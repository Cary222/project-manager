<!-- reviewer: ai-learning-mentor (软层) -->
# Phase 2 — Pi SubAgent 接入 架构审查（软层）

> 审查日期：2026-08-18
> 审查范围：Phase 2 新增的 Pi SubAgent 接入架构
> 审查者：ai-learning-mentor（软层审查）

---

## 审查摘要

| 维度 | 评分 | 说明 |
|------|------|------|
| 架构设计 | **SOLID** | 接口清晰、三层分离明确、符合 SOLID 原则 |
| 扩展性 | **HIGH** | SubAgentEvent 足够通用、Registry 模式预留、未来可扩展 |
| 可维护性 | **MEDIUM** | Mock 实现清晰，但缺少真实 Pi SDK 接入路径 |
| 文档完整性 | **GOOD** | Phase 边界清晰标注，但部分关键设计决策未记录 |
| 学习价值 | **HIGH** | 体现了事件驱动、适配器模式、AsyncIterable 等实用模式 |

**总体评价：APPROVED** ✅

---

## 架构亮点

### 1. 适配器模式完美落地

这次实现是**适配器模式**的教科书级案例：

```
用户输入 → Work Agent Graph → dispatchNode（任务分诊）
                                    ↓
              ┌─────────────────────┼─────────────────────┐
              ↓                     ↓                     ↓
      executeWorkflow         executeCoding           （未知任务）
      （周报工作流）          （Pi SubAgent）              ↓
                                  ↓                     END
                          PiSubAgent.start()
                                  ↓
                          translateEvents()  ← 适配器核心
                                  ↓
                          SubAgentEvent 流
```

**为什么这是好设计？**

就像你在知识地图里学的"接口解耦"概念——`SubAgentEvent` 是统一语言，无论底层是 Pi SDK、Cline 还是未来的 Claude Code Agent，前端只需要认识这一套事件类型。

### 2. 三层分离架构清晰

从 `work-agent-pi-integration-plan.md` 规划到代码实现，边界保持一致：

| 层级 | 文件 | 职责 |
|------|------|------|
| 第一层（业务封装） | `subagent.ts` | 任务是什么、workspace、结果回传 |
| 第二层（事件翻译） | `events.ts` | Pi 原生事件 → SubAgentEvent |
| 第三层（传输层） | `context.ts` | 上下文注入（预留 SDK/RPC 切换） |

### 3. AsyncIterable 作为事件流契约

`SubAgentHandle.events: AsyncIterable<SubAgentEvent>` 这个契约设计非常聪明：

- **对生产者**：可以用 `async generator` 轻松生成 mock 事件流
- **对消费者**：可以用 `for await...of` 消费，无需关心内部实现
- **对测试**：可以传入假的 AsyncIterable，隔离测试

这比回调函数或 Promise 更适合处理流式场景。

### 4. context.ts 的命名语义清晰

`injectRuntimeContext` / `cleanupRuntimeContext` / `getContextFilePath` 三个函数的命名直接说出了意图：

- **inject**：主动注入，不是覆盖
- **.projecthub/AGENT_CONTEXT.md**：放在隐藏目录，与原有 AGENTS.md 分离

---

## 架构风险

### 1. Phase 2/3 边界在 graph.ts 中模糊

在 `executeCodingNode` 中有这样的代码：

```typescript
// features/ai/agents/work/graph.ts:116-162
async function executeCodingNode(state: WorkAgentState): Promise<Partial<WorkAgentState>> {
  // ...
  const handle = await piAgent.start(subAgentRun, subAgentInput);

  // 5. 返回 running 状态（Phase 2: 不等待完整事件流）
  return {
    status: "running",
    artifacts: { piSessionId: handle.sessionId, piRunId: handle.runId },
    summary: `Pi Coding Session 已启动 (${handle.sessionId})`,
  };
}
```

**问题**：`executeCodingNode` 直接返回了"已启动"状态，但事件流是通过 `route.ts` 的 `handleCodingTask` 单独推送的。这意味着 Graph 状态和 SSE 事件流是两条独立路径。

