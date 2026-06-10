# Bug 单·设计单·程序单 状态闭环全链路手册

> 维护日期：2026-06-10  
> 适用范围：`project-manager` 项目内与单子类型、绑定关系、推单流程相关的开发工作。

---

## 一、业务模型总览

### 1.1 三种单子类型

| 类型 | 职责（ResponsibilityKind） | 典型场景 |
|------|---------------------------|---------|
| 程序单 | `PROGRAM` | 开发任务，编码实现 |
| 设计单 | `DESIGN` | UI 设计、视觉稿 |
| Bug 单 | `BUG` | 缺陷修复单 |

**关键约束**：`DESIGN` 和 `BUG` 依赖 `PROGRAM` 而生，不能独立创建。
- 从设计单推程序单（`DesignProgramBinding`）
- 从程序单推 Bug 单（`BugProgramBinding`）

### 1.2 两张绑定表

```
DesignProgramBinding    // 设计单 → 程序单（1:1）
  sourceTicketId (设计单)
  targetTicketId (程序单，可空)
  status: PENDING | SUCCEEDED | FAILED
  draftTitle / draftDescription
  programAssigneeIds / designAssigneeIds

BugProgramBinding        // Bug 单 → 程序单（1:N，一个程序单可对应多个 Bug）
  bugTicketId
  programTicketId
  draftTitle
  fixCommitIds    // 关联的 fix 提交 ID
  boundById
```

**语义澄清**（踩坑总结）：
- `DesignProgramBinding` 是**设计单**持有的绑定记录，source = 设计单，target = 程序单
- `BugProgramBinding` 是**程序单**持有的绑定记录，programTicket = 程序单，bugTicket = Bug 单
- 两张表方向相反，读代码时注意区分 source/target 和 bugTicket/programTicket

### 1.3 状态闭环图

```
程序单 DONE
    │
    ├──[push-record]──▶ 设计单 ◀──[DesignProgramBinding]── 程序单
    │                     │
    │                     │ (设计单 DONE 后可继续推新程序单)
    │                     ▼
    │                  设计单 DONE ──[DesignProgramBinding]──▶ 程序单
    │
    └──[Bug单流程]──▶ Bug 单 ◀──[BugProgramBinding]── 程序单
                          │
                          │ (Bug单 DONE 后继续)
                          ▼
                       Bug 单 DONE ──[BugProgramBinding]──▶ 程序单
```

---

## 二、API 路由职责全景图

### 2.1 DesignProgramBinding 相关（设计单推程序单）

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/tickets/[id]/push-record` | GET | 获取当前设计单的绑定快照 |
| `/api/tickets/[id]/push-record/update` | PATCH | 创建或更新绑定（含目标程序单 ID） |
| `/api/tickets/[id]/push-record/resolve` | GET | 解析设计单应处于 `bound / candidate / unbound` 哪种状态 |
| `/api/tickets/[id]/route.ts` | GET | 单子详情，查询 DesignProgramBinding（via `ticket.pushSources`） |
| `/api/tickets/[id]/route.ts` | DELETE | 删除单子时清理 DesignProgramBinding（source/target 两侧） |

### 2.2 BugProgramBinding 相关（程序单推 Bug 单）

| 路由 | 方法 | 职责 |
|------|------|------|
| `/api/tickets/[id]/bug-ticket` | POST | **仅创建** Bug 单（返回新单信息） |
| `/api/tickets/[id]/bug-relations` | GET | 获取程序单已绑定的所有 Bug 单列表 |
| `/api/tickets/[id]/bug-relations` | POST | **仅绑定**已有 Bug 单到程序单 |
| `/api/tickets/[id]/bug-relations/resolve` | GET | 解析程序单的 Bug 候选（优先级：同名模块 → fix 提交关联 → 标题相似） |
| `/api/tickets/[id]/bug-relations/actions` | POST | 解绑 Bug 单 |
| `/api/tickets/[id]/bug-relations/actions` | DELETE | 删除绑定关系 |
| `/api/tickets/[id]/bug-fix-commits` | GET | 获取 Bug 单关联的 fix 提交 |
| `/api/tickets/[id]/route.ts` | GET | 单子详情，查询 BugProgramBinding（via `ticket.bugSources / bugTargets`） |

### 2.3 职责划分原则（踩坑后确立）

```
bug-ticket POST   = 只创建 Bug 单，不写绑定
bug-relations POST = 只写 BugProgramBinding 绑定，不创建单子
```

两者严格分离，前端先调 `bug-ticket`，再调 `bug-relations`。

---

## 三、前端组件链路

### 3.1 程序单详情页 (`ProgramTicketDetail.tsx`)

```
程序单详情
  ├── TicketPushPanel (color="rose")
  │     ├── 打开 Bug 推送模态框 → PushConfirmModal (mode="bug")
  │     │     └── 用户确认 → handleBugPush()
  │     │           ├── POST /api/tickets/[id]/bug-ticket      → 创建 Bug 单
  │     │           └── POST /api/tickets/[id]/bug-relations   → 绑定到程序单
  │     │
  │     ├── openBugSearch()
  │     │     └── GET /api/tickets/[id]/bug-relations/resolve  → 智能检索候选 Bug
  │     │
  │     └── Bug 绑定列表 → GET /api/tickets/[id]/bug-relations
  │
  ├── 历史提交列表（程序单自身的 commit）
  └── CommitDiffModal（提交详情）
