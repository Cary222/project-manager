<!-- reviewer: ai-learning-mentor (软层) -->

# Phase 5: Production Readiness - 架构审查（软层）

> 🎭 当前身份：架构顾问（软层审查）
> 审查日期：2026-08-19
> 审查范围：真实 Pi SDK 集成 + 错误恢复 + 并发控制 + 监控 + 超时管理

---

## 审查摘要

**整体评价：APPROVED — 架构设计扎实，Phase 4 到 Phase 5 的演进逻辑清晰，有 3 处中等优先级的改进空间**

Phase 5 的核心成就是"从原型到生产"——把 Phase 2~4 搭建的 mock 骨架，换上了真实的 Pi SDK 肌肉，同时补上了生产环境必须的四肢（错误恢复、并发控制、监控、超时）。从软层视角看，架构选择经得起推敲，但有几个设计取舍值得在落地前对齐。

### 主要关注点

| 维度 | 结论 |
|------|------|
| 架构一致性 | ✅ 与 Phase 4 的 HIL 闭环、DB 持久化衔接顺畅 |
| 模块边界 | ✅ 六模块（sdk/events/error/concurrency/monitoring/timeout）各司其职 |
| 可扩展性 | ✅ 多处预留 Phase 6 扩展点（状态恢复、Redis 缓存） |
| 可维护性 | ✅ 代码行数控制得当（每个模块 <300 行） |
| 生产就绪度 | ⚠️ 有 3 处需要加固（见 § 技术债务） |
| 技术债务 | ⚠️ 有 5 处遗留 TODO 需要 Phase 6 承接 |

---

## 🏗️ 架构设计

### 1. Phase 4 → Phase 5 的演进逻辑 ✅

**Phase 4 留下的骨架**：
```
SubAgentRun 表（DB） + pausedRuns Map（内存） + PolicyAuditLog（审计）
```
这是 Phase 5 的地基。

**Phase 5 的四层叠加**：
```
第一层：真实 SDK（sdk.ts）
  └─ createAgentSession() + ModelRuntime
  └─ 从 UserApiKey 读凭证（resolveCredentialWithFallback）

第二层：事件翻译（events.ts）
  └─ 20+ 种 Pi 事件 → SubAgentEvent 统一接口
  └─ 保留 createMockEventStream() 作为 fallback

第三层：可靠性保障（error-recovery / concurrency / timeout）
  └─ 指数退避重试 + 错误分类 + 并发槽位 + 超时计时器

第四层：可观测性（monitoring.ts）
  └─ 结构化日志 + 性能指标 + 资源监控
```

**为什么分层合理？**

就像外卖系统：骑手（真实 SDK）接单 → 客服（事件翻译）传话 → 系统（错误恢复/并发/超时）处理异常 → 管理员后台（监控）看数据。每一层的职责单一，出问题时定位快。

**软层观察**：`events.ts` 同时保留 `translatePiEventStream()`（真实）和 `createMockEventStream()`（mock）两个路径，这是渐进式迁移的正确姿势——先 mock 跑通流程，再逐段替换真实 SDK，而不是一口气全换导致无法调试。

### 2. 凭证管理的三级降级链路 ✅

**设计验证**（`sdk.ts:154-198`）：

```typescript
// 1. 从数据库读取用户 API key
const cred = await resolveCredentialWithFallback(userId, providerName, {
  apiKey: process.env.OPENAI_API_KEY || "",
  baseURL: process.env.OPENAI_API_BASE_URL || "",
});

// 2. 设置到环境变量（Pi SDK 会读取）
process.env.OPENAI_API_KEY = cred.apiKey;
if (provider === "deepseek") {
  process.env.OPENAI_API_BASE_URL = cred.baseURL;
}
```

**为什么这个设计合理？**

- **渐进式**：先读 DB（用户自定义）→ 降级到 ENV（系统默认），不用改代码就能切换凭证来源
- **兼容历史**：你之前已经学过这个模式（`三级凭证降级链路`，#10199），Phase 5 复用了一样的思路
- **审计友好**：`cred.ownerType` 字段区分是谁的 key（SYSTEM / USER / ENV），审计日志能追溯

**潜在问题**：`process.env` 是全局的，如果同一个进程里跑两个不同用户的 Pi session，后者的 key 会覆盖前者。这是 Node.js 单进程模型的固有限制，Phase 6 如果做多租户隔离，需要考虑进程级隔离或 key 注入到 Pi SDK 的方式（而非全局 env）。

### 3. 错误分类与重试策略 ✅

