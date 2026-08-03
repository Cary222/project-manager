<!-- merged by Main -->

# AI 对话框 UI 重构 — 综合审查报告

**范围：**
- `features/ai/ui/AiResponsePanel.tsx`（新建）
- `features/ai/ui/AiMessageBubble.tsx`（重构）
- `features/ai/ui/AiChatPanel.tsx`（布局调整）
- `features/ai/ui/AiThinkingStream.tsx`（重构）

**来源报告：**
- 硬层：[docs/reviews/PR-ai-ui-refactor-code-reviewer.md](../reviews/PR-ai-ui-refactor-code-reviewer.md)（评分 C，PASS_WITH_FIXES）
- 软层：[docs/reviews/PR-ai-ui-refactor-ai-mentor.md](../reviews/PR-ai-ui-refactor-ai-mentor.md)（评分 A，APPROVED）

---

## 综合结论：APPROVED（Critical 已修复）

架构方向（Timeline/Markdown 解耦、三层组件拆分）经软层审查确认无问题；硬层发现的性能和边界问题已全部修复并回归验证。

---

## Critical 问题 — 已修复

| # | 问题 | 修复方式 | 状态 |
|---|------|----------|------|
| 1 | `StepRow` 每 200ms 全量 re-render（O(N) 定时器） | 计时器提升到 `AiThinkingStream` 父组件，单个共享 `now` state；仅在有 running/pending 任务时启动，完成后自动停止 | ✅ 已修复 |
| 2 | `AiResponsePanel` ghost/active 双层 `MarkdownContent` 同步渲染 | 移除双层，改为单层 relative 布局；光标改为内容后的 inline 元素 | ✅ 已修复（含容器样式回归修正，见下） |

## Major 问题 — 已修复

| # | 问题 | 修复方式 | 状态 |
|---|------|----------|------|
| 3 | `content` 未防御 undefined | 检查确认 `AiResponsePanelProps.content` / `AiMessageBubbleProps.content` 均已是必填 `string` | ✅ 无需改动 |
| 6 | `autoCollapse` useEffect 依赖 `tasks` 数组导致定时器反复重建 | 依赖改为 `tasks.map(t => t.status).join(",")` 稳定字符串 | ✅ 已修复 |
| 7 | `AiChatPanel.tsx` 多处调试 `console.log` | 6 处 `[AI] ...` 调试日志全部删除 | ✅ 已修复 |

## Major 问题 — 留待后续迭代（非阻断）

| # | 问题 | 说明 |
|---|------|------|
| 4 | 非流式切换的 setTimeout 微任务竞态（`AiMessageBubble.tsx`） | 影响低概率场景，标记为 tech debt |
| 5 | 内联 `onCandidateSelect` 未 memoize | 消息数量有限，性能影响可忽略 |

## Minor 建议 — 留待后续迭代

- `displayed` 状态可用 `useRef` 替代（改动较大，标记 tech debt）
- `candidates!.map()` 非空断言可简化
- `entityLabelMap` 建议 `useMemo`
- logs 渲染 key 稳定性（风险低）
- 候选人按钮缺 `focus-visible` ring（UX 优化）
- 流式光标可用 `caret-color` 替代 span（UX 优化）
- `CandidateUser` 接口在 `AiChatPanel.tsx` 与 `AiMessageBubble.tsx` 重复定义，建议抽取到 `features/ai/types/`

---

## 过程修正记录

Main 在验收 Critical #2 修复时发现子代理连带移除了 `AiResponsePanel` 外层卡片容器样式（`rounded-xl border border-ink-200 bg-white shadow-sm`），超出修复范围且与已批准的 Code Agent 风格卡片面板设计不符（软层审查的一致性检查表明确认可这些 token）。已要求子代理恢复容器样式，仅保留单层渲染修复。

---

## 正面亮点（两份报告共识）

- SSE 版本取消机制（`conversationVersionRef`）设计优秀
- RAF 打字机循环 + 自适应速度（SSE 空闲加速、突发降速）
- 组件三层拆分清晰：`AiMessageBubble`（角色路由）→ `AiResponsePanel`（布局容器）→ `AiThinkingStream`（思考流）
- `TaskCategory` 可插拔设计，未来扩展工具类型无需改架构
- 与 `pretty-ui` design tokens 高度一致

---

## Next Steps

1. Main 已验证 tsc 通过（4 个文件无新增类型错误）
2. 待用户确认后，按 `git-commit-required.mdc` 走提交流程
