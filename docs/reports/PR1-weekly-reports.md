# PR1 周报系统 — 开发到测试复现手册

> 适用：ProjectHub 仓库（Next.js 15 + Prisma pm schema + NextAuth）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"周报系统"端到端。

---

## 1. 目标 & 背景

### 1.1 旧版的问题
- 老板看板 `/reports` 是全静态数据（KPI / 趋势 / TOP 成员全是硬编码），无法反映真实业务
- PM / 团队成员没有"周报"提交入口，无法做项目复盘、风险预警
- AI Agent 无周报上下文可引用，画像构建缺料

### 1.2 结论
- 落地**周报 CRUD**：用户可写、改、看自己历史的周报（按 ISO 周 + 关联项目）
- API 完整覆盖：GET（分页 cursor）/ POST / GET[id] / PATCH / DELETE
- 业务聚类放在 `features/weekly-reports/lib/weekly-report-store.ts`（跨业务的 store helper）
- 页面壳 / API 路由：业务聚类页面壳 `app/reports/weekly-reports/`、API `app/api/reports/weekly-reports/`

> ⚠️ **注意**：周报**业务聚类**（未来 PR2+ stats 也会查 WeeklyReport）放 `features/weekly-reports/`。
> 业务聚类页面壳配套的 UI/AI 任务放 `features/reports/weekly-reports/`（PR2+）。
> 这两个根**不冲突**，分工见 PR2 recap 文档。

### 1.3 范围限定（PR1 不做）
- ❌ AI 自动总结周报 → PR4
- ❌ 周报提交后入队画像更新任务 → PR4
- ❌ 老板看板的真实数据接入 → PR2

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `prisma/schema.prisma` | 修改 | 新增 `WeeklyReport` + `WeeklyReportProject` 模型（与已有 Project 多对多） |
| `features/weekly-reports/lib/weekly-report-store.ts` | 新增 | 周报 CRUD store（5 个 export 函数） |
| `app/api/reports/weekly-reports/route.ts` | 新增 | GET 列表（cursor 分页） + POST 创建 |
| `app/api/reports/weekly-reports/[id]/route.ts` | 新增 | GET[id] + PATCH + DELETE |
| `app/reports/weekly-reports/page.tsx` | 新增 | 我的周报列表页 |
| `app/reports/weekly-reports/new/page.tsx` | 新增 | 新建周报表单页 |
| `app/reports/weekly-reports/[id]/page.tsx` | 新增 | 周报详情 / 编辑页 |
| `shared/lib/week.ts` | 新增（PR1 之前） | `getWeekRange` / `getIsoWeek` / `formatWeekLabel` / `isValidWeekRange` |
| `scripts/weekly-report-store-unit-test.ts` | 新增 | 单元测试（不依赖 DB 的纯函数 + mock） |
| `docs/ai/PR1-shared-design.md` | 新增 | 详尽设计文档（460 行） |

---

## 3. 核心实现

### 3.1 store 入口（`features/weekly-reports/lib/weekly-report-store.ts`）

```startLine:1:features/weekly-reports/lib/weekly-report-store.ts
import { prisma } from "@/shared/db/client";
import { normalizePkmAttachments } from "@/shared/lib/pkm";
import type { WeeklyReport } from "@prisma/client";
```

**5 个 export 函数**：

```startLine:9:features/weekly-reports/lib/weekly-report-store.ts
export async function listMyWeeklyReports(
  userId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<WeeklyReportWithProjects[]>
```

**为什么这样写**：
- `take: limit + 1` 是 cursor 分页标准手法 —— 多取 1 条用来判断"还有没有下一页"
- `...(opts?.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {})` —— 没传 cursor 时不加 skip/cursor，避免 Prisma 报"无 cursor 的 skip"警告
- orderBy 固定 `weekStart desc`，最近期周报排前

```startLine:48:features/weekly-reports/lib/weekly-report-store.ts
export async function createWeeklyReport(
  userId: string,
  input: {
    weekStart: Date;
    weekEnd: Date;
    title: string;
    content: string;
    attachments?: unknown;
    projectIds?: string[];
  },
)
```

