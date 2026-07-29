# Code Review: Human-in-Loop 实现方案

**审查范围**: PR Human-in-Loop（用户姓名语义搜索 + 消歧）
**审查类型**: Local Changes（git diff）
**文件**: `features/ai/graph/agent.ts`, `routing.ts`, `generate-response.ts`, `search-structured.ts`, `search-structured.ts`(工具), `AiChatPanel.tsx`, `AiMessageBubble.tsx`

---

## Code Review Summary

### Verdict: ❌ Request Changes

### TypeScript Check Results

tsc 全绿（`--noEmit`），无新增类型错误。历史错误（`e2e/` / `features/admin/`）均为既有遗留，与本次改动无关。

---

## Findings

### Critical (Must Fix)

#### 1. **[features/ai/graph/agent.ts:23]** `humanConfirmationNode` 文件不存在 → 运行时崩溃

```typescript
import { humanConfirmationNode } from "./nodes/human-confirmation";
```

`features/ai/graph/nodes/human-confirmation.ts` 文件在仓库中**不存在**。当 `USE_LANGGRAPH=true` 时，`agentGraph` 初始化触发此 import → **Node.js 在运行时就崩溃**，永远不会到达 SSE 响应阶段。

**Impact**: 启用 LangGraph 后 AI 对话完全不可用，是 P0 阻断性 bug。

**Suggestion**: 必须实现 `human-confirmation.ts`，或在 `agent.ts` 中暂时移除 `humanConfirmation` 节点和相关连线（见 routing.ts Critical #2）。

---

#### 2. **[features/ai/graph/edges/routing.ts]** `routeAfterGenerateResponse` 依赖不存在的节点

routing.ts 新增了 `routeAfterGenerateResponse` 条件路由，当 `state.waitingForConfirmation=true` 时返回 `"humanConfirmation"`。但该节点文件不存在，LangGraph 在执行条件路由时会报节点未找到错误。

**Impact**: 同上，LangGraph 分支不可用。

**Suggestion**: 配合 Critical #1，要么实现节点，要么删除条件路由（改回 `.addEdge("generateResponse", END)`）。

---

#### 3. **[features/ai/graph/nodes/generate-response.ts]** `getUserActivityConclusion` 返回类型与 plan 定义不符

plan 中 `generateResponse` 应返回含 `pendingConfirmation` 的状态：

```typescript
// plan §3.11 定义的期望行为
return {
  messages: [...state.messages, new AIMessage("...")],
  waitingForConfirmation: true,  // ← 应设置
};
```

但当前实现在 `queryUser` 返回 `attribution.candidates.length > 0` 时，只在 `summary` 文本中嵌入"请确认目标用户"，**未设置 `waitingForConfirmation` 或 `pendingConfirmation`**：

```typescript
// search-structured.ts 工具层返回
return {
  summary: `找到多个与"${queryText}"相关的用户，请确认目标用户...\n${options}`,
  sources: [],
  attribution: { ..., candidates, ... },  // candidates 在这里
};

// generate-response.ts 只读取 summary 文本
const userActivityConclusion = getUserActivityConclusion(state.toolResults);
if (userActivityConclusion) {
  return { response: userActivityConclusion };  // 只返回文本，不设置等待标志
}
```

**Impact**: Human-in-Loop 状态没有触发，`routeAfterGenerateResponse` 永远返回 `END`，消歧流程从未执行。

**Suggestion**: `generateResponseNode` 应在检测到 `attribution.candidates` 时设置：
```typescript
if (attribution?.candidates && attribution.candidates.length > 1) {
  return {
    response: userActivityConclusion,
    waitingForConfirmation: true,
    pendingConfirmation: {
      type: "user_disambiguation",
      candidates: attribution.candidates,
      query: attribution.targetUserName,
    },
  };
}
```

---

#### 4. **[app/api/ai/conversations/[id]/messages/route.ts]** SSE 不发送 `pendingConfirmation` 事件 → 前端永远收不到消歧信号

`handleLangGraphRequest` 只发送 6 种 SSE 事件：`conversation` / `tool_call` / `tool_result` / `sources` / `text` / `done` / `error`。**没有发送 `waitingForConfirmation` 或 `pendingConfirmation`**，即使 graph 设置了这些状态，前端也收不到。

**Impact**: 前端无法渲染消歧 UI（按钮选择组件），用户不知道需要确认。

