# Phase 6: 集成测试 + 技术债务清理 + UI 集成

> **阶段目标**: 远程环境集成测试 + 安全加固 + WorkModePanel UI 完整闭环
> **优先级**: P0 (远程测试) > P1 (安全加固) > P2 (UI 集成)
> **预计工期**: 2-3 天

---

## 📋 背景与动机

### Phase 5 实际完成情况

✅ **已完成**:
- Pi SDK 核心功能验证（独立脚本 `test-pi-minimal.mjs` 通过）
- API Key 管理修复（SYSTEM 级别 + AES-256-GCM 解密）
- ModelRuntime 正确初始化（`setRuntimeApiKey` + `getProviderAuthStatus`）
- AgentSession 正确创建（`result.session` 提取）
- 事件流监听（`subscribe` 回调 API）
- 重试机制（凭证获取 2 次，Session 创建 3 次）

⚠️ **部分完成**:
- `sdk.ts` 核心修复已完成，但 TypeScript ESM 导入问题导致无法通过 `npx tsx` 运行完整的 `phase-5-p0-verify.ts`
- 建议通过生产环境 UI 或编译后的代码测试完整流程

### Phase 5 遗留问题（调整后优先级）

| 问题 | 影响范围 | 优先级 | 备注 |
|------|---------|-------|------|
| **完整集成测试未执行** | Pi SDK 在生产环境的实际表现未知 | 🔴 P0 | 核心功能已验证，需 UI 测试 |
| **数据库迁移未执行** | PolicyAuditLog/PolicyRule/SubAgentRun 表不存在 | 🔴 P0 | 远程数据库缺表 |
| **WorkModePanel UI 未连接后端** | 用户无法通过 UI 触发 SubAgent | 🟡 P1 | 后端 API 已就绪 |
| **process.env API key 污染** | 多租户环境下 API key 可能串用 | 🟡 P1 | 当前单用户测试可接受 |
| **Pi SDK 类型定义不完整** | 使用 `as any` 规避类型检查 | 🟢 P2 | 不影响运行 |

### Phase 6 目标

1. **远程环境集成测试**（P0）
   - 在 `192.168.1.14` 生产环境执行端到端测试
   - 验证 Pi SDK + 数据库 + HIL 完整链路
   - 性能基准测试（并发 / 超时 / 错误恢复）

2. **安全加固**（P1）
   - 移除 `process.env` 全局 API key 污染
   - 实现 Pi SDK runtime credential passing（如果支持）
   - 或使用进程隔离 / 用户级环境变量

3. **UI 集成**（P1）
   - WorkModePanel 连接 `/api/ai/work/run`
   - HIL 审批 UI 连接 `/api/ai/work/approve`
   - 实时事件流展示（SSE / WebSocket）

4. **数据库迁移执行**（P0）
   - 在远程数据库执行 Phase 4/5 迁移脚本
   - 验证表结构 + 索引 + 约束

---

## 🎯 P0: 远程集成测试 + 数据库迁移

### P0-1: 数据库迁移执行

**目标**: 在 `hxy@192.168.1.14` 的 PostgreSQL `pm` schema 中应用所有迁移

**步骤**:

```bash
# 1. SSH 到远程机器
ssh hxy@192.168.1.14

# 2. 进入项目目录
cd ~/work/personal/project-manager

# 3. 拉取最新代码
git pull origin main

# 4. 检查数据库连接
psql "postgresql://hxy:your_password@localhost:5432/community?options=-c%20search_path=pm,public"

# 5. 执行 Prisma 迁移（自动检测未应用的迁移）
npx prisma migrate deploy

# 6. 验证表结构
psql -c "\d+ pm.PolicyAuditLog" community
psql -c "\d+ pm.PolicyRule" community
psql -c "\d+ pm.SubAgentRun" community

# 7. 重新生成 Prisma Client
npx prisma generate
```

**验证清单**:
- [ ] `PolicyAuditLog` 表存在（11 列）
- [ ] `PolicyRule` 表存在（15 列，含 targetName/riskLevel/requiresApproval）
- [ ] `SubAgentRun` 表存在（13 列）
- [ ] 枚举类型正确（PolicyDecision / PolicyRuleType / SubAgentStatus）
- [ ] 外键约束正确（userId → User）

