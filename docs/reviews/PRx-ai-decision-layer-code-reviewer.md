<!-- reviewer: code-reviewer (硬层) -->
# AI 查询意图重构 — 硬层代码审查

> 审查范围：F1 + F2 + F3（query-parser 重构、decision 节点重命名、HIL 路由统一）
> 审查视角：类型安全 · 状态管理 · 路由一致性 · 错误处理 · N+1 / 性能 · 边界 case · 业务正确性
> 审查者身份：code-reviewer（硬层技术审查）
> 配合文件：软层审查见 `docs/reviews/PRx-ai-decision-layer-ai-mentor.md`

---

## 整体评价

**结论：⚠️ Approved with Suggestions — 推荐 3 处必修后合入，2 处强烈建议同步修。**

架构方向正确（意图判断收敛到 query-parser、HIL 决策统一到 decision 节点），但落地的路由图有 **一个潜在死循环隐患** 和 **一处真实类型错误**，必须修。其余建议都属于"当下不爆、未来会爆"的路上升级。

tsc 现状（features/ai/graph + core 范围）：
- `query-weekly-report.ts:62, 123` — `UserActivityAttribution` 缺 `relatedReportCount` 字段（2 处）。**⚠️ Critical**，影响运行时。

---

## 1. 路由图死循环分析（Critical）

### 1.1 `routeAfterHumanConfirmation` → `routeAfterDecision` 形成 `decision → humanConfirmation → decision → …` 循环隐患

**位置**：`features/ai/graph/edges/routing.ts:84-99` + `agent.ts:202-212`

**现状**：

```typescript
// routing.ts
export function routeAfterHumanConfirmation(state: AgentState): NextNode {
  if (state.pendingHumanAction) return "humanConfirmation";           // 自环
  if (state.resolvedEntities?.user || /* ... */) return "decision";   // → decision
  return END;
}

export function routeAfterDecision(state: AgentState): NextNode {
  if (state.pendingHumanAction) return "humanConfirmation";           // → humanConfirmation
  if (state.resolvedEntities) return "searchStructured";              // → searchStructured
  return END;
}
```

**分析**：

`decision` 节点产生新 `pendingHumanAction`（Branch 2 ambiguous 触发 HIL）→ `routeAfterDecision` 返回 `humanConfirmation` → 用户选择 → `routeAfterHumanConfirmation` 返回 `decision`（因为 resolvedEntities 被设了）→ `decision` 节点再次执行。

- **如果 `decision` 没有重新设置 pendingHumanAction**（Branch 2 的 `if (state.isAmbiguous && !state.pendingHumanAction)` 守卫会在这种情况把 pendingHumanAction 保留还是清掉？让我们看：

```typescript
// decision.ts:80-118
if (state.isAmbiguous && !state.pendingHumanAction) {
  // ...查询候选人 → 设置 pendingHumanAction
}
return {};
```

  `state.isAmbiguous` 默认 `false`，只有 detectIntent 在首轮设置。第二轮回来时 `isAmbiguous` 仍是 `true`，但 `pendingHumanAction` 此时已被 humanConfirmation 清空 → Branch 2 会**再次触发**！

- 这意味着：**当用户选择 ambiguous HIL 后，decision 节点会再次触发**（因为 `isAmbiguous=true` 状态没被任何节点清理）。**`isAmbiguous` 状态没有"消费即清"机制**，是状态管理漏洞。

**实际场景**：

1. 用户："光污染传感器需求"  
2. `detectIntent` → `queryType=note`, `isAmbiguous=true`  
3. `routing` → `searchStructured` → `executeStructuredQuery({type: "note"})` 执行查询  
4. `routeAfterSearchStructured` → `pendingHumanAction` 不存在 → `generateResponse`  
5. **但是** `isAmbiguous=true` 没有被 `decision` 节点处理（因为 searchStructured 走的是 direct 路径，不是 `decision` 路径）  
6. 实际上：`routeAfterSearchStructured` 永远不返回 `decision`（除非 `toolResults.searchStructured.decision.type === "human"`），所以 `isAmbiguous` 触发的 Branch 2 **永远不会被执行**。