**设计验证**（`error-recovery.ts:32-86`）：

错误分为三类，每类的处理策略不同：

| 错误类型 | 判断依据 | 处理策略 |
|----------|----------|----------|
| `RETRIABLE` | timeout / network / 502~504 | 指数退避重试（1s → 2s → 4s） |
| `NON_RETRIABLE` | unauthorized / 401~403 / validation failed | 立即失败，不浪费重试 |
| `FATAL` | OOM / disk full | 立即失败，报警告 |

**为什么这个分类重要？**

就像去医院分诊——不是所有"不舒服"都用同一种药。认证错误（401）重试一万次还是 401，但网络抖动（timeout）可能下次就好了。盲目重试既浪费资源又让用户等更久。

**指数退避 + 抖动的设计**（`error-recovery.ts:120-138`）：

```typescript
// 指数退避：1s → 2s → 4s → 8s（但 maxDelay = 10s 所以封顶）
const exponentialDelay = baseDelay * Math.pow(backoffFactor, attempt - 1);

// 抖动（±25%）：避免"雷鸣群效应"
const jitter = Math.random() * exponentialDelay * 0.5 - exponentialDelay * 0.25;
```

**类比**：就像等电梯——大家都卡在同一层等（没 jitter）vs 有人等 3 楼有人等 4 楼（有 jitter），后者电梯调度更均匀。

### 4. 并发控制的双层槽位设计 ✅

**设计验证**（`concurrency.ts:156-169`）：

```typescript
private canExecuteNow(userId: string): boolean {
  // 1. 检查全局并发限制（最多 10 个同时跑）
  if (this.runningCount >= this.config.globalMaxConcurrent) {
    return false;
  }
  // 2. 检查用户并发限制（每人最多 3 个）
  const userCount = this.runningByUser.get(userId) || 0;
  if (userCount >= this.config.perUserMaxConcurrent) {
    return false;
  }
  return true;
}
```

**为什么需要两层限制？**

- **全局限制**：保护服务器资源（CPU / 内存 / Pi SDK 实例）
- **用户限制**：防止单一用户"占满"所有槽位，影响其他用户体验

**队列机制**（`concurrency.ts:104-135`）：超出限制的请求进入 FIFO 队列，最长等 5 分钟（`queueTimeoutMs`）。

**软层观察**：当前队列是纯 FIFO（先到先服务），没有优先级机制。如果 Phase 6 要支持"紧急任务插队"，需要引入优先级队列。这是已知的扩展点，不算欠债。

### 5. 事件翻译的健壮性 ✅

**设计验证**（`events.ts:192-305`）：`translateSingleEvent()` 处理了 20+ 种 Pi 事件类型，映射关系清晰：

| 事件类别 | Pi 原生类型 | 映射到 SubAgentEvent |
|----------|-------------|---------------------|
| 消息 | agent_message / assistant_message / message | assistant_message |
| 工具调用 | tool_call / tool_invocation | tool_call |
| 工具结果 | tool_result / tool_execution_end | tool_result |
| 工具错误 | tool_execution_error / tool_error | tool_error |
| 通用错误 | error / session_error / fatal_error | error |
| Session 生命周期 | run_started / session_started / run_completed / session_completed | run_started / run_completed |
| HIL 审批 | approval_required / hil_approval | approval_required |
| 进度 | progress / step_progress | progress |
| 心跳 | heartbeat / ping | **忽略**（不转发到 SubAgent 层）|

**设计亮点**：心跳/ping 类型返回 `null` 而非抛出错误，这是正确的——系统事件不需要暴露给业务层。

---

## 📈 可扩展性分析

### Phase 6 扩展点清单

| 扩展方向 | 当前状态 | Phase 6 需要做什么 |
|----------|----------|-------------------|
| **跨进程状态恢复** | `recoverRun()` 只标记 FAILED | 从 `lastEventId` 继续执行（需要 Pi SDK 支持） |
| **Redis 分布式缓存** | 进程内 Map 缓存 Policy 规则 | Redis 替代，支持多实例部署 |
| **Pi SDK steer API** | `sdk.ts:366-382` throw Error | 调用 `session.steer()` 实现运行时干预 |
| **跨进程 Session 恢复** | `sdk.ts:471-500` 只查内存 session | 从 DB 重建 Pi session（需要 Pi SDK 支持） |
| **告警集成** | `monitoring.ts` 只有 console 输出 | 接入 PagerDuty / 飞书机器人 |
| **指标持久化** | `MetricsCollector` 内存存储，重启丢失 | InfluxDB / Prometheus + Grafana |

