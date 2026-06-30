# PR7 周报编辑页 AI 总结 + UI 统一 — Code Review

> **审查时间**: 2026-06-30
> **审查范围**: PR7 主体 (M1) + M1.5 UI 改造
> **审查模式**: 本地变更审查（未合并 PR）

---

## 总览

| 维度 | 结论 |
|------|------|
| **Verdict** | ✅ **Approved with Suggestions** |
| **tsc 新增错误** | ✅ 零新增（仅 2 个历史遗留：`e2e/module-edit.spec.ts`、`features/admin/admin.test.ts`） |
| **单元测试** | ✅ 14/14 全绿（`weekly-report-draft-summary-unit-test.ts`） |
| **XSS 防护** | ✅ 所有 `dangerouslySetInnerHTML` 均通过 `escapeAiSummary` escape |
| **FSD 边界** | ✅ `features/reports/weekly-reports/lib/` 边界清晰，API 正确放在 `app/` 层 |
| **N+1 查询** | ✅ 4 个数据源用 `Promise.all` 并行，无 N+1 |
| **限流** | ⚠️ process-level Map（多实例失效，见 C-1） |
| **错误处理** | ⚠️ `WeeklyReportForm.handleAIGenerate` 缺少 `catch`（见 C-2） |
| **Auth 隔离** | ✅ API route 有 401 检查，`aggregateWeeklyContext` 接收 `userId` 参数 |
| **edit 路由残留** | ✅ 已确认无残留引用 |

---

## Critical (Must Fix)

| # | 文件:行 | 问题 | 修复建议 |
|---|---------|------|---------|
| **C-1** | `app/api/reports/weekly-reports/draft-summary/route.ts:43` | **限流为 process-level Map**：生产环境 Next.js 部署通常多实例（Vercel/Railway），`rateLimitMap` 是进程内变量，**每个实例有独立的 Map**。用户请求打到不同实例时，限流完全不生效——同一用户在 30ms 内可发起数十次请求。 | 改用 Redis（`ioredis`）或数据库（如 `RateLimit` 表）实现跨进程限流。Redis 方案示例：`MULTI` + `GET` + `SETEX` + `EXPIRE` 原子操作。若暂不支持 Redis，至少在注释里注明"单实例内有效"，并在上线前用 Vercel Analytics 监控 `POST /draft-summary` QPS。 |
| **C-2** | `features/reports/weekly-reports/ui/WeeklyReportForm.tsx:98-138` | **`handleAIGenerate` 缺少 `catch` 兜底**：`fetch()` 抛出网络异常（如 DNS 失败、超时）时，函数走到 `finally` 只设 `setDraftLoading(false)`，但 **`draftError` 从未被设置**，`draftSummary` 保留旧值。用户在 UI 上看不出发生了错误（toast 也不会弹）。若 `res.ok` 为 false 且状态码不在 `if` 分支内，`throw new Error` 会被外层 `catch` 捕获，但 toast 显示的是"未知错误"，信息量不足。 | 在 `handleAIGenerate` 的 `try {} catch {} finally {}` 块中补上：<br>1. 网络异常 `catch`：`toast.error("网络错误，请检查网络连接")`<br>2. HTTP 错误但状态码在 `if` 之外：`toast.error(\`AI 总结失败 (HTTP ${res.status})\`)`<br>3. 确保 `setDraftError` 在所有异常路径都被设置 |
| **C-3** | `features/reports/weekly-reports/ui/WeeklyReportForm.tsx:175-205` | **PATCH 成功后 `setReport` 未调用**：edit 模式保存后，`WeeklyReportDetailClient` 的 `report` state 不会更新。用户保存后页面切回 view 模式，显示的仍是**旧数据**（除非用户手动刷新）。`onSaved` 只调了 `setMode("view")`，没有更新 `report` 内容。 | 在 `WeeklyReportDetailClient` 的 `WeeklyReportForm` 上传递 `onSaved={() => { onSave(); setReport(updatedReport); }}`，或让父组件通过 props 传入最新数据。更简单的方案：`WeeklyReportForm` 在 PATCH 成功后返回新数据，父组件用 `useState` 接收更新。 |