**这是更深的问题**：

`routeAfterSearchStructured` 不读 `state.isAmbiguous`。当 `isAmbiguous=true` 且 `searchStructured` 没有触发决策时，graph 直接走 `generateResponse`，**完全跳过 decision 节点的 Branch 2**！

**风险**：

- 计划要求：`"光污染传感器需求" → searchStructured (执行 note 查询) → decision (Branch 2 ambiguous → searchAmbiguousEntities)`  
- 实际：`searchStructured` 不触发 decision，因为 `routeAfterSearchStructured` 不读 `isAmbiguous`。  
- 这意味着 **Branch 2 ambiguous 永远不会被触发**，decision 节点实际上 **就不会作为跨类型搜索的入口**！用户输入 "光污染传感器需求" → 直接进入 note 查询 → 找到/没找到 → 结束。**和计划声明的"展示各类型候选"完全不符**。

**影响**：

- 计划的核心效果"模糊查询会展示候选 → 让用户选择" 实际上**没实现**。
- Branch 2 是 dead code。

**修复方向**（cross-mentor 协商，但 code 层面要先标记）：

`routeAfterSearchStructured` 应加入 `isAmbiguous` 判断：

```typescript
if (state.isAmbiguous && !state.resolvedEntities) return "decision";
```

并把 `isAmbiguous` 作为一次性消费（decision 节点消费后重置为 false，否则与 detected intent 状态泄漏）。

---

### 1.2 `resolvedEntities` 与 `pendingHumanAction` 同时存在的死循环

**路径**：

1. 用户选 ambiguous → resolvedEntities.user 被 set（来自"光污染传感器需求" → 选了一个候选用户）  
2. `routeAfterSearchStructured` → 命中 `resolvedEntities.user` → 返回 `generateResponse`  
3. 但 `isAmbiguous=true` 状态仍在，Branch 2 一直在等待触发 → **实际不会触发**（因为 graph 走 generateResponse）

**当前是没爆**，但如果未来有人在 `routeAfterSearchStructured` 加入 `isAmbiguous` 检查（按计划应实现），就会触发 `decision → humanConfirmation → decision` 死循环。

**建议**：

- `decision` 节点应在 Branch 2 处理后 **主动 reset `isAmbiguous=false`**（即使 Branch 1 触发也应 reset）。
- `humanConfirmation` 节点应在设置 `resolvedEntities` 时同时清空 `isAmbiguous`（避免残留）。

---

## 2. `searchStructuredNode` 早 return 路径下 `queryType` / `isAmbiguous` 状态字段未填

**位置**：`features/ai/graph/nodes/search-structured.ts:42-228`

**问题**：

```typescript
const lastMessage = state.messages[state.messages.length - 1];
if (!lastMessage) return {};                              // ← 早 return 1
```

`searchStructuredNode` 早 return 时只返回 `{}`，**不消费** `state.queryType` / `state.isAmbiguous` / `state.extractedUser` / `state.activityWindow`，状态字段保留 detectIntent 的设置。

这本身没问题（Annotation 默认 reducer 是 `update === undefined ? current : update`），但 `decision` 节点 (`features/ai/graph/nodes/decision.ts:83`) 触发 Branch 2 的条件是 `state.isAmbiguous && !state.pendingHumanAction`：

- 如果 `searchStructured` 早 return → `pendingHumanAction` 不变（还是 null）→ `decision` 节点 Branch 2 条件就满足 → 触发 searchAmbiguousEntities → 又一轮 HIL。

**问题回路**：

如果 detectIntent 设了 `isAmbiguous=true` 但 searchStructured 早 return（lastMessage 缺失），graph 路由仍然 `pendingHumanAction` 已经不存在 → `routeAfterSearchStructured` 返回 `generateResponse`（不触发 decision）。**但如果未来加 `isAmbiguous` 检查，就会触发 Branch 2 在缺乏 query content 时报错**。

**建议**：

`decision` 节点 Branch 2 已有 `if (!query) return {}` 守卫（decision.ts:90），但守卫是基于 `state.originalQuery || lastMessage.content`。如果两者都空，函数返回 `{}` 不是错；但 `searchStructuredNode` 早 return 后 `pendingHumanAction` 是 null，下一轮路由会走向 `generateResponse`（不会触发 decision），所以不会爆。

