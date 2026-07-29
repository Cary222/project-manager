---
name: LangGraph Playground 学习线（Copilot + Workflow 双架构）
overview: 建立 playground/langgraph/ 独立实验区，学习 Chat Agent（stateless）和 Business Workflow（interrupt + MemorySaver + Scheduler）双层架构。
todos:
  - id: playground-setup
    content: "创建 playground/langgraph/ 目录结构"
    status: pending
  - id: playground-basics
    content: "00-runtime-model.ts: Chat vs Workflow 运行时对比"
    status: pending
  - id: playground-chat
    content: "01-chat-agent.ts: Stateless Chat Agent"
    status: pending
  - id: playground-workflow-intro
    content: "02-workflow-intro.ts: 什么是 Business Workflow"
    status: pending
  - id: playground-checkpointer
    content: "03-checkpointer-memory.ts: MemorySaver + thread_id（保存执行状态）"
    status: pending
  - id: playground-interrupt
    content: "04-interrupt-resume.ts: interrupt + resume"
    status: pending
  - id: playground-scheduler
    content: "05-scheduler.ts: 定时执行（每天 9 点生成日报）"
    status: pending
  - id: playground-daily-report
    content: "06-daily-report-flow.ts: 完整示例 - 日报生成（8 小时流程）"
    status: pending
  - id: playground-rating-analysis
    content: "07-project-risk-flow.ts: 完整示例 - 项目风险监控"
    status: pending
  - id: playground-arch
    content: "08-architecture-pattern.ts: Chat + Workflow 双层架构"
    status: pending
  - id: playground-readme
    content: "README.md: 学习笔记 + 架构演进路线"
    status: pending
isProject: false
---

# Plan: LangGraph Playground 学习线

## 核心洞察

| 概念 | 说明 |
|------|------|
| **Chat Memory** | 对话历史，"昨天说过什么？" |
| **Checkpoint** | Workflow 执行状态，"已分析 Git√，等待经理审批" |
| **Chat Agent** | Stateless，低延迟，一次 `invoke()` 结束 |
| **Workflow Agent** | 有状态，可恢复，持续数小时甚至数天 |

**两者不是替代关系，而是不同场景的工具。**

## 为什么分开学

```
AI Platform
    │
    ├───────────────┐
    │               │
    ▼               ▼
Chat Agent    Workflow Agent
    │               │
    invoke()       interrupt()
    │               │
    END            resume()
```

- **Chat**：追求低延迟、快速响应
- **Workflow**：追求可靠、可恢复、可持续执行

## 目录结构

```
playground/langgraph/
├── setup.ts                      # 共享 LLM/工具配置
├── 00-runtime-model.ts           # Chat vs Workflow 运行时对比
├── 01-chat-agent.ts              # Stateless Chat Agent
├── 02-workflow-intro.ts          # 什么是 Business Workflow
├── 03-checkpointer-memory.ts      # MemorySaver + thread_id
├── 04-interrupt-resume.ts        # interrupt + resume
├── 05-scheduler.ts               # 定时执行
├── 06-daily-report-flow.ts       # 日报生成（8 小时流程）
├── 07-project-risk-flow.ts       # 项目风险监控
├── 08-architecture-pattern.ts    # Chat + Workflow 双层架构
└── README.md                     # 学习笔记 + 架构演进路线
```

## 文件详情

### `00-runtime-model.ts` — 运行时对比 ⭐

**学习目标**：理解 Chat Agent 和 Workflow Agent 的本质区别

