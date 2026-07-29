# Code Review: `features/ai` Search-Structured 重构

**Scope:** `features/ai/core/` + `features/ai/tools/search-structured.ts` + `features/ai/graph/nodes/search-structured.ts`
**Review Type:** Local Changes (重构代码审查)
**Reviewer:** code-reviewer (硬技术层)

---

## Code Review Summary

### Verdict: ⚠️ Approved with Critical Fixes Required

### tsc 质量门

```bash
npx tsc --noEmit 2>&1 | head -100
```

**结果：✅ 无 features/ai 文件相关的 tsc 错误。**

所有 tsc 错误均来自无关文件：
- `e2e/module-edit.spec.ts` — Playwright 类型不匹配（历史遗留）
- `features/admin/admin.test.ts` — `@/lib/db` 模块缺失（历史遗留）

---

## Findings

### Critical (Must Fix)

#### 1. **[features/ai/tools/search-structured.ts:24]** 模块级状态导致并发请求竞态（Race Condition）

```startLine:24:features/ai/tools/search-structured.ts
let currentViewerUserId: string | null = null;
```

**问题**：`currentViewerUserId` 是模块级可变状态。在 Next.js 生产环境（Edge/Node）或 Serverless 场景下，同一模块实例会被多个并发请求共享。多个请求同时调用 `setSearchStructuredViewer()` 时，后一个请求会覆盖前一个请求的 `viewerUserId`，导致权限上下文串台。

**Impact**：用户 A 的请求可能使用用户 B 的 viewerUserId，存在越权访问风险。

**Suggestion**：使用 AsyncLocalStorage（Node.js 18+）或 Request Context 模式注入：

```typescript
import { AsyncLocalStorage } from "async_hooks";
const viewerContext = new AsyncLocalStorage<string>();

export async function withSearchStructuredViewer<T>(
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  return viewerContext.run(userId, fn);
}

export function getSearchStructuredViewer(): string | undefined {
  return viewerContext.getStore();
}
```

---

#### 2. **[features/ai/core/resolvers/user-resolver.ts:104-116]** N+1 查询 — 每个搜索词一次 DB 往返

```startLine:104:features/ai/core/resolvers/user-resolver.ts
for (const term of uniqueTerms) {
  if (term.length < 1) continue;
  if (/^[\u4e00-\u9fa5]$/.test(term)) continue;
  const matches = await prisma.user.findMany({
    where: { searchName: { contains: term, mode: "insensitive" }, bannedAt: null },
    select: { id: true, name: true },
  });
  // ...
}
```

**问题**：`allTerms` 数组可包含多个搜索词（原始词 + 空格分词 + 拼音 + 反序拼音 + 单字拼音），每个词执行一次 `findMany` 查询。对于中文输入，理论上最多可产生约 15 个串行 DB 查询。

**Impact**：用户查询延迟高，DB 连接数激增。

**Suggestion**：将所有 terms 合并为单次查询：

```typescript
if (uniqueTerms.length > 1) {
  const matches = await prisma.user.findMany({
    where: {
      OR: uniqueTerms
        .filter(t => t.length >= 1 && !/^[\u4e00-\u9fa5]$/.test(t))
        .map(term => ({ searchName: { contains: term, mode: "insensitive" } })),
      bannedAt: null,
    },
    select: { id: true, name: true },
  });
  // then filter by term in JS
}
```

---

#### 3. **[features/ai/core/search-structured-core.ts:97-101]** 静默吞掉错误，无日志详情

```startLine:97:features/ai/core/search-structured-core.ts
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[searchStructuredCore] error:", msg);
  return { summary: `查询失败: ${msg}`, sources: [] };
}
```

**问题**：catch 块仅记录 `err.message`，丢失了 `err.stack`。对于调试复杂 bug（如 Prisma 错误），仅有 message 不足以定位问题。

**Suggestion**：

```typescript
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("[searchStructuredCore] error:", message, { stack });
  return { summary: `查询失败: ${message}`, sources: [] };
}
```

---

### Warning (Recommended)

#### 4. **[features/ai/core/search-structured-core.ts:68]** `decision` 字段职责混乱

`executeStructuredQuery` 的设计注释明确说"不返回 decision 字段"，但实际 query 函数（`queryTicket`、`queryProject`、`queryUser`、`queryCommit`、`queryWeeklyReport`）大量返回带 `decision` 的结果（当候选项超过阈值时）。

**问题**：核心函数承担了 HIL 决策逻辑，违反了单一职责。`decision` 信号的存在使得 Normal 模式和 LangGraph 模式的边界模糊。

**Impact**：后续维护者可能误认为 Normal 模式会处理 HIL，实际只有 LangGraph 模式处理。

**Suggestion**：在 core 层去掉 `decision` 和 `attribution`，仅返回候选项数组，由调用方（tool/graph node）决定是否包装为 HIL 信号。

---

#### 5. **[features/ai/core/resolvers/user-resolver.ts]** `resolveUser` 无 try-catch

```startLine:15:features/ai/core/resolvers/user-resolver.ts
export async function resolveUser(
  identifier: ExtractedUser | undefined,
  viewerUserId: string | undefined
): Promise<ResolveResult> {
```

**问题**：整个函数没有任何 try-catch。Prisma 查询失败会直接向上抛出，导致调用方（如 `queryUser`）无法优雅降级。

**Suggestion**：在函数入口加 try-catch，返回 `{ user: null, confidence: 0, matchType: null }`。

---

#### 6. **[features/ai/core/queries/query-project.ts:84-86]** 查询所有 ticket 仅取 counts

```startLine:84:features/ai/core/queries/query-project.ts
include: {
  tickets: {
    select: { status: true, priority: true, deadline: true, ticketNo: true, title: true, id: true },
  },
},
```