**但** 这里的隐患是 **detectIntent 早 return 路径** (`detect-intent.ts:178-201`)：

```typescript
if (state.waitingForConfirmation) return {};     // 早 return 1
if (state.resolvedEntities) return {};            // 早 return 2
if (state.mode !== "auto") return { mode: state.mode };  // 早 return 3
if (!lastMessage || lastMessage.getType() !== "human") {
  return { mode: "chat" };                       // 早 return 4
}
```

**早 return 路径都不填充 `queryType` / `isAmbiguous` / `extractedUser` / `activityWindow`**：

- 这些字段保留 `default value`（`null` / `false` / `undefined`）。
- 看起来无问题（搜索性 queryType 是 auto 测出来的，人工确认/恢复走的是另一条路）。
- 但 `state.queryType = null` 在 search-structured 路径上被用作 fallback `state.queryType ?? savedQueryType`：

```typescript
// search-structured.ts:118-119
const candidateQueryType: QueryType | string | undefined = state.queryType ?? savedQueryType;
queryType = (candidateQueryType as typeof queryType) ?? "user";
```

如果 `queryType === null`（detectIntent 走早 return 路径），且 `savedQueryType` 也不存在，则 `queryType = "user"` —— **fallback 到 user 时没有有效 input**。

**风险**：当 `mode !== "auto"`（早 return 3）时，detectIntent 没有设置 queryType。又当 `mode === "search"` 且 `isUserActivityQuery` 命中，路由会走到 `searchStructuredNode` 但 queryType 是 null → fallback 到 "user" 但缺少 extractedUser → resolveUser 失败 → "未找到用户"。

**建议**：

`detectIntent` 早 return 路径应显式调用 `parseQueryType` 填充 `state.queryType`（哪怕 mode 不变）。最简单是：把 `...detectParserFields(content)` 加到非 auto 路径上。**或者** searchStructuredNode 在 `queryType === null` 且 `!resolvedEntities` 时直接 `return { mode: "search" }` 触发 RAG 兜底。

---

## 3. tsc 错误：`UserActivityAttribution` 缺 `relatedReportCount` 字段

**位置**：`features/ai/core/queries/query-weekly-report.ts:62, 123`

**错误**：

```
error TS2322: Type '{ ... relatedReportCount: 0; ... }' is not assignable to type 'Attribution | undefined'.
  Property 'relatedReportCount' is missing in type.
```

**实际代码**：

```typescript
// query-weekly-report.ts:62-74
return {
  summary: ...,
  sources: [],
  attribution: {
    kind: "user_activity",
    targetUserName: ...,
    windowLabel: ...,
    hasDirectEvidence: false,
    directEvidenceCount: 0,
    directNoteCount: 0,
    directTicketActionCount: 0,
    directCommentCount: 0,
    relatedTicketCount: 0,
    relatedCommitCount: 0,
    // ← 缺 relatedReportCount!
    matchType: resolved.matchType,
  }
};
```

**类型定义**（`features/ai/types/structured.ts:21-35`）：

```typescript
export interface UserActivityAttribution {
  kind: "user_activity";
  targetUserName: string;
  windowLabel: string;
  hasDirectEvidence: boolean;
  directEvidenceCount: number;
  directNoteCount: number;
  directTicketActionCount: number;
  directCommentCount: number;
  relatedTicketCount: number;
  relatedCommitCount: number;
  relatedReportCount: number;   // ← 必须
  matchType?: MatchType | null;
}
```

**Impact**：

- `query-user.ts:447-461` 正确设置 `relatedReportCount: userReports.length`，是 query-user 没问题。
- `query-weekly-report.ts` 这两处是 **reports=0 分支**（无周报），但缺这个字段会导致 `tsc` 编译失败或在运行时 `attribution.relatedReportCount` 是 undefined → `generateResponse.ts:87` `(attr.relatedReportCount as number) > 0` 会强制 falsy → 走兜底路径。

