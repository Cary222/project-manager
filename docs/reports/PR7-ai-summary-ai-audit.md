# PR7 周报编辑页 AI 总结 + UI 统一 — AI Audit

> 🎭 当前身份：架构顾问（ai-learning-mentor）
> 审查模式：软架构维度审查（基于 code-reviewer 已完成硬技术审查）

---

## 总览

- **Verdict**: ⚠️ **Approved with Concerns**
- **审查时间**: 2026-06-30
- **审查范围**: PR7 主体（M1）+ M1.5 UI 改造
- **参照**: code-reviewer 报告 `docs/reports/PR7-ai-summary-code-review.md`

---

## 维度评分

### 取舍 Trade-offs — 3/5

**核心问题**：30s 限流 + 5min 缓存 TTL 组合存在**缓存陈旧**问题。

`context-aggregator` 的 cache key 是 `userId:weekStartISO`（`context-aggregator.ts:90-91`），**不包含 `formDraft` 内容**。用户编辑 content 后再点"AI 总结"，5min 内会直接返回旧 context（基于旧 formDraft），LLM 生成的是"编辑前内容"的草稿——用户看不出哪里错了。

API route 的 `contextVersion` hash（`route.ts:96-99`）才是正确的 cache busting 思路，但它只返回给前端做参考，**不影响 context-aggregator 的缓存查找**。两层用了不同的 busting 逻辑。

**多 tab 并发**：`rateLimitMap` 是进程内 `Map`（`route.ts:43`），多实例部署下限流完全失效。code-reviewer C-1 已标注。

**6000 字硬截断**（`draft-summary.ts:35`）：对活跃用户（周内 50 个工单 + 30 篇笔记）会有数据丢失，无差异化策略（工单比笔记重要，但截断顺序取决于序列化顺序）。

---

### 边界 Boundaries — 4/5

**优点**：FSD 三层边界清晰，`features/reports/weekly-reports/lib/` 承载业务逻辑，`app/api/` 只做路由 + 参数校验，`shared/lib/xss.ts` 独立抽取 XSS 工具。

**⚠️ 职责模糊点**："插入到正文"后触发 `enqueueSummarizeWeeklyReport`，生成的是**被动**的 `aiSummary`（写入 DB），与**主动**的 draft-summary（不写 DB）是两个完全独立的数据流。详情页展示的 `AiSummaryPanel` 是 PR5 的被动生成，`WeeklyDraftPanel` 是 PR7 的主动生成。两者语义不同但都叫"AI 总结"，用户可能混淆。

---

### 可观测性 Observability — 2/5

**LLM 调用无结构化日志**（`draft-summary.ts:233`）：只有 `console.warn`，无 userId、无 weekStart、无 context size、无 token 估算。生产环境无法做 per-user LLM 调用审计。

**`_error` 泄漏内部信息**（`draft-summary.ts:239`）：LLM 失败时 `err.message` 直接写入 API 响应体，会暴露 Agnes API 内部错误（如网络超时消息、模型名称）。

**缓存命中/未命中无日志**：`aggregateWeeklyContext` 的 `getCached`（`context-aggregator.ts:98-106`）完全不记录 debug/info，无法判断缓存命中率。

---

### 成本 Cost — 4/5

**单用户日均调用**：30s 限流实际约束约 `2880 次/天`，正常操作远低于上限。

**潜在问题**：`summarizeWeeklyReport`（后台 job）和 `draft-summary`（用户触发）是两个独立的 LLM 调用路径。**同一次提交最多触发 2 次 LLM 调用**（用户主动的 + 后台被动的）。

**多用户并发**：Agnes API 无 per-tenant 限流配置，大量用户同时提交周报时可能触发 Agnes 限流。目前无队列限流保护。

---

### 一致性 Consistency — 3/5

