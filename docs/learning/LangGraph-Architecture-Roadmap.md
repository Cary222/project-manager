# LangGraph 架构演进路线图

> **项目**：ProjectHub AI Agent 系统
> **目标**：从单 Agent 演进为多 Agent 智能体编排系统
> **日期**：2026-07-17
> **依赖**：[LangGraph 实战学习计划](docs/learning/LangGraph-实战学习计划.md)

---

## 一、现状分析

### 1.1 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户消息                              │
│                            │                                │
│                            ▼                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Vercel AI SDK                           │  │
│  │                                                      │  │
│  │  detector.ts ──▶ 模式判断                           │  │
│  │       │                                              │  │
│  │       ├── search ──▶ searchKnowledge + searchStruct │  │
│  │       ├── web ────▶ webSearch + searchStruct       │  │
│  │       └── chat ────▶ 无工具                           │  │
│  │                                                      │  │
│  │  模型自动决定调用哪个工具                              │  │
│  │  SDK 自动处理循环                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                            │                                │
│                            ▼                                │
│                        用户回答                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 当前痛点

| 痛点 | 说明 |
|------|------|
| **黑盒调试** | 模型决定调用什么工具，你无法精确控制 |
| **单点决策** | 所有逻辑都在一个模型里，复杂任务容易出错 |
| **不可追溯** | 不知道为什么会走这条路 |
| **人工无法介入** | 模型自己跑完，用户只能等结果 |
| **工具调用混乱** | 多个工具同时可用时，模型可能选错 |

### 1.3 你的需求

```
☐ 需要可视化流程（LangGraph Studio）
☐ 需要人工介入节点（暂停等用户确认）
☐ 需要多 Agent 协作（规划 Agent + 执行 Agent）
☐ 经常需要调试"为什么走这条路"
```

**结论**：必须演进到 LangGraph 多 Agent 架构。

---

## 二、目标架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│                           Supervisor Agent                                    │
│                                                                              │
│   职责：                                                                     │
│   1. 理解用户意图（Plan）                                                   │
│   2. 分解任务（Task Decomposition）                                         │
│   3. 分发给子 Agent                                                        │
│   4. 汇总结果（Synthesize）                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
    ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
    │ Research Agent  │     │ Database Agent  │     │   Human Review  │
    │                 │     │                 │     │                 │
    │ 联网搜索         │     │ 查工单/项目     │     │ 暂停等用户确认   │
    │ 查文档           │     │ 查用户数据       │     │ 补充信息         │
    │ 查最新资讯       │     │ 查统计数据       │     │ 审批决策         │
    └─────────────────┘     └─────────────────┘     └─────────────────┘
              │                       │                       │
              └───────────────────────┼───────────────────────┘
                                      │
                                      ▼
                            ┌─────────────────┐
                            │  Summarize Agent│
                            │                 │
                            │ 汇总子 Agent 结果 │
                            │ 生成最终回答      │
                            └─────────────────┘
                                      │
                                      ▼
                               ┌─────────────┐
                               │    END      │
                               └─────────────┘
```

### 2.2 文件结构

```
features/ai/
├── graph/                              # LangGraph 核心
│   ├── state.ts                        # 全局状态定义
│   ├── supervisor.ts                   # 主编排器（Plan → Dispatch）
│   │
│   ├── nodes/                          # 节点
│   │   ├── intent-detection.ts         # 意图检测（入口）
│   │   ├── research-agent.ts           # Research Agent
│   │   ├── database-agent.ts           # Database Agent
│   │   ├── human-review.ts             # 人工介入节点
│   │   └── summarize.ts                # 汇总节点
│   │
│   ├── edges/                          # 边
│   │   ├── routing.ts                  # 路由逻辑
│   │   └── conditional.ts              # 条件边
│   │
│   ├── tools/                          # 工具
│   │   ├── web-search.ts
│   │   ├── knowledge-search.ts
│   │   └── structured-search.ts
│   │
│   └── prompts/                        # Agent 提示词
│       ├── supervisor-system.md
│       ├── research-system.md
│       ├── database-system.md
│       └── summarize-system.md
│
├── legacy/                             # 旧代码（保留）
│   ├── tools/
│   └── lib/
│       └── detector.ts
│
└── agents/                             # Agent 配置
    └── config.ts