---

### P0-2: 端到端远程测试

**目标**: 在生产环境执行完整 SubAgent 运行

**测试脚本**: `scripts/workagent/phase-6-remote-e2e.ts`

```typescript
/**
 * Phase 6 P0-2: 远程环境端到端测试
 * 
 * 测试场景：
 * 1. 真实用户 API key（从数据库读取）
 * 2. 真实 Pi SDK session
 * 3. HIL 审批流程（模拟用户批准）
 * 4. 数据库持久化（PolicyAuditLog / SubAgentRun）
 * 5. 并发控制（启动 3 个并发 run）
 * 6. 错误恢复（模拟 API 限流）
 */

import { PiSdkRuntime } from "../features/ai/agents/work/subagents/pi/transports/sdk";
import type { PiRunInput } from "../features/ai/agents/work/subagents/pi/runtime";
import { prisma } from "../shared/db/client";

async function testBasicRun() {
  console.log("🧪 Test 1: 基本 SubAgent 运行");
  
  const userId = process.env.TEST_USER_ID; // 从环境变量读取测试用户 ID
  if (!userId) throw new Error("请设置 TEST_USER_ID 环境变量");
  
  const runtime = new PiSdkRuntime();
  const input: PiRunInput = {
    prompt: "列出当前目录下的所有文件",
    workspace: process.cwd(),
    userId,
    provider: "deepseek",
  };
  
  const handle = await runtime.start(input);
  
  let eventCount = 0;
  for await (const event of handle.events) {
    console.log(`  [${event.type}]`, event);
    eventCount++;
    
    if (event.type === "completed" || event.type === "error") break;
  }
  
  console.log(`✅ 收到 ${eventCount} 个事件`);
  
  // 验证数据库持久化
  const subAgentRun = await prisma.subAgentRun.findUnique({
    where: { runId: handle.runId },
  });
  
  if (!subAgentRun) throw new Error("SubAgentRun 未持久化到数据库");
  console.log(`✅ SubAgentRun 已持久化: ${subAgentRun.id}`);
}

async function testHILApproval() {
  console.log("\n🧪 Test 2: HIL 审批流程");
  
  const userId = process.env.TEST_USER_ID!;
  const runtime = new PiSdkRuntime();
  
  const input: PiRunInput = {
    prompt: "删除 /tmp/test.txt 文件", // 触发 HIL（高风险操作）
    workspace: process.cwd(),
    userId,
  };
  
  const handle = await runtime.start(input);
  
  let approvalRequired = false;
  let approvalRunId = "";
  
  for await (const event of handle.events) {
    console.log(`  [${event.type}]`, event);
    
    if (event.type === "approval_required") {
      approvalRequired = true;
      approvalRunId = handle.runId;
      console.log(`  ⏸️  等待审批: runId=${approvalRunId}`);
      
      // 模拟用户批准（调用 approve API）
      await fetch("http://localhost:3003/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: approvalRunId,
          approved: true,
          reason: "测试审批",
        }),
      });
      
      console.log(`  ✅ 已批准`);
    }
    
    if (event.type === "completed" || event.type === "error") break;
  }
  
  if (!approvalRequired) {
    throw new Error("未触发 HIL 审批（可能策略配置有误）");
  }
  
  // 验证审计日志
  const auditLog = await prisma.policyAuditLog.findFirst({
    where: { runId: approvalRunId },
  });
  
  if (!auditLog) throw new Error("PolicyAuditLog 未记录");
  console.log(`✅ 审计日志已记录: decision=${auditLog.decision}`);
}

async function testConcurrencyControl() {
  console.log("\n🧪 Test 3: 并发控制");
  
  const userId = process.env.TEST_USER_ID!;
  const runtime = new PiSdkRuntime();
  
  // 启动 3 个并发 run
  const promises = Array.from({ length: 3 }, async (_, i) => {
    const input: PiRunInput = {
      prompt: `任务 ${i + 1}: 列出当前目录`,
      workspace: process.cwd(),
      userId,
    };
    
    const handle = await runtime.start(input);
    console.log(`  🚀 启动 run ${i + 1}: ${handle.runId}`);
    
    for await (const event of handle.events) {
      if (event.type === "completed" || event.type === "error") {
        console.log(`  ✅ Run ${i + 1} 完成`);
        break;
      }
    }
  });
  
  await Promise.all(promises);
  console.log(`✅ 3 个并发 run 全部完成`);
}

async function testErrorRecovery() {
  console.log("\n🧪 Test 4: 错误恢复");
  
  const userId = process.env.TEST_USER_ID!;
  const runtime = new PiSdkRuntime();
  
  // 模拟 API key 无效（触发重试）
  process.env.OPENAI_API_KEY = "invalid_key";
  
  const input: PiRunInput = {
    prompt: "测试错误恢复",
    workspace: process.cwd(),
    userId,
  };
  
  try {
    const handle = await runtime.start(input);
    
    for await (const event of handle.events) {
      console.log(`  [${event.type}]`, event);
      
      if (event.type === "error") {
        console.log(`  ⚠️  错误事件: ${event.error}`);
        break;
      }
    }
  } catch (error) {
    console.log(`  ✅ 错误被正确捕获: ${(error as Error).message}`);
  } finally {
    // 恢复正确的 API key
    delete process.env.OPENAI_API_KEY;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Phase 6 P0-2: 远程环境端到端测试");
  console.log("=".repeat(60));
  
  try {
    await testBasicRun();
    await testHILApproval();
    await testConcurrencyControl();
    await testErrorRecovery();
    
    console.log("\n" + "=".repeat(60));
    console.log("✅ 所有测试通过！");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ 测试失败:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

**执行方式**:

```bash
# 在远程机器上执行
ssh hxy@192.168.1.14
cd ~/work/personal/project-manager

