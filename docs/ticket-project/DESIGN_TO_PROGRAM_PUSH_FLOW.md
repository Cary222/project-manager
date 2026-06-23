# 设计单推程序单功能完整交付手册

## 目的

本文档记录“设计单完成后创建/绑定程序单”这条功能链路从实现到排坑的完整过程。目标是让后续任何人接手时：

- 一眼看懂功能目标
- 一眼看懂数据结构与接口关系
- 知道这次踩过的所有坑
- 按本文档执行后，AI 或人工都能稳定完成，不再反复试错

适用范围：`project-manager` 项目内与 ticket、module、push-record、ticketNo 分配相关的开发工作。

---

## 一、功能目标

### 1. 业务目标

当一张设计单进入 `DONE` 状态后，需要支持把它“推”成一张对应的程序单。

期望行为：

1. 设计单详情页展示“推单绑定”区域
2. 如果还没有程序单：
   - 可新建程序模块
   - 可新建程序单
   - 新建成功后立即与当前设计单绑定
3. 如果已经存在候选程序单：
   - 可直接绑定
4. 如果已经绑定程序单：
   - 页面显示当前已绑定程序单
   - 后续继续在该程序单上更新
5. 删除程序单时：
   - 需要清理对应 push-record
6. 单号生成必须稳定：
   - 创建单子时始终使用“当前最大单号 + 1”
   - 删除末尾单号后，应可复用该尾号

---

## 二、涉及的核心文件

### 前端

- `components/TicketDetail.tsx`
  - 推单 UI
  - 候选单 / 已绑定单展示
  - 新建程序单成功后的绑定动作

### 后端接口

- `app/api/tickets/[id]/push-record/route.ts`
  - 获取当前设计单的 push-record
- `app/api/tickets/[id]/push-record/update/route.ts`
  - 创建或更新 push-record
- `app/api/tickets/[id]/push-record/resolve/route.ts`
  - 解析当前设计单应处于 `unbound / candidate / bound` 哪种状态
- `app/api/tickets/route.ts`
  - 创建 ticket
- `app/api/tickets/[id]/route.ts`
  - 删除 ticket，同时清理 push-record

### 数据与辅助逻辑

- `prisma/schema.prisma`
  - `TicketPushRecord`
  - `Counter`
- `lib/ticket-counter.ts`
  - 单号分配与 counter 同步
- `scripts/cleanup-test-data.js`
  - 删除测试数据后，按“最大单号 + 1”修复计数器

---

## 三、最终正确的数据模型认知

### 1. TicketPushRecord 的职责

`TicketPushRecord` 不是普通备注表，而是“设计单 → 程序单”的绑定状态快照表。

关键字段含义：

- `sourceTicketId`
  - 设计单 id
- `targetTicketId`
  - 绑定的程序单 id，可为空
- `status`
  - `PENDING / SUCCEEDED / FAILED`
- `draftTitle`
  - 推单草稿标题
- `draftDescription`
  - 推单草稿描述
- `programAssigneeIds`
  - 程序单指派人
- `designAssigneeIds`
  - 设计单相关指派人快照

### 2. 关系约束

- 一个设计单只能有一条 push-record
- 所以 `sourceTicketId` 应唯一
- 一个程序单可能是某条 push-record 的目标单
- 删除 ticket 时，需要清掉：
  - 作为 source 的记录
  - 作为 target 的记录

---

## 四、这次踩过的坑与根因

## 坑 1：数据库里根本没有 `pm."TicketPushRecord"` 表

### 表现

终端报错：

```text
Raw query failed. Code: `42P01`. Message: `relation "pm.TicketPushRecord" does not exist`
```

表现为：

- `GET /api/tickets/[id]/push-record` 失败
- `GET /api/tickets/[id]/push-record/resolve` 失败
- `PATCH /api/tickets/[id]/push-record/update` 失败
- 整个推单绑定流程全挂

### 根因

代码里已经有 `TicketPushRecord` 模型，但数据库并没有执行 schema 同步。

也就是说：

- Prisma schema 已改
- 但 PostgreSQL 的 `pm` schema 未落表

### 正确处理

先加载环境变量，再执行：

```bash
set -a && source .env.local && set +a && npx prisma db push
```

如果只直接执行 `npx prisma db push`，可能还会踩另一个坑：

```text
Environment variable not found: DATABASE_URL
```

因为本项目使用 `.env.local`，而不是默认自动可见的 `.env`。

### 结论

只要动过 `prisma/schema.prisma`，必须优先确认：

1. `DATABASE_URL` 已加载
2. `npx prisma db push` 已成功
3. Prisma Client 已重新 generate