```

---

## 三、演进阶段

### 阶段 0：学习准备（Week 1）

**目标**：理解 LangGraph 核心概念，不写代码

```
┌─────────────────────────────────────────────────────────┐
│ Day 1-2   →  状态机是什么（用公司审批流程类比）        │
│ Day 3-4   →  StateGraph 三要素（状态、节点、边）        │
│ Day 5     →  对照你的 detector.ts 画状态流转图          │
│ Day 6-7   →  对照你的 tools/index.ts 理解节点分工      │
└─────────────────────────────────────────────────────────┘
```

**产出**：
- [ ] 能用自己的话解释"什么是状态机"
- [ ] 能在纸上画出 AI 对话状态流转图
- [ ] 能说出 `detector.ts` 里的逻辑对应 StateGraph 的哪个部分

---

### 阶段 1：最小化 LangGraph 改造（Week 2）

**目标**：保留现有工具链，加一层状态机控制

**文件变更**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `graph/state.ts` | 新增 | 状态定义 |
| `graph/nodes/detect-intent.ts` | 新增 | 迁移 detector.ts |
| `graph/edges/routing.ts` | 新增 | 路由逻辑 |
| `graph/agent.ts` | 新增 | 组装 StateGraph |
| `features/ai/index.ts` | 修改 | 新增 LangGraph 入口 |

**状态定义**：

```typescript
// graph/state.ts
import { BaseMessage } from "@langchain/core/messages";
import { AIMessage } from "@langchain/core/messages";

interface AgentState {
  messages: BaseMessage[];
  mode: "auto" | "search" | "chat" | "web";
  searchResults?: string[];
  response?: string;
}
```

**节点迁移**：

```typescript
// graph/nodes/detect-intent.ts
import { AgentState } from "../state";

