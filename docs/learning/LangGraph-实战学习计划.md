# LangGraph 实战学习计划

> **适用对象**：前端工程师，AI 原生开发者，靠 AI 写代码，ProjectHub 项目实战
> **目标**：通过重构自己的 AI 对话系统，深入理解 LangGraph 核心概念
> **原则**：不背代码、不刷教程、在实战中理解
> **更新日期**：2026-07-29

---

## 背景：为什么现在学（已更新：2026-07-29）

你已经完成了：

- ✅ AI Agent 对话系统（`features/ai/`）
- ✅ Agnes Tool Calling 接入
- ✅ SSE 流式响应 + 打字机效果
- ✅ 用户画像 + 预缓存优化
- ✅ **LangGraph StateGraph 状态机重构（2026-07-29）**

你的代码里已经有：
- `detector.ts` — 判断用哪个模式
- `features/ai/graph/` — **LangGraph StateGraph 状态机**
- `features/ai/graph/nodes/` — **7 个节点实现**
- `features/ai/graph/edges/routing.ts` — **7 个路由函数**
- `features/ai/graph/nodes/human-confirmation.ts` — **HIL 消歧节点**

**你已经用 LangGraph 重构了 AI 对话系统**，现在需要深入理解状态机原理 + 执行测试用例。

---

## 学习路线图

```
Week 1：理解核心概念（不写代码）
┌─────────────────────────────────────────────────────────┐
│ Day 1-2   →  状态机是什么（用公司审批流程类比）        │
│ Day 3-4   →  StateGraph 三要素（状态、节点、边）        │
│ Day 5     →  对照你的 detector.ts 画状态流转图          │
│ Day 6-7   →  对照你的 tools/index.ts 理解节点分工      │
└─────────────────────────────────────────────────────────┘
           ↓
Week 2：用 LangGraph 重构你的 AI 对话（实战）
┌─────────────────────────────────────────────────────────┐
│ Day 8-9   →  把 detector.ts → StateGraph 状态定义       │
│ Day 10-11 →  把 tools/index.ts → 节点 + 边             │
│ Day 12    →  对接 SSE 流式输出                         │
│ Day 13-14 →  调试 + 验证 + 踩坑记录                    │
└─────────────────────────────────────────────────────────┘
```

---

## Week 1：理解核心概念

### Day 1-2：状态机是什么

#### 你要理解的核心问题

**"什么是状态机？为什么你的 AI 对话需要状态机？"**

#### 日常类比：公司审批流程

想象你提交一个请假申请：

```
你（提交申请）
    ↓
直属领导（审批）
    ↓
    ├─ 同意 → 人事（审批）
    │           ↓
    │          同意 → 归档（结束）
    │           ↓
    │          拒绝 → 打回（结束）
    │
    └─ 拒绝 → 打回（结束）
```

**关键点**：
- 每个"审批节点"只做一件事
- "边"决定下一步去哪
- 有"条件"（同意/拒绝）
- 最终有"结束状态"

#### 对应你的 AI 对话系统

```
detector.ts（判断模式）
    ↓
    ├─ search 模式 → 用 searchKnowledge + searchStructured
    │               ↓
    │              生成回答（结束）
    │
    ├─ chat 模式 → 直接生成回答（结束）
    │
    └─ web 模式 → 用 webSearch + searchStructured
                  ↓
                 生成回答（结束）
```

**这就是一个状态机！** 只不过现在是用 `if-else` 写的。

#### 学习任务

- [ ] 打开 `features/ai/tools/index.ts`，看 `POLICIES` 对象
- [ ] 对照上面的流程图，标注哪个是"状态"，哪个是"节点"，哪个是"边"
- [ ] 问自己："如果用状态机重写，这个 if-else 会变成什么？"

---

### Day 3-4：StateGraph 三要素

#### 状态（State）

**类比**：审批流程里的"申请表"

```typescript
// 你的 AI 对话状态
interface AIState {
  messages: Message[];           // 对话历史
  currentMode: "auto" | "search" | "chat" | "web";
  toolCalls: ToolCall[];         // 已调用的工具
  searchResults: SearchResult[];   // 检索结果
}
```