这是整个功能是否可跑通的前置条件。

---

## 坑 2：Prisma Client 运行时 delegate 不一致

### 表现

接口报错：

```text
Cannot read properties of undefined (reading 'upsert')
```

发生在：

- `prisma.ticketPushRecord.upsert(...)`
- `prisma.ticketPushRecord.findUnique(...)`

### 根因

在数据库没同步、Client 未稳定生成、或运行时状态不一致时，代码里虽然能写 `ticketPushRecord`，但运行时 delegate 可能是 `undefined`。

这类问题最容易让人误判成“前端没绑定上”，实际上是后端 ORM 层没准备好。

### 正确处理

在问题未彻底稳定前，`push-record` 这几条接口统一改成 raw SQL 读写，避免：

- 一部分接口走 Prisma delegate
- 一部分接口走 raw SQL
- 线上/本地行为不一致

最终保留的稳定策略：

- `push-record/route.ts` 用 raw SQL 查询
- `push-record/update/route.ts` 用 raw SQL 做查、插、改
- `push-record/resolve/route.ts` 用 raw SQL 读 push-record
- 删除 ticket 时，清理 push-record 用 raw SQL 删除

### 经验

如果某个新模型刚接入，且运行时 delegate 可疑，不要一边排 ORM delegate 一边排业务逻辑。先统一到 raw SQL，把功能跑通，再决定是否回切 Prisma delegate。

---

## 坑 3：把“绝对复用单号”误做成了“扫描空洞补号”

### 错误实现

曾经把 `allocateTicketNo()` 写成：

- 扫描所有 ticketNo
- 从 `10000` 开始找最小空缺号
- 找到空位就复用

这个逻辑看似聪明，实际上不符合项目要求。

### 用户真实要求

这里的“绝对复用”不是“填补中间空洞”，而是：

- 创建单子时，用当前最大单号 + 1
- 删除单子后，把 counter 重置为当前最大单号 + 1
- 如果删的是尾号，下次创建就复用这个尾号
- 如果中间删掉一个旧号，不回填中间洞

这和 `scripts/cleanup-test-data.js` 里的逻辑保持一致：

```text
nextValue = (maxTicket?.ticketNo ?? 9999) + 1
```

### 正确实现原则

`allocateTicketNo()` 的真实职责应该是：

- 按当前最大 ticketNo 计算下一号
- 而不是做“最小缺口填补器”

### 最终策略

在 `lib/ticket-counter.ts` 中：

- `allocateTicketNo()`：直接返回当前最大 ticketNo + 1
- `syncTicketCounterAfterCreate(ticketNo)`：创建成功后回写 counter 为 `ticketNo + 1`
- `syncTicketCounterAfterDelete()`：删除后重新按最大 ticketNo + 1 回写 counter

这样可以同时满足：

- 现有脏 counter 不影响创建
- cleanup 脚本语义一致
- 删除尾号后可复用

---

## 坑 4：只改了前端提示，没有校验绑定接口是否成功

### 表现

程序单已经创建成功，但页面以为“已绑定”，刷新后又没了。

### 根因

前端 `handleProgramTicketCreated()` 曾经是：

1. 发起 `/push-record/update`
2. 不检查 `response.ok`
3. 直接本地 `setPushRecord(...)`
4. 显示“已创建”

结果就是：

- ticket 创建成功
- 绑定接口失败
- 前端却伪造了“绑定成功”状态

### 正确处理

在 `components/TicketDetail.tsx` 中：

- 必须检查 `/push-record/update` 的返回值
- 如果失败：
  - 提示 `绑定程序单失败：...`
  - 不要更新本地已绑定状态
- 只有在接口成功时，才：
  - `setPushRecord(...)`
  - `setPushedProgramTicket(...)`
  - 显示“已创建并绑定”

### 经验

任何“创建 A 后立即绑定 B”的前端流程，都必须把“创建成功”和“绑定成功”视为两个独立结果，不能偷懒合并。

---

## 坑 5：推单区域权限判断过窄

### 表现

ROOT 用户有时看不到绑定区域，或者行为不一致。

### 根因

前端曾写成：

- 只有 `ticket.creatorId === session.user.id` 才允许读取或展示推单状态

这会导致：

- ROOT 虽然能操作很多资源
- 但在前端被错误挡掉

### 正确处理

推单展示与加载条件改为：

- 创建人可以看
- ROOT 也可以看

即：

- 数据加载条件放宽到 `creator || ROOT`
- 绑定状态卡片展示条件也放宽到 `creator || ROOT`

