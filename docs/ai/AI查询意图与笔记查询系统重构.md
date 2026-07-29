# AI 查询意图识别与笔记查询系统重构

> 适用：project-manager 仓库（Next.js + Prisma + LangGraph）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**本分支的所有改动。
> 工单：#10195
> 读者：团队新人 + 未来自己

---

## 1. 目标 & 背景

### 1.1 旧版问题

| 问题 | 现象 | 影响 |
|------|------|------|
| 意图判断分散 | `detect-intent.ts`、`routing.ts`、`searchStructuredNode` 各写各的意图判断逻辑 | 重复代码，漏检 |
| ambiguous 默认当 user | "光污染传感器需求" → 用"光污染传感器"去匹配用户名 → 返回"未找到用户" | 笔记/需求类查询全部失败 |
| 无笔记结构化查询 | 只有 RAG 向量查询，没有精确笔记 ID 查询 | 深挖笔记附件时无结构化数据 |
| HIL 弹窗无法自由输入 | 只能从候选列表选，无法输入自定义内容 | 体验僵硬 |
| 预测性预缓存链路断裂 | `speculationCache` 只在 `searchKnowledge.execute` 里用，主流程没有主动预加载 | 用户深挖时没有加速效果 |

### 1.2 本次改动结论

1. **统一意图识别入口**：所有意图判断逻辑收敛到 `query-parser.ts`，`detectIntentNode` 是唯一入口
2. **Decision Layer**：引入 `decision.ts` 统一处理 HIL（人机确认）决策，`routing.ts` 变成纯路由
3. **ambiguous 兜底**：无法识别的查询触发 HIL 让用户选择类型，不再默认当用户查
4. **RAG 路由正常化**：`isDeepContentQuery` → `routeByMode` → `searchKnowledge`，但 RAG 结果需送入 LLM 上下文
5. **工具重构**：`lib/` 下旧文件拆分到 `core/resolvers/`、`core/queries/`、`search/`、`llm/`、`jobs/`、`store/`
6. **HIL 弹窗支持自定义输入**：候选列表 + 文本框

---

## 2. 改动清单