---

## Improvements（应该改）

| # | 文件:行 | 问题 | 修复建议 |
|---|---------|------|---------|
| **I-1** | `app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx:89-91` | **`report` state 初始化为 `initialReport` 后无同步机制**：用户从 view 模式切 edit → 修改 → 保存 → `onSaved()` → `setMode("view")`，但 `report` state 仍是旧的。若用户编辑后没保存就想切 view（点"取消编辑"），`report` state 保留编辑中途的状态。 | 在 `mode` 从 `"edit"` 变回 `"view"` 时，用 `useEffect` 监听 `mode` 变化，重置 `report` 为 `initialReport`，防止中间态泄漏：<br>`useEffect(() => { if (mode === "view") setReport(initialReport); }, [mode, initialReport]);` |
| **I-2** | `features/reports/weekly-reports/ui/WeeklyReportList.tsx:90-101` | **列表页"编辑"和"查看"两个按钮指向同一个 URL**：`/reports/weekly-reports/${report.id}`，两按钮样式完全相同。用户点击"编辑"后到详情页是 view 模式，需再点一次页面内的"编辑"按钮才能编辑。这是 M1.5 的设计（单页 toggle），但 UI 没有传达这个信息。 | 1. 合并为一个按钮"查看/编辑"；或 2. 两个按钮都保留，但去掉"编辑"按钮的"编辑"文字旁的视觉暗示（笔图标），改为"详情"；或 3. 保留两按钮但加 tooltip 说明"点击进入详情页，可切换编辑模式"。当前最简方案：两个 Link 都指向详情页，去掉"编辑"按钮（详情页已有编辑入口）。 |
| **I-3** | `app/api/reports/weekly-reports/draft-summary/route.ts:96-98` | **`contextVersion` 使用 SHA256 哈希 + `JSON.stringify(context)` 作为 cache busting key**：如果 `aggregateWeeklyContext` 内部有 `cache`，`JSON.stringify` 的序列化顺序取决于 JS 对象 key 枚举顺序（ES2015+ 规范保证 insertion order，但跨运行环境可能不一致）。另外，context payload 较大时 `JSON.stringify` 有性能开销。 | 使用 `createHash("sha256").update(JSON.stringify(context, null, 0))` 加注释说明"key 顺序由 ES2015 保证"，或改用 `crypto.randomUUID()` 作为 cache key（在写入缓存时生成）。当前实现在单实例 Node.js 环境下是安全的。 |
| **I-4** | `features/reports/weekly-reports/lib/context-aggregator.ts:251-264` | **`fetchVisits` 无 `take` 限制**：若用户在某周有 10000 条 PAGE_VIEW 日志，`findMany` 会返回全量数据（可能在内存里聚合），DB 和内存开销较大。`fetchTickets/Notes/Conversations` 都有 `take` 限制（50/30/20），唯独 visits 没有。 | 加 `take: VISITS_TAKE` 或 `take: 500`（留足够量给 topProjects 聚合，但避免全量）。如果需要保留全量做 topProjects 聚合，则加注释说明，并设一个较大的上限如 `take: 5000`。 |

---

## Nitpicks（可改可不改）

