<!-- reviewer: code-reviewer (硬层) -->
# HIL V3 Phase 1 硬层审查报告

## 审查结论

**CHANGES_REQUIRED**

存在 1 个 Critical TypeScript 编译错误（阻断构建），必须修复后才能合并。

---

## Critical（必须修复）

### 1. `[app/api/ai/conversations/[id]/messages/route.ts:624]` — V2 旧类型与新 `PendingConfirmation` 不兼容

**问题**：`initialState.pendingConfirmation` 仍使用 V2 的 `{ type: "user_disambiguation"; candidates: { id, name, email }[]; query }` 结构体，但 `PendingConfirmation` 类型（`agent.ts:13-20`）已改为泛化格式，要求：
- `type: "disambiguation"`（不再是 `"user_disambiguation"`）
- `entityType: "user" | "ticket" | "project" | "weekly_report"`（新增必填字段）
- `candidates` 结构改为 `{ id, label, summary }[]`（字段名变化：`name`/`email` → `label`/`summary`）

**tsc 报错**：
```
error TS2345: ... Property 'entityType' is missing in type
'{ type: "user_disambiguation"; candidates: { id: string; name: string; email: string; }[]; query: string; }'
but required in type 'PendingConfirmation'.
```

**影响**：生产构建失败，API 在恢复断点时会传入错误形状的 `pendingConfirmation` 给 graph。

**修复建议**：将 `route.ts:624` 处的 `pendingConfirmation` 构造迁移到新格式：

```ts
// 旧（V2）
pendingConfirmation: pendingState?.pendingConfirmation ?? null,

// 新（V3）
pendingConfirmation: (() => {
  const old = pendingState?.pendingConfirmation;
  if (!old) return null;
  // 旧格式兼容：如果仍是 user_disambiguation，降级迁移
  if (old.type === "user_disambiguation") {
    return {
      type: "disambiguation" as const,
      entityType: "user" as const,
      candidates: old.candidates.map((c) => ({
        id: c.id,
        label: `${c.name}（${c.email}）`,
        summary: "",
      })),
      query: old.query,
    };
  }
  return old; // 新格式直接透传
})(),
```

---

## Warning（建议修复）

### 2. `[features/ai/graph/edges/routing.ts:79]` — `routeAfterHumanConfirmation` 未处理新增的 `entityType`

**问题**：`routeAfterHumanConfirmation` 只检查 `resolvedEntities?.user`，但 `resolvedEntities` 现在还包含 `ticket`、`project`、`weekly_report`。如果用户消歧的是周报实体，路由会错误地走 `generateResponse` 而非 `searchStructured`。

**影响**：周报消歧确认后不会触发查询，周报列表不会返回。

**修复建议**：扩展判断条件，覆盖所有实体类型：

```ts
// routing.ts:79
const hasAnyResolved = !!(state.resolvedEntities?.user
  ?? state.resolvedEntities?.ticket
  ?? state.resolvedEntities?.project
  ?? state.resolvedEntities?.weekly_report);
if (hasAnyResolved) {
  return "searchStructured";
}
```

---

## Info（建议优化）

### 3. `[features/ai/graph/nodes/human-confirmation.ts:94]` — 非空断言在 `confirmed` 查找失败时 panic

**位置**：`human-confirmation.ts:94`
```ts
const confirmed = candidates.find((c) => c.id === result)!;
```
这里 `result` 来自 `parseSelection` 返回的 `id`，理论上必然能在 `candidates` 中找到（`parseSelection` 本身就是从 candidates 里取 id 的），但若 `pendingConfirmation.candidates` 在两次调用之间被并发修改，非空断言会导致运行时 panic。

**建议**：用显式检查替代非空断言，返回错误信息而非崩溃：
```ts
const confirmed = candidates.find((c) => c.id === result);
if (!confirmed) return { waitingForConfirmation: true };
```

### 4. `[features/ai/graph/nodes/search-structured.ts:119]` — `DISAMBIGUATION_THRESHOLDS` 无 `const assertion`，存在 key 拼写风险

**位置**：`search-structured.ts:10-15`
```ts
const DISAMBIGUATION_THRESHOLDS = {
  user: 1,
  ticket: 3,
  project: 3,
  weekly_report: 3,
}; // ← 缺少 as const
```

**问题**：第 118 行 `DISAMBIGUATION_THRESHOLDS[entityType]` 若 `entityType` 为字符串字面量（如 `"ticket"` 但非 `as const`）会报类型错误；当前代码可正常编译但属于脆弱设计。

**修复建议**：添加 `as const`：
```ts
} as const;
```

### 5. `[features/ai/graph/nodes/search-structured.ts:107]` — JSON.parse 大对象无 try-catch

**位置**：`search-structured.ts:107`
```ts
const resultObj = typeof result === "string" ? JSON.parse(result) : result;
```
当 `result` 为长字符串（周报摘要 + 工单列表）时，若 JSON 格式异常，`JSON.parse` 会抛异常穿透到外层 catch。虽然最终会被捕获（外层有 try-catch），但错误信息会丢失上下文（是 parse 失败还是 execute 失败难以区分）。

**建议**：给 parse 加内层 try-catch，分别记录。

### 6. `[features/ai/tools/search-structured.ts:183]` — `findMany` 循环查询存在 N+1 风险