```typescript
// ============================================================
// 运行时对比：Chat vs Workflow
// ============================================================

// Chat Agent 运行时
// - 输入: messages[]
// - 输出: messages[] + tool_calls
// - 状态: 无状态（状态在前端/数据库）
// - 中断: 无
const chatRuntime = {
  name: "Chat Agent",
  invoke: (input: { messages: BaseMessage[] }) => {
    // 一次调用完成
    return { messages: [...input.messages, response] };
  },
  stateful: false,
  interrupt: false,
};

// Workflow Agent 运行时
// - 输入: state + thread_id
// - 输出: state 更新
// - 状态: checkpointer 持久化
// - 中断: interrupt() 暂停执行
const workflowRuntime = {
  name: "Workflow Agent",
  invoke: (input: Partial<State>, config: { thread_id: string }) => {
    // 可能在 interrupt 点暂停
    return { state: updatedState, interrupted: true };
  },
  stateful: true,
  interrupt: true,
  checkpointer: new MemorySaver(),
};

// 验证对比
console.log("Chat:", chatRuntime);
// { name: "Chat Agent", stateful: false, interrupt: false }

console.log("Workflow:", workflowRuntime);
// { name: "Workflow Agent", stateful: true, interrupt: true }

// npx tsx playground/langgraph/00-runtime-model.ts
```

### `01-chat-agent.ts` — Stateless Chat Agent

**学习目标**：理解当前项目的 Chat Agent 实现

```typescript
// ============================================================
// Chat Agent: Stateless, 快速响应
// ============================================================

// 状态在外部（前端 history 或数据库）
interface ChatState {
  messages: BaseMessage[];
}

// 每次 invoke 都是独立的
async function chatInvoke(
  messages: BaseMessage[],
  input: string
): Promise<ChatState> {
  const newMessages = [...messages, new HumanMessage(input)];
  
  // 调用 LLM
  const response = await llm.invoke(newMessages);
  
  // 结束（无状态）
  return { messages: [...newMessages, response] };
}

// 验证
const state = await chatInvoke([], "刘工最近在做什么");
// 返回完整 messages，AI 可以理解上下文

// npx tsx playground/langgraph/01-chat-agent.ts
```

### `02-workflow-intro.ts` — 什么是 Business Workflow

**学习目标**：理解为什么 Chat 不够用，需要 Workflow

```typescript
// ============================================================
// Business Workflow: 持续数小时的业务自动化
// ============================================================

// 场景一：日报生成
const dailyReportWorkflow = {
  name: "日报生成",
  duration: "8 小时",
  steps: [
    "分析昨天所有 Commit",
    "分析昨天所有工单", 
    "分析昨天会议纪要",
    "生成日报草稿",
    "发送项目经理",
    "等待经理修改",  // ← 这里需要中断
    "下午 5 点汇总",
    "发送企业微信",
  ],
  checkpoint: true,  // 经理修改后，从步骤 5 继续，而不是重新分析
};

// 场景二：项目风险监控
const projectMonitorWorkflow = {
  name: "项目风险监控",
  duration: "持续运行",
  steps: [
    "每 30 分钟:",
    "  查询 Jira",
    "  查询 Git",
    "  查询 Bug",
    "  发现延期 → 通知负责人",
    "继续监控",
  ],
  scheduler: true,  // 定时触发
};

// 场景三：AI PM
const aiPmWorkflow = {
  name: "AI PM",
  duration: "几天到几周",
  steps: [
    "需求提出",
    "AI 拆解任务",
    "等待设计",      // ← 中断，等待设计稿
    "等待产品确认",
    "创建开发任务",
    "等待开发完成",
    "等待测试",
    "生成上线 Checklist",
  ],
  humanInLoop: true,
};

// 关键洞察
console.log("Chat 不够用的场景:");
console.log("1. 需要保存中间状态（已分析 Git✓）");
console.log("2. 需要等待人工审批（经理确认✓）");
console.log("3. 需要定时触发（每天 9 点✓）");
console.log("4. 需要从中断点恢复（不是重新开始✓）");

// npx tsx playground/langgraph/02-workflow-intro.ts
```

### `03-checkpointer-memory.ts` — 状态持久化

**学习目标**：理解 MemorySaver 保存的是执行状态，不是聊天历史