# 设置测试用户（从数据库查询已有用户的 ID）
export TEST_USER_ID="<实际用户ID>"

# 运行测试
npx tsx scripts/workagent/phase-6-remote-e2e.ts
```

**验证清单**:
- [ ] 测试 1: 基本运行成功，收到 10+ 事件
- [ ] 测试 2: HIL 审批触发，审计日志记录
- [ ] 测试 3: 3 个并发 run 全部完成，无死锁
- [ ] 测试 4: 错误被正确捕获，重试机制生效

---

### P0-3: 性能基准测试

**目标**: 测量生产环境性能指标

**测试脚本**: `scripts/workagent/phase-6-benchmark.ts`

```typescript
/**
 * Phase 6 P0-3: 性能基准测试
 * 
 * 指标：
 * - SubAgent 启动时间（P50 / P95 / P99）
 * - 事件流延迟（首个事件到达时间）
 * - HIL 审批响应时间
 * - 并发吞吐量（QPS）
 * - 内存占用（RSS / Heap）
 * - 数据库查询耗时
 */

import { PiSdkRuntime } from "../features/ai/agents/work/subagents/pi/transports/sdk";
import { getMetricsCollector } from "../features/ai/agents/work/subagents/pi/monitoring";

async function benchmarkStartupTime() {
  console.log("📊 Benchmark 1: SubAgent 启动时间");
  
  const samples = 20;
  const startTimes: number[] = [];
  
  const runtime = new PiSdkRuntime();
  const userId = process.env.TEST_USER_ID!;
  
  for (let i = 0; i < samples; i++) {
    const start = Date.now();
    
    const handle = await runtime.start({
      prompt: "echo hello",
      workspace: process.cwd(),
      userId,
    });
    
    // 等待第一个事件
    for await (const event of handle.events) {
      if (event.type === "start") {
        const elapsed = Date.now() - start;
        startTimes.push(elapsed);
        console.log(`  Sample ${i + 1}: ${elapsed}ms`);
        break;
      }
    }
    
    await handle.abort();
  }
  
  // 计算百分位
  startTimes.sort((a, b) => a - b);
  const p50 = startTimes[Math.floor(samples * 0.5)];
  const p95 = startTimes[Math.floor(samples * 0.95)];
  const p99 = startTimes[Math.floor(samples * 0.99)];
  
  console.log(`\n  P50: ${p50}ms`);
  console.log(`  P95: ${p95}ms`);
  console.log(`  P99: ${p99}ms`);
  
  // 基准: P50 < 500ms, P95 < 1000ms
  if (p50 > 500) console.warn(`  ⚠️  P50 过高（期望 <500ms）`);
  if (p95 > 1000) console.warn(`  ⚠️  P95 过高（期望 <1000ms）`);
}