**修复**：

```typescript
attribution: {
  kind: "user_activity",
  ...
  relatedCommitCount: 0,
  relatedReportCount: 0,   // ← 加上
  matchType: resolved.matchType,
}
```

---

## 4. `detectIntent` 早 return 路径填充 `extractedUser` 但 searchStructuredNode 又重新解析 → 状态浪费

**位置**：`features/ai/graph/nodes/search-structured.ts:88-89, 122-123`

**分析**：

- `detectIntent` 设置 `state.extractedUser = extractUserIdentifier(content)`.
- `searchStructuredNode` 在 `resolvedUser` 分支调 `extractUserIdentifier(queryForParsing)` 重新解析。
- 在 `else` 分支（非 resolvedUser）调 `extractUserIdentifier(effectiveQuery)` 重新解析。

**问题**：

`state.extractedUser` 字段被设置后**从未被读取**。searchStructuredNode 每次都重新调 `extractUserIdentifier`。这是**状态字段浪费**（字段设置但没有使用，等于 dead state）。

**建议**：

要么 searchStructuredNode 改用 `state.extractedUser` / `state.activityWindow`，要么从 `state` 字段中移除这两个字段（detectIntent 也不再设置）。

倾向建议：**保留 detectIntent 设置，searchStructuredNode 优先读 state.extractedUser**：

```typescript
const extractedUser = state.extractedUser ?? extractUserIdentifier(effectiveQuery);
```

这样未来在 detectIntent 阶段做的提取工作就 actually useful。

---

## 5. `searchAmbiguousEntities` 的并行查询与错误降级

**位置**：`features/ai/core/queries/query-ambiguous.ts:23-52`

**分析**：

- ✅ **已经使用 `Promise.allSettled`**（不是 `Promise.all`），单类失败不会让全部失败。
- ✅ 失败时被 rejects（`status === "rejected"`）的查询结果被跳过（无 candidates push）。
- ⚠️ **没有 timeout**：`prisma.findMany` 4 类并行查询，最坏情况（DB 慢 + 多并发）可能耗时 10+ 秒。HTTP 客户端（agnes 网关）通常 30s 超时，会把整个 SSE 流卡死。
- ⚠️ **没有去重**：4 个 query 都在 `prisma.X.findMany` 上独立查询，**没有共享 connection pool**。如果一次 ambiguous 请求和后续 request 重叠，可能导致 connection pool 撑爆。

**建议**：

1. 给 `Promise.allSettled` 加 `Promise.race([query, timeout(5000)])` 包装，确保 5 秒兜底。
2. 不需要跨 query 共享 connection，但可在 `query-ambiguous.ts` 顶部加注释说明"per-request prisma client will be reused"。

---

## 6. `queryNote` 索引与 N+1

**位置**：`features/ai/core/queries/query-note.ts:131-136`

```typescript
const notes = await prisma.pkmNote.findMany({
  where,
  orderBy: { updatedAt: "desc" },
  take: input.limit ?? 10,
  select: noteSelect,
});
```

**分析**：

- `where` 包含 `title` / `userId` / `projectId` / `updatedAt` 任意组合。
- `orderBy: updatedAt desc` + `take: 10`：如果 `where` 只指定 `title`（contains 模糊匹配），DB 必须扫描 title 索引然后按 updatedAt 排序——**没有 (title, updatedAt desc) 复合索引**，性能一般。
- `noteSelect` 包含 `user: { select: { name, email } }` 和 `project: { select: { name } }`，Prisma 会 JOIN。这些都有外键索引，性能 OK。

**建议**：

1. 验证 `pkmNote` 表的索引（应该有 `title` 的 trigram / btree 索引 + `userId` / `projectId`）。
2. 如果 `queryNote` 经常带 `userId` 过滤 + `updatedAt desc` 排序，建议加复合索引。

**潜在 N+1**：

`queryNoteById` 调用 `findUnique` 一次，**没有 N+1**。
`queryNote` 列表查询 + `select` 带 `user` `project` JOIN，**没有 N+1**。

---

## 7. `state.queryType` 联合类型在 `search-structured.ts:84` 有不安全的类型断言

