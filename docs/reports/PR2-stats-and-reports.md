# PR2 报表真实化 — 开发到测试复现手册

> 适用：ProjectHub 仓库（Next.js 15 + Prisma pm schema + NextAuth）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"老板看板报表真实化"端到端。

---

## 1. 目标 & 背景

### 1.1 旧版的问题
- 老板看板 `/reports` 是全静态数据（KPI / 趋势 / TOP 成员 / 项目进度全是硬编码）
- 老板看板上**没有"本周周报状态"**（已交/未交），无法直接做人员管理动作
- 团队健康度**没有 AI 总结**，全靠人肉看

### 1.2 结论
- 落地**真实数据驱动的报表首页**：
  - 5 个数据块：KPI、任务趋势、项目状态占比、项目进度、TOP 成员、本周周报状态、AI 健康度
- 业务聚类放在 `features/reports/`（与页面壳 `app/reports/` 对齐）
- 健康度 AI 总结：ROOT 限 + in-memory TTL=1h 缓存
- 提前建好 PR4 钩子：`features/reports/weekly-reports/lib/background-jobs.ts` + regenerate 占位 API

### 1.3 范围限定（PR2 不做）
- ❌ AI 健康度走真 LLM → PR4（PR2 用模板占位）
- ❌ 周报提交后入队 summarizer → PR4
- ❌ ProjectStatus 加 enum（DB 不可用 + 现有 String 字段够用）

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/reports/lib/reports-store.ts` | 新增 | 5 数据块并行聚合（Promise.all） |
| `shared/lib/health-cache.ts` | 新增 | 健康度 AI 总结缓存（globalThis + TTL=1h） |
| `app/api/reports/stats/route.ts` | 新增 | GET 报表聚合 API |
| `app/api/reports/health-summary/route.ts` | 新增 | GET 健康度 AI 总结（ROOT only） |
| `app/reports/page.tsx` | 重写 | 服务端组件，直接调 store 渲染 |
| `features/reports/ui/ReportsKpiCards.tsx` | 新增 | 4 个 KPI 卡 |
| `features/reports/ui/ReportsTrendChart.tsx` | 新增 | 6 周趋势柱状图 |
| `features/reports/ui/ReportsProjectStatus.tsx` | 新增 | 项目状态占比饼图 |
| `features/reports/ui/ReportsProjectHealth.tsx` | 新增 | 项目进度条列表 |
| `features/reports/ui/ReportsTopMembers.tsx` | 新增 | TOP 5 贡献者 |
| `features/reports/ui/ReportsWeeklyStatus.tsx` | 新增 | 本周周报 submitted/missing |
| `features/reports/ui/ReportsHealthAi.tsx` | 新增 | AI 健康度客户端组件 |
| `features/reports/ui/index.ts` | 新增 | barrel export |
| `features/reports/weekly-reports/lib/background-jobs.ts` | 新增 | PR4 占位（2 个空函数） |
| `app/api/reports/weekly-reports/[id]/regenerate/route.ts` | 新增 | PR4 占位（POST → 501） |
| `scripts/reports-store-unit-test.ts` | 新增 | 17 个纯函数测试 |
| `scripts/verify-pr.ts` | 扩展 | 支持 `--pr2` 和 `--all` |

---

## 3. 核心实现

### 3.1 报表 store 入口（`features/reports/lib/reports-store.ts`）

```startLine:195:features/reports/lib/reports-store.ts
export async function getReportsStats(): Promise<ReportsStats> {
  // 并行发起所有独立查询
  const [
    projects,
    monthlyTickets,
    doneCountMap,
    thisWeekReports,
    ticketTrend,
  ] = await Promise.all([
    getActiveProjects(),
    getMonthlyTicketsCount(),
    getRecentDoneTicketCountByCreator(30),
    getThisWeekReports(),
    getTicketTrend(6),
  ]);
  // ... 后处理
}
```

**为什么这样写**：
- 5 个独立查询**并行发起**，HTTP 总延迟 ≈ max(各查询)，不是 sum
- 这是 4 模块排错基本功（路线二）里学过的"独立 IO 必并行"

### 3.2 ticketTrend 周边界预计算 + 并行

```startLine:162:features/reports/lib/reports-store.ts
async function getTicketTrend(weekCount = 6): Promise<number[]> {
  const now = new Date();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const weeks = Array.from({ length: weekCount }, (_, i) => {
    const ref = new Date(now.getTime() - (weekCount - 1 - i) * WEEK_MS);
    const { weekStart, weekEnd } = getWeekRange(ref);
    return { gte: weekStart, lt: weekEnd };
  });

  const counts = await Promise.all(
    weeks.map((w) => prisma.ticket.count({ where: { createdAt: w } }))
  );
  return counts;
}
```

**为什么 `weekCount - 1 - i`**：从最早一周（W-5）到当前周（W-0），保证 result 顺序是历史→当前。
**为什么 `gte: weekStart, lt: weekEnd`**：用 ISO 周边界，避免跨天串扰。

### 3.3 topMembers 3 路并行（groupBy × 2 + findMany）

```startLine:243:features/reports/lib/reports-store.ts
// --- top members ---
const allUserIds = [...doneCountMap.keys()];
const [totalDoneMap, totalCreatedMap, users] = await Promise.all([
  prisma.ticket.groupBy({
    by: ["creatorId"],
    _count: { _all: true },
    where: { creatorId: { in: allUserIds }, status: "DONE" },
  }).then((rows) => new Map(rows.map((r) => [r.creatorId, r._count._all]))),
  prisma.ticket.groupBy({
    by: ["creatorId"],
    _count: { _all: true },
    where: { creatorId: { in: allUserIds } },
  }).then((rows) => new Map(rows.map((r) => [r.creatorId, r._count._all]))),
  prisma.user.findMany({
    where: { id: { in: allUserIds } },
    select: { id: true, name: true, image: true },
  }),
]);
```

**为什么用 `groupBy` 而不是 `findMany` + JS 聚合**：DB 层做 groupBy 比把 1 万条 ticket 拉到 Node 端再 reduce 快 10-100 倍。
**为什么 `creatorId: { in: allUserIds }`**：缩小 groupBy 范围，避免全表扫描。

### 3.4 健康度缓存（`shared/lib/health-cache.ts`）

```startLine:12:shared/lib/health-cache.ts
// Use globalThis so it survives Next.js dev HMR
const _cache = globalThis as typeof globalThis & {
  __health_summary_cache?: CacheEntry;
};
```

**为什么用 `globalThis`**：Next.js dev HMR 会重载模块，普通模块级变量会被清掉。`globalThis` 是 Node 全局对象，HMR 友好。
**为什么不放 SystemSetting（DB）**：PR2 阶段 DB schema 改动需 migrate + DB 不可用，in-memory 缓存够用。

### 3.5 health-summary ROOT 限

```startLine:12:app/api/reports/health-summary/route.ts
// ROOT only
if (session.user.role !== "ROOT") {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

**为什么 `session.user.role !== "ROOT"`**：BOSS/HR 不应该看到"团队健康度"（含个人 TOP），限定 ROOT 看到。

### 3.6 PR4 占位

```startLine:22:features/reports/weekly-reports/lib/background-jobs.ts
export function enqueueSummarizeWeeklyReport(reportId: string): void {
  console.warn(`[PR4 placeholder] enqueueSummarizeWeeklyReport: ${reportId}`);
}
```

**为什么只打日志不报错**：PR2 阶段 regenerate API 会调到这里，PR4 实现后无缝替换。
**为什么签名是 `void` 返回**：异步任务入队 = 立即返回，调用方不等结果。

```startLine:24:app/api/reports/weekly-reports/[id]/regenerate/route.ts
return NextResponse.json(
  { ok: false, code: "NOT_IMPLEMENTED", message: "PR4 待实施" },
  { status: 501 }
);
```

**为什么 501 不是 200**：501 = Not Implemented，调用方一看就知道"功能没做完"，不是"成功"。

### 3.7 业务聚类目录分工

```
features/weekly-reports/                     ← PR1: 跨业务的 store helper
└── lib/weekly-report-store.ts

features/reports/                            ← PR2+: 报表业务聚类
├── lib/reports-store.ts                     ← 5 数据块聚合
├── ui/Reports*.tsx                          ← 报表 UI 组件
└── weekly-reports/                          ← 报表页壳配套
    └── lib/background-jobs.ts               ← PR4 占位

app/reports/                                 ← 业务聚类页面壳
├── page.tsx                                 ← 报表首页
├── weekly-reports/                          ← 业务聚类页壳
└── (其他子模块未来可能加)

app/api/reports/                             ← 业务聚类 API
├── stats/route.ts
├── health-summary/route.ts
└── weekly-reports/
    ├── route.ts
    ├── [id]/route.ts
    └── [id]/regenerate/route.ts             ← PR4 占位
```

**为什么两个根 `features/weekly-reports/` 和 `features/reports/weekly-reports/` 共存**：
- `features/weekly-reports/lib/weekly-report-store.ts` 是**跨业务 helper**（PR2+ stats 也会查 WeeklyReport）
- `features/reports/weekly-reports/` 是**业务聚类页面壳的配套**（UI、AI 任务），与 `app/reports/weekly-reports/` 对齐
- 业务聚类页面壳在 `app/reports/weekly-reports/`，所以"业务实现"放 `features/reports/weekly-reports/`
- PR1 已落盘的 store 保持原位，不破坏现有 import

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 端口 | 3003 | dev server |
| 时区 | UTC（统一） | shared/lib/week.ts |
| ROOT 限 | `session.user.role === "ROOT"` | health-summary API |
| 缓存 TTL | 60 * 60 * 1000 (1h) | shared/lib/health-cache.ts |

---

## 5. 启动 / 部署

```bash
# 1. 启动 dev server
cd /Users/vastgui/Desktop/project-manager
npm run dev
# 期望：Local: http://localhost:3003

# 2. 浏览器手测
# - 登录 ROOT 账号 → 访问 /reports
# - 普通 USER 访问 /reports → 应看不到 AI 健康度（403）
```

---

## 6. 测试 & 验证

### 6.1 单元 / 脚本验证

```bash
cd /Users/vastgui/Desktop/project-manager
./node_modules/.bin/tsx --env-file=.env.local scripts/reports-store-unit-test.ts
```

**期望输出**：

```
[reports-store unit tests]
  ✓ bucketByProgress(10/10) → good
  ✓ bucketByProgress(8/10) → good
  ... (15 个 case)
Results: 17 passed, 0 failed
```

### 6.2 端到端 HTTP 验证

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --all
```

**期望输出**：

```
===== PR1 STEPS =====
[WEEKLY REPORT STORE UNIT] 9 passed
[PKM BOARD SMOKE] 3 passed
[PR1 API ROUTE TESTS] 6 个 HTTP 全 PASS

===== PR2 STEPS =====
[REPORTS STORE UNIT] 17 passed
[PR2 API ROUTE TESTS] 3 个 HTTP 全 PASS
  ✓ GET /api/reports/stats → 307 (auth)
  ✓ GET /api/reports/health-summary → 307 (auth)
  ✓ POST regenerate → 307

[PR1+PR2 OK]
```

### 6.3 浏览器手测 checklist

- [ ] 登录后访问 `/reports`，看到真实 KPI（不是硬编码 18/78%）
- [ ] 趋势图 6 根柱子来自真实 DB ticket 数据
- [ ] 项目状态占比饼图与进度条列表一致
- [ ] TOP 成员按近 30 天 DONE ticket 数排序
- [ ] 本周周报状态：已交/未交两个 list
- [ ] ROOT 账号看到 AI 健康度，普通 USER 看到"无权限"提示
- [ ] 点"重新生成"按钮，1h 内第二次点击应显示"缓存"标签

---

## 7. 复现 Checklist

- [ ] Prisma `WeeklyReport` 模型已 apply
- [ ] `shared/lib/health-cache.ts` 在
- [ ] `features/reports/lib/reports-store.ts` 5 个 helper + 1 个 public 函数
- [ ] `app/api/reports/stats/route.ts` + `health-summary/route.ts` 都 export GET
- [ ] `app/reports/page.tsx` 是 async server component（无 "use client"）
- [ ] 7 个 UI 组件 + index.ts barrel export
- [ ] `features/reports/weekly-reports/lib/background-jobs.ts` 2 个占位函数
- [ ] `app/api/reports/weekly-reports/[id]/regenerate/route.ts` 返回 501
- [ ] `scripts/reports-store-unit-test.ts` 17/17 pass
- [ ] `scripts/verify-pr.ts --all` 全绿
- [ ] tsc 无新增错误
- [ ] 浏览器手测 7 步全过

---

## 8. 踩坑记录

### 坑 1：ticketTrend 内部 for 循环串行 6 次 count

**现象**：子代理首版 `getTicketTrend` 用 for 循环 6 次 `await prisma.ticket.count`，**外层 `Promise.all` 包了，但内部是串行**。

**影响**：一次 `/api/reports/stats` 调用要等 6 个串行 RTT，从 ~50ms 变成 ~300ms。

**发现途径**：主代理审计 PR2 子代理产出时 Read `reports-store.ts:162-185` 发现 for 循环里 await。

**解法**：预计算 6 个周边界，再 `Promise.all` 并行发起 6 次 count：

```ts
const weeks = Array.from({ length: weekCount }, (_, i) => {
  const ref = new Date(now.getTime() - (weekCount - 1 - i) * WEEK_MS);
  const { weekStart, weekEnd } = getWeekRange(ref);
  return { gte: weekStart, lt: weekEnd };
});

const counts = await Promise.all(
  weeks.map((w) => prisma.ticket.count({ where: { createdAt: w } }))
);
```

### 坑 2：topMembers 的 groupBy + groupBy + findMany 没并行

**现象**：`getRecentDoneTicketCountByCreator` 是顶层 Promise.all 的一部分，但里面的两个 groupBy + 一个 findMany 是串行 await。

**影响**：3 个查询的延迟叠加，与"并行化"目标不符。

**解法**：包成 3 路 Promise.all：

```ts
const [totalDoneMap, totalCreatedMap, users] = await Promise.all([
  prisma.ticket.groupBy({...}).then((rows) => new Map(...)),
  prisma.ticket.groupBy({...}).then((rows) => new Map(...)),
  prisma.user.findMany({...}),
]);
```

### 坑 3：子代理跨 chat context 调度失灵

**现象**：主代理同时启动两个子代理（`fullstack-developer` 实施 + `ai-learning-mentor` 审计），audit 子代理拿 prompt 后永远 idle。

**原因**：两个子代理**不在同一 chat context**，audit 子代理拿不到"PR2 完成"的信号。prompt 文字里写"PR2 完成后 10 分钟内开始审计"是无效指令。

**解法**：
1. 主代理轮询主线（每 5-8 分钟查 transcript 文件大小）
2. 看到"## X 完工报告"信号后，再启动下一个子代理
3. 跨子代理协调由**主代理**负责，**不要**在子代理里写"等 X 完成"

**新加的 Rule**：`/Users/vastgui/Desktop/project-manager/.cursor/rules/subagent-coordination-sop.mdc`

### 坑 4：缺失子代理协作 SOP

**现象**：上次的子代理失败暴露了 SOP 空白——主代理习惯了"两个子代理同时跑"，没意识到"等 X 后做 Y"是无效指令。

**解法**：
- 新建 `.cursor/rules/subagent-coordination-sop.mdc`（主代理 + 全子代理共享）
- 更新 `fullstack-developer.md` 和 `ai-learning-mentor.md` 的协作流程段

### 坑 5：业务聚类目录分工不清晰

**现象**：PR1 已落盘 `features/weekly-reports/lib/weekly-report-store.ts`，PR2 要加"报表页壳配套"——放哪？

**取舍**：
- 方案 A：放 `features/weekly-reports/`（与 PR1 store 同根）→ 路径短，但跟"业务聚类页面壳"不一一对应
- 方案 B：放 `features/reports/weekly-reports/`（与 `app/reports/weekly-reports/` 对齐）→ 业务聚类一致

**用户拍板**：B（业务聚类一致），PR1 store 保持原位（跨业务 helper 性质特殊）。

**落地**：
- `features/weekly-reports/lib/weekly-report-store.ts` ← 不动
- `features/reports/weekly-reports/lib/background-jobs.ts` ← 新建，PR4 占位
- 两个根的 file header 都加注释说明"为什么这样分"

### 坑 6：`session.user.role` 类型是 string 不是 enum

**现象**：HealthAi.tsx 的 health-summary 接口返回 `fromCache: boolean`，但 Prisma `UserRole` 是 enum，写 `!== "ROOT"` 字符串比较。

**取舍**：
- 方案 A：用 enum 比对 `session.user.role !== UserRole.ROOT`
- 方案 B：字符串比对（直接）

**当前选择**：B（直接），因为 session 注入时 role 是字符串，避免 import Prisma enum 增加耦合。

---

## 附：相关文件位置

| 关注点 | 文件 |
|--------|------|
| 报表 store | `features/reports/lib/reports-store.ts` |
| 缓存 | `shared/lib/health-cache.ts` |
| 报表首页 | `app/reports/page.tsx` |
| API 入口 | `app/api/reports/{stats,health-summary}/route.ts` |
| 报表 UI | `features/reports/ui/Reports*.tsx` |
| 周报区块 | `features/reports/ui/ReportsWeeklyStatus.tsx` |
| 健康度 AI 区块 | `features/reports/ui/ReportsHealthAi.tsx` |
| PR4 占位 | `features/reports/weekly-reports/lib/background-jobs.ts` + `app/api/reports/weekly-reports/[id]/regenerate/route.ts` |
| 单元测试 | `scripts/reports-store-unit-test.ts` |
| 集成测试 | `scripts/verify-pr.ts --all` |
| 子代理 SOP | `.cursor/rules/subagent-coordination-sop.mdc` |
| PR1 复现 | `docs/reports/PR1-weekly-reports.md` |