async function benchmarkThroughput() {
  console.log("\n📊 Benchmark 2: 并发吞吐量");
  
  const duration = 60 * 1000; // 1 分钟
  const concurrency = 5;
  const runtime = new PiSdkRuntime();
  const userId = process.env.TEST_USER_ID!;
  
  let completedRuns = 0;
  const startTime = Date.now();
  
  async function worker() {
    while (Date.now() - startTime < duration) {
      try {
        const handle = await runtime.start({
          prompt: "echo hello",
          workspace: process.cwd(),
          userId,
        });
        
        for await (const event of handle.events) {
          if (event.type === "completed" || event.type === "error") {
            completedRuns++;
            break;
          }
        }
      } catch (error) {
        console.error(`  Worker error:`, error);
      }
    }
  }
  
  await Promise.all(Array.from({ length: concurrency }, worker));
  
  const elapsed = Date.now() - startTime;
  const qps = (completedRuns / elapsed) * 1000;
  
  console.log(`  完成 ${completedRuns} 次运行`);
  console.log(`  耗时 ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`  QPS: ${qps.toFixed(2)}`);
  
  // 基准: QPS > 1
  if (qps < 1) console.warn(`  ⚠️  QPS 过低（期望 >1）`);
}

async function benchmarkMemoryUsage() {
  console.log("\n📊 Benchmark 3: 内存占用");
  
  const runtime = new PiSdkRuntime();
  const userId = process.env.TEST_USER_ID!;
  
  const beforeRss = process.memoryUsage().rss;
  const beforeHeap = process.memoryUsage().heapUsed;
  
  // 运行 10 个 SubAgent
  for (let i = 0; i < 10; i++) {
    const handle = await runtime.start({
      prompt: "echo hello",
      workspace: process.cwd(),
      userId,
    });
    
    for await (const event of handle.events) {
      if (event.type === "completed" || event.type === "error") break;
    }
  }
  
  const afterRss = process.memoryUsage().rss;
  const afterHeap = process.memoryUsage().heapUsed;
  
  const rssDelta = (afterRss - beforeRss) / 1024 / 1024;
  const heapDelta = (afterHeap - beforeHeap) / 1024 / 1024;
  
  console.log(`  RSS 增长: ${rssDelta.toFixed(2)} MB`);
  console.log(`  Heap 增长: ${heapDelta.toFixed(2)} MB`);
  console.log(`  平均每 run: ${(rssDelta / 10).toFixed(2)} MB`);
  
  // 基准: 平均每 run < 50MB
  if (rssDelta / 10 > 50) console.warn(`  ⚠️  内存占用过高（期望 <50MB/run）`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("Phase 6 P0-3: 性能基准测试");
  console.log("=".repeat(60));
  
  await benchmarkStartupTime();
  await benchmarkThroughput();
  await benchmarkMemoryUsage();
  
  // 从 MetricsCollector 获取统计
  const metrics = getMetricsCollector().getMetrics();
  console.log("\n📈 汇总统计:");
  console.log(`  总运行次数: ${metrics.totalRuns}`);
  console.log(`  成功率: ${((metrics.successfulRuns / metrics.totalRuns) * 100).toFixed(1)}%`);
  console.log(`  平均运行时长: ${metrics.averageDuration.toFixed(0)}ms`);
}

main();
```

**基准目标**:

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 启动时间 P50 | < 500ms | 从 start() 到首个事件 |
| 启动时间 P95 | < 1000ms | 包含冷启动 |
| 并发 QPS | > 1 | 5 并发下的吞吐量 |
| 内存占用 | < 50MB/run | 平均每个 SubAgent |
| 成功率 | > 95% | 非错误完成的比例 |

---

## 🔐 P1: 安全加固

### P1-1: 移除全局 API key 污染

**问题**: 当前 `sdk.ts` 修改 `process.env.OPENAI_API_KEY`，在多租户环境下会导致 API key 串用

**方案 A: Pi SDK Runtime Credential Passing（首选）**

检查 Pi SDK 是否支持运行时传入凭证：

```typescript
// 理想方案: Pi SDK 支持 runtime credential
const piSession = await createAgentSession({
  agentDir: input.workspace,
  model: this.resolveModel(input),
  credentials: {
    openai: { apiKey: userApiKey },
    anthropic: { apiKey: userAnthropicKey },
  },
});
```

如果支持，移除 `process.env` 修改，改为直接传入 `credentials`。

**方案 B: 进程隔离（备选）**

如果 Pi SDK 不支持 runtime credential，使用子进程隔离：

```typescript
// 每个用户的 SubAgent 在独立子进程中运行
import { fork } from "child_process";

class IsolatedPiRuntime implements PiRuntime {
  async start(input: PiRunInput): Promise<PiRunHandle> {
    // 启动子进程，env 只包含该用户的 API key
    const child = fork("./pi-worker.js", [], {
      env: {
        ...process.env,
        OPENAI_API_KEY: await this.getUserApiKey(input.userId),
      },
    });
    
    // 通过 IPC 通信
    child.send({ type: "start", input });
    
    return {
      runId: generateRunId(),
      events: this.createEventStreamFromIPC(child),
      abort: () => child.kill(),
    };
  }
}
```

**验证清单**:
- [ ] 方案 A 或 B 已实现
- [ ] 并发测试：2 个不同用户的 SubAgent 同时运行，API key 不串用
- [ ] 安全测试：用户 A 无法通过 SubAgent 访问用户 B 的 API key

---

### P1-2: 敏感数据脱敏

**目标**: 日志和审计记录中不暴露完整 API key

```typescript
// monitoring.ts
function sanitizeApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) return "***";
  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

class StructuredLogger {
  log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    const sanitized = { ...context };
    
    // 自动脱敏敏感字段
    if (sanitized.apiKey) sanitized.apiKey = sanitizeApiKey(String(sanitized.apiKey));
    if (sanitized.token) sanitized.token = sanitizeApiKey(String(sanitized.token));
    
    console.log(JSON.stringify({
      level,
      message,
      context: sanitized,
      timestamp: new Date().toISOString(),
    }));
  }
}
```

---

## 🎨 P2: UI 集成

### P2-1: WorkModePanel 连接后端

**目标**: 用户可以通过 UI 触发 SubAgent

**文件**: `features/ai/ui/work/WorkModePanel.tsx`

```typescript
"use client";

import { useState } from "react";

export function WorkModePanel() {
  const [prompt, setPrompt] = useState("");
  const [events, setEvents] = useState<SubAgentEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsRunning(true);
    setEvents([]);
    
    try {
      // 调用 /api/ai/work/run
      const res = await fetch("/api/ai/work/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          workspace: "/path/to/workspace",
          contextFiles: [],
        }),
      });
      
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      
      const data = await res.json();
      setRunId(data.runId);
      
      // 订阅事件流（SSE）
      const eventSource = new EventSource(`/api/ai/work/run/${data.runId}/events`);
      
      eventSource.onmessage = (e) => {
        const event = JSON.parse(e.data) as SubAgentEvent;
        setEvents((prev) => [...prev, event]);
        
        if (event.type === "completed" || event.type === "error") {
          eventSource.close();
          setIsRunning(false);
        }
        
        if (event.type === "approval_required") {
          // 显示审批 UI
          setShowApprovalModal(true);
        }
      };
      
      eventSource.onerror = () => {
        eventSource.close();
        setIsRunning(false);
      };
    } catch (error) {
      console.error("Failed to start SubAgent:", error);
      setIsRunning(false);
    }
  }
  
  return (
    <div className="work-mode-panel">
      <form onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入任务描述..."
          disabled={isRunning}
        />
        <button type="submit" disabled={isRunning || !prompt}>
          {isRunning ? "运行中..." : "启动 SubAgent"}
        </button>
      </form>
      
      <div className="event-stream">
        {events.map((event, i) => (
          <EventCard key={i} event={event} />
        ))}
      </div>
      
      {showApprovalModal && (
        <ApprovalModal
          runId={runId!}
          onApprove={() => handleApprove(true)}
          onReject={() => handleApprove(false)}
        />
      )}
    </div>
  );
}
```

**新 API 路由**: `app/api/ai/work/run/[runId]/events/route.ts`

```typescript
/**
 * SSE 事件流订阅
 * GET /api/ai/work/run/[runId]/events
 */

import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;
  
  // 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      // 从 PiRuntime 获取事件流
      const piRuntime = getPiSubAgent();
      const handle = await piRuntime.getRunHandle(runId);
      
      if (!handle) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: "Run not found" })}\n\n`));
        controller.close();
        return;
      }
      
      try {
        for await (const event of handle.events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          
          if (event.type === "completed" || event.type === "error") {
            controller.close();
            break;
          }
        }
      } catch (error) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", error: String(error) })}\n\n`));
        controller.close();
      }
    },
  });
  
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