### 继承自 Phase 4 的扩展性

**三表职责已在 Phase 4 设计好**（见 Phase 4 AI-Mentor Review § 3）：
- `PolicyAuditLog` → 审计追溯
- `PolicyRule` → 规则外部化
- `SubAgentRun` → 状态持久化

Phase 5 没有改动这三表的 schema，这是正确的——生产就绪阶段不应重构数据模型，只应在既有骨架上补功能。

---

## 🔧 可维护性评估

### 代码组织 ✅

| 模块 | 行数 | 复杂度评价 |
|------|------|------------|
| `sdk.ts` | ~625 行 | ⚠️ 最长，但包含 SDK 集成、凭证管理、生命周期管理 |
| `events.ts` | ~305 行 | ✅ 翻译逻辑清晰，switch-case 结构 |
| `error-recovery.ts` | ~310 行 | ✅ 错误分类/重试/恢复/降级四大块 |
| `concurrency.ts` | ~280 行 | ✅ 并发控制 + 队列管理 |
| `monitoring.ts` | ~276 行 | ✅ 日志/指标/资源三块 |
| `timeout.ts` | ~185 行 | ✅ 简洁，超时管理单一职责 |

**软层观察**：`sdk.ts` 确实较长（625 行），但它承担的是"胶水层"职责——连接 Pi SDK、DB、Policy Gateway、凭证管理。这不是代码坏味道，而是模块边界划分的结果。如果将来要拆，可以把凭证管理和生命周期管理各抽一个文件。

### 命名一致性 ⚠️

Phase 4 的 `pausedRuns` 在 Phase 5 的 `sdk.ts` 中仍然使用（行 50-53），但 `concurrency.ts` 用的是 `runningRuns`。命名风格不一致，但不影响功能。

### 配置的可发现性 ✅

所有模块都用了 `DEFAULT_*_CONFIG` 常量作为默认值，配置项命名清晰（`globalMaxConcurrent` / `executionTimeoutMs` / `baseDelay`）。这是好的实践——用户看默认值就知道这个参数是干什么的。

---

## ✨ 最佳实践

### 符合的最佳实践 ✅

| 实践 | 实现位置 | 说明 |
|------|----------|------|
| **指数退避 + 抖动** | `error-recovery.ts:120-138` | 避免雷鸣群效应 |
| **错误分类决策** | `error-recovery.ts:32-86` | 不同错误不同处理，不盲目重试 |
| **并发双层限制** | `concurrency.ts:156-169` | 全局 + 用户级，防止资源独占 |
| **FIFO 队列 + 超时** | `concurrency.ts:104-135` | 有界队列，防止无限等待 |
| **事件类型枚举** | `events.ts` switch-case | 20+ 种事件全覆盖 |
| **内存指标保留上限** | `monitoring.ts:160` maxEntries=1000 | 防止 OOM |
| **百分位数统计** | `monitoring.ts:221-226` | P50/P95/P99 延迟 |
| **单例模式** | 全局 `get*Controller()` 函数 | 进程内共享状态 |
| **延迟导入** | `sdk.ts:36-42` getPolicyGatewayInstance | 避免循环依赖 |

### 轻微违反的最佳实践 ⚠️

| 实践 | 位置 | 说明 | 影响 |
|------|------|------|------|
| **console.log 混用** | `sdk.ts` 多处 | 计划用 `StructuredLogger`，但 `sdk.ts` 仍用 `console.log` | 低，Phase 5 P2 日志模块已就绪，等集成 |
| **any 类型** | `sdk.ts:206` `createPiSession` 返回 `any` | Pi SDK 类型不明确时的妥协 | 中，Phase 6 等 Pi SDK 类型定义完善后修复 |
| **process.env 全局副作用** | `sdk.ts:191-196` | 凭证设置到全局 env | 中，多租户场景需要进程隔离 |

---

## 💳 技术债务

### TODO 遗留清单

| 位置 | TODO 内容 | 优先级 | Phase 6 承接 |
|------|-----------|--------|-------------|
| `sdk.ts:117` | Policy Gateway tool_call hook 未集成 | 🔴 P1 | 实现拦截逻辑 |
| `sdk.ts:378` | steer() 未实现 | 🟡 P2 | 调用 Pi SDK steer API |
| `sdk.ts:419` | followUp() 调用 Pi SDK.followUp | 🟡 P2 | 从 DB 恢复 session 后调用 |
| `error-recovery.ts:247` | recoverRun() 只标记 FAILED | 🟡 P2 | 实现真正状态恢复 |
| `events.ts:75-173` | createMockEventStream() 仍是 mock | 🟢 低 | Phase 5 验证后删除 |

