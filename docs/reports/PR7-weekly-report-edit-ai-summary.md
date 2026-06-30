# PR7 周报编辑页 AI 总结 + UI 统一 — 开发到测试复现手册

> 适用：`/Users/vastgui/Desktop/project-manager`（Next.js 15 + Prisma + shadcn 风格）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现** PR7「周报编辑页 AI 总结 + 详情/编辑合并 toggle 单页 + 列表页返回报表键」的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

| 问题 | 业务影响 |
|---|---|
| PR5 周报详情页的 AI 总结是 **被动生成**（后台 pipeline 自动跑），用户写周报时看不到自己本周做过的工单/笔记/对话/访问过的站点 | 写周报纯靠记忆，容易漏 |
| 编辑周报要走 `/weekly-reports/[id]/edit` 跳到另一个页面，**UI 风格与详情页不一致**（卡片包裹 / max-w-3xl） | 切页面有违和感 |
| 列表页 `/weekly-reports` 顶部没有"返回报表"键 | 用户从 `/reports` 进入周报列表后只能通过浏览器后退键返回 |

### 1.2 结论

1. **编辑页**新增"AI 总结"按钮 → 多数据源聚合（工单+笔记+AI 对话+站点访问）→ LLM 生成结构化 JSON → 并排面板显示 → "插入到正文 / 覆盖正文"由用户决定。
2. **详情页 + 编辑页合并** 为单页 toggle：`/weekly-reports/[id]` 内 `mode: 'view' \| 'edit'`，点"编辑"切换表单态、点"取消编辑"回到详情态。
3. **列表页**加"返回报表"键，链接到 `/reports`。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `app/api/reports/weekly-reports/draft-summary/route.ts` | 新增 | POST API，返回结构化 WeeklyDraftSummary（30s 限流 + 5min hash 缓存） |
| `features/reports/weekly-reports/lib/context-aggregator.ts` | 新增 | 多数据源聚合（4 源 fan-out，Promise.all 无 N+1） |
| `features/reports/weekly-reports/lib/draft-summary.ts` | 新增 | LLM 生成器（DRAFT_INSTRUCTION prompt → JSON 解析） |
| `features/reports/weekly-reports/ui/WeeklyDraftPanel.tsx` | 新增 | 并排面板（read-only 段 + 编辑切换 + 插入/覆盖/重新生成按钮） |
| `features/reports/weekly-reports/ui/WeeklyReportForm.tsx` | 修改 | 新增 AI 总结按钮、WeeklyDraftPanel 嵌入、新增 `onSaved` 回调、edit 模式跳回 view |
| `app/reports/weekly-reports/[id]/page.tsx` | **重写** | server component 壳，仅做 auth + fetch + 渲染 client 子组件 |
| `app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx` | 新增 | 详情/编辑 toggle 单页客户端组件（view/edit 双模式 + router.refresh 同步） |
| `app/reports/weekly-reports/[id]/edit/page.tsx` | **删除** | 路由已合并到 `[id]/page.tsx` 的 edit 模式 |
| `app/reports/weekly-reports/page.tsx` | 修改 | 顶部新增"返回报表"链接 |
| `app/reports/weekly-reports/new/page.tsx` | 修改 | `max-w-3xl`→`max-w-4xl`，去掉外层卡片包裹 |
| `features/reports/weekly-reports/ui/WeeklyReportList.tsx` | 修改 | "编辑""查看"按钮都指向详情页（toggle 内嵌编辑态） |
| `shared/lib/xss.ts` | 新增 | `escapeAiSummary` 从详情页抽取（XSS 转义共享） |
| `scripts/weekly-report-draft-summary-unit-test.ts` | 新增 | 14 用例纯逻辑测试 |
| `scripts/verify-pr.ts` | 修改 | 加 `--pr7` 选项 |
| `docs/reports/PR7-ai-summary-code-review.md` | 新增 | code-reviewer 审计报告（双代理产物） |
| `docs/reports/PR7-ai-summary-ai-audit.md` | 新增 | ai-learning-mentor 审计报告 |

---

## 3. 核心实现

### 3.1 多数据源聚合器（`features/reports/weekly-reports/lib/context-aggregator.ts`）

```startLine:50:features/reports/weekly-reports/lib/context-aggregator.ts
export async function aggregateWeeklyContext(
  userId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<WeeklyContext> {
  const [tickets, notes, conversations, visits] = await Promise.all([
    fetchTickets(userId, weekStart, weekEnd),
    fetchNotes(userId, weekStart, weekEnd),
    fetchConversations(userId, weekStart, weekEnd),
    fetchVisits(userId, weekStart, weekEnd),
  ]);
  // ...
}
```

