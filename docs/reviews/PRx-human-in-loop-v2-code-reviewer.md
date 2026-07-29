<!-- reviewer: code-reviewer (硬层) -->
# Code Review: Human-in-Loop 重构 V2

## 审查范围

| 文件 | 审查维度 |
|------|---------|
| `features/ai/graph/agent.ts` | Annotation reducer / resolvedEntities 类型 |
| `features/ai/graph/nodes/human-confirmation.ts` | 状态清理 / skip 分支 |
| `features/ai/graph/edges/routing.ts` | resolvedEntities 路由逻辑 |
| `features/ai/graph/nodes/search-structured.ts` | null 安全 / candidates 解析 |
| `features/ai/graph/nodes/generate-response.ts` | pendingConfirmation?.type 短路 / safety check |
| `app/api/ai/conversations/[id]/messages/route.ts` | HTTP 层契约 / resolvedEntitiesResolved |

---

## Critical 问题（必须修复）

### 1. `search-structured.ts:102` — `queryText!` 在 null 情况下产生无效值

```102:108:features/ai/graph/nodes/search-structured.ts
        pendingConfirmation: {
          type: "user_disambiguation",
          candidates: candidates!,
          query: queryText!,   // ← queryText 可能是 undefined
        },
```

**问题**: `queryText` 声明为 `string | undefined`，即使在 `hasMultipleCandidates` 为 true 的执行路径中（必定经过 line 68 的 else 赋值），`queryText` 也可能是 `extractedUser?.raw ?? extractedId ?? "(未指定)"`。虽然当前逻辑不会导致 undefined，但仍建议消除这个不必要的 `!`。

**建议**: 将 line 55 的声明改为 `let queryText: string`，赋默认值 `"(未指定)"`，消除 `!` 断言。

---

### 2. `search-structured.ts:48` — 缺少 resolvedEntities.user 的 null/undefined 短路

```47:48:features/ai/graph/nodes/search-structured.ts
    // Use resolvedEntities.user from human confirmation (single source of truth)
    const resolvedUser = state.resolvedEntities?.user;
```

**问题**: `resolvedEntities` 本身可以是 `null`（Annotation 默认值），且 `user` 属性本身是可选的 `user?: {...}`。当用户在没有触发过 `pendingConfirmation` 的首次对话中直接说 "cary 最近在干嘛" 时：
- `resolvedEntities === null`
- `resolvedUser === undefined`
- 流程正确走 else 分支——但这是巧合，代码没有明确表达这个意图

**建议**: 在 line 48 后加一个显式防御：
```ts
if (resolvedEntities === null) {
  resolvedUser = undefined; // 明确表达意图
}
```
或重构为 `const resolvedUser = state.resolvedEntities?.user;` 保持不变，但加注释说明 null → undefined 的隐式映射是 Annotation reducer 的设计行为。

---

## Warning 问题（建议修复）

### 3. `generate-response.ts:204` — 非空断言 `state.resolvedEntities.user.id`

```203:206:features/ai/graph/nodes/generate-response.ts
    if (state.resolvedEntities?.user) {
      console.log(`[generateResponseNode] skipping confirmation: resolvedEntities.user=${state.resolvedEntities.user.id}`);
      return {};
    }
```

**问题**: 在 `if (resolvedEntities?.user)` 的条件分支内访问 `state.resolvedEntities.user.id`，虽然 TS 收缩了 `resolvedEntities` 为非 null（因为 `?.user` truthy 说明 `resolvedEntities !== null`），但严格类型上 `state.resolvedEntities` 仍可能是 `null | { user?: ... }`，IDE 可能显示警告。

**建议**: 使用局部变量消除链式访问的歧义：
```ts
const resEnt = state.resolvedEntities;
if (resEnt?.user) {
  console.log(`[generateResponseNode] skipping confirmation: resolvedEntities.user=${resEnt.user.id}`);
  return {};
}
```

---

### 4. `human-confirmation.ts:66` — 调试 console.log 残留（生产环境）

```66:features/ai/graph/nodes/human-confirmation.ts
  console.log(`[humanConfirmationNode] resolvedEntities=${JSON.stringify(state.resolvedEntities)} waiting=${state.waitingForConfirmation}`);
```

