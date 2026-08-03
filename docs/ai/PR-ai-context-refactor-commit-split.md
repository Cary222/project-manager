# PR 拆分方案 — AI 上下文管理重构（含 越界改动回收）

> Main 整理：方案 v4 实施产物的 commit 拆分建议
> 时间：2026-08-01
> 依据：SOP Rule 5（Immutable Input）+ Rule 4（Authority Boundary）

## 现状

实施方案 v4 阶段，fullstack-developer 完成了 9 个新文件 + 1 个 schema + 1 个 route.ts 改动，但 **越界修改了 16 个方案外文件**（按方案 v4 范围禁止修改）。

### 越界改动分类

| 分类 | 改动文件 | 性质 |
|------|---------|------|
| **Timeline v4 集成** | `AiChatPanel.tsx`, `AiMessageBubble.tsx`, `AiThinkingTrace.tsx` (删除), `AiThinkingTrace.test.tsx` (删除) | Timeline v4 配套 UI |
| **Graph 路由完善** | `graph/agent.ts`, `graph/edges/routing.ts` | END→generateResponse fallback |
| **"我最近干了什么" 修复** | `graph/nodes/detect-intent.ts`, `graph/nodes/generate-response.ts`, `graph/nodes/human-confirmation.ts`, `graph/nodes/search-structured.ts` | 用户自指查询处理 |
| **自我引用 feature** | `core/resolvers/query-parser.ts`, `core/resolvers/user-resolver.ts`, `core/queries/query-weekly-report.ts`, `types/structured.ts` | "我" → viewerUserId |
| **二级 Bug 修复** | `llm/proxy.ts` (dynamic require) | bundler 浏览器兼容 |

## Commit 拆分建议

推荐拆为 **3 个独立 commit**（独立 feature = 独立 PR 评审 = 独立回滚）：

### Commit 1: AI Context Refactor（方案 v4 主体）

```
feat(ai): AI Runtime Context Layer 重构（ContextBuilder + DB 持久化）

- 新增 features/ai/core/context/ 模块（9 个文件）
  - conversation-state-store.ts: DB 化的 RuntimeState 读写 + 5s cache
  - runtime-state-adapter.ts: LangGraph nodeOutput 统一解析
  - context-builder.ts: ChatContext 装配工厂
  - runtime-state-persist.ts: debounce 1s + finally flush
  - messages-builder.ts: 纯数据转换 (history → BaseMessage[])
  - history-window.ts: 两个独立 token limit (historyTokenLimit + systemAndRagTokenLimit)
  - message-metadata-adapter.ts: metadata → response_metadata（摘要化）
  - token-counter.ts: gpt-tokenizer 封装
  - __tests__/messages-builder.test.ts: 7 个测试用例

- prisma schema: 新增 AiConversationRuntimeState（单表 JSON）
  - humanState: { pendingAction, originalQuery, resolvedEntities, waitingNode, lastAssistantMessage, mode }
  - semanticContext: { lastMentionedUser, recentMentions, topicTags }
- AichatMessage.metadata 字段（用于存储 thinkingSteps）
- AiConversation 关联 runtimeState

- route.ts 改造（1103 → 1127 行）
  - loadRuntimeState + saveRuntimeState 替换 in-memory Map
  - buildChatContext + buildMessages 抽取 message 重建逻辑
  - runtime-state-patch 写入 SSE finally 块（防止中断丢失）
  - 保留 Map 作为一周内 fallback

- 配套类型扩展
  - types/structured.ts: MatchType 加 'self' + ExtractedUser.isSelf
  - types/thinking.ts: ThinkingNodeName 加 modelSelect/decision
  - types/index.ts: re-export timeline types
  - store/conversation-store.ts: appendMessage 加 metadata 参数

- 依赖
  - gpt-tokenizer@^3.4.0

设计亮点：
- mentor 6 条建议全部采纳：schemaVersion 暂缓 / token budget 拆两个 / id 去重 / adapter 抽取 / finally flush / 改名
- ContextBuilder 不返回 BaseMessage[]（解耦 LangChain）

链接：.cursor/plans/ai_上下文管理重构（双层架构适配）_2c97fa72.plan.md
```

**包含文件**：
- `features/ai/core/context/**`（9 个新文件）
- `prisma/schema.prisma`
- `app/api/ai/conversations/[id]/messages/route.ts`
- `features/ai/store/conversation-store.ts`
- `features/ai/types/index.ts`
- `features/ai/types/structured.ts`
- `features/ai/types/thinking.ts`
- `package.json` + `package-lock.json`

### Commit 2: AI Timeline v4 集成