**Suggestion**: 在流式响应中增加 `pending_confirmation` 事件：
```typescript
// 在发送 tool_result 之后、text 之前
if (nodeOutput.waitingForConfirmation && nodeOutput.pendingConfirmation) {
  enqueueData({
    type: "pending_confirmation",
    candidates: nodeOutput.pendingConfirmation.candidates,
    query: nodeOutput.pendingConfirmation.query,
  });
}
```

---

#### 5. **[features/ai/ui/AiChatPanel.tsx]** 前端已移除 `pending_confirmation` 消息处理

之前方案在 `AiChatPanel` 中有 `pending_confirmation` 类型的渲染分支（`if (message.type === "pending_confirmation")`），但当前代码中：

```typescript
// 搜索整个文件
grep -n "pending_confirmation\|selectCandidate" AiChatPanel.tsx
// 结果：无匹配
```

**Impact**: 即使后端发送了 `pending_confirmation` 事件（Critical #4），前端也没有对应的渲染逻辑，无法显示用户选择按钮。

**Suggestion**: 重新实现 `pending_confirmation` 类型的消息渲染组件（参考 plan §3.13 的设计）：
```tsx
if (parsed.type === "pending_confirmation") {
  return (
    <div className="flex flex-col gap-2 p-4 bg-warning/10 border border-warning/30 rounded-lg">
      <div className="text-sm text-warning-foreground font-medium">请选择用户：</div>
      {parsed.candidates.map((user) => (
        <button key={user.id} onClick={() => selectCandidate(user.id)} ...>
          {user.name}（{user.email}）
        </button>
      ))}
    </div>
  );
}
```

其中 `selectCandidate(id)` 应向服务端发送用户选择，服务端继续 LangGraph 执行流（需要服务端支持 resumed stream）。

---

### Improvements (Recommended)

#### 6. **[features/ai/graph/nodes/generate-response.ts:178]** `isUserActivityQuery` 是重复的意图检测

```typescript
// routing.ts 已用 isUserActivityQuery 决定走 searchStructured
if (isUserActivityQuery(content)) return "searchStructured";

// generate-response.ts 又检测了一次
if (isUserActivityQuery(userContent)) {
  return { response: "暂未查询到该用户的结构化活动记录..." };
}
```

当 graph 从 `searchStructured` 走到 `generateResponse` 时，`toolResults.searchStructured` 里一定有结果（空或非空）。直接用 `toolResults.searchStructured.summary` 判断更准确——如果 summary 包含"未找到"或"暂未查询到"才返回此兜底文案，不需要再次调用 `isUserActivityQuery`。

**Reason**: 减少正则匹配的重复计算，且用实际数据而非模式匹配做兜底判断更可靠。

---

#### 7. **[features/ai/graph/nodes/search-structured.ts:124]** 中文姓名最长匹配只考虑同一条目内最长

```typescript
const chinese = cleaned.match(/[\u4e00-\u9fa5]{2,}/g);
if (chinese && chinese.length > 0) {
  const raw = chinese.sort((a, b) => b.length - a.length)[0];  // 取最长
  return { raw, normalized: raw };
}
```

如果用户输入"张三丰问李四"，经过停用词过滤后，`chinese` 会匹配到 `["张三丰", "李四"]`，取最长返回 `"张三丰"`。但如果真实意图是查李四，这个匹配就错了。

**Reason**: 这个行为与 plan §3.1 的设计一致，但在多姓名场景下需要依赖后续 `resolveUser` 的 candidates 机制兜底。当前实现有这个兜底，可以接受，但应在注释中注明这个 trade-off。

---

#### 8. **[features/ai/graph/nodes/generate-response.ts]** `getUserActivityConclusion` 类型守卫比旧版宽松

旧版 `getNoDirectActivityConclusion` 检查了 `hasDirectEvidence === false`：

```typescript
// 旧版：必须有 hasDirectEvidence === false 才返回
if (result.kind !== "user_activity" ||
    result.hasDirectEvidence !== false ||  // ← 旧版有这个检查
    ...)
```

新版 `getUserActivityConclusion` 移除了这个检查，直接返回 `result.summary`。这意味着即使有直接活动证据（`hasDirectEvidence=true`），也会返回 summary。这在语义上是合理的（summary 已包含所有信息），但 `isUserActivityQuery` 兜底文案会被有结果的查询错误触发。

