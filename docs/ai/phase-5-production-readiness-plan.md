# Phase 5: Production Readiness - 实施计划

> **工单**: #无单号 (AI Agent 架构演进 Phase 5)  
> **计划制定时间**: 2026-08-19  
> **预计完成**: TBD  
> **前置条件**: Phase 4 完成 (HIL 闭环 + 持久化层)

---

## 📋 Phase 演进路线回顾

```
Phase 0: Pi SDK Spike ✅
  └─ 验证 Pi SDK 可用性 + API Surface 确认

Phase 1: Minimal Loop ✅
  └─ dispatchNode 任务分诊 + workflow 接通

Phase 2: Pi SubAgent Integration ✅
  └─ SubAgent 类型系统 + Mock 事件流 + 上下文注入

Phase 3: Policy Gateway ✅
  └─ 三层策略（Tool/Command/Path）+ PiRuntime 抽象层

Phase 4: HIL + Persistence ✅
  └─ 外部审批闭环 + 数据库持久化（PolicyAuditLog/PolicyRule/SubAgentRun）

Phase 5: Production Readiness 🎯 (当前)
  └─ 真实 Pi SDK 集成 + 错误恢复 + 并发控制 + 监控
```

---

## 🎯 Phase 5 核心目标

### 愿景
从 "功能完整的原型" 升级为 "可在生产环境运行的稳定系统"。

### 关键成果
1. **真实 Pi SDK 集成**: 移除所有 mock 实现，接入真实 `@earendil-works/pi-coding-agent`
2. **错误恢复能力**: SubAgent 异常时能自动重试或优雅降级
3. **并发控制**: 多用户/多任务场景下资源限制与调度
4. **生产级监控**: 结构化日志 + 性能指标 + 告警机制

---

## 📊 范围界定与优先级

### P0: 阻塞项 (必须完成才能上生产)

| ID | 任务 | 范围 | 产物 |
|----|------|------|------|
| P0-1 | 真实 Pi SDK 集成 | 替换 `PiSdkRuntime` 的 mock 实现 | `sdk.ts` 真实调用 Pi SDK |
| P0-2 | Pi 事件流映射 | 完整映射 Pi 原生事件 → `SubAgentEvent` | `events.ts` 翻译逻辑 |
| P0-3 | 端到端验证 | 真实 Pi session 执行简单任务（如 "读取 README"） | `phase-5-verify.ts` |

**预计工作量**: 1-2 天  
**风险**: Pi SDK 版本变更可能导致 API 不兼容（已在 Phase 0 验证过 0.84.2）

---

### P1: 重要项 (显著提升稳定性)

| ID | 任务 | 范围 | 产物 |
|----|------|------|------|
| P1-1 | 错误恢复机制 | SubAgent 异常重试 + 状态恢复 | `runtime.ts` + `graph.ts` |
| P1-2 | 修复 Phase 4 HIL 问题 | 4 个遗留问题（竞态/归属权/过滤/超时） | `approve/route.ts` + `sdk.ts` |
| P1-3 | 并发控制 | 多 SubAgent 实例管理 + 资源限制 | `concurrency.ts` + 配置 |

**预计工作量**: 2-3 天  
**风险**: 并发控制可能需要 Redis 等外部依赖

---

### P2: 可选项 (增强可观测性)

| ID | 任务 | 范围 | 产物 |
|----|------|------|------|
| P2-1 | 监控与日志 | 结构化日志 + 性能指标 | `logger.ts` + Datadog 集成 |
| P2-2 | 超时管理 | SubAgent 执行超时 + 审批超时清理 | `timeout.ts` + 定时任务 |

**预计工作量**: 1-2 天  
**风险**: 依赖外部监控服务（Datadog / Prometheus）

---

## 🔧 P0 详细设计

### P0-1: 真实 Pi SDK 集成

#### 当前状态
`features/ai/agents/work/subagents/pi/transports/sdk.ts` 中的 `PiSdkRuntime` 使用 `createMockPiEventStream()` 生成假事件流。

