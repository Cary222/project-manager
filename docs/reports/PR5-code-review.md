## Code Review Summary

**Scope:** PR5 周报 AI 总结 + sonner toast + 详情页填满 + summarizer 改造
**Review Type:** Local Changes（PR5 实施产物）
**Files Reviewed:**
- `features/reports/weekly-reports/lib/summarize.ts`
- `features/reports/weekly-reports/lib/background-jobs.ts`
- `features/ai/lib/summarizer.ts`
- `features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx`
- `shared/ui/AppShell.tsx`
- `app/reports/weekly-reports/[id]/page.tsx`
- `scripts/weekly-report-bg-job-unit-test.ts`
- `scripts/verify-pr.ts`
- `package.json`

---

### Verdict: ✅ Approved

无 Critical 问题。代码质量良好，所有踩坑记录中的坑均已修复。

---

### Findings

#### Critical (Must Fix)

无。

#### Improvements (Recommended)

- **[app/api/reports/weekly-reports/[id]/regenerate/route.ts:9-15]** 过时的注释未同步 PR5 改动
  - Reason: 注释写"刷新用户画像"但实际调用 `enqueueSummarizeWeeklyReport`（PR5 改为生成周报 AI 总结），语义已变。
  - Suggestion: 更新注释匹配当前行为，如"重新生成周报 AI 总结（基于最新周报内容）"。

- **[scripts/weekly-report-bg-job-unit-test.ts]** 测试编号跳号（Test 4 缺失）
  - Reason: 测试文件注释写 "Test 5"，但代码中没有 Test 4（可能是 PR4 重编号遗留）。不影响功能，但影响文档可读性。
  - Suggestion: 补 Test 4 或统一编号（5→6、6→7...）。

- **[features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx]** 可选：防止并发重复提交
  - Reason: 用户快速连击"刷新画像"会发多个 POST 请求（虽然 `loading` 状态有保护，但 React 17 的自动批处理可能导致竞态）。
  - Suggestion: 在 `handleRegenerate` 开头 `if (loading) return` 已有保护，标记为 Nitpick。

#### Nitpicks (Optional)

- **[features/reports/weekly-reports/lib/summarize.ts:86]** 中文字符串 `…（内容已截断）` 未加入 i18n
  - Reason: 项目其他文案若已接入 i18n，此处保持一致会更好。但非强制。

- **[app/reports/weekly-reports/[id]/page.tsx:46]** `escapeAiSummary` 未转义 `/`
  - Reason: `.replace(/'/g, "&#39;")` 后，`"` 已被转义，但 `/` 未转义。理论上 `<img onerror=alert(1)//` 中的 `//` 可能被解析为注释。不过由于 `<>` 已被转义，实际攻击面极小。
  - Suggestion: 接受当前实现，风险可接受。

- **[features/reports/weekly-reports/lib/summarize.ts:71]** `content.trim() === ""` 对 `null` 值不够健壮
  - Reason: Schema 中 `content String @db.Text`，非 null。`report.content` 不会是 null（除非 Prisma schema 改变）。但如未来 schema 允许 null，此处会抛 `TypeError`。
  - Suggestion: 可加 `|| null` 兜底：`if (!report.content || report.content?.trim() === "")`

---

### Verified: 踩坑记录对照（PR5 复现文档 §8）

| 坑 | 描述 | 状态 |
|----|------|------|
| 坑 1 | `getServerSession` → `auth()` tsc 错误 | ✅ 已修复。`[id]/page.tsx` line 111 用 `auth()`，line 2 从 `@/lib/auth` import |
| 坑 2 | `submittedAt` 字段不存在 | ✅ 已修复。`[id]/page.tsx` line 168 用 `report.createdAt`，schema 确认有该字段 |
| 坑 3 | XSS（dangerouslySetInnerHTML 未 escape） | ✅ 已修复。`escapeAiSummary` 函数（line 38-49）先转义 `& < > " '`，再还原 markdown |
| 坑 4 | 500ms setTimeout 语义 | ✅ 保留（有注释说明"分布式防御"） |
| 坑 5 | 同一周报 PATCH 两次 → LLM 调两次 | ✅ PR5 范围外，PR6 待做 |
| 坑 6 | 注释写"折叠"但实际"展开" | ✅ 已修复。`[id]/page.tsx` line 51 注释为"AI 总结展示区块（始终展开）" |

---

### Positive Points

- **状态机设计清晰**：`summarizeWeeklyReport` 三路径（空 content / LLM 失败 / 成功）都有明确分支，partial 状态机让 UI 有 skeleton 反馈。
- **XSS 防御到位**：`escapeAiSummary` 先转义危险字符再还原 markdown，策略正确。
- **错误处理完备**：fire-and-forget 模式下的 try/catch 防止 unhandled rejection，`catch` 内还有 `catch` 兜底 `aiSummaryPartial` 不卡死。
- **单元测试覆盖 PR5 新增路径**：Test 9（content 空 → 不调 LLM）和 Test 10（LLM 失败 → 仍触发画像刷新）覆盖了新增逻辑。
- **sonner 集成规范**：`Toaster` 全局挂载 + `richColors` + 完整的 HTTP 状态码分支（401/403/404）。
- **FSD 边界清晰**：新增 `features/reports/weekly-reports/lib/summarize.ts`，与现有 `features/ai/lib/summarizer.ts` 边界清晰。
- **无 N+1 问题**：`updateUserProfile` 的两个 findMany 查询有明确 take 限制（20 / 10），列表页无循环内查询。
- **tsc 零 PR5 相关错误**：仅有历史遗留的 e2e/ 和 admin.test.ts 错误，不在 PR5 范围内。

---

### Next Steps

1. （可选）更新 `regenerate/route.ts` 注释，匹配 PR5 实际行为。
2. （可选）统一单元测试编号（补 Test 4 或重新编号）。
3. （可选）`content` null 安全兜底。
4. 确认 `scripts/verify-pr.ts --pr5` 本地跑通（API 路由 HTTP 验证）。

---

### Cross-Mentor Items

无。所有发现均为纯技术问题，无软架构、取舍、成本类问题需要移交。