**Reason**: 当前 `queryUser` 有结果时 `getUserActivityConclusion` 会返回非 null（因为 attribution.kind === "user_activity"），所以不会走到 `isUserActivityQuery` 兜底。逻辑是对的，但类型守卫的语义变了，应在注释中说明。

---

#### 9. **[features/ai/tools/search-structured.ts:130]** 弱匹配 `name contains` 候选数量无上限

```typescript
const candidates = await prisma.user.findMany({
  where: { name: { contains: normTrimmed, mode: "insensitive" }, bannedAt: null },
  select: { id: true, name: true, email: true },
  // 无 take 限制
});
```

如果用户输入单字（如"张"），`contains` 会匹配系统中所有含"张"的用户，可能返回数百条记录，生成巨长的消歧列表。

**Reason**: 建议加 `take: 10` 限制结果数量，避免大 payload 和糟糕的用户体验。plan §3.8 中 candidates 建议有数量控制，但实现中遗漏了。

---

#### 10. **[features/ai/ui/AiChatPanel.tsx:489-507]** `handleSend` 中无消歧响应发送路径

即使实现了 `pending_confirmation` 前端渲染，`selectCandidate(id)` 回调需要向服务端发送用户选择，让 LangGraph 继续执行。当前 `handleSend` 只发送新消息，没有"发送选择结果"的逻辑。

**Reason**: 需要一个 SSE `resume` 机制或专用 API 端点来让 LangGraph 继续执行（参考 LangGraph 的 `interrupt` / `resume` 模式）。

---

### Positive Points

- **P0 修复扎实**: `extractUserIdentifier` 正确返回 `{ raw, normalized }`，解决了"jing zhang"被截断为"jing"的根本问题
- **工具层 candidates 传递完整**: `search-structured.ts` 工具层正确在 `attribution.candidates` 中返回候选用户列表，接口设计清晰
- **归因严格性提升**: `queryUser` 中对"直接证据"和"相关工单"的区分继续保持高标准，符合 plan §3.1 的设计意图
- **新增 UI 细节打磨**: `AiMessageBubble` 复制按钮（IconCheck/IconCopy）体验良好，`conversationVersion` 防竞态设计到位
- **LangGraph 状态机扩展性好**: `pendingConfirmation` / `waitingForConfirmation` 注解设计合理，后续可扩展到其他需要人工确认的场景（如指派决策、删除确认）
- **routing.ts `isUserActivityQuery` 正则扩展**: 增加了 `在干啥`、`在干嘛`、`在干啥` 等匹配项，覆盖更多真实问法

---

## Next Steps

1. **立即**: 实现 `human-confirmation.ts` 节点，或从 `agent.ts` 中暂时移除 `humanConfirmation` 节点连线
2. **立即**: 修复 `generateResponseNode`，在检测到 `attribution.candidates` 时设置 `waitingForConfirmation` + `pendingConfirmation`
3. **立即**: 在 SSE handler 中增加 `pending_confirmation` 事件发送
4. **立即**: 在 `AiChatPanel` 中重新实现 `pending_confirmation` 类型的消息渲染和选择回调
5. **建议**: 给 `name contains` 弱匹配加 `take: 10` 限制，避免候选过多
6. **建议**: `generateResponseNode` 中 `isUserActivityQuery` 兜底文案依赖 `toolResults.searchStructured.summary` 内容判断而非正则重匹配

---

## cross-mentor 标记

以下问题属于 ai-learning-mentor 软架构审查范围，标 `cross-mentor:`：

- **Human-in-Loop 超时机制**: 如果用户在选择界面长时间无响应（如 5 分钟），graph 是否应该自动取消？应该返回什么内容给用户？
- **"随便"/"不知道" 等模糊输入处理**: 如果用户输入不在 candidates 列表中，`humanConfirmation` 节点如何处理？是否应该允许用户输入任意文字而非只能选列表项？
- **消歧列表过长 UX**: 如果有 50+ 个同名用户，如何分页展示？是否需要按 confidence 排序后取 Top-N？
- **重复消歧**: 如果用户第一次选择了，但后续查询又触发了消歧，UX 上是否让用户觉得"系统总是不认识我"？是否需要记住用户的选择并自动应用？
- **Human-in-Loop 对话历史**: 选择结果是否应该持久化到 conversation history 中，还是作为 graph 内部状态不暴露给用户？