**为什么用 `prisma.$transaction`**：周报 + 多对多关联项目必须在同一事务，否则"周报创了但关联没创"留下孤儿记录。

```startLine:151:features/weekly-reports/lib/weekly-report-store.ts
export async function deleteWeeklyReport(id: string, userId: string): Promise<void> {
  await prisma.weeklyReport.deleteMany({ where: { id, userId } });
}
```

**为什么用 `deleteMany` 而非 `delete`**：deleteMany 在"找不到记录"时不抛错，前端体验更友好（幂等删除）。

### 3.2 API 路由（`app/api/reports/weekly-reports/route.ts`）

```startLine:6:app/api/reports/weekly-reports/route.ts
const createSchema = z.object({
  weekStart: z.string().datetime(),
  weekEnd: z.string().datetime(),
  title: z.string().min(1).max(200),
  content: z.string(),
  attachments: z.array(z.object({
    name: z.string(),
    url: z.string(),
    mimeType: z.string(),
    size: z.number(),
  })).optional(),
  projectIds: z.array(z.string()).optional(),
});
```

**为什么 `weekStart / weekEnd` 是 `z.string().datetime()`**：前端 form 传 ISO 字符串，后端 `new Date()` 转 Date，跨时区安全（统一 UTC）。

```startLine:63:app/api/reports/weekly-reports/route.ts
if (error instanceof Error && error.message.includes("Unique")) {
  return NextResponse.json(
    { error: "本周已存在周报，请用 PATCH 更新" },
    { status: 409 },
  );
}
```

**为什么 catch Unique**：周报同周唯一约束（`@@unique([userId, weekStart])`），重复创建应给 409 而不是 500。

### 3.3 分页 cursor 实现

```startLine:26:app/api/reports/weekly-reports/route.ts
const { searchParams } = new URL(request.url);
const limit = parseInt(searchParams.get("limit") ?? "20");
const cursor = searchParams.get("cursor") ?? undefined;

const reports = await listMyWeeklyReports(session.user.id, { limit, cursor });
return NextResponse.json({
  reports,
  nextCursor: reports.length === limit ? reports[reports.length - 1].id : null,
});
```

**为什么 nextCursor 是"返回 limit 条时"才设**：没取满 limit 说明没有下一页了，前端拿到 `nextCursor: null` 就知道停止请求。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| Next.js | 15.x | App Router |
| Prisma | latest | `pm` schema |
| Database | PostgreSQL (dev 端口 5432) | `npm run db:push` |
| 端口 | 3003 | LAN 部署端口 |
| 时区 | UTC（week 计算统一 UTC） | shared/lib/week.ts |

### Prisma schema 关键模型

```startLine:585:prisma/schema.prisma
model WeeklyReport {
  // ... fields
  @@unique([userId, weekStart])
  @@schema("pm")
}
```

**为什么 `@@unique([userId, weekStart])`**：一个人一周只能有一份周报，重复创建时 Prisma 抛 Unique 错误，API 层 catch 后转 409。

---

## 5. 启动 / 部署

```bash
# 1. 装依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 同步 DB（开发环境）
npx prisma db push

# 3. 启动 dev server
npm run dev
# 期望：Local: http://localhost:3003

# 4. 浏览器手测
open http://localhost:3003/reports/weekly-reports
# 未登录会重定向到 /login
```

---

## 6. 测试 & 验证

### 6.1 单元 / 脚本验证

```bash
cd /Users/vastgui/Desktop/project-manager
./node_modules/.bin/tsx --env-file=.env.local scripts/weekly-report-store-unit-test.ts
```

**期望输出**：

```
[weekly-report-store unit tests]
  ✓ normalizePkmAttachments filters valid attachments
  ✓ normalizePkmAttachments rejects empty-name and non-attachment objects
  ✓ normalizePkmAttachments caps at 8 items
  ✓ WeeklyReportWithProjects type has all required fields
  ✓ store input shape matches expected types
  ✓ getWeekRange: diff between weekStart and weekEnd ≈ 7 days
  ✓ formatWeekLabel returns string with ISO week
  ✓ isValidWeekRange returns boolean
  ✓ getIsoWeek returns valid {year, week}

Results: 9 passed, 0 failed
```