**为什么这样写**：
- 4 源用 `Promise.all` 并行查询 → 单轮 RTT，避免 N+1。
- 进程内 Map 缓存（key = `userId:weekStartISO`），5min TTL，hash 用 `node:crypto` SHA256。
- `fetchVisits` 返回聚合而非全量（`topProjects`/`validViews`/`totalDwellMs`/`recentDetails`），防止 10000+ 日志撑爆内存。

### 3.2 draft-summary API（`app/api/reports/weekly-reports/draft-summary/route.ts`）

```startLine:35:app/api/reports/weekly-reports/draft-summary/route.ts
const session = await auth();
if (!session?.user?.id) {
  return NextResponse.json({ error: "未登录" }, { status: 401 });
}

const rateLimitKey = `${session.user.id}`;
const last = rateLimitMap.get(rateLimitKey) ?? 0;
const now = Date.now();
if (!force && now - last < 30_000) {
  return NextResponse.json({ error: "请求过于频繁" }, { status: 429 });
}
rateLimitMap.set(rateLimitKey, now);
```

**为什么这样写**：
- `auth()` 走 Next.js Auth.js（与 PR5 一致，pm-dev skill §约定）。
- 30s 进程内限流（同 userId 至少 30s 一次），多实例部署需后续升级 Redis（code-reviewer C-1）。
- `force=true` 跳过限流（刷新画像场景）。

### 3.3 详情/编辑 toggle 单页（`WeeklyReportDetailClient.tsx`）

```startLine:90:app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx
export function WeeklyReportDetailClient({ initialReport, reportId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [report, setReport] = useState(initialReport);

  // PR7 fix (I-1): 切回 view 模式时，从 initialReport 同步重置 report state
  useEffect(() => {
    if (mode === "view") {
      setReport(initialReport);
    }
  }, [mode, initialReport]);
```

**为什么这样写**：
- server 端先 fetch → props 传给 client 子组件 → client 在 `view` / `edit` 两态切换，避免 page 路由变更（用户感受是"在原地切换"）。
- `useEffect` 监听 `mode === "view"` → 重置 `report = initialReport`：保证 "取消编辑" 不留中途态；`router.refresh()` 后 `initialReport` prop 更新 → useEffect 又跑一次 → 自动同步最新数据（修 code-reviewer C-3）。
- AI 总结：在 view 模式展示 `report.aiSummary`（被动生成，PR5），在 edit 模式由 `<WeeklyReportForm>` 内嵌 `<WeeklyDraftPanel>` 接管 — 两个数据流独立：用户点"AI 总结"不会污染既有 `aiSummary`。

### 3.4 XSS 转义共享（`shared/lib/xss.ts`）

```startLine:13:shared/lib/xss.ts
return aiSummary
  .replace(/&/g, "&amp;")   // 1. 先转义 &
  .replace(/</g, "&lt;")     // 2. 再转义 <
  .replace(/>/g, "&gt;")     // 3. 再转义 >
  .replace(/"/g, "&quot;")   // 4. "
  .replace(/'/g, "&#39;")    // 5. '
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/\*(.+?)\*/g, "<em>$1</em>")
  .replace(/\n/g, "<br/>");
```

**为什么这样写**：HTML 实体先转义后还原 markdown，避免 `<script>` 被浏览器解析。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `AUTH_SECRET` | `.env.local` | NextAuth 密钥 |
| 端口 | **3003** | 主应用，`npm run start` 监听 `0.0.0.0:3003`（pm-ops skill） |
| Agnes API | 用 PR5 既有 | `features/ai/lib/summarizer.ts:30-57` `callAgnes` — 不需新配置 |
| Node 模块 | 既有 `node:crypto`、`next/server`、`next/navigation` | 0 新依赖 |

---

## 5. 启动 / 部署

```bash
cd /Users/vastgui/Desktop/project-manager

# 1. 装依赖（如未装）
npm install

# 2. 同步 schema（如有改动，PR7 没改）
# npx prisma db push   # PR7 不需要

# 3. 启动服务
npm run build
fuser -k 3003/tcp 2>/dev/null; sleep 1; npm run start

# 4. 确认存活
curl -I http://localhost:3003/reports/weekly-reports
# 期望: HTTP/1.1 307 Temporary Redirect (重定向到 /login，未登录状态)
```

---

## 6. 测试 & 验证

### 6.1 单元 / 脚本验证

```bash
cd /Users/vastgui/Desktop/project-manager
./node_modules/.bin/tsx --env-file=.env.local scripts/weekly-report-draft-summary-unit-test.ts
```

