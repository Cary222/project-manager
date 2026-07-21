# LangGraph StateGraph Phase 1 — Code Review

<!-- reviewer: code-reviewer (硬层) -->
<!-- scope: features/ai/graph/* + app/api/ai/conversations/[id]/messages/route.ts LangGraph branch -->

## Code Review Summary

**Scope:** PR LangGraph Phase 1 — 新增 StateGraph 集成代码
**Review Type:** Local Changes (新增文件 + 部分修改)
**tsc:** ✅ 通过 — 新增文件零类型错误；历史遗留错误 2 处（`features/admin/admin.test.ts`、`e2e/module-edit.spec.ts`）与本 PR 无关

---

### Verdict: ⚠️ Approved with Suggestions

### Findings

#### Critical (Must Fix)

- **[features/ai/graph/agent.ts:77]** `generateResponseNode as any` 类型绕过
  - Impact: StateGraph 不知道 `generateResponseNode` 的第二个 options 参数，类型安全完全失效。若后续 refactor 改签名，tsc 不会报错。
  - Suggestion: 将 `generateResponseNode` 改造为可选第二个参数的节点函数，或在 `Partial<AgentState>` 上补充 `userName`/`profile` 字段让 StateGraph 自行注入。避免 `as any`。

- **[features/ai/tools/web-search.ts:13]** `webSearch` 工具在 API key 缺失时返回错误对象而非抛出
  - Impact: `webSearchNode` 的 `catch` 只捕获抛出的异常；当工具返回 `{ error: "TAVILY_API_KEY not set" }` 时，catch 不触发，节点返回 `toolResults: { webSearch: { error: "TAVILY_API_KEY not set" } }` — 静默失败，用户不知道原因。
  - Suggestion: 工具应在 API key 缺失时 `throw new Error(...)` 或 `return { error: "...", results: [], answer: null }`（使 error 为真）。或在节点层加 `if (result && typeof result === "object" && "error" in result)` 判断并转为错误。

#### Improvements (Recommended)

- **[features/ai/graph/edges/routing.ts:39-49]** `routeAfterSearchKnowledge` 和 `routeToResponse` 未被使用
  - Impact: 死代码，增加维护负担。实际流程由 `agent.ts` 的硬编码 `.addEdge` 控制，不走条件边。
  - Suggestion: 若后续不需要条件边演进，删除这两个函数；若需要则补充注释说明为何暂未使用。

- **[features/ai/graph/nodes/generate-response.ts:10,129]** `profile: unknown` 参数类型过于宽松
  - Impact: `buildSystemPrompt` 内部做了 `typeof profile === "object"` 守卫，但 `formatProfile` 的断言 `profile as Record<string, unknown>` 在 profile 非对象时会 panic。虽被守卫覆盖，但类型上仍存在隐患。
  - Suggestion: 声明为 `Record<string, unknown> | null` 并在入口做早期返回。

- **[features/ai/graph/nodes/web-search.ts:15-17]** `content` 空字符串兜底逻辑不透明
  - Impact: 当 `lastMessage.content` 非字符串时，搜索查询变成空字符串，`webSearch` 工具会因 `query` 长度不足（`min(2)`）而返回错误或空结果，但此行为对用户完全不透明。
  - Suggestion: 在节点层检测空 content 时返回明确的 `searchResults: ["[webSearch skipped: 消息内容为空]"]}`，避免静默发送空查询。

- **[app/api/ai/conversations/[id]/messages/route.ts:462]** `forceSearch` 覆盖后 `mode` 参数的 zod 验证默认值丢失
  - Impact: `forceSearch=true` 时会将 `"auto"` 转为 `"search"`，但若原始 mode 是无效值（被 `z.enum` 挡掉），`resolvedMode` 会变成 `"search"`，可能绕过预期行为。
  - Suggestion: `const resolvedMode: AgentMode = forceSearch ? "search" : mode;`，加 `as AgentMode` 确保类型收紧。

- **[features/ai/graph/agent.ts:47-48]** `PartialAgentState` 导出但未使用
  - Impact: 导出了未使用的类型，增加 API surface。
  - Suggestion: 若后续不需要可删除。

#### Nitpicks (Optional)

- **[features/ai/graph/edges/routing.ts:30]** `default:` case 在 `switch (state.mode: AgentMode)` 永远不可达 — `"auto"|"search"|"chat"|"web"` 四个 case 全部覆盖。虽无害但冗余。
- **[features/ai/graph/nodes/generate-response.ts:31]** `modeHints[mode] ?? modeHints.auto ?? ""` 双重兜底：第一个 `??` 已经保证了 `mode` 是 `AgentMode` 合法值，第二个 `??` 永远不触发。简化成 `modeHints[mode] ?? ""` 即可。

---

### Positive Points

- **tsc 零新增错误**：所有新增文件类型正确，导出/导入链路对齐 LangGraph 1.x API。
- **状态机流转正确**：`routeByMode` 四种 mode 全覆盖，硬编码边与条件边无歧义。
- **错误处理覆盖完整**：所有工具节点和 SSE handler 都有 try/catch，异常不穿透。
- **模块作用域上下文注入模式干净**：`injectSearchKnowledgeContext` / `injectSearchStructuredContext` 封装了 `setSearchKnowledgeViewer` 等 setter，避免在 API route 中直接调用，抽象合理。
- **SSE 格式兼容**：`handleLangGraphRequest` 发送的 event 类型（`conversation`、`tool_result`、`text`、`done`）与原有 SSE 格式对齐，前端无需修改。
- **FSD 边界清晰**：`features/ai/graph/` 作为独立 feature slice，节点/边/状态分离，职责明确。
- **无性能反模式**：消息历史限制 10 条、compiled graph 单例缓存、无 N+1 查询。

---

### Cross-Mentor Observations

- `buildSystemPrompt` 在 `generate-response.ts` 和 `messages/route.ts` 中存在完全相同的实现（`modeHints` 内容略有差异，search mode 规则不同），属于重复代码维护风险——**建议统一 Prompt 模板**，交由调用方注入差异部分。`cross-mentor: 建议评估两套 prompt 模板是否应合并为共享常量或工厂函数，避免长期分化。`
- LangGraph 分支未发送 `tool_call` 事件（只有 `tool_result`），前端无法在工具执行时显示"正在搜索…"等中间状态，UI 体验与原有流式分支不一致——**建议评估是否需要在 `streamMode: "updates"` 中捕获节点开始事件**。`cross-mentor: 流式 UX 一致性问题。`
- `generateResponseNode` 的 `{ userName, profile }` options 未从 API route 传入，graph 级别硬编码 "用户"，用户画像信息丢失——**建议将 userName/profile 写入初始状态**，让 graph 节点可访问。`cross-mentor: 用户个性化上下文在 graph 中不可用，是否需要透传？`

---

### Next Steps

- [ ] 修复 `as any` 类型绕过（`generateResponseNode` 签名对齐）
- [ ] 修复 `webSearch` 工具静默失败问题（throw 或节点层判断）
- [ ] 评估并决定是否保留未使用的 `routeAfterSearchKnowledge` / `routeToResponse`
- [ ] 确认 `webSearch` API key 缺失的 UX 预期（提示用户 vs 静默降级）
