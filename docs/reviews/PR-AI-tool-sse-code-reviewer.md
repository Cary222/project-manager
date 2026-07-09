<!-- reviewer: code-reviewer (硬层) -->

# Code Review: AI Module Bug Fixes

**Scope:** `app/api/ai/conversations/[id]/messages/route.ts` + `features/ai/lib/summarizer.ts`
**Review Type:** Local Changes (uncommitted, not part of a PR)

---

## 1. tool-result SSE 修复

### 变更内容

```190:196:app/api/ai/conversations/[id]/messages/route.ts
case "tool-result":
  enqueueData({
    type: "tool_result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: part.output,
  });
  break;
```

已移除 `input` 字段。

### 审查结果

#### Correctness ✅
- `input` 字段原本是冗余的：`tool-call` 事件已单独发送 `input`（第 182-188 行），`tool-result` 重复携带它既浪费带宽也无语义价值
- 前端消费者 `AiChatPanel.tsx:822` 仅使用 `parsed.toolName` 和 `parsed.output`，从未访问过 `input` 字段；移除后功能不受影响

#### Maintainability ✅
- 代码行数减少，事件 payload 更精简，符合 SSE 最小化原则

#### Security ✅
- 移除字段不涉及敏感信息处理，无安全影响

#### Dependency Check ✅
- Grep 全仓库 `tool_result` / `tool-result` 只找到两处引用（`route.ts` + `AiChatPanel.tsx`），无第三方依赖

#### Edge Cases ✅
- SSE 事件是追加式的，前端不会因缺少 `input` 而崩溃（TypeScript 已确认前端仅解构 `toolName` + `output`）

### Verdict: ✅ **APPROVED**

无需修改。变更干净、准确，前端已兼容。

---

## 2. summarizer 重试逻辑

### 变更内容

新增重试机制（`summarizer.ts`）：

```10:11:features/ai/lib/summarizer.ts
const RETRYABLE_STATUS_CODES = new Set([404, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
```

```43:88:features/ai/lib/summarizer.ts
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  if (attempt > 0) {
    const delayMs = Math.pow(2, attempt - 1) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  try {
    const response = await fetch(AGNES_API_URL, {
      // ...
    });
    if (response.ok) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content ?? "";
    }
    // 401/403 — auth problem, never retry
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Agnes API error: ${response.status}`);
    }
    lastError = new Error(`Agnes API error: ${response.status}`);
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    const statusMatch = lastError.message.match(/Agnes API error: (\d+)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    if (attempt < MAX_RETRIES && status > 0 && RETRYABLE_STATUS_CODES.has(status)) {
      continue;
    }
    throw lastError;
  }
}
throw lastError ?? new Error("Agnes API error: unknown");
```

### 审查结果

#### Correctness ⚠️ 有 1 处需确认

- **`404` 加入 `RETRYABLE_STATUS_CODES` 可疑**：业务含义上"资源不存在"通常不是临时性错误，重试无意义。但考虑到这是 AI 摘要 API，`404` 可能是服务端临时路由故障而非业务层"资源不存在"。建议确认 Agnes API 是否会返回 404 用于临时性故障。若是 429/500/502/503/504 重试是正确的。
  - **Impact**: 低 — 即使 404 被错误重试，最坏情况是多一次无效请求，不破坏数据
  - **Suggestion**: 如果能确认 Agnes API 的 404 语义，可以保留；否则建议从 `RETRYABLE_STATUS_CODES` 中移除 404

#### Error Handling ⚠️ 有 1 处需确认

- **响应体未消费（潜在连接池泄漏）**：当 `response.ok === false` 且 `status !== 401/403` 时，代码立即将 `lastError` 赋值为不含 response body 的错误对象，然后继续循环或抛出。**HTTP 规范要求在大多数情况下消费响应体**，否则可能导致 HTTP 连接无法正确复用（HTTP/1.1 规范要求）。这不是阻塞性问题（Node.js/Next.js 通常能容忍），但有微妙的资源泄漏风险。
  - **Impact**: 低 — 实践中 fetch 会自动关闭连接，但不符合最佳实践
  - **Suggestion**: 如果 `status` 在 `RETRYABLE_STATUS_CODES` 中，在 continue 前调用一次 `response.text()`（或 `await response.arrayBuffer()`）以消费响应体

#### Edge Cases ✅

- **`lastError` 空指针保护**：`throw lastError ?? new Error("Agnes API error: unknown")` — 正确，函数末尾确保 `lastError` 必有值
- **`parseInt` 异常保护**：`statusMatch` 为 null 时 `status = 0`，`RETRYABLE_STATUS_CODES.has(0)` 为 false，逻辑正确
- **死循环防护**：`attempt < MAX_RETRIES` 在 continue 前检查，最多重试 2 次（共 3 次调用），不会死循环

#### Efficiency ✅

- 指数退避时间：`attempt=1 → 1s`，`attempt=2 → 2s`，总等待时间 3s，**合理且不激进**
- 不重复发送已完成成功的请求

#### Security ✅

- 401/403 **立即抛出、不重试** — 正确，防止 API Key 泄露时无限重试浪费资源
- API Key 从 `process.env` 读取，未硬编码，无泄露风险

#### Type Safety ✅

- TypeScript 类型正确：`RETRYABLE_STATUS_CODES` 为 `Set<number>`，`status` 为 `number`，匹配

### Verdict: ⚠️ **APPROVED with Suggestions**

两处建议均为低风险优化项，不阻塞合并。建议修复后代码质量更高，但现有实现功能性正确。

---

## Critical (Must Fix)

无。tsc 报告中的错误均为历史遗留（admin moderation / e2e / admin.test.ts），与本次修改无关。

## Improvements (Recommended)

1. **`[features/ai/lib/summarizer.ts:10]`** 考虑从 `RETRYABLE_STATUS_CODES` 移除 `404`
   - Reason: "资源不存在"语义上通常是确定性错误而非临时故障；重试无收益

2. **`[features/ai/lib/summarizer.ts:75]`** 在 `lastError = ...` 后、`continue` 前消费 response body
   - Reason: 符合 HTTP 规范，防止连接池泄漏（非阻塞性但属最佳实践）

## Nitpicks (Optional)

- `[summarizer.ts:45]` `Math.pow(2, attempt - 1) * 1000` 可简写为 `1 << (attempt - 1) * 1000`（位运算），但当前写法可读性更好，无需改

## Positive Points

- `tool-result` 移除冗余字段，代码更精简
- 重试逻辑结构清晰：成功立即 return，auth 错误立即 throw，其他错误走退避
- 指数退避时间温和（最大 2s），不会对下游 API 造成压力
- 前端 `AiChatPanel.tsx` 已有对 `tool_result` 类型的安全解构（仅访问 `toolName`/`output`/`error`），无隐式依赖

## Summary

| 文件 | 维度 | 结论 |
|------|------|------|
| `route.ts` | tool-result 修复 | ✅ APPROVED |
| `summarizer.ts` | 重试逻辑 | ⚠️ APPROVED with Suggestions（2 个低风险改进建议） |

两个修改的核心逻辑正确，无阻塞性问题。建议处理完两处改进建议后合并。
