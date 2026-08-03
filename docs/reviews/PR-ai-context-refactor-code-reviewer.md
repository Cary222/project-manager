<!-- reviewer: code-reviewer (硬层) -->

# Code Review: AI 上下文管理重构（方案 v4）

**Scope:** `features/ai/core/context/`（9 文件）+ `prisma/schema.prisma` + `messages/route.ts`
**Review Type:** Local Changes（方案 v4 范围文件）
**tsc:** clean（无 context/ 相关错误）
**vitest:** 7/7 passed

---

## 审查结论

| 维度 | 评分 | 关键问题 |
|------|------|---------|
| 类型安全 | B | `as unknown as` 双重 cast 掩盖类型不匹配 |
| DB 操作 | A | upsert 用法正确，schema 设计合理 |
| 错误处理 | B | `patcher.flush()` finally 块无 try-catch |
| 并发安全 | A | debounce + cache TTL + finally flush 配合正确 |
| 性能 | A | 两个独立 token limit，debounce 1s，无 N+1 |
| 资源泄露 | A | clearTimeout 覆盖全路径，memoryCache 有 TTL |
| 安全性 | A | requireSession + ownership check 到位 |
| 接口设计 | B | `parseNodeOutput` 漏了 `recentMentions`/`topicTags` |
| 命名规范 | A | 与项目风格一致，命名清晰 |
| 文档完整性 | A | JSDoc 完整 |

---

## Critical 问题（必须修复）

### 1. `[runtime-state-persist.ts:60-69]` `patcher.flush()` 在 finally 块无 try-catch，DB 异常会传播到 SSE stream handler 抛出未捕获异常

```ts
} finally {
  // Stage 5 + Replace Point F: force flush RuntimeState to DB.
  await patcher.flush(); // ← 如果这里 throw，ReadableStream handler 崩溃
}
```

**影响**: 当 `saveRuntimeState`（调用 Prisma `upsert`）因 DB 连接问题 throw 时，异常穿透 `finally` 传播到 `ReadableStream` 的 `start()` controller。`ReadableStream` 的 start controller 异常会导致整个 stream 报 500 错误，用户看到的是原始异常而非友好的 "stream ended"。

**修复建议**: 在 finally 块包 try-catch，将 flush 错误降级为 console.error 而非抛异常：

```ts
} finally {
  try {
    await patcher.flush();
  } catch (flushErr) {
    console.error(`[AI-LangGraph] RuntimeState flush failed: ${flushErr instanceof Error ? flushErr.message : String(flushErr)}`);
  }
}
```

---

### 2. `[conversation-state-store.ts:69-70]` `as unknown as` 双重 cast 掩盖 Prisma Json 类型与业务类型的边界

```ts
if (row.humanState) state.human = row.humanState as ConversationRuntimeState["human"];
if (row.semanticContext) state.semantic = row.semanticContext as ConversationRuntimeState["semantic"];
```

**影响**: `Prisma.Json` 映射为 `Prisma.JsonValue`（联合类型），直接 `as` 跳过所有类型检查。若 DB 中存储的 JSON 结构与 `ConversationRuntimeState` 类型不匹配，运行时才暴露错误，无提前告警。

**修复建议**: 用 Zod 或手动 shape check 做运行时验证：

```ts
function isValidHumanState(v: unknown): v is ConversationRuntimeState["human"] {
  return typeof v === "object" && v !== null;
}
// 或
import { z } from "zod";
const HumanStateSchema = z.object({
  pendingAction: z.unknown().optional(),
  originalQuery: z.string().optional(),
  // ...
});
```

---

## Medium 问题（建议修复）

### 3. `[runtime-state-adapter.ts:81-91]` `parseNodeOutput` 只解析 `lastMentionedUser`，漏掉 `recentMentions` 和 `topicTags`

schema 定义 `semantic` 包含三个字段：

```ts
semantic?: {
  lastMentionedUser: { ... } | null;
  recentMentions: Array<{ ... }>;   // ← 未被写入
  topicTags: string[];               // ← 未被写入
};
```

但 `parseNodeOutput` 只处理 `lastMentionedUser`。即使 LangGraph graph 输出了 `recentMentions`/`topicTags`，也永远不会被持久化到 DB。

**建议**: 在 `NodeOutput` 接口添加字段：

```ts
recentMentions?: Array<{ id: string; name: string; mentionedAt?: string }>;
topicTags?: string[];
```