**位置**：`search-structured.ts:183-191`（`resolveUser` Step 3）
```ts
for (const term of uniqueTerms) {
  const matches = await prisma.user.findMany({
    where: { searchName: { contains: term, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true },
  });
  // ...
}
```

**问题**：`uniqueTerms` 最多约 20 个 term（单字中文 + 拼音全拼 + 倒序 + 空格拼接等），循环内每个 term 独立发一次 DB 查询，最坏 20 次 `SELECT * FROM "pm"."User" WHERE "searchName" LIKE '%...' AND "bannedAt" IS NULL`。

**影响**：用户查询（如"刘工的周报"）在 resolveUser 阶段会触发多次 DB 查询，而非一次 IN 查询。

**建议**：改用单次 `findMany` + 内存过滤，或用 `OR` 拼接 terms。

### 7. `[features/ai/tools/search-structured.ts:232-243]` — 同样存在 N+1（Step 5 weak match）

**位置**：`search-structured.ts:232-243`
```ts
for (const term of allTerms) {
  const matches = await prisma.user.findMany({ ... });
  // ...
}
```

与第 6 条同类问题，Step 5 再来一轮循环查询。

### 8. `[features/ai/graph/nodes/generate-response.ts:201]` — `pendingConfirmation.type === "disambiguation"` 覆盖所有 entityType

**位置**：`generate-response.ts:201`
```ts
if (state.pendingConfirmation?.type === "disambiguation") {
```

**确认**：V3 迁移后，所有消歧类型的 type 统一为 `"disambiguation"`，不再是 V2 的 `"user_disambiguation"`。此处无需修改，标记为通过。

### 9. `[features/ai/tools/search-structured.ts:50-61]` — `UserDisambiguationAttribution` 旧类型未删除

**位置**：`search-structured.ts:45-48`
```ts
interface UserDisambiguationAttribution {
  kind: "user_disambiguation";
  candidates: Array<{ id: string; name: string | null; email: string }>;
}
```

**问题**：`Attribution` 联合类型（line 61）中仍包含旧的 `UserDisambiguationAttribution`，但实际上代码中已统一使用 `DisambiguationAttribution`（`kind: "disambiguation"`）。旧类型残留可能误导后续维护者。

**建议**：删除 `UserDisambiguationAttribution`，保留 `DisambiguationAttribution` 和 `UserActivityAttribution`。

---

## 详细分析

### 类型安全

| 检查项 | 状态 |
|--------|------|
| `PendingConfirmation` 泛化（`entityType` + `type === "disambiguation"`） | ✅ `agent.ts` 定义正确 |
| `DisambiguationCandidate.label/summary` 调用点 | ✅ `human-confirmation.ts`、`search-structured.ts`、`generate-response.ts` 均已迁移 |
| V2 `type === "user_disambiguation"` 调用点 | ❌ `route.ts:624` 仍在使用旧结构 |
| `entityType` const assertion | ⚠️ `DISAMBIGUATION_THRESHOLDS` 缺 `as const`（Warning #4） |

### 向后兼容

| 检查项 | 状态 |
|--------|------|
| V2 user 消歧（"刘工的周报有哪些"） | ✅ `search-structured.ts:560-577` 返回泛化 `disambiguation`，`generate-response.ts` 渲染模板正确 |
| `routeAfterHumanConfirmation` 处理 `resolvedEntities` 新字段 | ❌ 只检查 `.user`，漏掉 `.ticket/.project/.weekly_report`（Warning #2） |
| `parseSelection` 无效输入兜底 | ⚠️ 返回 `null`，由调用方重试（行为正确，但 `human-confirmation.ts:94` 非空断言有风险，Warning #3） |

### 错误处理

| 检查项 | 状态 |
|--------|------|
| `parseSelection` 无效输入 | ✅ 返回 `null`，`human-confirmation.ts` 重试逻辑正确 |
| `JSON.parse` 异常 | ⚠️ 无内层 try-catch，错误上下文丢失（Warning #5） |
| `generateText` LLM 调用失败 | ✅ 降级到静态文本（`generate-response.ts:291-294`） |
| `searchStructured.execute` 异常 | ✅ try-catch 包裹，错误写入 `toolResults` |

### N+1 / 性能

| 检查项 | 状态 |
|--------|------|
| 无新增 N+1（HIL 改动本身） | ✅ |
| `resolveUser` Step 3 循环 findMany | ⚠️ 最多 20 次查询（Warning #6） |
| `resolveUser` Step 5 循环 findMany | ⚠️ 同样问题（Warning #7） |

### 测试覆盖

代码库中未见 HIL V3 Phase 1 的单元/集成测试文件。建议补充：
- `parseSelection` 边界测试（`null` 输入、空 candidates、越界数字）
- `extractUserIdentifier` 测试用例（中英文混合、英文全拼、人名变形）
- `routeAfterHumanConfirmation` 多 entityType 路由测试

---

## 结论

| 级别 | 数量 |
|------|------|
| Critical | 1（route.ts tsc 错误） |
| Warning | 2（路由逻辑不完整 + 非空断言） |
| Info | 6（JSON parse、N+1、残留类型等） |

**必须修复 Critical #1 后才能通过构建。** Warning #2（`routeAfterHumanConfirmation` 扩展判断）强烈建议同步修复，否则周报消歧路径不工作。Info 类问题可在后续迭代中处理。