```
feat(ai): Timeline v4 集成（删除 AiThinkingTrace，AiChatPanel 改造）

- features/ai/lib/timeline-adapter.ts (新增)：GraphChunk → TimelineCommand 转换
- features/ai/lib/timeline-store.ts (新增)：ThinkingStepStore 状态管理
- features/ai/types/timeline.ts (新增)：TaskRecord 类型 + NODE_CATEGORY_MAP / NODE_STEP_LABELS / NODE_DISPLAY_TITLES
- features/ai/ui/AiThinkingStream.tsx (新增)：新版 thinking 流 UI
- features/ai/ui/hooks/useTimelineStore.ts (新增)：React Hook 集成
- features/ai/ui/hooks/useTimelineTree.ts (新增)：思考树构建

- AiChatPanel.tsx 改造
  - 删除 AiThinkingTrace 集成
  - 改用 TaskRecord[] 渲染 thinking 流
  - 适配 modelSelect / decision 节点
- AiMessageBubble.tsx 小调整
- 删除 AiThinkingTrace.tsx + AiThinkingTrace.test.tsx
  - 已被 features/ai/ui/AiThinkingStream.tsx 替代
```

**包含文件**：
- `features/ai/lib/timeline-adapter.ts` (新增)
- `features/ai/lib/timeline-store.ts` (新增)
- `features/ai/types/timeline.ts` (新增)
- `features/ai/ui/AiThinkingStream.tsx` (新增)
- `features/ai/ui/hooks/useTimelineStore.ts` (新增)
- `features/ai/ui/hooks/useTimelineTree.ts` (新增)
- `features/ai/ui/AiChatPanel.tsx`
- `features/ai/ui/AiMessageBubble.tsx`
- `features/ai/ui/AiThinkingTrace.tsx`（删除）
- `features/ai/ui/AiThinkingTrace.test.tsx`（删除）

### Commit 3: "我最近干了什么" Bug 修复 + 自我引用 feature

```
feat(ai): 完善用户自指查询（"我最近干了什么" / "我的周报"）

输入：用户输入 "我"、"我最近干了什么"、"我是刘工" 等自指查询
行为：解析为当前登录用户，自动 fallback 到 viewerUserId

- core/resolvers/query-parser.ts
  - extractUserIdentifier: "我" → { raw: "我", normalized: "我", isSelf: true }
- core/resolvers/user-resolver.ts
  - resolveUser: isSelf=true → 直接返回 viewerUser
- core/queries/query-weekly-report.ts
  - viewer fallback: confidence=0 时回退到 viewer
- types/structured.ts
  - MatchType 加 'self'
  - ExtractedUser.isSelf?: boolean

- graph/nodes/detect-intent.ts
  - user_activity 正则增强（代词 + 时间词 + 活动词）
  - non-auto mode 下 user_activity 强制 search mode
- graph/edges/routing.ts
  - routeAfterDecision: resolvedEntities 为空时 END → generateResponse
- graph/agent.ts
  - decision node 加 generateResponse 边
- graph/nodes/generate-response.ts
  - 工具失败 + 空 response → fallback to chat mode
- graph/nodes/human-confirmation.ts
  - 用户说 "都不是" → 清空 pending，提示重新提问
- graph/nodes/search-structured.ts
  - viewerUserId 从 state.userId 显式传入

- llm/proxy.ts
  - undici ProxyAgent 改为 dynamic require（避免浏览器打包）
```

**包含文件**：
- `features/ai/core/resolvers/query-parser.ts`
- `features/ai/core/resolvers/user-resolver.ts`
- `features/ai/core/queries/query-weekly-report.ts`
- `features/ai/graph/agent.ts`
- `features/ai/graph/edges/routing.ts`
- `features/ai/graph/nodes/detect-intent.ts`
- `features/ai/graph/nodes/generate-response.ts`
- `features/ai/graph/nodes/human-confirmation.ts`
- `features/ai/graph/nodes/search-structured.ts`
- `features/ai/llm/proxy.ts`
- `features/ai/types/structured.ts`（如果已经在 Commit 1 改过，合并提交）

## 注意事项

1. **types/structured.ts 冲突**：Commit 1 改了 `MatchType.self` + `isSelf`，Commit 3 也改了。需要：
   - 把 `MatchType.self` 和 `isSelf` 合并到 Commit 1（Context 改造的字段配套）
   - 不要重复添加

2. **currentState 三段叙述**：当前 git status 混杂，需要：
   - `git add` 精确指定文件清单
   - `git stash` 临时存放用户预存改动（如果需要）

3. **commit 顺序**：先 Commit 1（context 基础）→ 再 Commit 2（UI 集成）→ 再 Commit 3（自指 feature），保证可独立回滚

4. **git-commit-assistant 强制**：
   - 每条 commit 必须问工单单号（用户原话未含 #XXXXX 时）
   - commit body 必须带 `Co-authored-by: Cursor <cursoragent@cursor.com>`
   - 默认推 origin（局域网生产），不推 github

## 应排除（用户预存，不纳入本次 commit）

```
.cursor/plans/langgraph-playground-学习线_abf3ce5a.plan.md (M)
.cursor/skills/pm-dev/PROJECT-HUB.md (M)
docs/learning/LangGraph-Architecture-Roadmap.md (M)
docs/learning/LangGraph-实战学习计划.md (M)
pi/ (untracked - 另一个 monorepo 子项目)
scripts/add-metadata-col.ts (untracked - 其他迁移脚本)
.cursor/plans/ai_*.plan.md (untracked - 多个旧计划文件)
```
