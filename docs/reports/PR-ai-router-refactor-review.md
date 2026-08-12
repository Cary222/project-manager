# PR: AI Router 重构 — 合并审查报告

<!-- merged by Main：整合 code-reviewer（硬层）+ ai-learning-mentor（软层）审查结论 -->

## 结论

| 审查 | 结论 |
|------|------|
| 硬层（code-reviewer） | ⚠️ Approved with Critical Fixes Required |
| 软层（ai-learning-mentor） | CHANGES_REQUIRED |

**Main 决策**：Critical 问题必须修复才能提交；Major/软层 P0 建议本轮一并处理；Minor/P1 可后续迭代。

原始报告：
- `docs/reviews/PR-ai-router-refactor-code-reviewer.md`
- `docs/reviews/PR-ai-router-refactor-ai-mentor.md`

---

## 待修复清单（本轮处理）

### Critical

1. `features/ai/core/context/runtime-state-bridge.ts:40` — `PendingHumanActionState.mode` 缺少 `"video"`，需同步 `AgentMode`。
2. `features/ai/routing/task-router.ts:41` + `features/ai/agents/conversation/nodes/detect-intent.ts:244` — 图片正则中单独的 `画` 字导致 "帮我画画" 误判为 image 模式。

### Major

3. `features/ai/routing/task-router.ts:14` — `AiTaskCategory` 与 `features/ai/types/modes.ts:12` 重复定义且不一致，删除本地定义改为从 `modes.ts` 导入。
4. `features/ai/llm/model-routing.ts:8` — `capabilities` 参数声明但未使用，属于死代码，需加注释标注为 v1 存根（暂不实现过滤逻辑，避免过度设计）。
5. `features/ai/agents/conversation/nodes/detect-intent.ts:250` — video 意图检测 `&&`/`||` 混用，提取为独立变量提高可读性。

### 软层 P0

6. `features/ai/types/modes.ts` 顶部补充类型层级注释：说明 `AiTaskCategory`（UI Tab 层）→ `AiMode`（用户可见 6 种模式）→ `TaskType`（模型路由粒度）的层次关系，`ChatToolMode` ⊂ `AiTaskCategory.chat`。

## 暂不处理（P1 / Minor，记录待跟进）

- task-router 的实际接入点（`AiChatPanel` 是否调用 `resolveIntent`）需向用户确认 scope 是否包含此项。
- `getTaskHint` 显式处理 `auto` case（Minor，行为已正确）。
- `routeByMode` 分离 image/video 独立 case 分支（Minor，可读性优化）。
- capabilities 匹配的真正实现（v2）、tier 分组的完整实现——按软层建议，在 PR 描述中说明为后续迭代项，不在本轮范围内。

---

## 双方一致认可的优点

- 前端 `task-router.ts`（非权威 Hint）与后端 `detect-intent.ts`（权威判断）职责边界清晰，两套正则完全独立。
- `ResolvedAiIntent` 接口解耦设计良好，未来替换 LLM 分类器无需改动调用方。
- AgentMode/AiMode 新增 video 的 switch 分支基本覆盖完整。
- 无 ReDoS / XSS / 凭证泄露风险；tsc 无新增类型错误；21 个测试用例通过。