**问题**：`queryProject` 函数只需要统计 `total`、`done`、`overdue`，却把所有 ticket 的完整字段都查出来了。当项目有大量工单时，payload 很大。

**Impact**：不必要的内存和 DB 传输开销。

**Suggestion**：

```typescript
include: {
  tickets: {
    select: { status: true, deadline: true }, // 只取统计需要的字段
  },
},
```

---

#### 7. **[features/ai/core/queries/query-ticket.ts:121]** Prisma where 类型丢失

```startLine:121:features/ai/core/queries/query-ticket.ts
const where: Record<string, unknown> = {};
```

**问题**：`Record<string, unknown>` 完全丢失了 Prisma 的类型推断，后续向 where 添加字段时无 IDE 补全、无类型检查。

**Suggestion**：使用 Prisma 的 `TicketWhereInput` 类型：

```typescript
import type { TicketWhereInput } from "@prisma/client";
const where: TicketWhereInput = {};
```

---

#### 8. **[features/ai/core/queries/query-user.ts:298]** `directEvidenceCount` 统计来源不一致

```startLine:298:features/ai/core/queries/query-user.ts
const directEvidenceCount = recentNotes.length + directStatusChanges.length + directAssigneeChanges.length + directComments.length;
```

**问题**：`recentNotes` 的查询条件是 `updatedAt: dateFilter`（工单更新时间），而 `directStatusChanges` 等的查询条件是 `createdAt: dateFilter`（变更记录创建时间）。当 `dateFilter` 为 `undefined` 时，两者都返回全量，但含义不同。

**Impact**：当用户指定 `activityWindow` 时，notes 的时间窗口和操作记录的时间窗口语义不一致，可能给用户造成困惑。

---

#### 9. **[features/ai/graph/nodes/search-structured.ts:159-161]** 类型断言掩盖潜在错误

```startLine:159:features/ai/graph/nodes/search-structured.ts
const resultRecord = typeof result === "object" && result !== null
  ? result as unknown as Record<string, unknown>
  : null;
```

**问题**：`as unknown as` 是双重断言，跳过了所有类型检查。如果未来 `StructuredResult` 结构变化导致 `decision` 字段被重构，此处不会产生任何编译错误。

**Suggestion**：使用类型守卫或显式检查：

```typescript
const hasDecision = "decision" in result && result.decision !== undefined;
```

---

### Nitpicks (Optional)

#### 10. **[features/ai/core/search-structured-core.ts:68]** `limit` 参数未使用

```startLine:68:features/ai/core/search-structured-core.ts
const { type, id, filters, limit: _limit } = input;
```

`_limit` 被解构但从未使用。各 query 函数内部各自使用硬编码的 `take` 值。如果未来要支持动态 `limit`，需要重构每个 query 函数。

---

#### 11. **[features/ai/core/queries/query-project.ts:22]** `filters` 参数未使用

```startLine:22:features/ai/core/queries/query-project.ts
const { id, filters: _filters } = input;
```

`filters` 参数解构为 `_filters` 但从未使用。project 查询目前不支持 status 以外的过滤条件。

---

#### 12. **[features/ai/tools/search-structured.ts:71]** `_debug` 字段泄露到工具返回

```startLine:71:features/ai/tools/search-structured.ts
_debug: "structured_with_sources"
```

Debug 字段不应该出现在生产代码的返回值中。建议在调试完成后移除。

---

#### 13. **[features/ai/core/resolvers/user-resolver.ts:165]** `allCandidates` 未排序即取值

```startLine:168:features/ai/core/resolvers/user-resolver.ts
const candidates = Array.from(allCandidates.values());

if (candidates.length === 1) { ... }
if (candidates.length > 1) {
  candidates.sort((a, b) => b.matchScore - a.matchScore);
```

当 `candidates.length === 1` 时，`matchScore` 排序逻辑被跳过。如果 single candidate 的 `matchScore` 逻辑有 bug，不会触发排序路径的调试机会。影响极小。

---

## Positive Points

- ✅ **FSD 架构契合**：重构后 `core/queries/`、`core/resolvers/`、`core/formatters/` 边界清晰，模块职责明确
- ✅ **向后兼容**：旧的 `lib/` 导入已全部迁移，无断裂引用
- ✅ **类型安全**：Zod input schema + TypeScript interface + discriminated union，整体类型设计良好
- ✅ **Prisma select 优化**：大多数查询使用 `select` 限定字段，避免全量加载
- ✅ **Promise.all 并行化**：`queryUser` 中前 4 个查询（user + 3 个 count）并行执行
- ✅ **HIL 阈值抽象**：`DISAMBIGUATION_THRESHOLDS` 集中管理，便于调参
- ✅ **Error Handling**：大多数 query 函数有 null 检查和 fallback 返回
- ✅ **无 `any` 类型滥用**：所有类型均明确，类型推断合理

---

## Next Steps

1. **必须修复**（Critical）：
   - 修复 `currentViewerUserId` 模块级状态的竞态问题（问题 1）
   - 合并 `resolveUser` 中的 N+1 查询（问题 2）
   - 增强 `search-structured-core.ts` 的错误日志（问题 3）

2. **强烈建议修复**（Warning）：
   - 清理 core 层 `decision` 字段的职责归属（问题 4）
   - 为 `resolveUser` 加 try-catch（问题 5）
   - 优化 project 查询的 ticket select 字段（问题 6）
   - 统一 `queryUser` 中 notes 和操作记录的时间窗口语义（问题 8）

3. **可选优化**（Nitpick）：
   - 移除 `_debug` 字段（问题 12）
   - 统一 `limit` 参数的处理方式（问题 10）