**影响**：
- 如果 Graph 中途需要获取 Pi 的中间状态（比如某次 tool_call 的结果），没有干净的方式获取
- `executeCodingNode` 和 `handleCodingTask` 之间的状态共享依赖 `runStore`（内存 Map）

**建议**：Phase 3 考虑用 LangGraph 的 Checkpoint + Store 机制持久化 SubAgentRun 状态。

### 2. events.ts 的 `translateEvents` 接受 `unknown`

```typescript
// features/ai/agents/work/subagents/pi/events.ts:25-31
export function translateEvents(
  runId: string,
  _piEvents: unknown  // ← 这里
): AsyncIterable<SubAgentEvent>
```

**问题**：参数类型是 `unknown`，完全失去了类型安全。Phase 3 接入真实 Pi SDK 时，这个参数应该是 `AsyncIterable<PiEvent>`。

**影响**：编译器无法在编译期发现问题，只能在运行时碰壁。

**建议**：定义 `PiEventStream = AsyncIterable<PiEvent>` 类型，并在 Phase 3 替换参数类型。

### 3. route.ts 中的双层 SSE 包装

```typescript
// app/api/ai/work/run/route.ts:53-102
const stream_ = new ReadableStream({
  async start(controller) {
    const sendEvent = (type: string, payload: unknown) => {
      const data = JSON.stringify({ type, payload });
      controller.enqueue(encoder.encode(`data: ${data}\n\n`));
    };

    // 1. 发送 run_started
    sendEvent("run_started", { runId });

    // 2. 流式处理 graph 事件
    for await (const chunk of stream) {
      // ... dispatch_result, workflow_progress, etc.
      if (dispatchResult.taskType === "coding") {
        await handleCodingTask(runId, session.user.id, parsed.input, sendEvent);
      }
    }

    // 3. 发送 run_completed
    sendEvent("run_completed", { runId });
  },
});
```

**观察**：这里有两层 SSE 事件流：
1. Graph 层的 `run_started` / `run_completed` / `dispatch_result` / `workflow_progress`
2. Pi SubAgent 层的 `pi_run_started` / `pi_tool_call` / `pi_run_completed`

**问题**：
- 事件类型命名不一致（有无 `pi_` 前缀）
- `dispatch_result` 没有 `pi_` 前缀，但它报告的是 Pi 即将启动
- 前端需要同时处理两种事件源

**建议**：
- 统一事件命名规范（考虑所有事件都用 `pi_` 前缀，workflow 事件用 `workflow_` 前缀）
- 或者在文档中明确说明"graph 事件 vs subagent 事件"的边界

### 4. SubAgentEvent 缺少 `timestamp` 字段

```typescript
// features/ai/agents/work/subagents/types.ts:92-101
export type SubAgentEvent =
  | { type: "run_started"; runId: string; sessionId: string }
  | { type: "assistant_message"; runId: string; content: string; delta?: string }
  // ...
```

**问题**：没有 `timestamp` 字段，前端无法知道事件的精确时间。

**影响**：
- 无法计算两个事件之间的间隔
- 无法做"事件时间线"展示
- 重连后无法对齐事件顺序

**建议**：在 Phase 3 补充 `timestamp?: number` 字段（可选，兼容现有实现）。

---

## 优化建议

### 建议 1：添加 `SubAgentEvent` 基类或标签

当前 `SubAgentEvent` 是 union type，每个 case 都需要写 `runId`。考虑提取公共字段：

```typescript
// 方案 A：提取基类
interface BaseSubAgentEvent {
  runId: string;
  timestamp?: number;
}

type SubAgentEvent =
  | BaseSubAgentEvent & { type: "run_started"; sessionId: string }
  | BaseSubAgentEvent & { type: "assistant_message"; content: string; delta?: string }
  // ...
```