**期望输出**：
```
  ✓ escapeAiSummary: HTML 标签转义，markdown 保留
  ✓ escapeAiSummary: 空值返回空字符串
  ✓ escapeAiSummary: 普通文本不过度转义
  ✓ serializeWeeklyContext: title 截断 100 字（含省略号共 101）
  ✓ serializeWeeklyContext: snippet 截断 200 字（含省略号共 201）
  ✓ 限流：同 userId 30s 内两次请求 → 第二次 false
  ✓ 限流：force=true 跳过限流
  ✓ 限流：不同 userId 互不影响
  ✓ 缓存 key：格式为 userId:weekStartISO
  ✓ Hash 计算：SHA256 产生 64 字符 hex
  ✓ WeeklyDraftSummary: highlights/tasks/nextPlan 为 string[]
  ✓ 表单插入：append 模式在正文末尾添加分隔符和内容
  ✓ 表单插入：replace 模式完全替换正文
  ✓ 表单插入：空正文 append 直接替换

[PR7 Unit Tests] 14/14 passed
✓ All PR7 tests passed!
```

### 6.2 TypeScript 自检

```bash
cd /Users/vastgui/Desktop/project-manager
npx tsc --noEmit 2>&1 | grep -v "e2e/module-edit.spec.ts\|features/admin/admin.test.ts" | grep "error TS" | head
```

**期望**：**零行输出**。剩余 `e2e/module-edit.spec.ts`、`features/admin/admin.test.ts` 错误是历史遗留（PR5 复现文档已注明）。

### 6.3 端到端验证

```text
1. 登录访问 /reports/weekly-reports
   期望: 顶部出现「返回报表」按钮（指向 /reports）
2. 点列表项的"编辑"
   期望: 进入 /reports/weekly-reports/[id]（不再跳 /edit）
3. view 模式：点页面右上"编辑" → 切到 edit 模式
   期望: 显示 WeeklyReportForm + 右侧 WeeklyDraftPanel（初始空态）
4. 在 edit 模式填写周范围，点"AI 总结"
   期望: spinner → 2-10 秒后右侧面板显示 3 段（重点/任务/下周计划）+ 预览
5. 点"插入到正文"
   期望: content textarea 末尾追加 "\n---\n" + rawMarkdown
6. 点"保存更新"
   期望: toast「周报已更新」 → 切回 view 模式 → 显示**最新** content（不是旧数据）✅ C-3 fix
7. 点 view 模式右上"取消"（如果是 edit 模式进入的）
   期望: 切回 view 模式且 content 仍是初始值，不保留中途编辑
```

---

## 7. 复现 Checklist

- [ ] 装好依赖（`npm install`）
- [ ] `.env.local` 存在且 `AUTH_SECRET` 已设
- [ ] 启动 3003 端口服务（`npm run start`）
- [ ] 跑 `npx tsc --noEmit` 看到零 PR7 相关错误
- [ ] 跑 `weekly-report-draft-summary-unit-test.ts` 看到 14/14
- [ ] 浏览器手测 `/reports/weekly-reports` 看到"返回报表"键
- [ ] 浏览器手测详情页 → 编辑 → AI 总结 → 插入 → 保存 → 验证 view 显示新数据
- [ ] 浏览器手测详情页 → 编辑 → 取消 → 验证 content 未污染
- [ ] `grep "WeeklyReportRegenerateButton"` 应命中（PR5 功能保留）
- [ ] `grep "/reports/weekly-reports/${id}/edit"` 应**不命中**（路由已删除）

---

## 8. 踩坑记录

### 坑 1：edit 路由删除后 UI 残留

**现象**：M1.5 删除 `app/reports/weekly-reports/[id]/edit/page.tsx` 后，`WeeklyReportList.tsx` 还有"编辑"按钮指向 `/edit`，点开会 404。

**原因**：M1 子代理实施时创建了 `/edit` 路由作为中间步骤，M1.5 合并后未清理引用。

**解法**：
```startLine:88:features/reports/weekly-reports/ui/WeeklyReportList.tsx
<Link href={`/reports/weekly-reports/${report.id}`} ...>编辑</Link>
<Link href={`/reports/weekly-reports/${report.id}`} ...>查看</Link>
```
两个按钮都指向详情页，由详情页内 toggle 决定是 view 还是 edit。

### 坑 2：PATCH 后 view 模式显示旧数据（C-3）

**现象**：M1.5 第一版 `onSaved={() => setMode("view")}` —— PATCH 成功后切回 view，但 `report` state 没更新，UI 显示**旧 title/content**。

**原因**：父组件 `WeeklyReportDetailClient` 的 `report` 是 `useState(initialReport)`，只在初次挂载时赋值；PATCH 后 server 数据变了，client state 没跟上。

**解法**（code-reviewer C-3 修复）：
```startLine:294:app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx
onSaved={() => {
  router.refresh();   // 触发 server re-render，传新 initialReport prop
  setMode("view");   // 立即切回 view
}}
```
搭配 `useEffect([mode, initialReport])` 在 `mode === "view"` 时 setReport(initialReport) —— `router.refresh()` 完成后 `initialReport` 变化，useEffect 自动同步。