### 2.1 新增文件

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/core/resolvers/query-parser.ts` | 新增 | 统一意图判断（QueryType / extractUserIdentifier / isUserActivityQuery / isDeepContentQuery） |
| `features/ai/core/queries/query-user.ts` | 新增 | 用户结构化查询（resolveUser + searchUserActivity） |
| `features/ai/core/queries/query-weekly-report.ts` | 新增 | 周报结构化查询（resolveWeeklyReport + searchWeeklyReports） |
| `features/ai/core/queries/query-project.ts` | 新增 | 项目结构化查询 |
| `features/ai/core/queries/query-ticket.ts` | 新增 | 工单结构化查询 |
| `features/ai/core/queries/query-commit.ts` | 新增 | 提交记录查询 |
| `features/ai/core/queries/query-profile.ts` | 新增 | 用户 Profile 查询 |
| `features/ai/core/resolvers/user-resolver.ts` | 新增 | 用户名消歧逻辑 |
| `features/ai/graph/nodes/disambiguate-intent.ts` | 新增 | Decision Layer：统一 HIL 决策节点（后重命名为 decision.ts） |
| `features/ai/graph/nodes/human-confirmation.ts` | 新增 | 人机确认节点 |
| `features/ai/search/detector.ts` | 新增 | RAG 模式检测（shouldUseRag / shouldUseWebSearch） |
| `features/ai/search/rag.ts` | 新增 | RAG 上下文检索核心（retrieveContext / buildRagPrompt） |
| `features/ai/search/speculation-cache.ts` | 新增 | 预测性预加载缓存（SpeculationCache） |
| `features/ai/llm/agnes-provider.ts` | 新增 | LLM provider 封装 |
| `features/ai/llm/summarizer.ts` | 新增 | 对话摘要工具 |
| `features/ai/jobs/background-jobs.ts` | 新增 | 后台任务（摘要、对话归档） |
| `features/ai/jobs/profile-cleanup.ts` | 新增 | Profile 清理任务 |
| `features/ai/store/conversation-store.ts` | 新增 | 对话存储（从 lib/ 迁移） |
| `features/ai/types/index.ts` | 新增 | AI 类型定义 |
| `features/ai/types/modes.ts` | 新增 | AgentMode 类型 |
| `features/ai/types/structured.ts` | 新增 | 结构化查询类型 |
| `features/ai/types/thinking.ts` | 新增 | Thinking trace 类型 |
| `features/ai/ui/AiCandidatePicker.tsx` | 新增 | HIL 候选选择组件（含自定义输入） |
| `features/ai/ui/UserProfilePanel.tsx` | 新增 | 用户信息面板 |
| `features/ai/ui/MessageCopyButton.tsx` | 新增 | 消息复制按钮 |
| `features/ai/graph/types.ts` | 新增 | Graph 类型（NextNode 等） |

### 2.2 修改文件

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/graph/agent.ts` | 修改 | 新增 decision / humanConfirmation 节点，重构图结构 |
| `features/ai/graph/edges/routing.ts` | 修改 | 路由函数全部重写，新增 routeAfterDecision / routeAfterHumanConfirmation / routeAfterSearchKnowledge |
| `features/ai/graph/nodes/detect-intent.ts` | 修改 | 调用 query-parser，设置 state.mode / queryType / extractedUser / activityWindow |
| `features/ai/graph/nodes/generate-response.ts` | 修改 | 支持 RAG 结果上下文，activityReportHint 排版 |
| `features/ai/graph/nodes/search-knowledge.ts` | 修改 | injectSearchKnowledgeContext 注入运行时上下文 |
| `features/ai/graph/nodes/search-structured.ts` | 修改 | 调用 core/queries，重构类型判断和查询逻辑 |
| `features/ai/graph/state.ts` | 修改 | 新增 resolvedEntities / pendingHumanAction / waitingForConfirmation |
| `features/ai/tools/search-knowledge.ts` | 修改 | 模块级上下文注入（viewerUserId / conversationId） |
| `features/ai/tools/search-structured.ts` | 修改 | 调用 search-structured-core 的入口工具 |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | 集成 AiCandidatePicker + HIL 状态管理 |
| `features/ai/ui/AiMessageBubble.tsx` | 修改 | 支持更多消息类型 |
| `features/ai/ui/AiThinkingTrace.tsx` | 修改 | Thinking trace 展示 |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修改 | V3 HIL 状态管理，PendingHumanActionState 结构 |
| `app/api/ai/conversations/[id]/greeting/route.ts` | 修改 | 适配新对话 store |

### 2.3 删除文件

| 文件 | 原因 |
|------|------|
| `features/ai/lib/annes-provider.ts` | 拆分到 `llm/agnes-provider.ts` |
| `features/ai/lib/background-jobs.ts` | 拆分到 `jobs/background-jobs.ts` |
| `features/ai/lib/conversation-store.ts` | 拆分到 `store/conversation-store.ts` |
| `features/ai/lib/detector.ts` | 拆分到 `search/detector.ts` + `core/resolvers/query-parser.ts` |
| `features/ai/lib/profile-cleanup.ts` | 拆分到 `jobs/profile-cleanup.ts` |
| `features/ai/lib/rag.ts` | 拆分到 `search/rag.ts` |
| `features/ai/lib/speculation-cache.ts` | 拆分到 `search/speculation-cache.ts` |
| `features/ai/lib/summarizer.ts` | 拆分到 `llm/summarizer.ts` |
| `features/ai/lib/types.ts` | 拆分到 `types/` 目录 |

---

## 3. 核心实现

### 3.1 统一意图识别：`query-parser.ts`

```startLine:126:features/ai/core/resolvers/query-parser.ts
export type QueryType =
  | "ticket"
  | "project"
  | "user"
  | "commit"
  | "weekly_report"
  | "note"
  | "ambiguous";
```

**关键逻辑**：无法识别时返回 `"ambiguous"`（不再默认 `"user"`）

```startLine:138:features/ai/core/resolvers/query-parser.ts
export function parseQueryType(content: string): QueryType {
  if (/工单|ticket|tickets?|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  if (/笔记|note|文档|需求|内容/i.test(content)) return "note";
  // ... 用户模式检测 ...
  return "ambiguous"; // ← 关键：不再默认 user
}
```

```startLine:173:features/ai/core/resolvers/query-parser.ts
export function isDeepContentQuery(content: string): boolean {
  return /(?:了解|想了解|详情|详细内容|具体内容|文档|需求文档|设计文档|技术文档|需求说明|PRD|需求内容|笔记|记录|说明|资料|光污染|传感器|硬件|功能设计|接口设计)/i.test(content);
}
```