**位置**：`features/ai/graph/nodes/search-structured.ts:82-85`

```typescript
queryType = candidateQueryType
  ? (candidateQueryType as typeof queryType)
  : "user";
```

**问题**：

`QueryType` 含 `"ambiguous"`、`"note"` 等于 `queryType` 类型不存在的值：

```typescript
// search-structured.ts:70
let queryType: "ticket" | "project" | "user" | "commit" | "weekly_report";  // 不含 note/ambiguous
```

`state.queryType` 类型是 `QueryType | null`（含 `note` 和 `ambiguous`）。当 `candidateQueryType === "note"` 且 `searchStructuredNode` 把它 cast 到 `queryType` 变量时，**类型系统不报错但运行时会把 "note" 传给 `executeStructuredQuery`**。

`executeStructuredQuery` 的 `case "note"` 会处理（已注册），所以**运行时不会爆**。但这种 cast 是 ts 类型安全的"定时炸弹"——下次有人删 `case "note"` 或扩展 `queryType`，会让 `note` 落入 `default: { summary: "不支持的查询类型: note" }` 路径。

**建议**：

1. 用 `executeStructuredQuery` 自己的 Zod schema 验证（`SearchStructuredInputSchema` 已经定义 `type: z.enum([...])`）。
2. 或者把 `queryType` 变量类型扩展成 `QueryType` 局部变量，然后在调 `executeStructuredQuery` 时再做窄化。

**这是 review 优先级 Medium**，不爆但难维护。

---

## 8. `routeByMode` 重复 `isUserActivityQuery()` 的逻辑（minor）

**位置**：`features/ai/graph/edges/routing.ts:43, 48`

`routing.ts` 仍调用 `isUserActivityQuery(content)` 来决定 search 模式下走 searchStructured 还是 searchKnowledge。

计划要求 "routing.ts 删除 isUserActivityQuery() 和 isDeepContentQuery()，改为从 state 读取"。**但实际上 routing.ts 仍然调用这两个函数**（agent.ts:171-172 引用了 detect-intent 里的 isUserActivityQuery）。

**问题**：

- `detectIntent` 设的 `state.queryType` 没被 `routing.ts` 用于路由决策。
- `isUserActivityQuery` 重新调一遍表示 `detectIntent` 的判断并没有被路由复用。
- 计划要求的 "intelligence 都在 detectIntent，routing 只读 state" 没完全实现。

**建议**：

`routing.ts` 改成读 `state.queryType`：

```typescript
case "search":
  if (state.queryType === "user" || state.queryType === "weekly_report" || state.queryType === "commit") return "searchStructured";
  return "searchKnowledge";
```

或者保留 `isUserActivityQuery` 但移出来作为 `query-parser.ts` 的 helper（计划确实是这么设计的，但似乎没落地）。

---

## 9. `query-ambiguous.ts` 的 `_viewerUserId` 参数未使用

**位置**：`features/ai/core/queries/query-ambiguous.ts:17`

```typescript
export async function searchAmbiguousEntities(
  query: string,
  _viewerUserId?: string,
): Promise<AmbiguousCandidate[]> {
```

参数带 `_` 前缀标记未使用，但 permission check 没有实施。任何 viewer 都能拿到其他用户的 listing。

**问题**：

- `queryUser.ts` 接受 `viewerUserId` 用于 `bannedAt: null` 过滤。
- `query-ambiguous.ts` 没有 `viewerUserId` 过滤逻辑。

**建议**：

如果 ambiguous 候选应排除已 banned 用户（计划采用 `bannedAt: null` 过滤但 query-ambiguous 强制不传 viewerUserId），这是 OK 的。但如果未来要按 viewer 权限过滤，参数位置已留好。

**当前不算 bug**（用 `_` 前缀明确标记未使用），是 **future design hint**。

---

## 10. 审查结论汇总

### Critical (Must Fix)