---

## 坑 6：更新已绑定程序单时，误走了“创建新单”路径

### 表现

已经绑定了程序单后，在“更新程序单”场景里提交表单：

- 原来的绑定程序单会被更新
- 但同时又会额外创建一张新的程序单
- 于是出现“更新成功了，但又多出一个新单”的错乱结果

### 根因

`components/TicketDetail.tsx` 虽然在已绑定场景下把提交回调切到了 `handleUpdateBoundProgramTicket()`，但复用的表单组件 `components/TicketCreateForm.tsx` 内部提交逻辑仍然固定是：

1. 必要时创建模块
2. `POST /api/tickets`
3. 创建成功后再调用 `onCreated`

这意味着：

- 即使按钮文案已经变成“更新程序单”
- 即使外层回调是 update handler
- 表单内部仍然先执行了“创建 ticket”

所以 bug 本质不是 update handler 写错，而是“创建表单”被错误复用到了“编辑模式”，却没有真正切换提交行为。

### 正确处理

必须把表单的“展示复用”和“提交语义”拆开。

最终修复方案：

- 在 `components/TicketCreateForm.tsx` 新增 `submitMode: "create" | "edit"`
- 当 `submitMode === "create"` 时：
  - 正常执行 `POST /api/tickets`
  - 创建完成后调用 `onCreated`
- 当 `submitMode === "edit"` 时：
  - 允许继续复用同一套表单 UI
  - 但不再调用 `POST /api/tickets`
  - 直接把表单数据交给外层 `onCreated`
- 在 `components/TicketDetail.tsx` 中：
  - 未绑定程序单时传 `submitMode="create"`
  - 已绑定程序单时传 `submitMode="edit"`

### 经验

任何“创建表单复用成编辑表单”的场景，都不能只改：

- 按钮文案
- 外层回调函数

还必须同时改掉表单内部真正的提交路径。否则 UI 看起来是“更新”，底层实际上还是“创建”。

---

## 坑 7：以为只改代码就够了，忽略了“schema / env / client / runtime”是一个闭环

这是这次最核心的教训。

在这个项目里，任何新增 Prisma 模型的功能，必须按下面顺序闭环处理：

1. 改 `prisma/schema.prisma`
2. 确认 `.env.local` 里的 `DATABASE_URL`
3. 执行 `npx prisma db push`
4. 确认 Prisma Client regenerate 完成
5. 再调接口
6. 再看前端状态

如果跳过第 3、4 步，前面看起来像是“接口 401”“绑定失败”“读取失败”“delegate undefined”，本质都只是 schema 没同步。

---

## 五、最终推荐实现方案

## 1. 单号分配方案

### 目标

保持与 cleanup 脚本一致。

### 规则

- 创建 ticket：`max(ticketNo) + 1`
- 删除 ticket 后：把 `counter.nextValue` 重置为 `max(ticketNo) + 1`
- 没有任何 ticket 时：下一个号为 `10000`

### 推荐职责划分

`lib/ticket-counter.ts`

- `allocateTicketNo()`
  - 只负责算当前最大号 + 1
- `syncTicketCounterAfterCreate(ticketNo)`
  - 创建后更新 counter
- `syncTicketCounterAfterDelete()`
  - 删除后按当前最大号更新 counter

这样即使 counter 曾经不准，也不会污染创建路径。

---

## 2. push-record 方案

### 推荐接口职责

#### `GET /api/tickets/[id]/push-record`

返回当前设计单保存的 push-record 快照。

#### `PATCH /api/tickets/[id]/push-record/update`

负责：

- 没记录则插入
- 有记录则更新
- 绑定目标程序单 id
- 返回最新 record

#### `GET /api/tickets/[id]/push-record/resolve`

负责：

- 如果已有 targetTicket → `bound`
- 否则尝试按模块名、标题等规则匹配候选程序单 → `candidate`
- 都没有 → `unbound`

### 推荐实现策略

在这个项目当前状态下，建议 `push-record` 全部统一使用同一种访问方式。

优先级建议：

1. 如果 Prisma delegate 运行稳定，可统一回到 Prisma
2. 若运行不稳定，三条接口全部统一 raw SQL
3. 不要混用

当前这次修复中，采用的是第 2 种：统一 raw SQL。

---

## 六、标准开发流程

以后任何人再做这块功能，请严格按这个顺序走。

### 第 1 步：先确认 schema

检查 `prisma/schema.prisma` 是否包含：

- `model TicketPushRecord`
- `model Counter`
- `@@schema("pm")`

### 第 2 步：同步数据库