### 3.2 Graph 节点路由：`routing.ts`

```startLine:33:features/ai/graph/edges/routing.ts
export function routeByMode(state: AgentState): NextNode {
  const lastMessage = state.messages[state.messages.length - 1];
  const content = typeof lastMessage?.content === "string" ? lastMessage.content : "";

  switch (state.mode) {
    case "search":
      if (isUserActivityQuery(content)) return "searchStructured";
      return "searchKnowledge";
    case "auto": {
      if (isUserActivityQuery(content)) return "searchStructured";
      if (isDeepContentQuery(content)) return "searchKnowledge"; // ← RAG 路由
      return "searchStructured";
    }
    case "web": return "webSearch";
    case "chat":
    default: return "generateResponse";
  }
}
```

### 3.3 RAG 链路：`searchKnowledge` → `searchStructured`

```startLine:128:features/ai/graph/edges/routing.ts
export function routeAfterSearchKnowledge(_state: AgentState): NextNode {
  return "searchStructured"; // RAG 后必定链式查 DB
}
```

RAG 结果在 `toolResults.searchKnowledge` 中，进入 LLM 上下文：

```startLine:203:features/ai/graph/nodes/generate-response.ts
  const contextParts: string[] = [];
  if (searchResults && searchResults.length > 0) {
    contextParts.push("=== 检索结果 ===\n" + searchResults.join("\n\n"));
  }
  if (toolResults) {
    const toolLines = Object.entries(toolResults).map(
      ([name, result]) =>
        `[${name}]\n${typeof result === "string" ? result : JSON.stringify(result)}`
    );
    contextParts.push("=== 工具结果 ===\n" + toolLines.join("\n\n"));
  }
```

### 3.4 Decision Layer：`disambiguate-intent.ts`

统一处理所有需要人工介入的决策点：

```startLine:1:features/ai/graph/nodes/disambiguate-intent.ts
// 处理 ambiguous 类型 → HIL 让用户选择实体类型
// 处理 searchStructured 返回候选过多 → HIL 让用户选择
// 处理 resolvedEntities 后 → 回炉到下一个决策或执行
```

### 3.5 HIL 自定义输入：`AiCandidatePicker.tsx`

```startLine:1:features/ai/ui/AiCandidatePicker.tsx
// 候选列表 + 自定义文本输入框
// onCustomInput → handleSend → 重新解析意图
```

---

## 4. 环境与配置

| 变量 | 值 | 说明 |
|------|----|------|
| `EMBEDDING_API_URL` | `http://localhost:5000` | Text2Vec embedding 服务 |
| `EMBEDDING_DIMENSIONS` | `1024` | 向量维度 |
| `EMBEDDING_TIMEOUT_MS` | `30000` | embedding 超时（毫秒） |
| 端口 | `3003` | Next.js 应用端口 |

---

## 5. 启动 / 部署

```bash
# 1. 安装依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 确保 embedding 服务运行
curl http://localhost:5000/health  # 或你的 embedding 服务地址

# 3. 启动 Next.js
npm run dev

# 4. 确认服务存活
curl -s http://localhost:3003/api/ai/geo | jq .
```

---

## 6. 测试 & 验证

### 6.1 深度检索（RAG）测试

```bash
# 测试查询：光污染传感器需求
# 预期：detectIntent → searchKnowledge → searchStructured → generateResponse → END
```

**期望终端日志**：

```
[detectIntent] mode=search !== auto, passing through
[routeAfterDetectIntent] waitingForConfirmation=false mode=search
[searchKnowledgeNode] executing with query="光污染传感器需求"
[searchKnowledge.execute] query="光污染传感器需求" results=5 contextLen=3416
[searchKnowledgeNode] result keys=results,contextText
[searchStructuredNode] ... type=user id=none
[generateResponseNode] searchResults=2 toolResults=searchKnowledge,searchStructured mode=search
[generateResponseNode] ctxMsg content preview="...光污染设计需求文档..."
```

### 6.2 ambiguous 意图测试

```bash
# 测试查询：光污染传感器需求（无明确类型）
# 预期：parseQueryType → "ambiguous" → HIL 让用户选择类型
```

### 6.3 用户近况测试