| 场景 | 结论 | 解释 |
|------|------|------|
| **场景 A**（点 AI 总结 → 插入 → 提交） | ⚠️ **可接受，但需 UX 说明** | draft-summary 是"编辑辅助预览"，aiSummary 是"提交后自动总结"，两者独立。不会产生数据错误，但预览和详情结果可能不同，用户困惑。建议加 UX 文案。 |
| **场景 B**（直接提交） | ✅ **一致** | 正常流程，无歧义。 |
| **场景 C**（生成后不插入，修改 content 再提交） | ⚠️ **时序不一致，无害但困惑** | draft-summary 面板显示基于旧 content 的草稿，与最终提交的 content 无关。不会产生数据错误，但用户可能误以为提交了旧草稿。 |

**两个数据源不会冲突**：draft-summary 和 aiSummary 写入了不同的字段，前者不写 DB，后者写 `WeeklyReport.aiSummary`。**数据一致性没有问题，问题是 UX 语义不一致**。

---

### UX — 2/5

1. **`EditableSection` 的"编辑"按钮是死链接**（`WeeklyDraftPanel.tsx:210-212`）：`onChange` 是空函数，用户编辑后点"保存"，编辑内容被静默丢弃，无任何反馈。code-reviewer N-3 已标注。

2. **取消编辑无确认弹窗**（`WeeklyReportDetailClient.tsx:151`）：form 中未保存的编辑内容直接丢弃，无法恢复。

3. **`WeeklyReportList` 中"编辑"和"查看"两个按钮指向同一 URL**（`WeeklyReportList.tsx:90-100`）：用户点击"编辑"后看到的仍是 view 模式，需再点一次页面内"编辑"按钮。code-reviewer I-2 已标注。

4. **"刷新画像"按钮语义混乱**：详情页 view 模式的"刷新画像"触发的是 `summarizeWeeklyReport`（重新生成 `aiSummary`），不是 draft-summary 的重新生成。文案暗示"重新读取数据"，实际做的是"重新调用 LLM"。

---

### 可扩展性 Extensibility — 4/5

**添加新数据源（如 Git Commit）**：在 `context-aggregator.ts` 中需要加新的 `fetchXxx` 函数，在 `Promise.all` 中加入新的 fetcher，在 `serializeWeeklyContext` 中加对应的 section。**无需改动 API route**。改造难度低。

**prompt 改版（多语言）**：`DRAFT_INSTRUCTION` 硬编码中文（`draft-summary.ts:37-55`），要支持多语言需将 prompt 抽取为独立配置。改造难度中等。

---

## Must Fix（阻塞合并）

| # | 文件:行 | 问题 | 修复建议 |
|---|---------|------|---------|
| **M-1** | `draft-summary.ts:239` | `_error` 直接将 `err.message` 写入 API 响应，**暴露 Agnes API 内部错误信息**（网络超时、模型名称等）。 | API route 层单独处理错误返回，不透传 `_error`：`catch` 中返回 `{ draft: { ...defaults, _error: "生成失败，请重试" }, ... }` |
| **M-2** | `context-aggregator.ts:90-91` | **缓存不包含 `formDraft` 内容**：cache key 是 `userId:weekStartISO`，用户修改 content 后点"AI 总结"，5min 内返回基于旧内容的缓存草稿。 | 将 `formDraft` 的 hash 加入 cache key，或在 API route 层用 `contextVersion` hash 主动 invalidate context-aggregator 的缓存 |

---

## Should Fix（强烈建议）

| # | 文件:行 | 问题 | 修复建议 |
|---|---------|------|---------|
| **S-1** | `WeeklyReportForm.tsx` | **draft-summary 和 aiSummary 语义混淆**：用户在编辑页看到的 AI 草稿预览，和提交后在详情页看到的 AI 总结是两个完全独立生成的文本。 | 在 `WeeklyDraftPanel` 顶部加提示："此为草稿预览，提交后将根据正文内容重新生成 AI 总结" |
| **S-2** | `WeeklyReportForm.tsx:141-143` | **两个"重新生成"行为完全不同但文案可能相同**：编辑页的重新生成 = draft-summary 重新调用；详情页的重新生成 = `summarizeWeeklyReport` 重新调用。 | 统一"重新生成"的语义文案，确保每个场景的行为用户可理解 |
| **S-3** | `WeeklyReportDetailClient.tsx:151` | **取消编辑无确认弹窗**，form 数据直接丢弃。code-reviewer I-1 补充了 state 未重置。 | 加 `window.confirm` + mode 切换时重置 `report` state |
| **S-4** | `draft-summary.ts:35` | **6000 字硬截断无差异化策略**：活跃用户的数据可能被截断在中间。 | 改为分优先级截断：工单 20 条 → 笔记 10 条 → 对话 5 条，或加日志可观测截断情况 |
| **S-5** | `WeeklyDraftPanel.tsx:210-212` | **`EditableSection` 的 `onChange` 是空函数**：用户编辑后点"保存"，编辑内容被静默丢弃。code-reviewer N-3。 | 移除"编辑"按钮（当前 data 不可编辑），最简单的修复 |

