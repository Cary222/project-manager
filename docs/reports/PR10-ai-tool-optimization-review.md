# PR10 审查报告 — AI 工具调用范围优化

**范围**: `search-knowledge.ts` / `search-structured.ts` / `speculation-cache.ts` / `messages/route.ts`
**合并日期**: 2026-07-10
**merged by**: Main

---

## 审查结论：✅ Approved（修复后）

| 步骤 | 任务 | 状态 |
|------|------|------|
| step-0 | 修复 SSE sources 未发送 | ✅ 已完成 |
| step-1 | 重写 searchKnowledge description | ✅ 已完成 |
| step-2 | 重写 searchStructured description | ✅ 已完成 |
| step-3 | 调整 POLICIES maxSteps | ✅ 已完成 |
| step-4 | 实现 mode 分层策略 | ✅ 已完成 |
| step-5 | 实现预测性预加载 | ✅ 已完成（修复后） |
| step-6 | 增强 system prompt | ✅ 已完成 |
| step-7 | 测试验证 | ⏳ 待手动测试 |

---

## code-reviewer 发现（已处理）

### Critical → 已修复

| # | 问题 | 修复 |
|---|------|------|
| #2 | `set()` 每次 O(n) 全量清理 | 改为每 10 次 set 才清理一次（惰性清理） |
| #3 | `retrieveContext` 重复调用 | 改为复用 `ragPromise` 结果 |

### Critical → 误报

| # | 问题 | 说明 |
|---|------|------|
| #1 | `setSearchKnowledgeConversationId` 未导入 | 已在 `search-knowledge.ts:19` 定义，`messages/route.ts:16` 正确导入 |

### Improvements（可选）

| # | 建议 | 状态 |
|---|------|------|
| #4 | 添加内存上限（MAX_SIZE） | 可后续实现 |
| #5 | TTL refresh | 可后续实现 |
| #6 | `extractEntities` 正则优化 | 可后续实现 |
| #7 | 只存 `contextText` 而非完整 `RagContext` | 可后续实现 |

---

## ai-learning-mentor 发现

（待补充）

---

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `features/ai/tools/search-knowledge.ts` | 新 description + `setSearchKnowledgeConversationId` |
| `features/ai/tools/search-structured.ts` | 新 description + sources 返回 |
| `features/ai/lib/speculation-cache.ts` | **新增** 预测性预加载缓存 |
| `app/api/ai/conversations/[id]/messages/route.ts` | SSE sources 发送 + 预加载集成 + modeHints/toolRules |

---

## Next Steps

1. [ ] 手动测试：auto 模式下"查工单 #10156"是否显示来源框
2. [ ] 手动测试：search 模式下是否直接用 searchKnowledge
3. [ ] 提交代码