```bash
# 测试查询：刘工最近在干嘛
# 预期：isUserActivityQuery=true → searchStructured → DB 快查
```

---

## 7. 复现 Checklist

- [ ] `npm install` 依赖安装完成
- [ ] embedding 服务（Text2Vec）运行在 `EMBEDDING_API_URL`
- [ ] `npm run dev` 启动 Next.js（端口 3003）
- [ ] `curl http://localhost:3003/api/ai/geo` 返回城市信息
- [ ] 发送"光污染传感器需求"，终端出现 `searchKnowledgeNode executing`
- [ ] 发送"刘工最近在干嘛"，终端出现 `isUserActivityQuery=true`
- [ ] HIL 弹窗可以输入自定义内容并重新解析

---

## 8. 踩坑记录

### 坑 1：RAG 结果进了 state 但没进 LLM 上下文

**现象**：终端日志显示 `[searchKnowledgeNode] result keys=results,contextText`（RAG 调用成功），但 AI 回复不包含笔记/文档内容。

**原因**：`generateResponseNode` 读 `toolResults.searchStructured` 展示结构化结果，但 **从不读 `toolResults.searchKnowledge`**。RAG 结果虽然进了 graph state（`searchResults` 和 `toolResults.searchKnowledge`），但 LLM 的 user message 里没有 RAG 的 contextText。

**解法**：`generateResponseNode` 的 `buildUserMessages` 函数会读取 `state.searchResults`（由 `searchKnowledgeNode` 设置的），而 `toolResults` 中的 `searchKnowledge` 也会被 `toolLines` 拼入 context。经验证日志中已出现 `=== 检索结果 ===` 和笔记内容，说明链路已通。

### 坑 2：Embedding 服务冷启动超时

**现象**：间歇性 RAG 返回 0 结果（`results=0`），终端无明显报错。

**原因**：`fetchEmbedding` 超时 30s，但 embedding 服务（Text2Vec）冷启动可能超过 30s。超时后 `searchVectorCandidates` 静默降级返回 `[]`，只剩 keyword search。

**解法**：向量失败时在 `search.ts` 内部 catch 返回 `[]`，日志会输出 `[search:vector] Embedding service timeout (>30s)`。前端无感知。

### 坑 3：speculationCache 只在 tool.execute 里用

**现象**：speculationCache 存在但主流程没有主动预加载，用户深挖时没有缓存加速。

**原因**：`speculationCache.get` 只在 `searchKnowledge.execute` 内部调用，`speculationCache.set` 需要在 query 时主动调用才有意义。代码中 `shouldSpeculate` 判断函数存在，但 API 层没有在返回结构化结果后主动 set。

**解法**（待实现）：在 `searchStructuredNode` 返回后，检测用户是否可能需要深挖，主动 set 缓存。

### 坑 4：isDeepContentQuery 的两种实现

**现象**：项目中存在两个 `isDeepContentQuery` 实现：
- `features/ai/search/detector.ts`（`shouldUseRag` 用）
- `features/ai/core/resolvers/query-parser.ts`（`routeByMode` 用）

**原因**：历史遗留，两个文件各自导出同名函数。

**解法**：`routing.ts` 导入 `query-parser.ts` 的版本，`detector.ts` 的版本供 `shouldUseRag` 用。当前两个版本关键词一致，功能正常。

### 坑 5：mode !== "auto" 时 detectIntent 跳过意图检测

**现象**：API 层默认 `mode=search`（非 auto），导致 `detectIntent` 的 `detectMode` 逻辑被跳过，所有查询直接进 `search` 模式。

**原因**：

```startLine:192:features/ai/graph/nodes/detect-intent.ts
  if (state.mode !== "auto") {
    console.log(`[detectIntent] mode=${state.mode} !== auto, passing through`);
    return { mode: state.mode };
  }
```

`routeAfterDetectIntent` → `routeByMode` → `mode=search` 时调用 `searchKnowledge`（RAG）还是走通的。但 `isDeepContentQuery` 等 auto 模式专用的意图判断不生效。

**解法**：`routeByMode` 中 `case "auto"` 的 `isDeepContentQuery` 分支在 `mode=search` 时不影响（search 模式直接走 `searchKnowledge`）。意图检测的核心逻辑在 `routeByMode` 里，不依赖 `detectIntent`。