**你的理解**：State 就是"全局变量"，每个节点都可以读写。

#### 节点（Node）

**类比**：审批流程里的"每个审批部门"

```typescript
// 你的 AI 对话节点
const nodes = {
  // 节点1：检测用户意图
  detectIntent: () => { /* 读 detector.ts 的逻辑 */ },
  
  // 节点2：检索知识库
  searchKnowledge: () => { /* 调 searchKnowledge 工具 */ },
  
  // 节点3：检索结构化数据
  searchStructured: () => { /* 调 searchStructured 工具 */ },
  
  // 节点4：联网搜索
  webSearch: () => { /* 调 webSearch 工具 */ },
  
  // 节点5：生成回答
  generateResponse: () => { /* 调 LLM 生成 */ },
};
```

**你的理解**：节点就是"函数"，每个函数做一件事。

#### 边（Edge）

**类比**：审批流程里的"部门间的流转规则"

```typescript
// 你的 AI 对话边
const edges = {
  // 从检测节点出发，根据模式选择边
  detectIntent: (state) => {
    if (state.currentMode === "search") return "searchKnowledge";
    if (state.currentMode === "chat") return "generateResponse";
    if (state.currentMode === "web") return "webSearch";
    return "searchKnowledge"; // auto 默认
  },
  
  // 从知识检索节点出发，永远去生成回答
  searchKnowledge: () => "generateResponse",
  
  // 从联网搜索节点出发，永远去生成回答
  webSearch: () => "generateResponse",
  
  // 结束
  generateResponse: () => END,
};
```

**你的理解**：边就是"函数返回下一个节点名"，可以是固定的，也可以是条件的。

#### 对照你的代码

| 你的代码 | LangGraph 概念 | 位置 |
|----------|----------------|------|
| `detector.ts` | `detectIntent` 节点 | `features/ai/lib/detector.ts` |
| `POLICIES` | 边路由规则 | `features/ai/tools/index.ts:29` |
| `toolsetForMode()` | 工具分发 | `features/ai/tools/index.ts:43` |
| `maxStepsForMode()` | 边上的条件 | `features/ai/tools/index.ts:51` |

---

### Day 5：画状态流转图

#### 任务

用白纸或 Excalidraw 画你的 AI 对话状态流转图：

```
                    ┌──────────────┐
                    │   START      │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ detectIntent │ ← 对应 detector.ts
                    └──────┬───────┘
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │  search  │  │   chat   │  │   web    │
     │  mode    │  │   mode   │  │   mode   │
     └────┬─────┘  └────┬─────┘  └────┬─────┘
          │              │              │
          ▼              ▼              ▼
   ┌──────────┐   ┌──────────┐  ┌──────────┐
   │searchKnow│   │ generate │  │webSearch │
   │ -ledge   │   │ Response │  └────┬─────┘
   └────┬─────┘   └────┬─────┘       │
         │              │              ▼
         ▼              │       ┌──────────┐
   ┌──────────┐         │       │ generate │
   │searchStru│         │       │ Response │
   │ -ctured  │         │       └────┬─────┘
   └────┬─────┘         │            │
         │              │            │
         └──────────────┴────────────┘
                          │
                          ▼
                   ┌──────────┐
                   │   END    │
                   └──────────┘
```

#### 检查清单

- [ ] 每个节点对应一个具体操作
- [ ] 每条边有明确的触发条件
- [ ] 你的 `detector.ts` 逻辑对应哪个节点？
- [ ] 你的 `tools/index.ts` 中的 `POLICIES` 对应哪些边？

---

### Day 6-7：理解节点分工

#### 你的工具对应的节点

| 工具 | 节点 | 做的事 |
|------|------|--------|
| `searchKnowledge` | `searchKnowledge` | 调用 RAG 检索 |
| `searchStructured` | `searchStructured` | 调用 Prisma 查数据库 |
| `webSearch` | `webSearch` | 调用 Tavily 联网 |
| — | `generateResponse` | 调用 LLM 生成回答 |