#### 目标状态
调用真实的 `@earendil-works/pi-coding-agent` API：

```typescript
import { createAgentSession, ModelRuntime } from '@earendil-works/pi-coding-agent';

export class PiSdkRuntime implements PiRuntime {
  private modelRuntime: ModelRuntime | null = null;
  private sessions: Map<string, AgentSession> = new Map();

  async start(input: PiStartInput): Promise<string> {
    const runId = `run_${Date.now()}`;
    
    // 1. 初始化 ModelRuntime（首次调用）
    if (!this.modelRuntime) {
      this.modelRuntime = await ModelRuntime.create({
        agentDir: input.agentDir || '.pi-agent',
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
    }
    
    // 2. 创建 Pi session
    const { session } = await createAgentSession({
      cwd: input.workspace,
      agentDir: input.agentDir || '.pi-agent',
      modelRuntime: this.modelRuntime,
      sessionId: input.sessionId, // 支持恢复
    });
    
    this.sessions.set(runId, session);
    
    // 3. 发送用户消息
    await session.sendUserMessage(input.prompt);
    
    // 4. 订阅事件流
    this.subscribeToSession(runId, session);
    
    return runId;
  }
  
  private subscribeToSession(runId: string, session: AgentSession): void {
    session.subscribe({
      onMessage: (msg) => {
        // 映射到 SubAgentEvent
        this.emitEvent(runId, {
          type: "assistant_message",
          runId,
          content: msg.content,
        });
      },
      onToolCall: (tool) => {
        this.emitEvent(runId, {
          type: "tool_call",
          runId,
          tool: tool.name,
          args: tool.arguments,
        });
      },
      // ... 其他事件
    });
  }
  
  async abort(runId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (session) {
      await session.abort();
      session.dispose();
      this.sessions.delete(runId);
    }
  }
}
```

#### 关键改动点
1. **移除 mock**: 删除 `createMockPiEventStream()`
2. **真实初始化**: `ModelRuntime.create()` + `createAgentSession()`
3. **事件订阅**: `session.subscribe()` 监听 Pi 原生事件
4. **生命周期管理**: `abort()` → `session.dispose()`

#### 依赖
- Node.js >= 22.19.0（Phase 0 已确认）
- 环境变量: `OPENAI_API_KEY` 或其他 LLM key
- `agentDir`: 建议配置为 `/home/hxy/.pi/agent`（生产环境）

#### 验证标准
```bash
# 运行简单任务: "读取项目 README 并总结"
npx tsx scripts/phase-5-verify.ts
# 预期: 真实 Pi session 成功执行 → 返回 README 摘要
```

---

### P0-2: Pi 事件流映射

#### 当前状态
`features/ai/agents/work/subagents/pi/events.ts` 的 `translateSingleEvent()` 只处理了部分事件类型。

#### 目标状态
完整映射 Pi SDK 所有事件类型到 `SubAgentEvent`:

| Pi 原生事件 | SubAgentEvent | 优先级 |
|-------------|---------------|--------|
| `session_started` | `run_started` | P0 |
| `message` | `assistant_message` | P0 |
| `tool_call` | `tool_call` | P0 |
| `tool_result` | `tool_result` | P0 |
| `tool_error` | `tool_error` | P0 |
| `session_completed` | `run_completed` | P0 (Phase 4 已添加) |
| `approval_required` | `approval_required` | P0 (Phase 4 已添加) |
| `progress` | `progress` | P1 |
| `error` | `error` | P0 |

