<!-- reviewer: code-reviewer (硬层) -->
## 审查结论

**Scope:** `features/ai/lib/speculation-cache.ts`、`app/api/ai/conversations/[id]/messages/route.ts`、`features/ai/tools/search-knowledge.ts`
**Review Type:** Local Changes（Step-5 产物审查）

### Verdict: ❌ Request Changes

---

## Findings

### Critical (Must Fix)

#### 1. **[app/api/ai/conversations/[id]/messages/route.ts:231]** `setSearchKnowledgeConversationId` 未导入

```typescript
// 当前导入（第12行）
import { speculationCache, shouldSpeculate } from "@/features/ai/lib/speculation-cache";

// 缺少：setSearchKnowledgeConversationId

// 第231行调用（报错 TS2304）
setSearchKnowledgeConversationId(conversationId);
```

- **Impact**: `currentConversationId` 永远为 `null`，`speculationCache.get()` 在 `searchKnowledge` 中永远返回 `null`，整个预加载机制完全失效
- **Suggestion**: 在第 12 行 import 中添加 `setSearchKnowledgeConversationId`：

```typescript
import { speculationCache, shouldSpeculate, setSearchKnowledgeConversationId } from "@/features/ai/lib/speculation-cache";
```

#### 2. **[features/ai/lib/speculation-cache.ts:35]** `set()` 每次调用都做 O(n) 全量清理

```typescript
set(conversationId: string, query: string, context: RagContext, ttl = this.DEFAULT_TTL): void {
  // 清理过期条目 — 每次 set 都遍历全量 Map
  this.cleanup();
  // ...
}
```

- **Impact**: 缓存条目越多，`cleanup()` 的 `for...of` 循环越慢。缓存 100 条时每次 set 扫描 100 个 entry；1000 条时扫描 1000 个。如果同一 conversation 频繁更新（如用户快速发多条消息），每次 set 都会触发全量扫描，造成性能退化
- **Suggestion**: 改用惰性清理策略，只在 `get()` 时检查当前条目是否过期，或者用定期（每 N 次 set）触发清理：

```typescript
private cleanupTrigger = 0;
private readonly CLEANUP_INTERVAL = 10;

set(...) {
  if (++this.cleanupTrigger >= this.CLEANUP_INTERVAL) {
    this.cleanup();
    this.cleanupTrigger = 0;
  }
  // ...
}
```

#### 3. **[app/api/ai/conversations/[id]/messages/route.ts:186+193-196]** `retrieveContext` 重复调用

```typescript
// 第186行：主流程 ragPromise
const ragPromise = useRag
  ? retrieveContext(message, { limit: 5, userId: session.user.id })
  : Promise.resolve({ results: [], contextText: "" });

// 第193-196行：预加载也调用 retrieveContext（相同参数！）
retrieveContext(message, { limit: 8, userId: session.user.id })
  .then((context) => {
    if (context.results.length > 0) {
      speculationCache.set(conversationId, message, context);
    }
  })
```

- **Impact**: 同一请求中 `retrieveContext` 被调用两次，数据库 / 向量搜索走两遍。当 speculation 命中时（`speculationCache.get` 返回非 null），第 186 行的结果被丢弃；当未命中时，两次调用都是浪费
- **Suggestion**: 预加载逻辑应该使用 `ragPromise` 的结果（已经算过了），而不是重新调用：

```typescript
// 方案：用 ragPromise 的结果做预加载（limit 稍大用于预缓存）
retrieveContext(message, { limit: 8, userId: session.user.id })
  .then((context) => {
    // 只有当 context 和 ragPromise 结果不同时才缓存
    // 或者：预加载只需要触发 searchKnowledge 时用，ragPromise 结果直接用
    speculationCache.set(conversationId, message, context);
  })
```

> 实际上，由于 `ragPromise` 在第 186 行已经执行，最简修复是：**预加载使用 `ragPromise` 的结果**（把 `retrieveContext` 调用改为 `ragPromise.then(...)`），或者干脆去掉预加载逻辑（`ragPromise` 的结果已经可以作为 RAG context 使用了，预加载只是锦上添花）。

---

### Improvements (Recommended)

#### 4. **[features/ai/lib/speculation-cache.ts:145]** 模块级单例无内存上限

```typescript
export const speculationCache = new SpeculationCache();
```

- **Impact**: `Map` 无限增长。虽然 TTL 5 分钟理论上会过期，但如果服务器长驻、缓存命中率低、或 `cleanup()` 触发频率低（见问题 2），可能导致内存持续增长
- **Suggestion**: 添加最大容量限制，超出时驱逐最老的条目：

```typescript
private readonly MAX_SIZE = 1000;

set(...) {
  this.cleanup();
  if (this.cache.size >= this.MAX_SIZE && !this.cache.has(conversationId)) {
    // 驱逐最老的
    const oldestKey = this.cache.keys().next().value;
    this.cache.delete(oldestKey);
  }
  // ...
}
```

#### 5. **[features/ai/tools/search-knowledge.ts:48-58]** 缓存检查时机正确，但缺少命记录