---

## Nice to Have（可选）

| # | 文件 | 问题 |
|---|------|------|
| **N-1** | `context-aggregator.ts:251-264` | `fetchVisits` 无 `take` 限制，若某周有 10000 条 PAGE_VIEW 日志会全量拉取。code-reviewer I-4 |
| **N-2** | `route.ts:118` | `console.error` 无结构化上下文（userId、weekStart），生产环境无法做 per-user 审计 |
| **N-3** | `draft-summary.ts:159` | 截断后无日志，用户无法感知数据被截断 |

---

## Cross-Reviewer（越界发现，需 code-reviewer 处理）

> 以下问题属于硬技术维度，code-reviewer 未充分覆盖，标 cross-reviewer 由其处理。

| # | 文件:行 | 问题 | 性质 |
|---|---------|------|------|
| **CR-1** | `draft-summary.ts:239` | `_error: err instanceof Error ? err.message` 暴露完整错误消息到 API 响应，潜在信息泄漏。 | ⚠️ **安全问题**（与 code-reviewer N-1 "接口污染"维度不同） |
| **CR-2** | `route.ts:93` | `aggregateWeeklyContext` 内部有 5min 进程内缓存，但无跨请求的缓存失效机制。当用户修改 content 后再点"AI 总结"，**缓存可能返回旧 context**。 | ⚠️ **数据正确性问题**（与 Must Fix M-2 合并） |

---

## 一致性场景验证

| 场景 | 结论 | 解释 |
|------|------|------|
| **场景 A**（点 AI 总结后提交） | ⚠️ **可接受，但需 UX 说明** | 两个独立数据流，数据不会冲突，但用户可能困惑"预览和详情不一样" |
| **场景 B**（直接提交） | ✅ **一致** | 正常流程，无歧义 |
| **场景 C**（生成后不插入，修改 content 再提交） | ⚠️ **时序不一致，无害但困惑** | draft-summary 面板显示旧草稿，与最终 content 无关。建议：content 变更后 draft-summary 面板应自动失效或提示"内容已变更，请重新生成" |

---

## 与 Code-Reviewer 的分工确认

| 问题类型 | 处理方 |
|----------|--------|
| 硬技术（类型错误、TS 编译、N+1 查询、XSS 安全） | ✅ code-reviewer（已覆盖 C-1/C-2/C-3，XSS 专项 ✅） |
| **软架构（取舍、边界、一致性、UX 语义、扩展性）** | ✅ ai-learning-mentor |
| `_error` 信息泄漏 | ⚠️ 交叉：M-1（ai-learning-mentor）+ N-1（code-reviewer），互补 |
| 缓存陈旧 | ⚠️ 交叉：M-2（ai-learning-mentor），code-reviewer 无此视角 |
| 数据一致性（draft vs aiSummary 独立） | ✅ ai-learning-mentor 补充 |

---

## 改进建议（无需修复，仅观察）

1. **context-aggregator 和 summarize.ts 的 token 预算分离**：draft-summary 6000 字，summarize.ts 8000 字，无统一治理。

2. **Agnes API 没有 per-request 超时设置**（`summarizer.ts:36-49`）：若 Agnes API 响应慢，`callAgnes` 会一直等。建议加 `signal: AbortSignal.timeout(30000)`。

3. **context-aggregator 的 cache key 和 API route 的 contextVersion 是两套独立的缓存体系**：设计上容易误解"API route 用 hash 做 cache busting，所以缓存安全"，实际上两者完全独立。

---

## AI Audit 完工