#### 实现要点
```typescript
export function translateSingleEvent(piEvent: PiEvent): SubAgentEvent | null {
  switch (piEvent.type) {
    case "session_started":
      return {
        type: "run_started",
        runId: piEvent.runId,
        sessionId: piEvent.sessionId,
        timestamp: new Date().toISOString(),
      };
    
    case "message":
      return {
        type: "assistant_message",
        runId: piEvent.runId,
        content: piEvent.content,
        timestamp: piEvent.timestamp,
      };
    
    case "tool_call":
      return {
        type: "tool_call",
        runId: piEvent.runId,
        tool: piEvent.tool,
        args: piEvent.args,
        callId: piEvent.callId,
      };
    
    case "tool_result":
      return {
        type: "tool_result",
        runId: piEvent.runId,
        callId: piEvent.callId,
        result: piEvent.result,
      };
    
    case "tool_error":
      return {
        type: "tool_error",
        runId: piEvent.runId,
        callId: piEvent.callId,
        error: piEvent.error,
      };
    
    case "error":
      return {
        type: "error",
        runId: piEvent.runId,
        error: piEvent.error,
        timestamp: new Date().toISOString(),
      };
    
    // Phase 4 已添加
    case "session_completed":
      return {
        type: "session_completed",
        sessionId: piEvent.sessionId,
      };
    
    case "approval_required":
      return {
        type: "approval_required",
        runId: piEvent.runId,
        tool: piEvent.tool,
        command: piEvent.command,
        reason: piEvent.reason,
      };
    
    default:
      console.warn(`[translateSingleEvent] Unknown Pi event type: ${(piEvent as any).type}`);
      return null;
  }
}
```

#### 验证标准
- 所有 Pi 原生事件都有对应的翻译分支
- 未知事件类型打印警告但不抛异常
- 事件字段完整（runId / timestamp / content 等）

---

### P0-3: 端到端验证

#### 目标
在真实 Pi SDK 环境下，完成一个简单的端到端任务。

#### 验证场景
**任务**: "读取项目根目录的 README.md 并生成 200 字摘要"

**预期流程**:
1. Work Agent 接收任务 → dispatchNode 识别为 `coding` 类型
2. executeCodingNode 调用 `PiSdkRuntime.start()`
3. Pi SDK 启动真实 session → 调用 `bash cat README.md`
4. 事件流: `run_started` → `assistant_message` → `tool_call` → `tool_result` → `run_completed`
5. 返回摘要结果

#### 验证脚本
**文件**: `scripts/phase-5-verify.ts`

```typescript
import { getPiSubAgent } from "@/features/ai/agents/work/subagents/pi/subagent";

async function verifyPhase5() {
  console.log("🧪 Phase 5 验证: 真实 Pi SDK 集成");
  
  const piAgent = getPiSubAgent();
  
  // Test 1: 启动 Pi session
  console.log("\n📋 Test 1: 启动 Pi session");
  const handle = await piAgent.start({
    prompt: "读取项目根目录的 README.md 并生成 200 字摘要",
    userId: "test-user",
    workspace: process.cwd(),
    contextFiles: ["README.md"],
  });
  
  console.log(`✅ 启动成功: runId=${handle.runId}, sessionId=${handle.sessionId}`);
  
  // Test 2: 收集事件流
  console.log("\n📋 Test 2: 收集事件流");
  const events: any[] = [];
  
  for await (const event of handle.events) {
    console.log(`  → ${event.type}`);
    events.push(event);
    
    if (event.type === "run_completed") {
      break;
    }
  }
  
  // Test 3: 验证事件完整性
  console.log("\n📋 Test 3: 验证事件完整性");
  const expectedTypes = ["run_started", "assistant_message", "tool_call", "tool_result", "run_completed"];
  
  for (const type of expectedTypes) {
    const found = events.some(e => e.type === type);
    if (found) {
      console.log(`  ✅ ${type}`);
    } else {
      console.log(`  ❌ ${type} 缺失`);
    }
  }
  
  // Test 4: 检查最终结果
  console.log("\n📋 Test 4: 检查最终结果");
  const finalEvent = events.find(e => e.type === "run_completed");
  
  if (finalEvent && finalEvent.result) {
    console.log(`  ✅ 结果长度: ${finalEvent.result.length} 字符`);
    console.log(`  预览: ${finalEvent.result.substring(0, 100)}...`);
  } else {
    console.log(`  ❌ 未获取到结果`);
  }
}

verifyPhase5().catch(console.error);
```