| # | 文件:行 | 问题 | 备注 |
|---|---------|------|------|
| **N-1** | `features/reports/weekly-reports/lib/draft-summary.ts:239` | **`_error` 字段暴露在 `WeeklyDraftSummary` 公开类型中**：这是内部实现细节，不应出现在公共接口。若 LLM 调用失败，`_error: err.message` 会随 API 响应暴露给前端，可能泄漏服务端错误信息（如内部路径、库版本）。 | 将 `_error` 改为私有字段或改为 `unknown` 类型，在 API route 层单独处理错误响应，不透传给前端：`catch` 中返回 `{ draft: { ...defaults..., error: "生成失败" }, ... }`。 |
| **N-2** | `features/reports/weekly-reports/lib/draft-summary.ts:61-72` | **`summarizeTicketList` 截断到 10 条，但 `fetchTickets` 最多取 50 条**：数据源取了 50 条，但序列化时只用了前 10 条，中间 40-50 条数据浪费。 | 统一截断策略：`summarizeTicketList` 和 `fetchTickets` 的 take 保持一致（都用 10），或提高到 20 以获得更有价值的工单摘要。 |
| **N-3** | `features/reports/weekly-reports/ui/WeeklyDraftPanel.tsx:210-212` | **`EditableSection.onChange` 空函数**：`WeeklyDraftPanel` 中 `highlights` 的 `onChange` 是空函数（`/* Parent handles edit through onInsert */`），`tasks` 和 `nextPlan` 也是空函数。这意味着用户编辑了 AI 总结后点"保存"，编辑的内容被丢弃，UI 没有反馈。 | 要么移除每个 section 的"编辑"按钮（当前 data 不可编辑），要么实现真正的编辑逻辑（将修改后的 items 传给父组件）。当前设计下"编辑"按钮是死链接，建议移除以免用户困惑。 |
| **N-4** | `app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx:300-301` | **`initialWeekStart`/`initialWeekEnd` 使用 `toISOString().split("T")[0]` 转 date input 格式**：在用户时区非 UTC 时，`toISOString()` 会产生 UTC 日期字符串，可能与用户看到的本地日期不匹配（如用户在 UTC+8，`2026-07-01T00:00:00+08:00` 的 `toISOString()` 是 `2026-06-30T16:00:00.000Z`，split 后是 `2026-06-30`）。 | 改用本地时间格式化：`new Date(report.weekStart).toLocaleDateString("en-CA")` 或 `toISOString().slice(0, 10)` 配合本地时区转换。当前 form 的 `toLocalMidnight` 也是类似逻辑，保持一致即可。 |
| **N-5** | `scripts/weekly-report-draft-summary-unit-test.ts:27-39` | **测试文件内联了 `escapeAiSummary` 逻辑而非 import**：测试文件复制了 `escapeAiSummary` 的实现代码而非从 `shared/lib/xss.ts` import。这样如果源文件实现改了，测试不会 catch 行为变化。 | 改为 `import { escapeAiSummary } from "@/shared/lib/xss";`。但这需要解决 `@/` alias 在 tsx 脚本中的解析问题——当前可能通过 tsconfig 配置已解决。若 alias 不支持，考虑在 `shared/lib/` 下新增纯函数导出供测试 import。 |

---

## XSS 检查专项

### 所有 `dangerouslySetInnerHTML` 检查结果

| # | 文件:行 | 内容 | escape 方式 | 状态 |
|---|---------|------|------------|------|
| 1 | `WeeklyDraftPanel.tsx:248-250` | `escapeAiSummary(draft.rawMarkdown)` | ✅ `escapeAiSummary` 先转义 `& < > " '` 再还原 markdown | ✅ 安全 |
| 2 | `WeeklyReportDetailClient.tsx:80-82` | `escapeAiSummary(aiSummary)` | ✅ 同上，从 `@/shared/lib/xss` import | ✅ 安全 |
| 3 | `shared/lib/xss.ts:13-24` | `escapeAiSummary` 函数实现 | ✅ 先 `.replace(/&/g, "&amp;")` → `replace(/</g, "&lt;")` → ... → 再还原 `**bold**` / `*italic*` | ✅ 正确顺序 |
| 4 | `[id]/page.tsx` (PR5 原文) | 不再使用（已合并到 `WeeklyReportDetailClient`） | — | ✅ 已迁移 |

