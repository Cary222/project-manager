# #10144 LangGraph 路由重构 & 意图检测优化

## 概述

重构 AI 对话引擎的工具路由策略，修正 `searchStructured`（DB 快查）和 `searchKnowledge`（RAG 向量检索）的调用优先级，并将来源引用 UI 抽成独立组件。

## 改动文件

| 文件 | 改动说明 |
|------|----------|
| `features/ai/lib/detector.ts` | 重写 `shouldUseRag` 意图判断逻辑 |
| `features/ai/graph/edges/routing.ts` | 修正 auto 模式路由规则 |
| `features/ai/graph/nodes/detect-intent.ts` | 扩展意图关键词 |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修复 Agnes 路径 RAG 判断 + LangGraph SSE 来源提取 |
| `features/ai/ui/AiSourcesList.tsx` | 新增来源引用独立组件 |
| `features/ai/ui/AiMessageBubble.tsx` | 委托来源渲染给 AiSourcesList |
| `features/ai/ui/AiChatPanel.tsx` | 更新 import 路径 + 传递客户端城市 |

---

## 一、路由策略修正

### 旧逻辑（错误）

```
auto → searchKnowledge（先走 RAG，慢）
```

### 新逻辑（正确）

```
auto + 浅层查询（工单号/项目名/统计/vcs） → searchStructured（DB 快查）
auto + 深层内容（文档/笔记/详情）→ searchKnowledge（RAG 向量检索）
search（强制）→ searchKnowledge（始终 RAG）
web → webSearch
chat → generateResponse（无工具）
```

**核心原则**：`searchStructured`（直连 DB）效率远高于 `searchKnowledge`（向量检索），浅层精确查询优先 DB。

### 踩坑：路由文件被重写过

- 原始 `routing.ts` 中 auto 模式判断写反了
- `routeAfterSearchKnowledge` 导出了但从未在 `addConditionalEdges` 中使用
- Graph 固定链 `searchKnowledge → searchStructured → generateResponse` 是硬编码的，导致路由函数形同虚设
- 修正后：auto 模式直接从 `routeByMode` 返回目标节点，不再依赖条件边

---

## 二、意图检测增强

### `shouldUseRag` 判断条件

以下关键词触发 RAG（`searchKnowledge`）：
- `了解`、`详情`、`详细内容`、`具体内容`
- `文档`、`需求文档`、`设计文档`、`技术文档`、`PRD`
- `笔记`、`记录`、`说明`、`资料`
- `光污染`、`传感器`、`硬件`、`功能设计`、`算法`

其余（工单号/项目名/统计/提交/vcs）默认走 `searchStructured`。

### Agnes 路径漏判

Agnes 引擎（非 LangGraph）路径中，原代码：

```ts
// ❌ 原来只判断 search 模式，auto 模式的 shouldUseRag 被完全忽略
const useRag = mode === "search" || (mode === "auto" && forceSearch);
```

修复后：

```ts
// ✅ auto 模式也走 shouldUseRag 检测
const autoNeedsRag = mode === "auto" && shouldUseRag(message);
const ragPromise = (useRag || autoNeedsRag) ? retrieveContext(...) : ...;
```

---

## 三、来源引用 UI 组件化

### 拆分原因

- `AiMessageBubble` 承担了打字机动画 + 来源渲染两个职责
- 流式过程中来源可能不完整（chunk 未完成），导致渲染闪烁
- 需要让来源组件可被其他气泡复用

### 组件结构

```
AiMessageBubble (打字机 + 对话气泡)
└── AiSourcesList (来源引用，独立渲染)
    ├── inlineActions（工单/项目/用户/提交/周报 → 胶囊按钮）
    └── passiveRefs（笔记/外链 → 白色卡片）
```

### 关键设计点

- `AiSourcesList` 内部做 URL 去重（同一笔记多个 chunk → 显示一个）
- 流式期间 `isStreaming=true` 时不渲染来源，避免打字过程中闪烁
- `AiMessageBubble` 只在 `!isStreaming && sources` 时才挂载 `AiSourcesList`