#### 关键理解

**LangGraph 的节点职责单一原则**：
- 一个节点只做一件事
- 节点之间通过 State 传递数据
- 边决定"数据流"而不是"谁做什么"

**对比你现在的写法**：
- `streamText()` + `stopWhen: stepCountIs(N)` 是隐式的状态流转
- LangGraph 是显式的状态流转

---

## Week 2：用 LangGraph 重构实战

### Day 8-9：把 detector.ts → StateGraph

#### 你的起点

`features/ai/lib/detector.ts`：

```typescript
export function shouldUseRag(
  message: string,
  forceMode?: "search" | "chat"
): boolean {
  if (forceMode === "search") return true;
  if (forceMode === "chat") return false;
  return containsSearchKeywords(message);
}
```

#### 转换为 StateGraph

```typescript
// 状态定义
interface AIState {
  messages: Message[];
  currentMode: "auto" | "search" | "chat" | "web";
  detectedIntent: "search" | "chat" | "web" | null;
}

// 节点：检测意图
function detectIntent(state: AIState): AIState {
  const message = state.messages[state.messages.length - 1].content;
  
  if (shouldUseRag(message, state.messages[0].forceMode)) {
    return { ...state, detectedIntent: "search", currentMode: "search" };
  }
  if (shouldUseRag(message)) {
    return { ...state, detectedIntent: "search", currentMode: "auto" };
  }
  return { ...state, detectedIntent: "chat", currentMode: "chat" };
}

// 边路由
function routeBasedOnIntent(state: AIState): string {
  if (state.detectedIntent === "chat") return "generateResponse";
  if (state.detectedIntent === "web") return "webSearch";
  return "searchKnowledge";
}
```

#### 学习任务

- [ ] 打开你的 `detector.ts`，找到 `containsSearchKeywords` 函数
- [ ] 用上面的模板改写（不运行，只改写）
- [ ] 问自己："这个改写后，逻辑变了吗？"

---

### Day 10-11：把 tools/index.ts → 节点 + 边

#### 你的起点

`features/ai/tools/index.ts`：

```typescript
const POLICIES: Record<ToolMode, ModePolicy> = {
  auto:   { tools: { searchStructured, searchKnowledge }, maxSteps: 20 },
  search: { tools: { searchKnowledge, searchStructured }, maxSteps: 25 },
  chat:   { tools: {},                                    maxSteps: 3 },
  web:    { tools: { webSearch, searchStructured },       maxSteps: 15 },
};
```

#### 转换为 LangGraph

```typescript
import { StateGraph } from "@langchain/langgraph";

// 定义图
const workflow = new StateGraph(AIState)
  // 添加节点
  .addNode("detectIntent", detectIntent)
  .addNode("searchKnowledge", searchKnowledgeNode)
  .addNode("searchStructured", searchStructuredNode)
  .addNode("webSearch", webSearchNode)
  .addNode("generateResponse", generateResponseNode)
  // 添加边
  .addEdge("__start__", "detectIntent")
  .addConditionalEdges("detectIntent", routeBasedOnIntent)
  .addEdge("searchKnowledge", "searchStructured")
  .addEdge("searchStructured", "generateResponse")
  .addEdge("webSearch", "generateResponse")
  .addEdge("generateResponse", "__end__")
  .compile();
```

#### 学习任务

- [ ] 对照 `POLICIES` 里的 `maxSteps`，找到 LangGraph 里对应的写法
- [ ] 问自己："`maxSteps` 在 LangGraph 里怎么实现？"
- [ ] 提示：`langgraph` 的 `interrupt` 可以实现类似的效果

---

### Day 12：对接 SSE 流式输出

#### 你的起点

`app/api/ai/conversations/[id]/messages/route.ts` 里的 SSE 流式输出

#### LangGraph 的流式

```typescript
// 使用 stream_mode="messages" 获取 token 级流式
const stream = await workflow.astream(
  { messages: [{ role: "user", content: userMessage }] },
  { streamMode: "messages" }
);

for await (const [chunk, metadata] of stream) {
  controller.enqueue(chunk);  // SSE 输出
}
```