```typescript
// ============================================================
// Checkpoint vs Chat Memory
// ============================================================

// Chat Memory: 对话历史
const chatMemory = {
  type: "conversation_history",
  content: [
    "用户: 刘工最近在做什么？",
    "AI: 找到两个用户...",
    "用户: 张靖",
  ],
  question: "昨天说过什么？",  // Chat Memory 能回答
};

// Checkpoint: 执行状态
const checkpoint = {
  type: "execution_state", 
  content: {
    taskId: "daily-report-2024-01-15",
    completedSteps: [
      { step: "analyze_commits", status: "done", result: "10 commits" },
      { step: "analyze_tickets", status: "done", result: "5 tickets" },
    ],
    currentStep: "waiting_manager_approval",  // ← Chat Memory 不知道这个
    resumeFrom: "step_3_draft_generation",
  },
  question: "日报生成到哪一步了？",  // Checkpoint 能回答
};

// MemorySaver 保存的是后者
const checkpointer = new MemorySaver();

// 编译图时注入
const workflow = new StateGraph(WorkflowState)
  .addNode("analyze", analyzeNode)
  .addNode("draft", draftNode)
  .addNode("approve", approveNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "draft")
  .addEdge("draft", "approve")
  .addEdge("approve", END)
  .compile({ checkpointer });

// 第一轮：执行到 draft
const threadId = "report-123";
await workflow.invoke(
  { taskId: "daily-report", step: "analyze" },
  { configurable: { thread_id: threadId } }
);

// 查看保存的状态
const state = await workflow.getState({
  configurable: { thread_id: threadId },
});
console.log(state);
// {
//   values: { taskId: "daily-report", step: "draft" },
//   next: ["approve"],
//   ...
// }

// 恢复：从 draft 继续，不重新 analyze
await workflow.invoke(null, {
  configurable: { thread_id: threadId }
});

// npx tsx playground/langgraph/03-checkpointer-memory.ts
```

### `04-interrupt-resume.ts` — 中断与恢复 ⭐

**学习目标**：理解 interrupt + resume 完整流程

```typescript
// ============================================================
// interrupt + resume: Workflow 的暂停点
// ============================================================

import { interrupt, MemorySaver } from "@langchain/langgraph";

interface ApprovalState {
  messages: BaseMessage[];
  task?: string;
  approved?: boolean;
}

// 带 checkpointer 的图
const checkpointer = new MemorySaver();

const workflow = new StateGraph(ApprovalState)
  .addNode("submit", async (state) => {
    return { task: state.messages[state.messages.length - 1].content as string };
  })
  .addNode("approve", async (state) => {
    // interrupt() 会暂停执行，等待 resume
    const decision = interrupt({
      prompt: "是否批准这个任务？回复 是/否",
      required: true,
    });
    return { approved: (decision as string) === "是" };
  })
  .addNode("execute", async (state) => {
    console.log("执行任务:", state.task);
    return { messages: [...state.messages, new AIMessage("任务已完成")] };
  })
  .addNode("reject", async (state) => {
    console.log("任务被拒绝:", state.task);
    return { messages: [...state.messages, new AIMessage("任务被拒绝")] };
  })
  .addEdge(START, "submit")
  .addEdge("submit", "approve")
  .addConditionalEdges("approve", (s) => s.approved ? "execute" : "reject")
  .addEdge("execute", END)
  .addEdge("reject", END)
  .compile({ checkpointer });

// 第一轮：执行到 approve 中断
const threadId = "approval-456";
const stream1 = await workflow.astream(
  { messages: [new HumanMessage("帮我处理这个")] },
  { configurable: { thread_id: threadId } }
);

for await (const event of stream1) {
  console.log("event:", Object.keys(event));
  // 会在这里看到 interrupt
}

// 查看状态：停在了 approve 节点
const state1 = await workflow.getState({
  configurable: { thread_id: threadId },
});
console.log("中断时状态:", state1.values);
// { task: "帮我处理这个", approved: undefined, next: ["approve"] }

// 第二轮：用户批准后 resume
const stream2 = await workflow.astream(
  null,  // 不传新输入
  {
    configurable: {
      thread_id: threadId,
      resume: { approved: true },  // 注入用户决策
    },
  }
);

for await (const event of stream2) {
  console.log("resume event:", Object.keys(event));
}

// npx tsx playground/langgraph/04-interrupt-resume.ts
```