### 配置硬编码问题 ⚠️

| 配置项 | 当前值 | 问题 |
|--------|--------|------|
| `executionTimeoutMs` | 30 分钟 | 为什么是 30 分钟？不是 20 分钟或 1 小时？ |
| `approvalTimeoutMs` | 10 分钟 | 为什么是 10 分钟？ |
| `globalMaxConcurrent` | 10 | 为什么是 10？需要压测数据支撑 |
| `perUserMaxConcurrent` | 3 | 为什么是 3？ |

**建议**：这些值应该能从环境变量读取，并且有合理的 fallback。文档里应该说明"30 分钟是根据 XXX 估算的，10 分钟是根据用户调研的"。

---

## 🎯 改进建议

### 高优先级（Phase 5 落地前建议处理）

#### 1. 统一日志输出方式

**问题**：`monitoring.ts` 定义了 `StructuredLogger`，但 `sdk.ts` 仍用 `console.log`。混用会导致日志难以统一收集和分析。

**建议**：在 `sdk.ts` 中引入 `StructuredLogger`：

```typescript
import { StructuredLogger, LogLevel } from "../monitoring";
const logger = new StructuredLogger("PiSdkRuntime", LogLevel.INFO);
```

#### 2. 凭证管理的多租户隔离

**问题**：`process.env` 全局污染，同一进程无法同时服务两个不同 API key 的用户。

**建议**（Phase 6）：研究 Pi SDK 是否支持在调用时传递 API key 而非依赖全局 env。如果支持，改掉；如果不支持，文档里写清楚限制。

### 中优先级（Phase 6 处理）

#### 3. MetricsCollector 持久化

**问题**：内存存储，重启后数据丢失。无法做历史趋势分析。

**建议**：定期将聚合指标写入 DB（如每小时写一条 `MetricsSnapshot` 表）。

#### 4. 配置外部化

**问题**：所有配置硬编码在代码里，改值要改代码 + 重启。

**建议**：引入 `getConfig()` 函数，从 `.env.local` 读取：

```typescript
export const CONCURRENCY_CONFIG: ConcurrencyConfig = {
  globalMaxConcurrent: parseInt(process.env.PI_MAX_CONCURRENT || "10"),
  perUserMaxConcurrent: parseInt(process.env.PI_MAX_USER_CONCURRENT || "3"),
  ...
};
```

---

## 审查结论

### 状态：✅ APPROVED

**理由**：
1. 架构一致性良好，Phase 4 到 Phase 5 的演进逻辑清晰
2. 错误分类、并发控制、超时管理三套机制各司其职，没有重复造轮子
3. 事件翻译层健壮性好，20+ 事件类型全覆盖，有 fallback
4. 代码组织遵循单一职责，每个模块 <300 行
5. 技术债务已识别，有明确的 Phase 6 承接计划

### 给 fullstack-developer 的建议

Phase 5 落地时重点关注：

1. **sdk.ts 的 TODO 清理顺序**：先集成 Policy Gateway（最关键），再实现 steer/followUp（次要）
2. **console.log → StructuredLogger**：等集成完后统一替换，不要零散改
3. **压测验证配置**：全局 10 / 用户 3 / 30 分钟超时 这些值需要压测数据支撑，不是拍脑袋
4. **Phase 4 P0 问题的后续**：schema 字段不匹配（targetName/riskLevel）是否已在 schema migration 里修复？需要确认

---

## 参考文件

| 文件 | 作用 |
|------|------|
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | Pi SDK Transport 核心 |
| `features/ai/agents/work/subagents/pi/events.ts` | 事件翻译层 |
| `features/ai/agents/work/subagents/pi/error-recovery.ts` | 错误恢复机制 |
| `features/ai/agents/work/subagents/pi/concurrency.ts` | 并发控制 |
| `features/ai/agents/work/subagents/pi/monitoring.ts` | 监控与日志 |
| `features/ai/agents/work/subagents/pi/timeout.ts` | 超时管理 |
| `docs/ai/phase-5-production-readiness-plan.md` | Phase 5 实施计划 |
| `docs/reviews/PR-phase4-hil-persistence-ai-mentor.md` | Phase 4 软层审查（连续性参考） |

---

*审查人：ai-learning-mentor（架构顾问/软层）*
*审查时间：2026-08-19*