并在 `parseNodeOutput` 的 semantic 分支补充对应逻辑。

> **注**: 如果这是"第一阶段先做 lastMentionedUser，others 后续再接"的故意简化，应在代码注释中说明"reserved for future fields"。

---

### 4. `[conversation-state-store.ts:79-113]` `saveRuntimeState` 无 try-catch，DB 异常静默丢失

若 Prisma `upsert` 失败（如唯一约束冲突），异常向上抛——在 `patcher.schedule()` 的 `setTimeout` 回调中意味着定时 flush 的数据永久丢失（pending 被清空但 DB 没写入）。

**建议**: 在 `saveRuntimeState` 内部 catch 并 console.error：

```ts
export async function saveRuntimeState(
  convId: string,
  state: Partial<ConversationRuntimeState>,
): Promise<void> {
  // ... build updateData ...
  try {
    await prisma.aiConversationRuntimeState.upsert({ ... });
  } catch (err) {
    console.error(`[RuntimeState] save failed for conv=${convId}: ${err instanceof Error ? err.message : String(err)}`);
    throw err; // 重新抛让 caller 知道失败了
  }
  memoryCache.delete(convId);
}
```

---

## 对照方案 v4 验证

| 方案要求 | 实际实现 | 状态 |
|---------|---------|------|
| 单表 JSON schema | `AiConversationRuntimeState`，`humanState`/`semanticContext` 两个 Json 列，`conversationId @id` | ✅ |
| runtime-state-adapter 抽取 | `parseNodeOutput()` 统一解析 `NodeOutput` → `ParsedRuntimePatch` | ✅ |
| finally flush | `finally { await patcher.flush() }` 在 SSE stream finally 块 | ✅ |
| 两个独立 token limit | `historyTokenLimit` + `systemAndRagTokenLimit` 分别传入 | ✅ |
| id 去重（不是 content） | `seen.has(msg.id)` + `seen.add(msg.id)`，测试用例确认 | ✅ |
| response_metadata（不是 additional_kwargs） | `new AIMessage({ content, response_metadata: hydrated ?? undefined } as any)` | ✅ |
| toolSummary 摘要 | `message-metadata-adapter.ts` 提取 count + 最多 10 个 entities | ✅ |
| ContextBuilder 不返回 BaseMessage[] | `context-builder.ts` 只返回 `ChatContext`（含 raw history），`buildMessages` 在 route.ts 调用 | ✅ |
| 单元测试覆盖 | 7 个测试用例：空历史、截断、id 去重、pending 插入、去重检查、response_metadata、toolSummary 上限 | ✅ |

---

## Positive Points

- **架构清晰**: 9 个文件各司其职（store / persist / adapter / builder / counter / window / adapter），无重复逻辑
- **测试覆盖完整**: 7 个测试用例覆盖了关键路径（id 去重、metadata 路径、toolSummary 上限）
- **语义上下文注释到位**: `runtime-state-adapter.ts` 中 `null 是有效值（清除字段）` 的注释准确
- **finally flush 设计正确**: 覆盖 normal end / network abort / recursion error 三种场景
- **memoryCache 有 TTL**: 5s TTL 防止 stale data，且 `saveRuntimeState` 主动 invalidate
- **auth 链路完整**: `requireSession` → `getConversation(..., session.user.id)` → 工具 context 注入
- **无 N+1**: 所有 DB 操作都是单条 query，无循环内 query
- **turbopack 兼容**: 无 `require()` 语法

---

## 越界改动提示

subagent 越界修改了 16 个方案外文件（detect-intent.ts, generate-response.ts, human-confirmation.ts, search-structured.ts, agent.ts, routing.ts, query-*.ts, user-resolver.ts, AiChatPanel.tsx, AiMessageBubble.tsx, llm/proxy.ts, query-weekly-report.ts, ai/types/{index,structured,thinking}.ts）。本审查**不评估**这些改动，只记录范围。

---

## Next Steps

1. **必须修复**: 为 `finally { await patcher.flush() }` 加 try-catch（Critical #1）
2. **必须修复**: 移除 `as unknown as` 双重 cast，改用 Zod 或 shape check（Critical #2）
3. **建议修复**: `parseNodeOutput` 补充 `recentMentions`/`topicTags` 字段（Medium #3）
4. **建议修复**: `saveRuntimeState` 加 try-catch 并重新抛异常（Medium #4）