#### 验证标准
- ✅ Pi session 成功启动（无异常抛出）
- ✅ 事件流包含预期类型（run_started → tool_call → run_completed）
- ✅ 最终返回 README 摘要（长度 > 0）
- ✅ 无 mock 事件（真实调用 Pi SDK）

---

## 🔧 P1 详细设计

### P1-1: 错误恢复机制

#### 问题陈述
当前实现中，SubAgent 异常会直接导致任务失败，无重试机制。

#### 目标
1. **自动重试**: SubAgent 启动失败或执行异常时，自动重试最多 3 次
2. **指数退避**: 重试间隔 1s / 2s / 4s
3. **状态恢复**: 从 `SubAgentRun` 表中恢复中断的任务

#### 实现方案

**文件**: `features/ai/agents/work/error-recovery.ts`

```typescript
export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number; // 毫秒
  maxDelay: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt < config.maxAttempts - 1) {
        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt),
          config.maxDelay
        );
        
        console.warn(
          `[Retry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
          error
        );
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw new Error(
    `Failed after ${config.maxAttempts} attempts: ${lastError?.message}`
  );
}
```

**集成到 PiSdkRuntime**:

```typescript
async start(input: PiStartInput): Promise<string> {
  return withRetry(async () => {
    // ... 原有的 start 逻辑 ...
  }, {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
  });
}
```

#### 验证标准
- ✅ 模拟 Pi SDK 启动失败 → 自动重试 3 次
- ✅ 第 2 次重试成功 → 任务正常完成
- ✅ 3 次全部失败 → 抛出聚合错误

---

### P1-2: 修复 Phase 4 HIL 遗留问题

#### 问题清单（来自 Phase 4 Code-Reviewer）

**P1-1**: HIL 竞态条件（用户提前审批）
- **问题**: 用户在 `approval_required` 事件发出前调用 `/api/ai/work/approve` 会失败
- **方案**: 在数据库 `PolicyAuditLog` 中增加 "pending approval" 状态，允许提前记录用户决策

**P1-2**: SubAgentRun 归属权检查
- **问题**: `POST /api/ai/work/approve` 没有验证 `runId` 是否属于当前用户
- **方案**: 在审批前查询 `SubAgentRun.userId` 并校验

**P1-3**: GET /api/ai/work/approve 缺少用户过滤
- **问题**: 返回所有用户的待审批项
- **方案**: 在 `findPendingApproval()` 中传入 `session.user.id` 过滤

**P1-4**: 审批超时清理机制
- **问题**: 待审批项可能永久停留在 `hil_pending` 状态
- **方案**: 增加定时任务（cron），超时后自动 deny + abort

#### 实施优先级
- P1-2 (归属权检查): **高风险**，优先修复
- P1-3 (用户过滤): **高风险**，优先修复
- P1-1 (竞态条件): 中等风险，P1 修复
- P1-4 (超时清理): 低风险，可延后到 P2

---

### P1-3: 并发控制

#### 问题陈述
多用户同时启动多个 SubAgent 时，可能导致：
1. 资源耗尽（CPU / 内存）
2. Pi SDK 实例冲突
3. 数据库连接池耗尽

#### 目标
1. **全局限流**: 最多同时运行 5 个 SubAgent
2. **用户限流**: 单用户最多 2 个并发 SubAgent
3. **队列机制**: 超出限制时进入等待队列

#### 实现方案

**文件**: `features/ai/agents/work/concurrency.ts`

```typescript
export interface ConcurrencyConfig {
  maxGlobalConcurrent: number;
  maxUserConcurrent: number;
  queueTimeout: number; // 队列等待超时（毫秒）
}

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  maxGlobalConcurrent: 5,
  maxUserConcurrent: 2,
  queueTimeout: 60000, // 1 分钟
};

