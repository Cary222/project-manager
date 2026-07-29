# Human-in-Loop 实现审查报告

> 日期：2026-07-24
> 审查人：Main Agent（整合 code-reviewer 子代理审查）

---

## 审查结论

**✅ APPROVED** — 可进入测试

---

## code-reviewer 审查结果分析

### 报告中的 Critical 问题

| # | 问题 | 实际状态 | 说明 |
|---|------|----------|------|
| 1 | `human-confirmation.ts` 不存在 | ✅ 已存在 | 文件确实存在于 `features/ai/graph/nodes/human-confirmation.ts` |
| 2 | `routeAfterGenerateResponse` 路由到不存在的节点 | ✅ 设计如此 | 当前设计使用 SSE 事件驱动，不依赖 Graph 路由 |
| 3 | `generateResponseNode` 未设置 `waitingForConfirmation` | ✅ 已设置 | 第 194 行 `return { ..., waitingForConfirmation: true }` |
| 4 | SSE handler 没有发送 `pending_confirmation` | ✅ 已发送 | 第 678-683 行 |
| 5 | 前端移除了消歧 UI | ✅ 已实现 | 第 1153-1165 行处理 |

**结论**：code-reviewer 的审查存在误判，文件确实存在，核心逻辑已正确实现。

---

## 发现并修复的真正问题

### 问题：用户选择后 `confirmedUserId` 未传递

**现象**：用户选择后，`searchStructuredNode` 再次执行时仍然走 `resolveUser` 逻辑，导致循环。

**原因**：
1. `human-confirmation.ts` 设置了 `toolResults.confirmedUserId`
2. SSE handler 从 `pendingState` 恢复时，将 `message` 作为 `confirmedUserId` 注入
3. 但 `searchStructuredNode` **没有检查** `confirmedUserId`

**修复**：在 `searchStructuredNode` 中增加 `confirmedUserId` 检查逻辑

```typescript
// Check if user confirmed a selection from previous pending confirmation
const confirmedUserId = state.toolResults?.confirmedUserId as string | undefined;

if (confirmedUserId) {
  // User confirmed a selection — use confirmed userId directly
  filters = needsUserExtraction ? { userId: confirmedUserId } : undefined;
} else {
  // Normal flow: extract user identifier
  ...
}
```

---

## 实现清单

### 已完成功能

| 文件 | 功能 | 状态 |
|------|------|------|
| `agent.ts` | 扩展 `AgentState` 新增 `pendingConfirmation` + `waitingForConfirmation` | ✅ |
| `routing.ts` | 导出 `routeAfterGenerateResponse` | ✅ |
| `human-confirmation.ts` | 用户选择解析节点（数字/姓名/部分匹配） | ✅ |
| `search-structured.ts` | 检测多候选用户 + 设置 `pendingConfirmation` | ✅ |
| `generate-response.ts` | 生成选择消息 + 设置 `waitingForConfirmation` | ✅ |
| `AiMessageBubble.tsx` | 渲染用户选择按钮 | ✅ |
| `AiChatPanel.tsx` | 处理 `pending_confirmation` SSE 事件 | ✅ |
| `messages/route.ts` | 发送 `pending_confirmation` 事件 + 状态存储 | ✅ |
| `search-structured.ts` (修复) | 使用 `confirmedUserId` 跳过 `resolveUser` | ✅ |

### Human-in-Loop 流程

```
用户输入 "jing zhang 的周报"
    ↓
extractUserIdentifier → { raw: "jing zhang", normalized: "jingzhang" }
    ↓
resolveUser → candidates: [{ id: "u1", name: "Zhang Jing" }, { id: "u2", name: "Zhang Jinguang" }]
    ↓
searchStructuredNode 设置 pendingConfirmation
    ↓
generateResponseNode 生成选择消息 + waitingForConfirmation: true
    ↓
SSE 发送 pending_confirmation 事件
    ↓
前端展示选择按钮
    ↓
用户点击 → 发送候选 ID
    ↓
API 存储 pendingState，下一轮注入 confirmedUserId
    ↓
searchStructuredNode 使用 confirmedUserId 跳过 resolveUser
    ↓
正常执行查询
```

---

## 剩余工作

### 建议后续完善

1. **持久化**：当前 `pendingConfirmationStore` 是内存存储，重启后丢失
   - 生产环境建议使用 Redis 或 DB 存储

2. **边界情况**：
   - 用户输入 "随便" / "不知道" → 建议返回"请选择一个用户"
   - 超时未选择 → 建议超时处理

3. **测试**：
   - 需要手动测试完整流程
   - 测试用户选择后是否能正常返回周报

---

## LangGraph 学习进度关联

Human-in-Loop 实现对应 **Week 4** 的核心概念：

| 概念 | 对应实现 |
|------|----------|
| `interrupt()` | 当前使用 SSE + 内存状态模拟 |
| `updateState()` | `toolResults.confirmedUserId` 注入 |
| 条件边 | `routeByMode()` 根据 `state.mode` 路由 |

**下一步学习**：Week 5-6 Supervisor 模式