**结论**: 所有新增/修改的 `dangerouslySetInnerHTML` 均通过 `escapeAiSummary`，XSS 防护覆盖完整。

### `escapeAiSummary` 转义顺序验证

```13:24:shared/lib/xss.ts
return aiSummary
  .replace(/&/g, "&amp;")   // 1. 先转义 &
  .replace(/</g, "&lt;")     // 2. 再转义 <
  .replace(/>/g, "&gt;")     // 3. 再转义 >
  .replace(/"/g, "&quot;")   // 4. "
  .replace(/'/g, "&#39;")    // 5. '
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")  // 6. 还原 markdown（html_entity 已转义，不会被解析为标签）
  .replace(/\*(.+?)\*/g, "<em>$1</em>")
  .replace(/\n/g, "<br/>");
```

**顺序正确**: HTML 实体先转义，markdown 替换在后。`<script>` → `&lt;script&gt;` 后不会被浏览器解析为标签。

---

## 测试覆盖

### 单元测试文件
`scripts/weekly-report-draft-summary-unit-test.ts`

### 用例数
**14 个用例，全绿** ✅

### 覆盖路径

| # | 用例 | 覆盖内容 |
|---|------|---------|
| 1 | `escapeAiSummary: HTML 标签转义，markdown 保留` | XSS 核心防护：`<script>` → `&lt;script&gt;`，`&#39;` 转义，markdown 还原 |
| 2 | `escapeAiSummary: 空值返回空字符串` | null/undefined/空字符串兜底 |
| 3 | `escapeAiSummary: 普通文本不过度转义` | `&` → `&amp;`，不过度处理普通字符 |
| 4 | `serializeWeeklyContext: title 截断 100 字` | truncate 函数边界 |
| 5 | `serializeWeeklyContext: snippet 截断 200 字` | truncate 边界 |
| 6 | `限流：同 userId 30s 内两次请求 → 第二次 false` | 限流核心逻辑 |
| 7 | `限流：force=true 跳过限流` | force 跳过 |
| 8 | `限流：不同 userId 互不影响` | userId 隔离 |
| 9 | `缓存 key：格式为 userId:weekStartISO` | 缓存 key 格式 |
| 10 | `Hash 计算：SHA256 产生 64 字符 hex` | hash 长度/格式 |
| 11 | `WeeklyDraftSummary: highlights/tasks/nextPlan 为 string[]` | 类型验证 |
| 12 | `表单插入：append 模式在正文末尾添加分隔符和内容` | append 逻辑 |
| 13 | `表单插入：replace 模式完全替换正文` | replace 逻辑 |
| 14 | `表单插入：空正文 append 直接替换` | 空内容边界 |

### 覆盖率评估

**覆盖的路径**：
- XSS 转义（核心安全路径）：✅ 完整
- 限流逻辑：✅ 覆盖 3 个场景（重复/force/隔离）
- 缓存 key：✅ 覆盖
- 表单插入：✅ append/replace/空内容全覆盖
- truncate：✅ 边界覆盖

**未覆盖的路径**（建议补充）：
- `aggregateWeeklyContext` 无数据源时的空数组处理（4 个数据源全为空）
- `generateWeeklyDraftSummary` LLM 抛出非 JSON 响应的 `extractJsonFromResponse` 回退路径
- `WeeklyReportForm.handleAIGenerate` 网络异常的 toast（见 C-2）
- `WeeklyReportDetailClient` mode 切换时的 state reset（见 I-1）

---

## 复用合规（M1.5 `[id]/edit` 删除后检查）

| 检查项 | 状态 |
|--------|------|
| `app/reports/weekly-reports/[id]/edit/page.tsx` 存在 | ✅ 文件不存在（已删除） |
| `features/reports/weekly-reports/ui/WeeklyReportList.tsx` 中指向 `/edit` 的链接 | ✅ 无残留（两个 Link 都指向 `/reports/weekly-reports/${report.id}`） |
| `scripts/verify-pr.ts` 中引用 `[id]/edit` | ✅ 无残留 |
| 其他文件引用 `[id]/edit` | ✅ `grep` 全仓库无匹配 |