export class ConcurrencyController {
  private globalRunning: Set<string> = new Set();
  private userRunning: Map<string, Set<string>> = new Map();
  private queue: Array<{
    runId: string;
    userId: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  
  constructor(private config: ConcurrencyConfig = DEFAULT_CONCURRENCY_CONFIG) {}
  
  async acquire(runId: string, userId: string): Promise<void> {
    // 检查是否可以立即执行
    if (this.canRun(userId)) {
      this.addRun(runId, userId);
      return;
    }
    
    // 进入队列等待
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeFromQueue(runId);
        reject(new Error(`Queue timeout after ${this.config.queueTimeout}ms`));
      }, this.config.queueTimeout);
      
      this.queue.push({ runId, userId, resolve, reject, timer });
    });
  }
  
  release(runId: string, userId: string): void {
    this.removeRun(runId, userId);
    this.processQueue();
  }
  
  private canRun(userId: string): boolean {
    const globalCount = this.globalRunning.size;
    const userCount = this.userRunning.get(userId)?.size || 0;
    
    return (
      globalCount < this.config.maxGlobalConcurrent &&
      userCount < this.config.maxUserConcurrent
    );
  }
  
  private processQueue(): void {
    for (let i = 0; i < this.queue.length; i++) {
      const item = this.queue[i];
      if (this.canRun(item.userId)) {
        clearTimeout(item.timer);
        this.queue.splice(i, 1);
        this.addRun(item.runId, item.userId);
        item.resolve();
        return;
      }
    }
  }
  
  // ... 其他辅助方法 ...
}

export const concurrencyController = new ConcurrencyController();
```

**集成到 PiSdkRuntime**:

```typescript
async start(input: PiStartInput): Promise<string> {
  const runId = `run_${Date.now()}`;
  
  // 获取并发槽位
  await concurrencyController.acquire(runId, input.userId);
  
  try {
    // ... 原有的 start 逻辑 ...
    return runId;
  } catch (error) {
    concurrencyController.release(runId, input.userId);
    throw error;
  }
}