### `05-scheduler.ts` — 定时执行

**学习目标**：理解 Workflow 如何定时触发

```typescript
// ============================================================
// Scheduler: 定时触发 Workflow
// ============================================================

// 定时任务示例
async function scheduleDailyReport() {
  // 每天上午 9 点执行
  const cron = "0 9 * * *";  // cron 表达式
  
  // 实际项目中可以用:
  // - node-cron
  // - BullMQ
  // - Vercel Cron
  // - Railway scheduled tasks
  
  const job = setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 0) {
      // 触发日报生成 workflow
      const threadId = `daily-report-${now.toISOString().split('T')[0]}`;
      
      await workflow.invoke(
        { messages: [new HumanMessage("生成今日日报")] },
        { configurable: { thread_id: threadId } }
      );
      
      console.log(`日报生成任务已启动: ${threadId}`);
    }
  }, 60000);  // 每分钟检查一次
  
  return job;
}

// 或者用 BullMQ（生产级）
import { Queue, Worker } from "bullmq";

const dailyReportQueue = new Queue("daily-report", {
  connection: redisConnection,
});

const worker = new Worker(
  "daily-report",
  async (job) => {
    const threadId = `daily-report-${job.data.date}`;
    await workflow.invoke(
      { messages: [new HumanMessage("生成今日日报")] },
      { configurable: { thread_id: threadId } }
    );
  },
  { connection: redisConnection }
);

// 调度任务
await dailyReportQueue.add("generate", {
  date: new Date().toISOString().split('T')[0],
}, {
  repeat: { pattern: "0 9 * * *" },  // 每天 9 点
});

// npx tsx playground/langgraph/05-scheduler.ts
```

### `06-daily-report-flow.ts` — 日报生成（8 小时流程）⭐⭐

**学习目标**：综合所有概念，完整实现一个 Business Workflow