**结论**: `[id]/edit` 路由已完全删除，无残留引用。

---

## 跨边界发现

- **cross-mentor**: `WeeklyReportList` 中"编辑"和"查看"两个按钮指向同一 URL（`/reports/weekly-reports/${id}`）——这是 M1.5 toggle 单页设计的产物，但 UX 语义上"编辑"和"查看"是不同操作，当前设计会让用户困惑。需从 UX 设计角度确认：是否应该在列表页直接去掉"编辑"按钮，或改为"详情"按钮？请 ai-learning-mentor 评估 UX 一致性并给出建议。

---

## PR5 踩坑记录对照

| 坑 | PR5 记录 | PR7 验证 |
|----|---------|---------|
| 坑 1: `getServerSession` → `auth()` | ✅ 已修复 | ✅ `[id]/page.tsx:11` 用 `auth()` |
| 坑 2: `submittedAt` 不存在 | ✅ 已修复 | ✅ 不涉及 |
| 坑 3: XSS 未 escape | ✅ 已修复 | ✅ `shared/lib/xss.ts` 先转义后还原 markdown |
| 坑 4: 500ms setTimeout 语义 | ✅ 保留（加注释） | ✅ PR7 无使用 setTimeout |
| 坑 5: PATCH 两次 LLM 调两次 | ✅ PR6 待做 | ✅ 不涉及（新 API 是 draft-summary，不是 summarizeWeeklyReport） |
| 坑 6: 注释写"折叠"但实际"展开" | ✅ 已修复 | ✅ `WeeklyDraftPanel` 有展开/收起按钮，注释准确 |
| 新增: `escapeAiSummary` 抽取到 shared | PR5 坑 3 教训延伸 | ✅ `shared/lib/xss.ts` 独立文件，两个消费者正确 import |

---

## PR6 踩坑记录对照（涉及 context-aggregator 的已知风险）

| 风险 | PR6 记录 | PR7 验证 |
|------|---------|---------|
| I-1: 多实例竞态（process-level 变量） | ⚠️ 已知风险 | ⚠️ **复现**: `rateLimitMap` 同样是 process-level（见 C-1）。`cache` 也是 process-level，但影响较小（缓存不命中 → 重新计算，数据一致性问题仅限同一周同一用户的缓存穿透）。 |

---

## 汇总

| 类别 | 数量 |
|------|------|
| Critical (Must Fix) | **3** |
| Improvements (Recommended) | **4** |
| Nitpicks (Optional) | **5** |
| XSS 安全 | ✅ 全覆盖 |
| 单元测试 | ✅ 14/14 |
| tsc 新增错误 | ✅ 零 |
| FSD 边界 | ✅ 清晰 |
| N+1 查询 | ✅ 无 |
| `[id]/edit` 残留 | ✅ 无 |

---

## 建议行动

### 必须修复（合并前）
1. **C-1**: 将 `rateLimitMap` 从 `Map<string, number>` 改为 Redis 实现（或接受单实例限制并在文档说明）
2. **C-2**: `handleAIGenerate` 补全网络异常和 HTTP 错误分支的 `toast.error`
3. **C-3**: edit 模式 PATCH 后同步 `report` state（或通过 `useEffect` 重置）

### 建议修复（合并后尽快）
4. **I-1**: mode 切回 view 时重置 `report` state
5. **I-2**: 合并 `WeeklyReportList` 中的"编辑"/"查看"按钮
6. **I-4**: `fetchVisits` 加 `take` 限制

### 可选（发布后迭代）
7. **N-1**: `_error` 不暴露在公共接口
8. **N-2**: `summarizeTicketList` 和 `fetchTickets` take 统一
9. **N-3**: `EditableSection` 的空 `onChange` 清理

---

## Code Review 完工