async abort(runId: string): Promise<void> {
  // ... 原有的 abort 逻辑 ...
  
  // 释放并发槽位
  const run = await prisma.subAgentRun.findUnique({ where: { id: runId } });
  if (run) {
    concurrencyController.release(runId, run.userId);
  }
}
```

#### 验证标准
- ✅ 同时启动 10 个 SubAgent → 5 个运行，5 个进入队列
- ✅ 单用户启动 3 个 SubAgent → 2 个运行，1 个进入队列
- ✅ 队列超时（60s）→ 抛出 timeout 错误

---

## 🔧 P2 详细设计

### P2-1: 监控与日志

#### 目标
1. **结构化日志**: Winston / Pino 格式化日志
2. **性能指标**: SubAgent 执行时间 / 事件数量 / 错误率
3. **告警**: 连续失败 > 5 次时触发

#### 实现方案（简要）

**文件**: `features/ai/agents/work/logger.ts`

```typescript
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function logSubAgentEvent(event: {
  runId: string;
  eventType: string;
  duration?: number;
  error?: string;
}) {
  logger.info({
    component: 'SubAgent',
    runId: event.runId,
    eventType: event.eventType,
    duration: event.duration,
    error: event.error,
  });
}
```

---

### P2-2: 超时管理

#### 目标
1. **执行超时**: SubAgent 运行超过 10 分钟自动 abort
2. **审批超时**: HIL 待审批超过 1 小时自动 deny

#### 实现方案（简要）

**文件**: `features/ai/agents/work/timeout.ts`

```typescript
export const TIMEOUT_CONFIG = {
  subAgentExecution: 10 * 60 * 1000, // 10 分钟
  hilApproval: 60 * 60 * 1000, // 1 小时
};

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        onTimeout();
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}
```

**定时任务**（Cron）:
```typescript
// 每小时检查一次待审批项
cron.schedule('0 * * * *', async () => {
  const expired = await prisma.policyAuditLog.findMany({
    where: {
      decision: 'hil_pending',
      createdAt: {
        lt: new Date(Date.now() - TIMEOUT_CONFIG.hilApproval),
      },
    },
  });
  
  for (const log of expired) {
    await updateApproval(log.runId, 'denied');
    await piRuntime.abort(log.runId);
  }
});
```

---

## 📊 验证策略

### 单元测试
- [ ] `PiSdkRuntime.start()` 调用真实 Pi SDK
- [ ] 事件翻译覆盖所有类型
- [ ] 重试机制（模拟失败 → 重试 → 成功）
- [ ] 并发控制（队列 + 槽位释放）

### 集成测试
- [ ] 端到端验证（`phase-5-verify.ts`）
- [ ] HIL 审批流（创建 → 审批 → 恢复）
- [ ] 多用户并发场景

### 回归测试
- [ ] Phase 1-4 的验证脚本全部重跑
- [ ] 确保新改动不破坏旧功能

---

## 📅 里程碑与交付物

### Milestone 1: P0 完成 (预计 1-2 天)
- ✅ 真实 Pi SDK 集成
- ✅ 事件流映射完整
- ✅ 端到端验证通过
- 📄 `docs/ai/phase-5-p0-pi-sdk-integration.md`

### Milestone 2: P1 完成 (预计 2-3 天)
- ✅ 错误恢复机制
- ✅ Phase 4 HIL 问题修复
- ✅ 并发控制
- 📄 `docs/ai/phase-5-p1-stability-enhancements.md`

### Milestone 3: P2 完成 (可选，预计 1-2 天)
- ✅ 监控与日志
- ✅ 超时管理
- 📄 `docs/ai/phase-5-p2-observability.md`

### 最终交付
- 📄 `docs/ai/phase-5-production-readiness.md` (完成报告)
- 🧪 双审查报告（code-reviewer + ai-learning-mentor）
- 🚀 生产环境部署 Checklist

---

## 🚨 风险与依赖

### 技术风险
1. **Pi SDK 版本变更**: 0.84.2 → 更新版本可能有 breaking changes
   - **缓解**: 锁定版本号，升级前充分测试
2. **Node.js 22 部署**: 生产环境需要升级 Node 版本
   - **缓解**: 使用 nvm，保留 Node 20 fallback
3. **并发控制复杂度**: 可能需要引入 Redis 等外部依赖
   - **缓解**: 先实现内存版本，P2 再考虑 Redis

### 资源依赖
1. **环境变量**: `OPENAI_API_KEY` 或其他 LLM key（生产环境）
2. **磁盘空间**: Pi agentDir 可能占用空间（建议预留 1GB）
3. **数据库性能**: 高并发时 `SubAgentRun` 表查询压力（考虑索引优化）

---

## 📚 参考文档

- [Phase 0: Pi SDK Spike Results](./phase-0-pi-spike-results.md)
- [Phase 1: Work Agent Minimal Loop](./phase-1-work-agent-min-loop.md)
- [Phase 2: Pi SubAgent Integration](./phase-2-pi-subagent-integration.md)
- [Phase 3: Policy Gateway + HIL](./phase-3-policy-gateway-hil.md)
- [Phase 4: HIL Persistence](./phase-4-hil-persistence.md)
- [Pi SDK 官方文档](https://github.com/earendil-works/pi-coding-agent)

---

## ✅ 下一步行动

1. **用户确认范围**: P0 必须完成，P1/P2 根据时间决定
2. **开始实施 P0-1**: 真实 Pi SDK 集成
3. **环境准备**: 确保远程开发机 Node 22 + OPENAI_API_KEY 配置
4. **逐项验证**: 每完成一个 P0 任务，立即跑验证脚本

---

**计划制定完成**，等待用户确认后开始实施。