#### 学习任务

- [ ] 打开 `messages/route.ts`，找到 SSE 相关的代码
- [ ] 对照 `ReadableStream` 的写法，理解 LangGraph 的 `astream` 怎么对接

---

### Day 13-14：调试 + 验证 + 踩坑

#### 必做验证清单

- [ ] 类型检查：`npx tsc --noEmit`
- [ ] 开发服务器：`npm run dev`
- [ ] 功能测试：
  - [ ] 问一个 search 模式的问题（"帮我找 #10156"）
  - [ ] 问一个 chat 模式的问题（"今天天气怎么样"）
  - [ ] 问一个 web 模式的问题（"最新 AI 新闻"）
- [ ] 对比重构前后的响应时间

#### 踩坑记录模板

```markdown
### 坑 N：[标题]

**现象**：

**原因**：

**解法**：
```

---

## 学习资源

### 必读文档

| 文档 | 对应 Day | 链接 |
|------|----------|------|
| LangGraph 快速入门 | Day 1-2 | `.agents/skills/dive-into-langgraph/references/1.quickstart.md` |
| 状态图 | Day 3-4 | `.agents/skills/dive-into-langgraph/references/2.stategraph.md` |
| 中间件 | Day 6-7 | `.agents/skills/dive-into-langgraph/references/3.middleware.md` |
| 人机交互 | Day 10-11 | `.agents/skills/dive-into-langgraph/references/4.human_in_the_loop.md` |

### 你的代码对照表

| LangGraph 概念 | 你的代码位置 | 对应实现 |
|----------------|-------------|---------|
| 状态定义 | `features/ai/lib/types.ts` | `AIState` |
| 意图检测 | `features/ai/lib/detector.ts` | `shouldUseRag()` |
| 工具分发 | `features/ai/tools/index.ts` | `toolsetForMode()` |
| 流式输出 | `app/api/ai/conversations/[id]/messages/route.ts` | `ReadableStream` |

---

## 里程碑检查

### Week 1 结束

- [ ] 能用自己的话解释"什么是状态机"
- [ ] 能在纸上画出你的 AI 对话状态流转图
- [ ] 能说出 `detector.ts` 里的逻辑对应 StateGraph 的哪个部分

### Week 2 结束

- [ ] 用 LangGraph 重写了 `detector.ts` 的逻辑
- [ ] 用 LangGraph 重写了 `tools/index.ts` 的工具分发
- [ ] SSE 流式输出正常
- [ ] 所有功能测试通过
- [ ] 记录了至少 3 个踩坑

---

## 常见问题

### Q：要不要先学 LangChain.js？

**A：不需要。** LangGraph 是概念，LangChain.js 是实现。你已经有 AI SDK 的基础，理解 LangGraph 不需要 LangChain.js。

### Q：TypeScript 类型看不懂怎么办？

**A：问 AI。** 把报错贴给 Cursor，说"帮我解释这个类型错误"，然后说"这个错误在说什么，我应该怎么改"。

### Q：学完就忘怎么办？

**A：正常。** 你的目标是"能看懂 AI 输出的代码"，不是"能自己写出来"。学完后，把这份文档和你的代码对照着看就行。

### Q：遇到卡点怎么办？

**A：先跳。** 如果一个概念卡住超过 30 分钟，跳过去继续。回头再看，可能就懂了。

---

## 附录：LangGraph 术语对照

| 术语 | 你的理解 |
|------|---------|
| `StateGraph` | 定义状态和节点的关系 |
| `State` | 全局状态对象 |
| `Node` | 节点 = 函数 |
| `Edge` | 边 = 函数返回下一个节点名 |
| `addConditionalEdges` | 条件边 = if-else |
| `END` | 结束状态 |
| `compile()` | 把图编译成可执行的对象 |
| `invoke()` | 同步执行 |
| `astream()` | 异步流式执行 |

---

> **记住**：慢即是快。每个概念理解透彻比囫囵吞枣重要得多。