```bash
set -a && source .env.local && set +a && npx prisma db push
```

不要跳过。

### 第 3 步：确认 Prisma Client 已生成

关注命令输出里是否出现：

```text
Generated Prisma Client
```

### 第 4 步：再跑功能链路

验证顺序：

1. 设计单进入 `DONE`
2. 打开详情页，能看到推单绑定区域
3. 创建程序模块
4. 创建程序单
5. `/push-record/update` 成功
6. 页面显示“已创建并绑定”
7. 刷新后仍保持绑定

### 第 5 步：验证删除与单号

1. 删除刚创建的尾号 ticket
2. 确认 counter 被回写为当前最大 ticketNo + 1
3. 再创建 ticket
4. 应复用刚删除的尾号

---

## 七、建议的验收清单

### A. 推单链路

- [ ] 设计单 `DONE` 后展示推单卡片
- [ ] 可创建程序模块
- [ ] 可创建程序单
- [ ] 创建成功后自动绑定
- [ ] 刷新后绑定信息仍存在
- [ ] 已绑定状态下点击“更新程序单”时，只更新原绑定单，不会额外创建新单
- [ ] 删除绑定的程序单后，push-record 被清理

### B. 单号链路

- [ ] 无 ticket 时首号为 `10000`
- [ ] 连续创建时严格递增
- [ ] 删除尾号后，下次创建复用尾号
- [ ] 删除中间旧号，不回填中间洞
- [ ] cleanup 脚本执行后，counter 回到“最大号 + 1`

### C. 环境链路

- [ ] `.env.local` 中 `DATABASE_URL` 可用
- [ ] `db push` 已成功
- [ ] `TicketPushRecord` 表存在于 `pm` schema
- [ ] Prisma Client 已重新生成

---

## 八、推荐给 AI 的执行指令模板

如果后续把这个任务交给 AI，建议直接给下面这种指令，AI 基本就不会再卡顿。

## 模板 1：完整修复型

```text
请在 project-manager 中完成“设计单 DONE 后创建并绑定程序单”的完整链路修复。
要求：
1. 先检查 prisma/schema.prisma 是否存在 TicketPushRecord 与 Counter，且都在 pm schema。
2. 先加载 .env.local，再执行 npx prisma db push，确认数据库已同步并重新生成 Prisma Client。
3. push-record 相关接口（route / update / resolve）统一使用同一种数据访问方式，不要混用 Prisma delegate 和 raw SQL。
4. 新建程序单后，前端必须检查 push-record/update 是否成功，成功后才更新本地已绑定状态。
5. 单号分配逻辑必须与 scripts/cleanup-test-data.js 一致：创建使用当前最大单号+1，删除后将 counter 重置为当前最大单号+1；删除尾号可复用，不能做中间空洞补号。
6. 删除 ticket 时要同时清理 source/target 两侧的 push-record。
7. 更新已绑定程序单时，必须只更新原绑定单，不能再次创建新 ticket
8. 改完后检查相关文件 lint，并给出验证步骤。
```

## 模板 2：只做功能，不做解释型

```text
按 docs/DESIGN_TO_PROGRAM_PUSH_FLOW.md 的流程，直接把设计单推程序单功能完整修好并自检：
- 先同步 Prisma schema 到数据库
- 再修 push-record 读写
- 再修 TicketDetail 绑定成功判断
- 再修“已绑定程序单更新时误创建新单”的表单提交模式问题
- 再修 ticketNo 创建与删除后的回退逻辑
- 最后输出验收结果
```

---

## 九、给后续维护者的结论

这类功能不是单点 bug，而是一个跨层闭环：

- Prisma schema
- PostgreSQL 落表
- Prisma Client 生成
- API 访问方式统一
- 前端绑定成功判断
- 删除与单号回退一致性

只修某一层，基本都会再次踩坑。

正确方式一定是：

- 先保证表存在
- 再保证接口访问方式一致
- 再保证前端只在接口成功后更新状态
- 最后保证 ticketNo 分配规则与 cleanup 脚本完全一致

做到这四点，这个功能就能稳定交付。

---

## 十、这次最终落地结果摘要

本次完整修复最终覆盖了：

- `TicketPushRecord` schema 落库
- `push-record` 全链路接口修复
- 前端绑定成功判断修复
- 已绑定程序单更新时的误创建新单问题修复
- 删除 ticket 时同步清理 push-record
- ticketNo 创建逻辑修复为最大单号 + 1
- ticketNo 删除后 counter 回退修复
- ROOT 视角下推单区域展示修复

如果后续再做同类需求，请先看本文档，再动代码。