这样可以：
- 减少每个 event 的重复字段
- 在中间件统一添加 `timestamp`
- 未来可以统一做事件去重/重排序

### 建议 2：在 `context.ts` 添加"增量上下文"能力

当前 `injectRuntimeContext` 是全量覆盖。如果用户在长任务中途需要注入新上下文（比如"现在做 XXX"），需要重新写整个文件。

考虑：

```typescript
// 增量更新，不全量覆盖
export async function updateRuntimeContext(
  workspace: string,
  updates: Partial<RuntimeContext>
): Promise<void>
```

### 建议 3：为 `PiSubAgent` 添加状态机可视化

`PiSubAgent` 有 7 种状态（pending/running/waiting_approval/paused/completed/failed/cancelled），但没有状态流转图。

建议在文件注释中补充状态机图：

```
                    ┌──────┐
              ┌────▶│pending│
              │     └───┬────┘
    start()   │        │
              │        ▼
              │     ┌───────┐
              │     │running│◀───┐
              │     └───┬───┘     │
              │         │         │
              │    resume()   pause()
              │         │         │
              │         │         ▼
              │         │     ┌──────┐
              │         │     │paused│
              │         │     └──┬───┘
              │         │        │
              │         │   resume()
              │         │        │
              │         ▼        │
              │    ┌─────────┐   │
              │    │waiting_ │───┘
              │    │approval │
              │    └────┬────┘
              │         │ approve()
              │         │
    cancel()  │         ▼
              │    ┌──────────┐
              └────│ cancelled│
                   └──────────┘

              completed/failed → 终态
```

### 建议 4：在 `events.ts` 补充 Pi 事件映射表

当前的 `translateSingleEvent` 做了翻译，但映射关系没有文档化。建议：

```typescript
/**
 * Pi 原生事件 → SubAgentEvent 映射表
 *
 * | Pi Event Type       | SubAgentEvent Type  | 说明                    |
 * |---------------------|---------------------|------------------------|
 * | assistant_message   | assistant_message   | AI 思考/回复           |
 * | tool_call          | tool_call           | 工具调用               |
 * | tool_result        | tool_result         | 工具返回（成功）       |
 * | tool_execution_end | tool_result         | 工具执行结束           |
 * | tool_execution_error | tool_error         | 工具执行失败           |
 * | error              | error               | 一般错误               |
 * | run_completed      | run_completed       | 运行完成               |
 */
export function translateSingleEvent(...)
```

---

## 学习要点（针对用户）

### 这次实现体现了哪些值得学习的模式？

#### 1. 适配器模式（Adapter Pattern）

这是你在"排错基本功"里没学过，但实际项目中非常重要的模式：

**类比**：就像旅行转换头——不同国家的插座形状不同（Pi SDK / Cline / Claude Code Agent），但都转换成 USB 接口（SubAgentEvent）供设备使用（前端）。

**核心代码**：
```typescript
// events.ts:25-31
export function translateEvents(
  runId: string,
  _piEvents: unknown
): AsyncIterable<SubAgentEvent> {
  return createMockEventStream(runId);  // Phase 2: mock
}
```

**好处**：
- 前端只需要认识 SubAgentEvent，不用改代码就能换底层
- 测试时可以注入假的 Pi 事件
- 未来接入 Claude Code Agent，只需写新的 `translateEvents` 实现

#### 2. AsyncIterable 作为流式契约

**类比**：就像发电站的输出插座——不管发电站用的是水电/火电/核电（Pi SDK / RPC / Mock），只要插口规格一样（AsyncIterable），电器就能用。

**核心代码**：
```typescript
// subagent.ts:55-56
const handle: SubAgentHandle = {
  events,  // AsyncIterable<SubAgentEvent>
  // ...
};
```

**为什么比回调更好？**
- 回调：每次事件都要注册一个函数，复杂且容易内存泄漏
- Promise：只能处理一次结果，不能处理流
- AsyncIterable：`for await...of` 遍历，像读数组一样读事件流

#### 3. 内存 Map 作为简单的状态存储