**建议**: 改为 `console.debug` 或在生产构建时剥离。可接受现状（项目其他 node 也有类似 log），但建议统一改用 `console.debug`。

---

### 5. 重复 console.log 前缀不一致

| 文件 | 前缀 |
|------|------|
| `search-structured.ts` | `[AI-LangGraph]` |
| `generate-response.ts` | `[generateResponseNode]` |
| `routing.ts` | `[routeAfterDetectIntent]` / `[routeAfterHumanConfirmation]` |
| `human-confirmation.ts` | `[humanConfirmationNode]` |

**建议**: 统一使用 `[AI-LangGraph]` 前缀，或统一去掉前缀。跨文件调试时统一前缀更利于 grep 过滤。

---

### 6. `search-structured.ts:97` — candidates 类型断言依赖隐式结构假设

```97:features/ai/graph/nodes/search-structured.ts
    const candidates = (result as { attribution?: { candidates?: UserCandidate[] } })?.attribution?.candidates;
```

**问题**: 如果 `searchStructured` 工具的返回类型实际形状与断言不符，`candidates` 可能为 `undefined` 而非空数组。在 `hasMultipleCandidates` 判断 `candidates && candidates.length > 1` 时，undefined → false，不会触发误判。但下游 `pendingConfirmation.candidates` 赋值依赖 `!` 断言，理论上有风险。

**建议**: 考虑在类型断言外再加一次守卫：
```ts
const candidates = (result as { attribution?: { candidates?: UserCandidate[] } })?.attribution?.candidates;
const safeCandidates = Array.isArray(candidates) ? candidates : [];
```

---

## 通过项

### 类型安全

- `agent.ts` resolvedEntities Annotation reducer 正确：`(current, update) => update === undefined ? current : update` 语义清晰，default 返回 `null`
- `routeAfterHumanConfirmation` 直接访问 `state.resolvedEntities?.user`，可选链保护了 null 访问
- `generate-response.ts` 用 `state.pendingConfirmation?.type === "user_disambiguation"` 防护，line 204 的 `?.user` 双重可选链安全

### 状态机逻辑

- `humanConfirmationNode` 三路分支（skip / valid / invalid）职责清晰
- skip 分支正确清理：`waitingForConfirmation: false` + `pendingConfirmation: null` + `resolvedEntities: null`
- valid 选择分支正确写入：`resolvedEntities: { user: { id, name, resolvedBy: "confirmation" } }`
- invalid 分支仅设置 `waitingForConfirmation: true`（不追加 AI 消息，不污染状态）

### API 边界

- HTTP route `resolvedEntitiesResolved` 变量在 `humanConfirmation` node 输出中检测 `nodeOutput.resolvedEntities?.user`，作为清除 pending store 的信号，逻辑正确
- `pendingConfirmationStore` 生命周期管理：graph interrupted → store；resolvedEntitiesResolved → clear；其他 → 覆盖更新

### 错误处理

- `generate-response.ts` 有双重降级：disambig 生成失败降级到硬编码提示（line 248），activity 排版失败降级到返回原文（line 294）
- `search-structured.ts` 的 try/catch 覆盖了 `searchStructured.execute`，并返回结构化错误 payload（line 123-125）

### DRY

- `routing.ts` 中 `routeAfterHumanConfirmation` 仅读 `resolvedEntities?.user`，与 V1 的 `confirmedUserId in toolResults` 完全解耦，职责单一
- `search-structured.ts` 中 `resolvedUser` 作为单源真值的分支清晰，无重复的状态查询

---

## tsc 检查结果

```
tsc --noEmit ✅ 无错误
```

所有 18 个 tsc 错误均为**历史遗留**（e2e Playwright test 类型错误、`@/lib/db` 缺失），与本次 Human-in-Loop V2 改动**无关**。

---

## 最终判定

**PASS**（with minor suggestions）

核心逻辑正确：无类型错误、无状态泄漏、无 API 契约错位。`console.log` 调试残留不影响功能但建议统一前缀。`queryText!` 的非必要断言和 `candidates` 类型断言是低风险技术债。

如需快速修复，建议按以下优先级处理：
1. **立即修复**: `search-structured.ts:102` queryText 声明 → 消除 `!` 断言
2. **建议修复**: `generate-response.ts:204` 使用局部变量
3. **可选**: 统一 console 前缀