```typescript
// ============================================================
// 日报生成 Workflow: 完整的 8 小时流程
// ============================================================

import { interrupt, MemorySaver, START, END } from "@langchain/langgraph";

interface DailyReportState {
  messages: BaseMessage[];
  date: string;
  commitAnalysis?: string;
  ticketAnalysis?: string;
  meetingAnalysis?: string;
  draft?: string;
  managerFeedback?: string;
  finalReport?: string;
  approved?: boolean;
}

const checkpointer = new MemorySaver();

const workflow = new StateGraph(DailyReportState)
  // 步骤 1: 分析 Commit
  .addNode("analyze_commits", async (state) => {
    const commits = await queryGitCommits(state.date);
    return {
      commitAnalysis: summarizeCommits(commits),
      messages: [...state.messages, new AIMessage("已分析今日 Commit")],
    };
  })
  // 步骤 2: 分析工单
  .addNode("analyze_tickets", async (state) => {
    const tickets = await queryTickets(state.date);
    return {
      ticketAnalysis: summarizeTickets(tickets),
      messages: [...state.messages, new AIMessage("已分析今日工单")],
    };
  })
  // 步骤 3: 分析会议
  .addNode("analyze_meetings", async (state) => {
    const meetings = await queryMeetings(state.date);
    return {
      meetingAnalysis: summarizeMeetings(meetings),
      messages: [...state.messages, new AIMessage("已分析今日会议")],
    };
  })
  // 步骤 4: 生成草稿
  .addNode("generate_draft", async (state) => {
    const draft = await llm.invoke([
      new HumanMessage(`基于以下信息生成日报草稿:
        - Commit: ${state.commitAnalysis}
        - 工单: ${state.ticketAnalysis}
        - 会议: ${state.meetingAnalysis}
      `),
    ]);
    return {
      draft: draft.content as string,
      messages: [...state.messages, new AIMessage("日报草稿已生成")],
    };
  })
  // 步骤 5: 等待经理审批（interrupt）
  .addNode("wait_approval", async (state) => {
    const feedback = interrupt({
      prompt: `日报草稿已生成:
        ${state.draft}
        请确认是否发送？回复 修改意见 / 确认发送`,
      required: true,
    });
    return { managerFeedback: feedback as string };
  })
  // 步骤 6: 根据反馈修改
  .addNode("revise_report", async (state) => {
    const revised = await llm.invoke([
      new HumanMessage(`日报需要修改:
        原稿: ${state.draft}
        经理反馈: ${state.managerFeedback}
      `),
    ]);
    return {
      draft: revised.content as string,
      messages: [...state.messages, new AIMessage("日报已根据反馈修改")],
    };
  })
  // 步骤 7: 下午 5 点汇总
  .addNode("finalize_report", async (state) => {
    const finalized = await llm.invoke([
      new HumanMessage(`最终日报（下午版）:
        ${state.draft}
        添加下午的工作进展。
      `),
    ]);
    return {
      finalReport: finalized.content as string,
      messages: [...state.messages, new AIMessage("日报已最终定稿")],
    };
  })
  // 步骤 8: 发送企业微信
  .addNode("send_notification", async (state) => {
    await sendToWechat(state.finalReport!);
    return {
      messages: [...state.messages, new AIMessage("日报已发送到企业微信")],
    };
  })
  // 边定义
  .addEdge(START, "analyze_commits")
  .addEdge("analyze_commits", "analyze_tickets")
  .addEdge("analyze_tickets", "analyze_meetings")
  .addEdge("analyze_meetings", "generate_draft")
  .addEdge("generate_draft", "wait_approval")
  // 根据是否有修改意见决定下一步
  .addConditionalEdges("wait_approval", (state) => {
    if (state.managerFeedback.includes("确认发送")) return "finalize_report";
    return "revise_report";
  })
  .addEdge("revise_report", "wait_approval")  // 再次等待审批
  .addEdge("finalize_report", "send_notification")
  .addEdge("send_notification", END)
  .compile({ checkpointer });

// 执行
const threadId = `daily-report-${new Date().toISOString().split('T')[0]}`;
await workflow.invoke(
  {
    messages: [new HumanMessage("开始生成今日日报")],
    date: new Date().toISOString().split('T')[0],
  },
  { configurable: { thread_id: threadId } }
);

// npx tsx playground/langgraph/06-daily-report-flow.ts
```

### `07-project-risk-flow.ts` — 项目风险监控

**学习目标**：实现周期性监控的 Workflow

```typescript
// ============================================================
// 项目风险监控 Workflow: 持续运行的监控流程
// ============================================================

interface MonitorState {
  projectId: string;
  lastCheck?: Date;
  risks: Array<{ type: string; description: string; severity: string }>;
  notifications: string[];
}

const workflow = new StateGraph(MonitorState)
  .addNode("check_jira", async (state) => {
    const issues = await queryJira(state.projectId);
    const delays = issues.filter(i => i.status === "delayed");
    return { risks: [...state.risks, ...delays.map(i => ({
      type: "jira_delay",
      description: i.title,
      severity: "high",
    }))]};
  })
  .addNode("check_git", async (state) => {
    const commits = await queryGit(state.projectId, state.lastCheck);
    const stalled = commits.filter(c => !c.recent);
    return { risks: [...state.risks, ...stalled.map(c => ({
      type: "git_stalled",
      description: c.branch,
      severity: "medium",
    }))]};
  })
  .addNode("check_bugs", async (state) => {
    const bugs = await queryBugs(state.projectId);
    return { risks: [...state.risks, ...bugs.map(b => ({
      type: "bug",
      description: b.title,
      severity: b.critical ? "high" : "medium",
    }))]};
  })
  .addNode("notify_if_needed", async (state) => {
    const highRisks = state.risks.filter(r => r.severity === "high");
    if (highRisks.length > 0) {
      await sendAlert(state.projectId, highRisks);
      return {
        notifications: [...state.notifications, `已发送 ${highRisks.length} 个高风险通知`],
        lastCheck: new Date(),
      };
    }
    return { lastCheck: new Date() };
  })
  .addEdge(START, "check_jira")
  .addEdge("check_jira", "check_git")
  .addEdge("check_git", "check_bugs")
  .addEdge("check_bugs", "notify_if_needed")
  .addEdge("notify_if_needed", END)
  .compile({ checkpointer: new MemorySaver() });

// npx tsx playground/langgraph/07-project-risk-flow.ts
```