**类比**：就像便利贴——临时记一下，不用数据库，用完就扔。

**核心代码**：
```typescript
// subagent.ts:22-23
const runStore = new Map<string, SubAgentRun>();
const handleStore = new Map<string, { cancel: () => Promise<void> }>();
```

**适用场景**：
- Phase 2 快速验证，不需要持久化
- 单进程内的简单状态共享
- 开发/测试环境

**不适用场景**：
- 多进程/多实例部署
- 需要重启后恢复状态
- 需要跨请求共享状态

#### 4. 事件流中的命名约定

`pi_run_started` / `pi_tool_call` / `pi_run_completed` 前缀约定的好处：

- 一眼能看出事件来源（是 Pi 发的）
- 避免和其他事件类型冲突
- 便于前端过滤/路由

---

## 结合你的学习档案

### 你已经具备的基础

从你的学习档案来看，这次 Phase 2 涉及的概念你已经学过：

| 概念 | 你在知识地图中的位置 |
|------|---------------------|
| SSE 流式响应 | ✅ 已掌握（2026-06-29） |
| AsyncIterable | 部分掌握（LangGraph 学习中） |
| 适配器模式 | 新学（这次） |
| 状态机 | 部分掌握（LangGraph StateGraph） |

### 你可以从这次实现中学到什么？

**1. 事件驱动架构的工程取舍**

你之前学的是"SSE = 打电话（一方一直说）"，这次你可以学到：
- **事件流分层**：Graph 事件 vs SubAgent 事件是两层
- **事件命名规范**：`pi_` 前缀的作用
- **事件聚合**：多个小事件合成一个 `dispatch_result`

**2. 适配器模式的具体实现**

你之前学的"接口解耦"是概念，这次你可以看到：
- `BaseSubAgent` 接口定义契约
- `PiSubAgent` 实现接口
- `SubAgentEvent` 作为统一语言
- `translateEvents` 作为翻译层

**3. Mock-first 开发的工程价值**

Phase 2 用 Mock 事件流验证了架构，这体现了"先跑通再优化"的思想：
- 不等 Pi SDK 准备好，先用 Mock 验证 SSE 链路
- 前端可以并行开发，不依赖后端真实实现
- 单元测试可以用假数据，不依赖外部服务

---

## 总结

### 优点

1. **架构清晰**：适配器模式 + 三层分离，边界明确
2. **接口优雅**：AsyncIterable 作为事件流契约，生产者和消费者解耦
3. **命名语义好**：`injectRuntimeContext`、`translateEvents` 等函数名直接说意图
4. **Phase 边界清晰**：Mock 实现有明确标注，Phase 3 升级路径清晰
5. **代码量克制**：没有过度设计，该 Mock 的 Mock，该占位的占位

### 需要改进

1. **类型安全**：`translateEvents` 参数类型 `unknown` 丢失了类型信息
2. **状态共享**：Graph 和 SSE 事件流是两条独立路径，状态共享依赖内存 Map
3. **事件命名**：graph 事件和 subagent 事件命名风格不一致
4. **缺少 timestamp**：SubAgentEvent 没有时间戳字段

### 给 fullstack-developer 的建议

1. **Phase 3 第一件事**：把 `translateEvents` 的参数类型从 `unknown` 改成 `AsyncIterable<PiEvent>`
2. **Phase 3 第二件事**：为 SubAgentEvent 补充 `timestamp` 字段
3. **Phase 3 第三件事**：考虑用 LangGraph Checkpointer 替代内存 Map 做状态持久化

---

## 审查结论

**APPROVED** ✅

Phase 2 的架构设计符合集成方案文档的要求，适配器模式落地清晰，接口契约优雅，Mock 实现克制且有明确升级路径。少量改进建议（类型安全、事件命名、timestamp）是 Phase 3 的优化项，不影响 Phase 2 通过审查。

---

*审查完成时间：2026-08-18*
*审查者：ai-learning-mentor（软层）*
