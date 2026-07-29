# Plan: Human-in-Loop 重构（V2 — 单一数据来源）

## 问题根因

当前有两个互相竞争的数据来源：
- `pendingState.confirmedUserId`（HTTP 层维护）
- `AIMessage.additional_kwargs.entityId`（消息层携带）

导致 `routeAfterHumanConfirmation` 看不到 `confirmedUserId`，误路由到 `generateResponse`。

## 核心原则

| 原则 | 说明 |
|------|------|
| **Single Source of Truth** | 所有业务状态只存在 `AgentState.resolvedEntities`，Graph 永远只读这个 |
| **Message 给 LLM，State 给程序** | AIMessage（含 `additional_kwargs`）仅供 LLM 理解，不被程序 parse |
| **HTTP 层只转发** | `route.ts` 不维护业务状态，只做 HTTP→Graph 透传 |

## 目标状态数据流

```
第一轮：
User: "刘工最近在干什么"
  → detectIntent → searchStructured
    → resolveUser → 多候选
    → pendingConfirmation = { candidates, query }
    → generateResponse → "请选择用户"

第二轮：
User: "1"
  → detectIntent → humanConfirmation
    → parseUserSelection("1", candidates) → userId
    → state.resolvedEntities = { user: { id, name, resolvedBy: "confirmation" } }
    → searchStructured
      → resolveUser() → 直接用 state.resolvedEntities.user（跳过解析）
    → generateResponse → "刘工最近在干什么"的真实回答
```

## 改动文件（5 个）

### 1. `features/ai/graph/agent.ts`

新增 `resolvedEntities` 字段：

```typescript
resolvedEntities: Annotation<{
  user?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
  project?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
  ticket?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
} | null>({
  value: (current, update) => update === undefined ? current : update,
  default: () => null,
})
```

### 2. `features/ai/graph/nodes/human-confirmation.ts`

设置 `resolvedEntities`，不再依赖 `toolResults.confirmedUserId`：

```typescript
export async function humanConfirmationNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  const userContent = typeof lastMessage?.content === "string" ? lastMessage.content : "";
  const candidates = state.pendingConfirmation?.candidates ?? [];

  const result = parseUserSelection(userContent, candidates);

  if (result === "skip") {
    return { pendingConfirmation: null, resolvedEntities: null };
  }

  if (result) {
    const confirmed = candidates.find(c => c.id === result)!;
    return {
      pendingConfirmation: null,
      resolvedEntities: {
        user: { id: confirmed.id, name: confirmed.name, resolvedBy: "confirmation" },
      },
    };
  }

  return { waitingForConfirmation: true };
}
```

### 3. `features/ai/graph/edges/routing.ts`

简化路由判断，只读 `resolvedEntities`：

```typescript
export function routeAfterHumanConfirmation(state: AgentState): NextNode {
  if (state.resolvedEntities?.user) return "searchStructured";
  return "generateResponse";
}
```

### 4. `features/ai/graph/nodes/search-structured.ts`

用 `resolvedEntities.user` 替代 `toolResults.confirmedUserId`：

```typescript
const resolvedUser = state.resolvedEntities?.user;

if (resolvedUser) {
  console.log(`[searchStructured] using resolvedEntities.user id=${resolvedUser.id}`);
  filters = needsUserExtraction ? { userId: resolvedUser.id } : undefined;
  queryText = `user:${resolvedUser.id}`;
} else {
  // Normal flow: extract user from query
  const extractedUser = needsUserExtraction ? extractUserIdentifier(effectiveQuery) : undefined;
  // ...
}
```

`hasMultipleCandidates` 判断不受影响（`resolvedUser` 非空时自然不会触发）：

```typescript
const hasMultipleCandidates = !resolvedUser && candidates && candidates.length > 1;
```

### 5. `app/api/ai/conversations/[id]/messages/route.ts`

**删除**：消息注入逻辑（`additional_kwargs` 注入 + `pendingState.confirmedUserId` 持久化）

**保留**：消息历史转发

```typescript
// 删除（约第 570-609 行）：
// - isUserSelection / resolveCandidate 检测
// - new AIMessage({ content: "[Internal]...", additional_kwargs: {...} }) 注入
// - capturedPendingConfirmation.confirmedUserId = ...
// - confirmationResolved 时保留 confirmedUserId 的逻辑
```

`initialState` 简化为：

```typescript
const initialState = {
  messages: langgraphMessages,
  mode: resolvedMode,
  userName: session.user.name ?? "用户",
  pendingConfirmation: pendingState?.pendingConfirmation ?? null,
  waitingForConfirmation: Boolean(pendingState),
  resolvedEntities: null,  // humanConfirmation 设置，不再从 pendingState 恢复
  toolResults: {},
};
```

---

## 验证步骤

1. `npm run build` — tsc 通过
2. `npm run dev` — 重启服务
3. 测试场景：
   - 用户：`刘工最近在干什么` → AI 返回候选列表
   - 用户：`1` → AI 回答刘工的真实最近动态
   - 验证 `resolvedEntities` 日志出现 `resolvedBy: "confirmation"`