const SEARCH_KEYWORDS = [
  { pattern: /(?:工单|ticket)\s*[#：:]\s*\d+/i, category: "project_id" },
  { pattern: /(?:帮我)?(?:找|查|搜|检索)\b/i, category: "search_action" },
  { pattern: /(?:进度|完成率|统计|汇总)/i, category: "statistics" },
  // ... 其他关键词
];

export function detectIntent(state: AgentState): Partial<AgentState> {
  const lastMessage = state.messages[state.messages.length - 1].content as string;
  const hasKeywords = SEARCH_KEYWORDS.some(({ pattern }) => pattern.test(lastMessage));

  return {
    mode: hasKeywords ? "search" : "chat"
  };
}
```

**路由边**：

```typescript
// graph/edges/routing.ts
import { AgentState } from "../state";

type NextNode = "searchKnowledge" | "webSearch" | "generateResponse" | "__end__";

export function routeByMode(state: AgentState): NextNode {
  switch (state.mode) {
    case "search":
    case "auto":
      return "searchKnowledge";
    case "web":
      return "webSearch";
    case "chat":
    default:
      return "generateResponse";
  }
}
```

**组装图**：

```typescript
// graph/agent.ts
import { StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import { detectIntent } from "./nodes/detect-intent";
import { searchKnowledge } from "./nodes/search-knowledge";
import { webSearch } from "./nodes/web-search";
import { generateResponse } from "./nodes/generate-response";
import { routeByMode } from "./edges/routing";

const workflow = new StateGraph(AgentState)
  .addNode("detectIntent", detectIntent)
  .addNode("searchKnowledge", searchKnowledge)
  .addNode("webSearch", webSearch)
  .addNode("generateResponse", generateResponse)
  .setEntryPoint("detectIntent")
  .addConditionalEdges("detectIntent", routeByMode)
  .addEdge("searchKnowledge", "generateResponse")
  .addEdge("webSearch", "generateResponse")
  .addEdge("generateResponse", "__end__")
  .compile();

export { workflow };
```

**入口切换**：

```typescript
// features/ai/index.ts
export async function chat(message: string, options?: ChatOptions) {
  // 开关：使用新架构还是旧架构
  if (process.env.USE_LANGGRAPH === "true") {
    return langGraphChat(message, options);
  }
  return legacyChat(message, options);
}
```

**验证清单**：

- [ ] 类型检查：`npx tsc --noEmit`
- [ ] 开发服务器：`npm run dev`
- [ ] 功能测试：
  - [ ] 问 search 模式（"帮我找 #10156"）
  - [ ] 问 chat 模式（"今天天气"）
  - [ ] 问 web 模式（"最新 AI 新闻"）

---

### 阶段 2：引入 ReAct 模式（Week 3）

**目标**：每个 Agent 内部用 ReAct 循环思考

**ReAct 是什么**：

```
Thought：我需要查最新的 API 文档
Action：webSearch("LangGraph API docs")
Observation：找到 3 个相关结果
Thought：结果不够详细，需要看官方教程
Action：webSearch("LangGraph tutorial")
...（循环直到足够）
Response：[总结结果]
```

**Research Agent（带 ReAct）**：

```typescript
// graph/nodes/research-agent.ts
import { AgentState } from "../state";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

const tavily = new TavilySearchResults({ apiKey: process.env.TAVILY_API_KEY });

const SYSTEM_PROMPT = `你是一个研究助手，使用 ReAct 模式思考。

每次思考格式：
Thought: 我需要做什么
Action: 调用什么工具（web_search / knowledge_search）
Action Input: 搜索内容
Observation: 工具返回结果
...（重复直到足够）
Response: 最终结论
`;

export async function researchAgent(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1].content as string;

  const chain = RunnableSequence.from([
    // 1. 生成 Thought + Action
    llm.with_structured_output(ReActSchema),
    // 2. 执行 Action
    executeTool,
    // 3. 把结果加回消息
    addToMessages,
  ]);

  // 循环直到 Response
  let currentState = state;
  for (let i = 0; i < 5; i++) {
    const result = await chain.invoke(currentState.messages);
    if (result.response) {
      return { researchResult: result.response };
    }
    currentState = { ...currentState, messages: [...currentState.messages, result] };
  }

  return { researchResult: "研究完成，但结果有限" };
}
```

**Database Agent（带 ReAct）**：

```typescript
// graph/nodes/database-agent.ts
const SYSTEM_PROMPT = `你是一个数据库助手，使用 ReAct 模式思考。

可用的工具：
- searchStructured: 查工单、项目、用户
- searchKnowledge: 查知识库

每次思考格式：
Thought: 我需要查什么数据
Action: searchStructured 或 searchKnowledge
Action Input: 查询条件
Observation: 返回结果
...（重复直到足够）
Response: 数据总结
`;
```

**验证清单**：

- [ ] Research Agent 能联网搜索并总结
- [ ] Database Agent 能查工单数据
- [ ] ReAct 循环不超过 5 次

---

### 阶段 3：Human-in-the-Loop（Week 4）

**目标**：关键节点暂停等用户确认

**应用场景**：

| 场景 | 说明 |
|------|------|
| 高风险操作 | 删除工单、修改权限 |
| 意图不明 | AI 无法确定用户真实意图 |
| 需要补充 | 用户说的不完整，需要更多信息 |

**Human Review 节点**：

```typescript
// graph/nodes/human-review.ts
import { AgentState } from "../state";

interface HumanReviewState extends AgentState {
  pendingQuestion?: string;    // 等待用户回答的问题
  waitingForUser: boolean;    // 是否在等待用户
  userInput?: string;         // 用户回复
}

export function humanReview(state: HumanReviewState): Partial<HumanReviewState> {
  // 检测是否需要人工介入
  const lastMessage = state.messages[state.messages.length - 1].content as string;

  const needsHumanReview = detectHighRisk(lastMessage) ||
    detectAmbiguousIntent(lastMessage) ||
    detectMissingInfo(lastMessage);

  if (needsHumanReview) {
    return {
      waitingForUser: true,
      pendingQuestion: generateQuestion(lastMessage),
    };
  }

  return { waitingForUser: false };
}

// 高风险检测
function detectHighRisk(message: string): boolean {
  const patterns = [
    /删除.*工单/i,
    /修改.*权限/i,
    /取消.*项目/i,
  ];
  return patterns.some(p => p.test(message));
}

// 意图不明检测
function detectAmbiguousIntent(message: string): boolean {
  const unclearPatterns = [
    /随便/i,
    /不知道/i,
    /都行/i,
    /你看着办/i,
  ];
  return unclearPatterns.some(p => p.test(message));
}

// 信息缺失检测
function detectMissingInfo(message: string): boolean {
  const hasTicketNo = /工单\s*[#：:]\s*\d+/i.test(message);
  const hasProjectName = /项目.*名称/i.test(message);
  return !hasTicketNo && !hasProjectName;
}
```

**边路由（带中断）**：

```typescript
// graph/edges/human-loop.ts
import { interrupt } from "@langchain/langgraph";

export function routeAfterHumanReview(state: HumanReviewState): string {
  if (state.waitingForUser) {
    // 暂停，等待用户输入
    interrupt("awaiting_user_input");
  }

  if (state.userInput) {
    // 用户已回复，继续
    return "supervisor";
  }

  return "human_review";
}
```

**前端对接**：

```typescript
// app/api/ai/chat/route.ts
export async function POST(req: Request) {
  const stream = await workflow.astream(input, {
    configurable: {
      thread_id: sessionId,
    },
  });

  for await (const event of stream) {
    if (event.event === "interrupt") {
      // 发送暂停信号给前端
      controller.enqueue(JSON.stringify({
        type: "human_review",
        question: event.value.pendingQuestion,
        awaiting: true,
      }));
      // 等待用户回复
      const userReply = await waitForUserInput(sessionId);
      // 注入用户回复
      await workflow.updateState(config, {
        userInput: userReply,
        waitingForUser: false,
      });
    }
  }
}
```

**验证清单**：

- [ ] 高风险操作触发人工确认
- [ ] 意图不明时 AI 提问，用户回复后继续
- [ ] 前端能正确显示等待状态

---

### 阶段 4：多 Agent 协作（Week 5-6）

**目标**：Supervisor 编排多个子 Agent

**Supervisor 职责**：

```
1. Plan：理解用户意图，分解任务
2. Dispatch：分配任务给合适的 Agent
3. Monitor：跟踪每个 Agent 的进度
4. Synthesize：汇总结果，生成最终回答
```

**Supervisor 实现**：

```typescript
// graph/supervisor.ts
import { z } from "zod";
import { AgentState } from "./state";

const Member = z.enum(["research", "database", "human", "FINISH"]);
type Member = z.infer<typeof Member>;

const MEMBER_OPTIONS = ["research", "database", "human", "FINISH"];

const SYSTEM_PROMPT = `你是项目经理智能体（Supervisor），负责协调团队完成用户任务。

团队成员：
- research: 负责联网搜索、查文档、查最新资讯
- database: 负责查工单、项目、用户等结构化数据
- human: 需要人工介入时使用
- FINISH: 任务完成

工作流程：
1. 理解用户意图
2. 决定调用哪个成员（一次一个）
3. 等结果返回
4. 决定下一步或结束

每次只调用一个成员，用 JSON 格式回复：
{"next": "member_name", "reason": "为什么选择这个成员"}
`;

export async function supervisor(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1].content as string;

  // 调用 Supervisor LLM
  const response = await llm.invoke([
    SystemMessage(SYSTEM_PROMPT),
    HumanMessage(`用户请求：${lastMessage}`),
    HumanMessage(`团队成员：${MEMBER_OPTIONS.join(", ")}`),
    HumanMessage(`决定下一步：{"next": "...", "reason": "..."}`),
  ]);

  const decision = JSON.parse(response.content as string);
  return {
    nextSpeaker: decision.next as Member,
    reason: decision.reason,
  };
}
```

**路由边**：

```typescript
// graph/edges/supervisor-routing.ts
import { AgentState } from "../state";

export function routeBySupervisor(state: AgentState): string {
  const { nextSpeaker } = state;

  switch (nextSpeaker) {
    case "research":
      return "research_agent";
    case "database":
      return "database_agent";
    case "human":
      return "human_review";
    case "FINISH":
      return "__end__";
    default:
      return "supervisor";
  }
}
```

**完整图结构**：

```typescript
// graph/agent.ts
const workflow = new StateGraph(AgentState)
  // 节点
  .addNode("supervisor", supervisor)
  .addNode("research_agent", researchAgent)
  .addNode("database_agent", databaseAgent)
  .addNode("human_review", humanReview)
  .addNode("synthesize", synthesizeAgent)
  // 边
  .setEntryPoint("supervisor")
  .addConditionalEdges("supervisor", routeBySupervisor)
  .addEdge("research_agent", "synthesize")
  .addEdge("database_agent", "synthesize")
  .addEdge("human_review", "supervisor")  // 人回复后回到 supervisor
  .addEdge("synthesize", "__end__")
  .compile();

export { workflow };
```

**验证清单**：

- [ ] Supervisor 能正确理解用户意图
- [ ] 任务正确分发给对应 Agent
- [ ] Agent 结果正确汇总

---

### 阶段 5：持久化与可视化（Week 7+）

**目标**：状态持久化 + LangGraph Studio 可视化

**状态持久化**：

```typescript
// graph/persistence.ts
import { MemoryStoreer, SqliteSaver } from "@langchain/langgraph/checkpoint";

const checkpointer = new MemoryStoreer();
// 生产环境用：
// const checkpointer = new SqliteSaver.fromConnString("./data/checkpoints.db");

const workflow = new StateGraph(AgentState)
  // ...
  .compile({ checkpointer });

// 恢复会话
export async function resumeConversation(threadId: string) {
  const config = { configurable: { thread_id: threadId } };
  return await workflow.getState(config);
}
```

**LangGraph Studio（未来）**：

```
┌─────────────────────────────────────────────────────────────┐
│                    LangGraph Studio                        │
│                                                             │
│   ┌─────────┐                                             │
│   │START    │                                             │
│   └────┬────┘                                             │
│        │                                                  │
│        ▼                                                  │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│   │ Supervisor  │───▶│ Research    │───▶│ Synthesize  │  │
│   └─────────────┘    └─────────────┘    └─────────────┘  │
│        │                   ▲                               │
│        ▼                   │                               │
│   ┌─────────────┐         │                               │
│   │ Database    │─────────┘                               │
│   └─────────────┘                                         │
│        │                                                  │
│        ▼                                                  │
│   ┌─────────────┐                                         │
│   │ Human Review│◀── 用户输入                            │
│   └─────────────┘                                         │
│                                                             │
│   [播放] [暂停] [单步] [重置]                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 四、学习路径（完整版）

```
Week 1：理解核心概念（不写代码）
┌─────────────────────────────────────────────────────────┐
│ Day 1-2   →  状态机是什么（用公司审批流程类比）        │
│ Day 3-4   →  StateGraph 三要素（状态、节点、边）        │
│ Day 5     →  对照你的 detector.ts 画状态流转图          │
│ Day 6-7   →  对照你的 tools/index.ts 理解节点分工      │
└─────────────────────────────────────────────────────────┘
           ↓
Week 2：最小化 LangGraph 改造
┌─────────────────────────────────────────────────────────┐
│ Day 8-9   →  把 detector.ts → StateGraph 状态定义       │
│ Day 10-11 →  把 tools/index.ts → 节点 + 边             │
│ Day 12    →  对接 SSE 流式输出                         │
│ Day 13-14 →  调试 + 验证 + 踩坑记录                    │
└─────────────────────────────────────────────────────────┘
           ↓
Week 3：引入 ReAct 模式
┌─────────────────────────────────────────────────────────┐
│ Day 15-16 →  ReAct 循环原理理解                         │
│ Day 17-18 →  Research Agent 实现                       │
│ Day 19-20 →  Database Agent 实现                       │
│ Day 21    →  调试 + 验证                               │
└─────────────────────────────────────────────────────────┘
           ↓
Week 4：Human-in-the-Loop
┌─────────────────────────────────────────────────────────┐
│ Day 22-23 →  Human Review 节点原理                     │
│ Day 24-25 →  前端对接（暂停/恢复）                     │
│ Day 26-27 →  高风险检测 + 意图不明检测                 │
│ Day 28    →  调试 + 验证                               │
└─────────────────────────────────────────────────────────┘
           ↓
Week 5-6：多 Agent 协作
┌─────────────────────────────────────────────────────────┐
│ Day 29-31 →  Supervisor 实现                          │
│ Day 32-33 →  任务分解 + 分发逻辑                       │
│ Day 34-35 →  Synthesize Agent 实现                     │
│ Day 36-38 →  端到端测试                                │
│ Day 39-40 →  调试 + 验证                               │
└─────────────────────────────────────────────────────────┘
           ↓
Week 7+：持久化与可视化
┌─────────────────────────────────────────────────────────┐
│ Day 41-42 →  Checkpointer 持久化                       │
│ Day 43-44 →  LangGraph Studio 对接（未来）            │
│ Day 45+   →  持续优化                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 五、技术选型

### 5.1 依赖包

```json
{
  "dependencies": {
    "@langchain/langgraph": "^0.0.20",
    "@langchain/core": "^0.2.0",
    "@langchain/community": "^0.2.0",
    "langchain": "^0.2.0"
  }
}
```

### 5.2 环境变量

```bash
# .env.local
TAVILY_API_KEY=tvly-xxx
OPENAI_API_KEY=sk-xxx
USE_LANGGRAPH=false  # 开发阶段关闭
```

### 5.3 路由策略

| 环境 | `USE_LANGGRAPH` | 说明 |
|------|-----------------|------|
| 开发 | `false` | 使用旧架构，快速迭代 |
| 测试 | `true` | 新架构验证 |
| 生产 | `true` | 全量切换 |

---

## 六、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 学习曲线陡峭 | 进度延迟 | 分阶段交付，每阶段可回退 |
| 性能下降 | 用户体验差 | 监控响应时间，必要时降级 |
| 复杂度过高 | 维护困难 | 保持节点职责单一，文档完善 |
| LLM 成本增加 | 费用上涨 | 限制 ReAct 循环次数，合理使用 |

---

## 七、里程碑

| 里程碑 | 日期 | 验收标准 |
|--------|------|---------|
| M1: 基础状态机 | Week 2 结束 | detector.ts 迁移完成，SSE 正常 |
| M2: ReAct 模式 | Week 3 结束 | Research/Database Agent 可用 |
| M3: Human-in-Loop | Week 4 结束 | 暂停/恢复功能正常 |
| M4: 多 Agent 编排 | Week 6 结束 | Supervisor 正确分发任务 |
| M5: 持久化 | Week 7 结束 | 会话可恢复 |

---

## 八、附录

### 8.1 术语对照

| 术语 | 说明 |
|------|------|
| StateGraph | 定义状态和节点关系 |
| State | 全局状态对象 |
| Node | 节点 = 函数 |
| Edge | 边 = 函数返回下一个节点名 |
| ReAct | Thought → Action → Observation 循环 |
| Supervisor | 主编排器 |
| Human-in-the-Loop | 人工介入节点 |
| Checkpointer | 状态持久化 |

### 8.2 参考资源

| 资源 | 对应阶段 |
|------|---------|
| `.agents/skills/dive-into-langgraph/references/1.quickstart.md` | Week 1 |
| `.agents/skills/dive-into-langgraph/references/2.stategraph.md` | Week 1-2 |
| `.agents/skills/dive-into-langgraph/references/3.middleware.md` | Week 3 |
| `.agents/skills/dive-into-langgraph/references/4.human_in_the_loop.md` | Week 4 |

### 8.3 代码对照表

| LangGraph 概念 | 你的代码位置 | 对应实现 |
|----------------|-------------|---------|
| 状态定义 | `features/ai/lib/types.ts` | `AIState` |
| 意图检测 | `features/ai/lib/detector.ts` | `shouldUseRag()` |
| 工具分发 | `features/ai/tools/index.ts` | `toolsetForMode()` |
| 流式输出 | `app/api/ai/conversations/[id]/messages/route.ts` | `ReadableStream` |

---

> **记住**：慢即是快。每个概念理解透彻比囫囵吞枣重要得多。
> **原则**：不背代码、不刷教程、在实战中理解。