| # | 位置 | 问题 |
|---|------|------|
| **C1** | `query-weekly-report.ts:62, 123` | tsc 2322 错误 — `UserActivityAttribution` 缺 `relatedReportCount` 字段，必修 |
| **C2** | `routing.ts:140-164` + `decision.ts:80-118` | `routeAfterSearchStructured` 不读 `state.isAmbiguous` → **Branch 2 (ambiguous 跨类型搜索)永远不会被触发**。计划要求"光污染传感器需求"展示候选，实际跑成了直接 note 查询。**计划核心效果未实现** |
| **C3** | `state.isAmbiguous` 状态管理 | `isAmbiguous` 没有"消费即清"机制。一旦 `routeAfterSearchStructured` 加 `isAmbiguous` 检查（按 C2 修复路径），会触发 `decision → humanConfirmation → decision` 死循环；`humanConfirmation` 必须消费 `isAmbiguous` 后清空 |

### Major (Recommended)

| # | 位置 | 问题 |
|---|------|------|
| **M1** | `detect-intent.ts:178-201` | 早 return 路径不填充 `queryType / extractedUser / activityWindow`，searchStructuredNode fallback 不一致 |
| **M2** | `search-structured.ts:118-119` | `state.queryType` 与 `savedQueryType` fallback 逻辑：当 `queryType=null` 时直接默认 "user"，但 user 模式下也需要 extractedUser 才能 resolve |
| **M3** | `routing.ts:43, 48` | `isUserActivityQuery` 仍被调用，计划的"判断逻辑只放 query-parser"没有完全落地 |
| **M4** | `query-ambiguous.ts:23-52` | 并行 4 类查询无 timeout，最坏情况 SSE 30s 超时 |

### Minor (Optional)

| # | 位置 | 问题 |
|---|------|------|
| **m1** | `search-structured.ts:82-85` | `queryType` 变量的 unsafe cast（`QueryType` 包含 `"note"`/`"ambiguous"` 但本地变量类型不含） |
| **m2** | `state.extractedUser` / `state.activityWindow` | 字段被设置但 searchStructuredNode 完全不读，等于 dead state |
| **m3** | `query-ambiguous.ts:17` | `_viewerUserId` 标记未使用，per-viewer 权限未实现（未来扩展点） |

### Positive Points

- ✅ F3 重命名（`disambiguateIntent` → `decision`）做得好：保留旧名导出做兼容，agent.ts 用 `as` 别名渐进迁移。
- ✅ `AmbiguousCandidate` 用 `entityType` 字段携带实体类型，跨类型候选统一表达，UI 不需要硬编码。
- ✅ `noteSelect` 用 `select` const 集中所有 select 字段，避免 N+1。
- ✅ `decision.ts` Branch 1 检查 `decisionField.candidates.length > 0` 才触发 HIL，避免空候选 falsely 触发。
- ✅ `searchAmbiguousEntities` 用 `Promise.allSettled` 而不是 `Promise.all`，单类失败不会全败。
- ✅ detectIntent 用 `if (state.waitingForConfirmation) return {}` 守卫，避免 HIL 期间二次意图检测。

### cross-mentor 转交

- **决策层架构合理性**（decision 节点是否过度抽象） — 已在 `ai-learning-mentor` 报告内。
- **`isAmbiguous` 状态生命周期**（first-class citizen vs 临时标志） — 建议转 mentor 评估。

---

## 下一步

1. **C1 / C2 / C3** 必修后再次 `npx tsc --noEmit` 验收，并把 qa 写到 PR description。
2. **M1-M4** 建议在本 PR 一起修，避免后续回炉。
3. **m1-m3** 留待下个 PR 清理，或在 commit message 中标注 TODO。
4. 运行测试用例 `B1.1 - B1.7`（见 `docs/plans/langgraph-测试用例_b2c7d3f1.md`）验证路由不爆。
5. 重点手测 `"光污染传感器需求"`：预期应该走 Branch 2 → 展示候选。**修复前实际跑 note 查询直接返回结果**。

---

## 关联文件

- 软层审查：`docs/reviews/PRx-ai-decision-layer-ai-mentor.md`
- 计划文档：`.cursor/plans/ai查询意图与笔记查询修复_ab3c8d1e.plan.md`
- 测试用例：`.cursor/plans/langgraph-测试用例_b2c7d3f1.md`