---

### P2-2: HIL 审批 UI

**组件**: `features/ai/ui/work/ApprovalModal.tsx`

```typescript
"use client";

import { useState } from "react";

interface ApprovalModalProps {
  runId: string;
  tool: string;
  args: Record<string, unknown>;
  riskLevel: string;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalModal({
  runId,
  tool,
  args,
  riskLevel,
  onApprove,
  onReject,
}: ApprovalModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  async function handleDecision(approved: boolean) {
    setIsSubmitting(true);
    
    try {
      const res = await fetch("/api/ai/work/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId,
          approved,
          reason,
        }),
      });
      
      if (!res.ok) throw new Error(`Approval failed: ${res.status}`);
      
      if (approved) {
        onApprove();
      } else {
        onReject();
      }
    } catch (error) {
      console.error("Approval error:", error);
      alert("审批失败，请重试");
    } finally {
      setIsSubmitting(false);
    }
  }
  
  return (
    <div className="approval-modal-overlay">
      <div className="approval-modal">
        <h2>需要人工审批</h2>
        
        <div className="risk-badge" data-level={riskLevel}>
          风险等级: {riskLevel}
        </div>
        
        <div className="tool-info">
          <p><strong>工具:</strong> {tool}</p>
          <pre>{JSON.stringify(args, null, 2)}</pre>
        </div>
        
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="审批理由（可选）"
        />
        
        <div className="actions">
          <button
            onClick={() => handleDecision(true)}
            disabled={isSubmitting}
            className="approve-btn"
          >
            批准
          </button>
          <button
            onClick={() => handleDecision(false)}
            disabled={isSubmitting}
            className="reject-btn"
          >
            拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## ✅ Phase 6 完成标准

| 任务 | 验收标准 |
|------|---------|
| **P0-1: 数据库迁移** | 所有表和枚举在生产数据库中存在 |
| **P0-2: 端到端测试** | 4 个测试场景全部通过 |
| **P0-3: 性能基准** | 所有指标达到基准目标 |
| **P1-1: 安全加固** | 并发多租户测试无 API key 串用 |
| **P1-2: 敏感数据脱敏** | 日志中 API key 被脱敏 |
| **P2-1: UI 集成** | 用户可通过 WorkModePanel 触发 SubAgent |
| **P2-2: HIL UI** | 审批 Modal 正确显示并提交决策 |

---

## 📝 Phase 6 执行顺序

```
Day 1 (P0):
  ├─ 上午: P0-1 数据库迁移 + 验证
  └─ 下午: P0-2 端到端测试 + P0-3 性能基准

Day 2 (P1):
  ├─ 上午: P1-1 安全加固（方案选择 + 实现）
  └─ 下午: P1-2 敏感数据脱敏 + 安全测试

Day 3 (P2):
  ├─ 上午: P2-1 WorkModePanel UI 集成 + SSE 事件流
  └─ 下午: P2-2 HIL 审批 UI + 端到端测试

Day 4 (验收):
  ├─ 上午: 完整回归测试
  └─ 下午: 文档更新 + Phase 6 完成报告
```

---

## 🚀 下一步（Phase 7 预览）

Phase 6 完成后，考虑：

1. **多模型支持**（Claude / GPT-4 / Gemini）
2. **工作流自动化**（基于 LangGraph 的 workflow）
3. **SubAgent 模板库**（预定义任务模板）
4. **协作模式**（多 SubAgent 协同）
5. **成本优化**（模型选择策略 / token 限制）

---

**Phase 6 启动时间**: 2026-08-19 14:15（已提交 Phase 5）
**预计完成时间**: 2026-08-21
**负责人**: Main Agent + User 决策
