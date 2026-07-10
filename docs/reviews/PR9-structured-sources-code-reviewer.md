<!-- reviewer: code-reviewer (硬层) -->

## Code Review Summary

**Scope:** `features/ai/tools/search-structured.ts` + `app/api/ai/conversations/[id]/messages/route.ts`
**Review Type:** Local Changes（改动中，未完成）
**tsc:** ⚠️ 1 个新增错误（见 Critical #1）

---

### Verdict: ❌ Request Changes

实现未完成——TS 类型错误阻断编译，且 SSE `sources` 事件发送逻辑完全缺失。

---

### Findings

#### Critical (Must Fix)

- **`features/ai/tools/search-structured.ts:441`** `error TS2322: Type 'StructuredResult' is not assignable to type 'string'`

  `queryTicket` 返回 `StructuredResult`（含 `summary` + `sources`），但 `execute` 内部 switch 所有分支都赋值给 `result: string`。`ticket` 分支直接将 `StructuredResult` 赋给 `string` 变量，类型不匹配。

  ```437:441:features/ai/tools/search-structured.ts
        let result: string;
        switch (type) {
          case "ticket":
            result = await queryTicket(id, filters, viewerUserId); // TS2322
  ```

  **Impact**: 编译阻断，`searchStructured` 工具完全不可用。
  **Suggestion**: 将 `result` 类型改为 `string | StructuredResult`，在 return 前统一取 `.summary` 字段转 `string`。

- **`app/api/ai/conversations/[id]/messages/route.ts`** SSE `sources` 事件提取逻辑完全缺失

  前端已实现 `parsed.type === "sources"` 消费逻辑（`AiChatPanel.tsx:789`），但 backend 从未发送此事件。`toolResults` 数组在 line 245 被收集后即丢弃，`extractSourcesFromToolResults` 和 `dedupeSourcesByUrl` 均未调用。

  **Impact**: 前端期待 `sources` 事件但永远收不到，参考来源不显示。
  **Suggestion**: 在 `fullStream` 迭代结束后（`enqueueData({ type: "done" })` 之前）补充 source 提取 + SSE 发送逻辑。

---

#### Improvements (Recommended)

- **`features/ai/tools/search-structured.ts:228–458`** 除 `queryTicket` 外其余 4 个 query 函数返回 `string`，不一致

  `queryProject`/`queryUser`/`queryCommit`/`queryWeeklyReport` 未填充 `sources`。若后续要统一 SSE 来源覆盖范围，这 4 个函数需要补充 source 提取逻辑。

  **Impact**: SSE `sources` 只能从 `ticket` 类型工具调用提取，其他类型的 URL 不会发送给前端。
  **Suggestion**: 评估 `queryProject`/`queryUser`/`queryCommit`/`queryWeeklyReport` 是否需要补充 `sources`；若需要，与 `queryTicket` 保持一致的返回结构。

- **`features/ai/tools/search-structured.ts:169–176`** `SourceReference.type` 用 `"ticket" as const` 字面量，但 `queryTicket` 列表分支也返回 `"ticket" as const`

  一致性 OK，但 `SourceReference.type` 联合类型包含 5 种，而 `rag.ts` 中 `SourceReference` 只有 3 种（`"ticket" | "commit" | "note"`），`AiMessageBubble.tsx` 同样只有 3 种。

  **Impact**: `searchStructured` 返回的 `"project" | "user" | "weekly_report"` 类型在现有 UI 渲染层会落入 `default` 分支，URL 显示可能出错。
  **Suggestion**: 统一 `SourceReference` 类型定义，或在 `AiMessageBubble` 对未知 type 做兜底渲染。

---

#### Nitpicks (Optional)

- **`app/api/ai/conversations/[id]/messages/route.ts:183`** `const result: any = streamText(...)` 使用 `any` 类型掩盖了 `streamText` 返回值的类型检查

  建议定义明确类型：`type StreamResult = Awaited<ReturnType<typeof streamText>>`，或在 `eslint-disable` 注释后加 TODO 说明为何需要 `any`。

- **`features/ai/tools/search-structured.ts:436`** `viewerUserId` 在所有 5 个 query 函数签名中出现但 `queryProject`/`queryCommit` 函数体内未使用

  对 `queryTicket`/`queryUser`/`queryWeeklyReport` 有实际权限过滤作用，但 `queryProject`/`queryCommit` 没有做权限检查。确认这是有意设计还是有遗漏。

---

### Positive Points

- `StructuredResult` 和 `SourceReference` 类型设计合理，`queryTicket` 的 source 填充逻辑正确（`index/title/url/type` 均完整）
- `setSearchStructuredViewer` 模块级 viewer 注入机制设计清晰，注释清楚解释了 Agnes 不支持 `toolsContext` 的历史原因
- `messages/route.ts` 移除 `toolsContext`、改用 `maxStepsForMode` 动态步数控制是正确的方向
- `dedupeSourcesByUrl` 在 `AiMessageBubble.tsx` 中已实现，可直接复用

---

### Cross-Mentor Note

- `cross-mentor:` SSE `sources` 事件的数据模型（`SourceReference`）在 3 个地方定义不完全一致（`search-structured.ts` 5-type、`rag.ts` 3-type、`AiMessageBubble.tsx` 3-type），建议 mentor 评估是否需要统一抽象到 shared 类型文件

---

### Next Steps

1. **必须修复**：`search-structured.ts` 的 `result: string` 类型改为 `string | StructuredResult`，return 前统一取 `.summary`
2. **必须实现**：在 `messages/route.ts` 的 `ReadableStream` 中添加 `extractSourcesFromToolResults` 逻辑（复用 `AiMessageBubble.tsx` 的 `dedupeSourcesByUrl`），在 `enqueueData({ type: "done" })` 之前发送 `{ type: "sources", sources }` 事件
3. **建议评估**：4 个非 ticket query 函数的 sources 补充计划
4. tsc 0 错误后再进行功能测试