---

## 四、LangGraph 来源提取修复

### 问题

LangGraph 路径的 SSE 来源提取（`type: "sources"` 事件）只处理了 `searchStructured.sources`（DB 结果），完全忽略了 `searchKnowledge.results`（RAG 结果）。

### 修复

从 `toolResults` 中同时提取两处来源：

```ts
// RAG 来源：searchKnowledge.results → extractSourceReferences
const searchKnowledgeResult = toolResults.find(tr => tr.toolName === "searchKnowledge");
if (Array.isArray(searchKnowledgeResult.output?.results)) {
  const ragRefs = extractSourceReferences(searchKnowledgeResult.output.results);
  for (const ref of ragRefs) allSources.push({ title: ref.title, url: ref.url, type: ref.type });
}

// DB 来源：searchStructured.sources（原有逻辑）
for (const { toolName, output } of toolResults) {
  if (toolName === "searchStructured" && o._debug === "structured_with_sources" && Array.isArray(o.sources)) {
    for (const src of o.sources) allSources.push({ ... });
  }
}
```

---

## 五、预测性缓存预热策略

### 逻辑

```ts
// auto 模式浅层查询时，异步预热 searchKnowledge 结果
if (mode === "auto" && shouldSpeculate(message)) {
  const ragPromise = retrieveContext(message, { limit: 5, userId });
  ragPromise.then(context => {
    if (context.results.length > 0) {
      speculationCache.set(conversationId, message, context);
    }
  });
}
```

### 意图预测规则（`shouldSpeculate`）

触发预热：工单号（`工单 #123`）、项目名（`项目的XXX`）、用户名（`问张三`）

不触发：进度/统计类、web 搜索模式

### 踩坑

- `speculationCache` 在 `searchKnowledge.execute()` 内部被动查缓存，但从未主动预热
- 现在 Agnes 路径主动预热后，LangGraph 路径的 `searchKnowledge` 工具可命中缓存加速

---

## 六、其他优化

### Agnes 路径工具集动态切换

```ts
if (autoNeedsWeb) {
  resolvedTools = { webSearch, searchStructured };
  resolvedMaxSteps = 15;
} else if (mode === "auto") {
  resolvedTools = { searchStructured, searchKnowledge }; // searchStructured 优先
  resolvedMaxSteps = 20;
}
```

### 前端城市名传递

`AiChatPanel` 在 `auto`/`web` 模式下获取客户端城市，通过 `clientCity` 参数传给后端，用于天气等实时数据搜索。

---

## 测试验证

```bash
# 1. 浅层查询 → 应走 searchStructured（DB）
"许敏捷最近在干嘛" → searchStructured → 快查

# 2. 深层内容 → 应走 searchKnowledge（RAG）
"了解光污染设计需求文档的详细内容" → searchKnowledge → 检索笔记片段

# 3. 强制搜索 → 始终走 RAG
search 模式下任意问题 → searchKnowledge

# 4. 来源显示
LangGraph 路径检索到笔记后，左下角"参考来源"卡片应正常显示可跳转链接
```

---

## Commit 信息

```
#10144 AI路由重构 & 意图检测 & 来源组件化

- 修正 auto 模式路由：浅层查询→searchStructured，深层内容→searchKnowledge
- 重写 shouldUseRag：文档/笔记/详情触发 RAG，工单号/统计/vcs 走 DB
- 修复 Agnes 路径漏判：auto 模式现在正确调用 shouldUseRag 检测
- 修复 LangGraph 来源提取：同时提取 searchKnowledge.results 和 searchStructured.sources
- 新增 AiSourcesList 组件：来源引用 UI 独立，打字完成后才渲染避免闪烁
- 优化预测性缓存：auto 浅层查询时异步预热 searchKnowledge
- 动态工具集切换：autoNeedsWeb 时优先注入 webSearch
- 前端传递 clientCity：用于天气等实时数据搜索
```
