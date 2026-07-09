<!-- merged by Main, 2026-07-09 -->

# AI 模块 Bug 修复 — 合并审查报告

> **审查范围**：`app/api/ai/conversations/[id]/messages/route.ts` + `features/ai/lib/summarizer.ts`
> **审查者**：code-reviewer（硬层） + ai-learning-mentor（软层） + Main 合并

---

## 一、tool-result SSE 修复

### 1.1 变更内容

`app/api/ai/conversations/[id]/messages/route.ts` 第 190-197 行：

```190:197:app/api/ai/conversations/[id]/messages/route.ts
case "tool-result":
  enqueueData({
    type: "tool_result",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    output: part.output,
  });
  break;
```

去掉冗余的 `input` 字段（`tool-call` 事件已单独发送参数）。

### 1.2 硬层审查（code-reviewer）

- `tool-call` 事件已发送 `input`（工具参数），`tool-result` 重复携带是冗余的
- 前端 `AiChatPanel.tsx` 仅使用 `parsed.toolName` 和 `parsed.output`，从未访问过 `input` 字段
- SSE 事件追加式，缺少 `input` 不会导致前端崩溃
- 无第三方依赖影响

**结论：✅ APPROVED** — 变更干净准确，前端已兼容。

### 1.3 软层审查（ai-learning-mentor）

- `tool_call` 负责"发出调用"（含 `input` 让前端显示"正在搜索 XXX"），`tool_result` 负责"返回结果"（含 `output`）。职责分离清晰。
- `ai-module-full-chain.md` 附录 B 未显式定义 `tool_result` 字段是旧文档遗漏，不影响本次修改。

**结论：✅ APPROVED** — 符合设计意图，消除冗余。

### 1.4 Main 综合结论

**✅ 可合并。无阻塞问题。**

---

## 二、summarizer 重试逻辑

### 2.1 变更内容

`features/ai/lib/summarizer.ts`：

```10:12:features/ai/lib/summarizer.ts
/** Status codes that warrant a retry with exponential backoff */
const RETRYABLE_STATUS_CODES = new Set([404, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
```

```43:88:features/ai/lib/summarizer.ts
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  if (attempt > 0) {
    const delayMs = Math.pow(2, attempt - 1) * 1000; // 1s → 2s
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  try {
    const response = await fetch(AGNES_API_URL, { ... });
    if (response.ok) { return data.choices?.[0]?.message?.content ?? ""; }
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

### 2.2 硬层审查（code-reviewer）

**Critical：无**

| 问题 | 风险 | 建议 |
|------|------|------|
| 404 加入可重试集合语义可疑 | 低 — 重试 404 无收益但也不破坏数据 | 考虑从 `RETRYABLE_STATUS_CODES` 移除 404 |
| 响应体未消费（`response.ok === false` 时） | 低 — HTTP 连接可能无法正确复用 | 在 `continue` 前调用 `response.text()` 消费响应体 |

**其他维度全部通过**：
- 死循环防护：`attempt < MAX_RETRIES` 检查正确
- 401/403 立即抛出：不重试 auth 错误，正确
- 指数退避：最大 2s，不激进
- TypeScript 类型正确

**结论：⚠️ APPROVED with Suggestions** — 2 个低风险改进建议，不阻塞合并。

### 2.3 软层审查（ai-learning-mentor）

**发现：retry 策略出现两套，叠加效应未记录**

| 位置 | retry 机制 | 延迟策略 | auth 失败 |
|------|-----------|----------|----------|
| `background-jobs.ts` | 失败后 1 次重试 | 固定 5s | 未处理 |
| `summarizer.ts`（新增） | 最多 2 次重试 | 指数退避 1s→2s | 401/403 直接抛错 |

调用链关系：
```
background-jobs:doSummarize(attempt=0)
  → summarizer:callAgnes() ← 这里有 retry (attempt 0-2)
  → 若全失败，background-jobs 再触发一次 doSummarize
```
**最坏情况：4 次 LLM 调用**（3 次 summarizer + 1 次 background-jobs）。

**建议**：在 `ai-module-full-chain.md` 第 5.5 节补充说明两层 retry 的叠加效应。

**结论：⚠️ CHANGES_REQUIRED** — 代码本身正确，但文档需补充。

### 2.4 Main 综合结论

**⚠️ 可合并，建议处理以下改进后合并**：

1. **（低优先级）从 `RETRYABLE_STATUS_CODES` 移除 404** — 资源不存在通常非临时故障
2. **（低优先级）在重试前消费响应体** — 符合 HTTP 规范
3. **（文档）更新 `ai-module-full-chain.md` 第 5.5 节** — 说明两层 retry 叠加效应

---

## 三、审查总结

| 修改 | 硬层 | 软层 | Main 综合 |
|------|------|------|----------|
| `tool-result` 去掉 `input` | ✅ APPROVED | ✅ APPROVED | ✅ 可合并 |
| `summarizer` 重试逻辑 | ⚠️ APPROVED with Suggestions | ⚠️ CHANGES_REQUIRED（文档） | ⚠️ 可合并（建议处理 3 个改进） |

**无 Critical 问题。两个修改均具备合并条件。**

---

## 四、改进项

| # | 文件 | 优先级 | 内容 |
|---|------|--------|------|
| 1 | `summarizer.ts` | 低 | 从 `RETRYABLE_STATUS_CODES` 移除 404 |
| 2 | `summarizer.ts` | 低 | 重试前调用 `response.text()` 消费响应体 |
| 3 | `ai-module-full-chain.md` | 中 | 第 5.5 节补充两层 retry 叠加效应说明 |