```typescript
execute: async ({ query, limit }) => {
  // 优先检查预测性缓存
  if (currentConversationId) {
    const cached = speculationCache.get(currentConversationId, query);
    if (cached) {
      console.log(`[searchKnowledge] cache HIT...`);
      return cached;  // ✅ 正确：直接返回，不执行 retrieveContext
    }
  }
  // 缓存未命中，执行真正的检索
  return await retrieveContext(query, { limit, userId: currentViewerUserId });
}
```

- **Positive**: 缓存命中时正确短路，`retrieveContext` 不执行，设计合理
- **Suggestion**: 可考虑在 cache HIT 时也设置一下（refresh TTL），让频繁访问的条目不过期：

```typescript
if (cached) {
  // 刷新 TTL（用 set 覆盖，等效于更新 createdAt）
  speculationCache.set(currentConversationId, query, cached);
  return cached;
}
```

#### 6. **[features/ai/lib/speculation-cache.ts:96-124]** `extractEntities` 正则误匹配风险

```typescript
// "在/为 XXX" 模式几乎匹配所有中文句子
const activityMatches = query.match(/(?:在|为|给)\s*([^\s]{2,10})/g);
// 例如："我在干嘛" → 匹配到 "在干嘛"
```

- **Impact**: 模糊匹配过于宽松，可能导致完全不相关的查询命中缓存（如"我"匹配"张伟"的用户名缓存）
- **Suggestion**: 在 `get()` 中增加额外验证，比如只在 `hasOverlap` 时有**多个**实体匹配才返回缓存：

```typescript
const overlapCount = entryEntities.filter((e) =>
  queryEntities.some((qe) => e.toLowerCase() === qe.toLowerCase() || e.includes(qe) || qe.includes(e))
).length;

if (overlapCount >= 1 && (overlapCount >= 2 || entryEntities.length <= 1)) {
  // ...
}
```

#### 7. **[features/ai/lib/speculation-cache.ts:12-17]** `SpeculationEntry` 的 `context: RagContext` 直接存储引用

```typescript
interface SpeculationEntry {
  query: string;
  context: RagContext;   // ← 整个结果数组都存进来了
  createdAt: number;
  ttl: number;
}
```

- **Impact**: `RagContext.results` 是 `SearchResultItem[]`，每条可能含长 `snippet`。如果 limit=8，每个 entry 可能占用几十 KB。1000 个 entry = 几十 MB
- **Suggestion**: 考虑只存 `results` 的 ID 列表或 `contextText`（已经汇总的字符串），而不是完整对象：

```typescript
interface SpeculationEntry {
  query: string;
  contextText: string;      // 只存汇总文本
  resultIds: string[];     // 用于去重验证
  createdAt: number;
  ttl: number;
}
```

---

### Nitpicks (Optional)

#### 8. **[features/ai/lib/speculation-cache.ts:45-47]** 日志中暴露 query 内容

```typescript
console.log(`[SpeculationCache] cached conv=${conversationId} query="${query.slice(0, 50)}"`);
```

- **Minor**: query 最多截断 50 字符还好，但如果是用户私密内容（如"我的密码是什么"），日志会记录。考虑统一脱敏或只记录 hash

#### 9. **[app/api/ai/conversations/[id]/messages/route.ts:197-201]** speculation 失败时静默忽略

```typescript
.catch((e) => {
  console.log(`[AI-MSG] speculation prefetch failed: ${e}`);
  // 没有 rethrow — 静默失败
});
```

- **Minor**: 作为 fire-and-forget 机制静默失败是合理的（不影响主流程）。但如果 speculation 是核心功能，可以加一个 metrics counter 便于监控

---

## 正面发现

- **架构设计清晰**：预测性预加载的理念（类似 CPU 流水线预取）符合优化目标
- **无阻塞主流程**：speculation 用 `.then()` 异步执行，不阻塞 SSE 流式响应
- **conversationId 隔离正确**：每个 conversation 有独立的 cache key，不会串数据
- **search-knowledge 集成正确**：缓存命中时正确短路，不执行 retrieveContext
- **`shouldSpeculate` 触发条件合理**：工单号/项目名/人名等实体查询模式覆盖面适中
- **TTL 设计合理**：5 分钟对于对话场景足够长又不会太长

---

## Next Steps

1. **立即修复**：添加缺失的 `setSearchKnowledgeConversationId` import（问题 1）
2. **性能优化**：移除每次 set 的全量 cleanup（问题 2）
3. **消除重复调用**：预加载复用 `ragPromise` 结果而非重新调用 `retrieveContext`（问题 3）
4. **可选改进**：添加内存上限、TTL refresh、正则优化（问题 4-7）

---

## 对照踩坑记录

无相关历史踩坑记录（这是新功能 PR10）。

---

> **cross-mentor**: 问题 3（retrieveContext 重复调用）的业务取舍——预加载是否必要，还是直接用 `ragPromise` 结果即可？这涉及功能价值判断，转交软层决策。