```

### 3.2 设计单详情页 (`TicketDetail.tsx`)

```
设计单详情
  ├── TicketPushPanel (color="emerald")   // 原有逻辑
  │     ├── 打开程序单推送表单
  │     ├── openPushForm()
  │     │     └── GET /api/tickets/[id]/push-record/resolve   → bound / candidate / unbound
  │     ├── handleCreateTicket()
  │     │     └── POST /api/tickets/[id]/push-record/update   → 创建+绑定
  │     └── handleBindCandidate()                                → 直接绑定候选程序单
  └── DesignProgramBinding 展示区
```

### 3.3 Bug 单详情页 (`BugTicketDetail.tsx`)

```
Bug 单详情
  ├── 来源程序单卡片（via bugSources[0].programTicket）
  │     └── Link → 跳转程序单
  ├── 修复提交记录（fix: 开头的提交）
  │     ├── 本单自带的 fix commits
  │     └── /api/tickets/[id]/bug-fix-commits 返回的 fix commits
  └── CommitDiffModal
```

---

## 四、本次排坑全记录（2026-06-10）

### 坑 1：`bug-ticket` 写错绑定表

**表现**：`POST /api/tickets/[id]/bug-ticket` 后，数据库里 `DesignProgramBinding` 出现了 bug 单数据，`BugProgramBinding` 没有记录。

**根因**：历史代码把 Bug 单创建时的绑定写入了 `DesignProgramBinding`（设计→程序绑定表），方向完全错误。

**修复**：`bug-ticket/route.ts` 不再写入任何绑定表，只负责创建 Bug 单。绑定由前端调用 `bug-relations POST` 完成。

---

### 坑 2：`bug-ticket` 和 `bug-relations` 职责重叠

**表现**：前端 `TicketPushPanel.handleCreateTicket()` 同时调用了两个接口，但两个接口都在写 `BugProgramBinding`，导致重复绑定（409 冲突）。

**根因**：之前 `bug-ticket` 内部也写了 `BugProgramBinding`，与 `bug-relations` 职责重叠。

**修复**：职责彻底分离：
- `bug-ticket POST` = 只创建 Bug 单（`$transaction` 内含 ticket + assignee history + status history）
- `bug-relations POST` = 只写入 `BugProgramBinding`

前端顺序调用：
```tsx
const res = await fetch(`/api/tickets/${ticketNo}/bug-ticket`, { method: "POST", ... });
const bindRes = await fetch(`/api/tickets/${ticketNo}/bug-relations`, { method: "POST", ... });
```

---

### 坑 3：表名语义容易混淆

**表现**：仅看 `sourceTicketId`/`targetTicketId` 字段名，无法直观判断是谁引用谁。

**结论**：记住方向约定：
- `DesignProgramBinding.sourceTicketId` = 设计单 ID
- `BugProgramBinding.programTicketId` = 程序单 ID

代码里已经用注释和 relation name 做了区分（`PushSourceTicket` / `PushTargetTicket` / `BugSourceTicket` / `BugTargetTicket`），但 relation 命名也是反的：
- `BugSourceTicket` 指向 `bugTicketId`（Bug 单）
- `BugTargetTicket` 指向 `programTicketId`（程序单）

**建议**：不要改 relation 名（改 schema 代价大），在代码注释中明确方向。

---

### 坑 4：`push-record/resolve` vs `bug-relations/resolve` 逻辑相似但独立

**发现**：两个 resolve 接口逻辑结构几乎相同：
1. 查已绑定记录
2. 按优先级找候选（同名模块 > fix 提交 > 标题相似）
3. 权限过滤
4. 返回 `bound / candidate / unbound`

**区别**：
- `push-record/resolve`：设计单找程序单候选（用 `DesignProgramBinding` 判断是否已绑定）
- `bug-relations/resolve`：程序单找 Bug 单候选（用 `BugProgramBinding` 判断已绑定列表）

两个接口独立维护，后续如果修 bug，记得两边逻辑保持一致。

---

## 五、关键业务规则

### 5.1 Bug 单的 fix 提交匹配规则（`bug-relations/resolve`）

```
优先级 1：同一模块 + 同名标题的 Bug 单（排除已绑定）
         ↓ 没找到