### `08-architecture-pattern.ts` — 双层架构

**学习目标**：理解 Chat Agent 和 Workflow Agent 如何共存

```typescript
// ============================================================
// AI Platform 双层架构
// ============================================================

// 项目未来的目录结构
const futureStructure = `
features/ai/
    chat/                    # Chat Agent 层
        graph.ts            # Stateless graph.invoke()
        tools/
            search-structured.ts
            search-knowledge.ts
        nodes/
            detect-intent.ts
            generate-response.ts
        route.ts            # 消息路由
    
    workflow/               # Workflow Agent 层
        graphs/
            daily-report.ts
            project-monitor.ts
        runtime.ts          # Workflow 运行时
        scheduler.ts        # 定时调度
        approval.ts         # 审批处理
        checkpointer.ts     # 状态持久化
`;

// Chat vs Workflow 使用场景
const useCases = {
  chat: [
    "帮我查一下刘工的周报",
    "这个项目的进度如何？",
    "今天有哪些新工单？",
  ],
  workflow: [
    "每天早上 9 点给我发日报",
    "持续监控 A 项目的风险，有问题通知我",
    "帮我跟进 B需求的开发，完成后提醒我审批",
  ],
};

// 入口判断
function routeToAgent(input: string): "chat" | "workflow" {
  const isWorkflow = 
    input.includes("每天") ||
    input.includes("持续") ||
    input.includes("完成后") ||
    input.includes("监控") ||
    input.includes("跟进");
  
  return isWorkflow ? "workflow" : "chat";
}

// 验证
console.log(routeToAgent("查刘工周报"));  // "chat"
console.log(routeToAgent("每天早上发日报"));  // "workflow"

// npx tsx playground/langgraph/08-architecture-pattern.ts
```

### `README.md` — 学习笔记

每个文件包含：
1. **学习目标**：这次要理解什么
2. **代码注释**：关键步骤的中文解释
3. **验证命令**：`npx tsx playground/langgraph/0X-xxx.ts`
4. **思考题**：学完后自测

## 改动摘要

| 文件 | 类型 | 说明 |
|------|------|------|
| `playground/langgraph/setup.ts` | 新增 | 共享配置 |
| `playground/langgraph/00-runtime-model.ts` | 新增 | 运行时对比 |
| `playground/langgraph/01-chat-agent.ts` | 新增 | Stateless Chat |
| `playground/langgraph/02-workflow-intro.ts` | 新增 | Workflow 概念 |
| `playground/langgraph/03-checkpointer-memory.ts` | 新增 | 状态持久化 |
| `playground/langgraph/04-interrupt-resume.ts` | 新增 | 中断恢复 |
| `playground/langgraph/05-scheduler.ts` | 新增 | 定时执行 |
| `playground/langgraph/06-daily-report-flow.ts` | 新增 | 日报生成 |
| `playground/langgraph/07-project-risk-flow.ts` | 新增 | 风险监控 |
| `playground/langgraph/08-architecture-pattern.ts` | 新增 | 双层架构 |
| `playground/langgraph/README.md` | 新增 | 学习笔记 |

**总文件数**：10 个 .ts + 1 个 .md