### 坑 3：取消编辑后 form 残留中途态（I-1）

**现象**：用户从 view 切 edit → 修改 → 不保存，点"取消编辑" → 切回 view，但 `setReport` state 仍保留 edit 期间的中间值（理论上，PR7 第一版有这个隐患）。

**解法**：见坑 2 的 useEffect。

### 坑 4：限流 process-level（C-1，遗留）

**现象**：`rateLimitMap = new Map<string, number>()` 是进程内变量，部署到 Vercel/Railly 等多实例环境时，每个实例有独立 Map，限流完全失效。

**解法（本 PR 未做，留作 follow-up）**：
- 短期：在注释里注明"单实例有效"
- 中期：换 Redis `SETEX` 原子操作实现跨进程限流
- 长期：用 `RateLimit` 表持久化（Postgres 唯一约束）

### 坑 5：ai-learning-mentor 在 Ask 模式下无法写文件

**现象**：SOP 模式 D 启动 audit agent 后，ai-learning-mentor 在 transcript 末尾承认"我注意到当前处于 Ask 模式，无法执行写入操作"，报告**未落盘**到 `docs/reports/PR7-ai-summary-ai-audit.md`。

**原因**：audit agent 的子代理任务在沙箱里被限制了文件写权限（但任务上下文不会传过去告知）。

**解法（主代理补救）**：
1. transcript 中 grep `## AI Audit 完工` 确认报告内容存在
2. 主代理用 Python 解析 jsonl 提取最长 assistant text
3. 主代理自己 Write 到指定路径（10.9KB 成功落盘）
4. **SOP 改进建议**：未来对 ask 类 agent 加 `read-only: false` 显式参数；或者要求 audit agent 把报告写在 transcript 中，主代理负责落盘

### 坑 6：shell tail -f 卡死

**现象**：用 `tail -f ... | grep -m 1` 等 PR7 UI 完工信号时，shell 不退出（即使 grep -m 1 已匹配）。

**原因**：`tail -f` 是长连接命令，pipe 关闭时不主动终止。

**解法**：改用轮询 `for i; sleep 30; if grep ...; break; done`。

### 坑 7：UI 统一的两阶段决策

**现象**：第一轮用户说"统一编辑页和详情页 UI"，三选项用户选了 a + c = 壳统一 + 详情/编辑合并，但合并模式又问了第三轮。

**根因**：决策树本身有交叉，乘法组合导致多轮问答。

**总结**：未来类似"统一 + 合并"需求，最好一次性列 3-4 个候选最终态，让用户选一个组合，而非分轮收集子选项。

---

## 9. 审计与修复交叉表

| 审计 | 发现 | 修复 |
|---|---|---|
| code-reviewer C-1 | 限流 process-level | 留作 follow-up（坑 4） |
| code-reviewer C-2 | 网络异常 catch 信息不足 | ✅ 优化 toast (`AI 总结失败 (HTTP N)` + `网络异常，请检查连接`) |
| code-reviewer C-3 | PATCH 后 report state 未更新 | ✅ `router.refresh()` + useEffect（坑 2） |
| code-reviewer I-1 | 取消编辑 state 残留 | ✅ useEffect 重置 |
| code-reviewer I-2 | 列表页"编辑""查看"两按钮同 URL | ⚠️ 保留双按钮引导 |
| code-reviewer I-4 | fetchVisits 无 take | ⚠️ 待办（PR7 不阻塞） |
| code-reviewer N-1..N-5 | 各种 Nitpicks | ⚠️ 待跟进 |
| ai-learning-mentor M-1 | 缓存陈旧（formDraft 未参与 cache key） | ⚠️ 待优化（用 contextVersion hash 做 busting） |
| ai-learning-mentor M-2 | Agnes API 无超时 | ⚠️ 待加 `AbortSignal.timeout(30000)` |
| ai-learning-mentor CR-1（cross-reviewer）| `_error` 信息泄漏 | ⚠️ 与 code-reviewer N-1 互补，待清理 |

---

## 10. 后续 Follow-up（不阻塞本次合并）

1. 限流升级 Redis（C-1）
2. `fetchVisits` 加 `take` 限制（I-4）
3. cache key 加 `formDraft.hash` 做 busting（M-1）
4. Agnes `callAgnes` 加 `signal: AbortSignal.timeout(30000)`（M-2）
5. `_error` 从公共 API 响应里剥离（N-1）
6. 列表页"编辑"按钮去掉（I-2 简化）

---

**复现路径**：按"启动 / 部署"一节启动后，访问 `/reports/weekly-reports/new` → 填写 → 点 AI 总结 → 应进入本文 §6.3 流程。