优先级 2：从 fix 提交中提取被修复的单号 #XXXXX，查找对应 Bug 单
         ↓ 没找到且有 fix 提交
优先级 3：标记 shouldAutoCreate = true（预填 fix 信息给用户创建 Bug 单）
         ↓ 没有 fix 提交
优先级 4：标题包含程序单标题的 Bug 单
```

fix 关键词支持：`fix:xxx`、`fix：xxx`、`fix 修补xxx` 等变体。

### 5.2 模块自动创建规则

**从设计单推程序单时**：
- 用户选择或新建程序模块
- 模块创建在 `push-record/update` 或 `POST /api/tickets` 事务中

**从程序单推 Bug 单时**：
- 如果用户传了 `newModuleName`：在 Bug 职责下查找或创建同名模块
- 如果用户传了 `moduleId`（程序模块 ID）：在 Bug 职责下查找或创建同名模块
- 如果都没传：使用 Bug 职责下第一个模块，没有则创建" Bug 模块"

### 5.3 权限规则

所有操作（读/写/绑定/解绑）都需满足：
```
creator === session.user.id
  || assignees 包含 session.user.id
  || session.user.role === "ROOT"
```

---

## 六、标准开发流程

### 6.1 动 schema 后的闭环步骤

```
1. 改 prisma/schema.prisma
2. 确认 .env.local 中 DATABASE_URL
3. set -a && source .env.local && set +a && npx prisma db push
4. 确认 "Generated Prisma Client" 出现
5. npm run build 验证
6. 再测试功能链路
```

### 6.2 新增绑定类型的检查清单

如果新增第三种绑定（如"测试单"），需要检查：

- [ ] Prisma schema：新模型 + relation + @@unique + @@index
- [ ] db push 成功
- [ ] API 路由：GET(list) / POST(create binding) / DELETE(unbind) / resolve(候选解析)
- [ ] 前端：组件中调用 API，展示绑定列表
- [ ] 目标单详情页：通过 `bugSources` / `bugTargets` 或新增 relation 展示来源
- [ ] 权限检查：读/写/删三处
- [ ] 删除目标单时：级联清理绑定关系

### 6.3 测试验收清单

**Bug 单绑定链路**：
- [ ] 程序单详情页展示 Bug 推送入口
- [ ] 检索已有 Bug 单时正确匹配（同名模块优先）
- [ ] 有 fix 提交时预填 fix 信息
- [ ] 创建新 Bug 单 → 自动绑定
- [ ] 刷新后绑定信息仍存在
- [ ] 解绑后再次绑定正常
- [ ] Bug 单详情页显示来源程序单
- [ ] Bug 单显示关联的 fix commits

**设计单推程序单链路**：
- [ ] 设计单 DONE 后展示推单卡片
- [ ] 检索候选程序单（同名模块 + 同名标题）
- [ ] 创建程序单 → 自动绑定
- [ ] 已绑定状态下更新程序单不额外创建
- [ ] 删除程序单后，DesignProgramBinding 被清理

---

## 七、AI 指令模板

后续让 AI 修复这块功能时，推荐使用以下模板：

### 模板 A：完整链路审查

```
请审查 project-manager 中"程序单 ↔ Bug 单 ↔ 设计单"绑定相关的所有 API 和前端代码：

1. 确认 DesignProgramBinding（设计→程序）和 BugProgramBinding（Bug→程序）的读写路由是否各司其职
2. 确认 bug-ticket POST 只创建单子，bug-relations POST 只写绑定，前端是否顺序调用
3. 检查 resolve 接口的候选匹配逻辑是否完整（同名模块 > fix提交 > 标题相似）
4. 检查权限检查在所有路由中是否一致
5. 检查删除单子时是否正确清理绑定关系
6. 验证 npm run build 通过
```

### 模板 B：Bug 修复型

```
修复 project-manager 中以下问题（选一或多）：
1. bug-relations/resolve 返回的 shouldAutoCreate 逻辑有误
2. Bug 单详情页没有正确显示来源程序单
3. 解绑后绑定列表没有刷新
4. push-record/update 在某些 edge case 下重复插入记录
```

---

## 八、相关文档索引

| 文档 | 内容 |
|------|------|
| `docs/DESIGN_TO_PROGRAM_PUSH_FLOW.md` | 设计单推程序单完整交付手册（表名旧为 TicketPushRecord） |
| `docs/ARCHITECTURE.md` | 项目整体架构、权限体系 |
| `docs/OPERATIONS.md` | 部署、重启、环境变量 |
| `.cursor/skills/pm-dev/SKILL.md` | 开发 skill |