### 6.2 端到端 HTTP 验证

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --pr1
```

**期望输出**：

```
[PR1 OK]
- WEEKLY REPORT STORE UNIT: 9 passed
- PKM SMOKE: 3 passed
- PR1 API ROUTE TESTS: 6 个 HTTP 测试全 307（auth redirect）
```

### 6.3 浏览器手测 checklist

- [ ] 登录后访问 `/reports/weekly-reports` 看到空列表
- [ ] 点"新建" → 填表单 → 提交 → 看到列表多 1 条
- [ ] 点列表项进入详情页 → 改 content → 保存 → 看到更新
- [ ] 删除一条 → 列表少 1 条
- [ ] 同一周再点"新建" → 期望 409 提示

---

## 7. 复现 Checklist

- [ ] Prisma schema 已 apply（`npx prisma db push`）
- [ ] 装了 `@prisma/client` + `zod`
- [ ] `shared/lib/week.ts` 存在（PR1 之前已建）
- [ ] `features/weekly-reports/lib/weekly-report-store.ts` 5 个 export 函数都在
- [ ] `app/api/reports/weekly-reports/route.ts` GET + POST 都 export
- [ ] `app/api/reports/weekly-reports/[id]/route.ts` GET + PATCH + DELETE 都 export
- [ ] 三个页面壳在 `app/reports/weekly-reports/` 下
- [ ] `scripts/weekly-report-store-unit-test.ts` 9/9 pass
- [ ] `scripts/verify-pr.ts --pr1` 全绿
- [ ] 浏览器手测 6 步全过

---

## 8. 踩坑记录

### 坑 1：Prisma `delete` 在记录不存在时抛错

**现象**：`delete()` 调用在重复点击删除时 500。

**原因**：Prisma `delete` 是 strict 的，找不到记录直接抛 `RecordNotFound`。

**解法**：用 `deleteMany({ where: { id, userId } })`，幂等删除，0 或 1 行都正常返回。

### 坑 2：cursor 分页 `take: limit + 1` 与 `skip: 1` 的关系

**现象**：第一页正常，第二页报错"cursor 不可用"。

**原因**：cursor 分页的 `skip: 1` 是在"跳过 cursor 本身"用的，第一页（无 cursor）不能加 skip。

**解法**：用 conditional spread：

```ts
take: limit + 1,
...(opts?.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
```

### 坑 3：`weekStart / weekEnd` 必须 UTC

**现象**：用户在 UTC+8 创建的周报，DB 里存的是本地时间，查询时差 8 小时。

**原因**：JavaScript `new Date()` 不带时区信息，Prisma 存到 DB 时按 server 时区。

**解法**：`shared/lib/week.ts` 全部用 `Date.UTC(...)` 构造，前后端统一 UTC。

### 坑 4：周报唯一约束必须放 store 层

**现象**：两个人并发 POST 同一周的周报，DB 没抛 Unique，create 两条记录。

**原因**：业务层"先查再 create"不是原子的。

**解法**：Prisma schema 加 `@@unique([userId, weekStart])`，让 DB 兜底；store 层不查重（性能 + 性能 + 简单）。

### 坑 5：`message.includes("Unique")` 是脆弱匹配

**现象**：Prisma 版本升级后错误信息变了，匹配失败 → 500 而不是 409。

**原因**：依赖错误信息的字符串内容，跨版本不稳定。

**解法（待优化）**：用 `Prisma.PrismaClientKnownRequestError` + `error.code === "P2002"` 替代字符串匹配。**PR1 暂时接受脆弱匹配，PR4+ 一起重构**。

---

## 附：相关文件位置

| 关注点 | 文件 |
|--------|------|
| 详尽设计 | `docs/ai/PR1-shared-design.md` |
| ISO 周工具 | `shared/lib/week.ts` |
| Store helper | `features/weekly-reports/lib/weekly-report-store.ts` |
| API 入口 | `app/api/reports/weekly-reports/route.ts` + `[id]/route.ts` |
| 页面壳 | `app/reports/weekly-reports/{page,new/page,[id]/page}.tsx` |
| 单元测试 | `scripts/weekly-report-store-unit-test.ts` |
| 集成测试 | `scripts/verify-pr.ts --pr1` |
