<!-- reviewer: ai-learning-mentor (软层) -->

# Phase 4 HIL + Persistence 架构审查（软层）

> 🎭 当前身份：架构顾问（软层审查）
> 审查日期：2026-08-19
> 审查范围：HIL 完整闭环 + 数据库持久化

---

## 审查摘要

**整体评价：APPROVED — 设计合理，可进入 Phase 5**

Phase 4 的架构设计体现了良好的工程直觉：**将策略外部化、审计持久化、HIL 闭环打通**。从软层视角看，核心设计选择经得起推敲，但有 2 处细节值得在 Phase 5 落地前确认。

### 主要关注点

| 维度 | 结论 |
|------|------|
| HIL 闭环 | ✅ 设计合理，Promise + resolve 模式清晰 |
| 三表职责 | ✅ 划分清晰，审计/规则/运行状态各自独立 |
| PolicyGateway | ✅ 作为中心化审计点的设计合理 |
| 扩展性 | ⚠️ 有 1 处隐患需关注 |
| 可维护性 | ✅ 代码组织清晰，职责单一 |
| 技术债务 | ⚠️ Mock 替换计划需明确 |

---

## 🏗️ 架构设计

### 1. HIL 闭环设计 ✅

**设计选择**：API → `pausedRuns` Map → Promise resolve → `followUp()`

```
用户点击"批准"
    ↓
POST /api/ai/work/approve
    ↓
piSubAgent.resume(runId, reason)
    ↓
PiSdkRuntime.followUp(runId, input)
    ↓
pausedRuns.get(runId).resolve(input)
    ↓
事件流继续执行
```

**为什么这个设计合理？**

- **类比**：就像订外卖时"骑手到了打电话叫你下楼"，你在 `approval_required` 事件处暂停（等电话），`resolve` 就是你下楼取餐，之后骑手继续送下一单
- **关键点**：事件流本身被 `await approvalPromise` 阻塞，外部通过 resolve 解锁——这是**协程思维**，不是回调地狱

**代码验证**（`sdk.ts:419-438`）：

```typescript
// 🔑 在发出 approval_required 事件之前，先创建 Promise 并注册到 pausedRuns
const approvalPromise = new Promise<string>((resolve, reject) => {
  this.pausedRuns.set(runId, { resolve, reject });
  // ...超时处理...
});

// 触发 HIL 审批请求
yield { type: "approval_required", ... };

// 等待用户审批（阻塞事件流）
const userInput = await approvalPromise;
```

这个顺序很关键：**先注册 resolver，再 yield 事件，再 await**。如果顺序反了，会出现"事件发出了但没人接收"的竞态。

**软层观察**：超时处理用 `setTimeout` + `clearTimeout`，但超时后只 reject，没有触发 `run_completed` 或状态更新。Phase 5 接入真实 Pi SDK 时需要确认超时是否会自动结束 run。

### 2. `pausedRuns` Map 生命周期管理 ⚠️

**设计**：内存 Map，key = runId，value = { resolve, reject }

**优点**：
- 简单直接，O(1) 查找
- 与 SubAgentRun 生命周期对齐（run 结束时自然清理）

**隐患**：Next.js 的 **hot reload** 会重置进程，导致 Map 丢失。但设计者意识到了这个问题——`SubAgentRun` 表已经持久化了 run 状态，理论上可以在进程恢复时重建 pausedRuns。

**Phase 5 需要做的事**：在 `PiSdkRuntime` 初始化时，从数据库查询所有 `status = "WAITING_APPROVAL"` 的 run，重建 pausedRuns Map。

### 3. 三表职责划分 ✅

| 表 | 职责 | 设计评价 |
|----|------|----------|
| `PolicyAuditLog` | 每次 tool_call 的决策记录 | ✅ 原子化，每条记录是一次检查结果 |
| `PolicyRule` | 策略规则定义 | ✅ 外部化，支持运行时更新 |
| `SubAgentRun` | SubAgent 运行会话 | ✅ 完整生命周期，含状态/结果/错误 |

**审计日志的 6W 覆盖**（`PolicyAuditLog` 字段）：

| 字段 | 对应 W |
|------|--------|
| runId / userId / tool | Who + What（谁做了什么操作） |
| args / command / filePaths | What exactly（具体参数） |
| workspace | Where（在哪个工作目录） |
| createdAt | When（何时发生） |
| decision / reason | Why（决策依据） |
| approvedAt / approvedBy | How（如何处理） |

**为什么 args 是 Json 而不是 String？** Json 支持存储复杂参数结构（如 `{ path: "a.ts", content: "..." }`），但设计文档也指出了安全脱敏需求——Phase 5 应该在 `persistAuditLog` 之前对敏感字段做脱敏处理。

### 4. PolicyGateway 作为中心化审计点 ✅

**设计验证**（`policy/index.ts`）：

```typescript
async check(context: PolicyContext): Promise<PolicyResult> {
  // 1. Policy Gateway 未启用 → 直接放行
  if (!this.config.enabled) { return { decision: "allow", ... }; }

  // 2. 调用 tool-policy（三层检查已在内部串联）
  const result = await checkTool(context);

  // 3. 如果需要审批，但 HIL 未启用 → 根据配置决定
  if (result.decision === "approve" && !this.config.hilEnabled) {
    return { decision: this.config.timeoutDecision, ... };
  }

  // 4. 记录审计日志
  if (this.config.auditEnabled) {
    this.recordAudit(context, result);
  }

  return result;
}
```

**为什么这个设计合理？**

- **单一职责**：PolicyGateway 只做两件事——决策 + 审计，不做执行
- **可配置**：通过 `PolicyConfig` 控制是否启用审计、审批超时等
- **降级设计**：数据库写入失败不影响 tool_call 执行（`persistAuditLog` 用 catch 吞掉错误）
- **双轨查询**：数据库查询失败时降级到内存日志（`getAuditLogFromMemory`）

**软层观察**：`getAuditLog` 的内存降级方案有个问题——内存日志和数据库日志是两个独立的数据源，如果数据库写入失败，降级后 `getAuditLog` 返回的是不完整的审计记录。这个 trade-off 在设计文档中已经明确（"数据库写入失败不应阻塞 tool_call 执行"），是合理的取舍。

---

## 📈 扩展性分析

### 1. PolicyRule 规则类型扩展 ✅

| 规则类型 | 当前实现 | 扩展路径 |
|----------|----------|----------|
| TOOL_WHITELIST / TOOL_BLACKLIST | ✅ 已实现 | — |
| TOOL_HIL | ✅ 已实现 | — |
| COMMAND_WHITELIST / COMMAND_BLACKLIST | ⚠️ 代码中未完全接入 DB | 见下方 |
| PATH_BLACKLIST | ⚠️ 代码中未完全接入 DB | 见下方 |

**当前状态**：`tool-policy.ts` 的 `loadPoliciesFromDB()` 只处理 `ruleType === "TOOL"` 的规则。`command-policy.ts` 和 `path-policy.ts` 仍然是硬编码的 Set/Regex。

**为什么这样设计是合理的？**

- Phase 4 的核心目标是"打通路"，先把 Tool 规则外部化，Command/Path 规则在 Phase 5 或更晚迁移
- 命令规则需要更复杂的匹配逻辑（支持前缀/正则），路径规则需要 workspace 上下文，这些比工具名匹配更复杂

**Phase 5 建议**：统一用 `PolicyRule` 表存储所有规则，`ruleType` 字段区分类型，`pattern` 字段存匹配规则，`metadata` 字段存额外配置（如正则表达式、workspace 限制）。

### 2. SubAgent 扩展性 ✅

`SubAgentRun.agentType` 是 String 而非 Enum，支持未来扩展到 Claude Code、Devin 等其他 SubAgent。

**Phase 5 需要的事**：为 Claude Code 等其他 agent 实现对应的 Runtime transport（`transports/claude.ts`），然后在 `runtime.ts:createPiRuntime` 中添加路由。

### 3. 缓存策略与分布式 ⚠️

**当前设计**：`tool-policy.ts` 使用进程内缓存（60 秒 TTL）

**分布式隐患**：多实例部署时，规则更新后只有当前实例的缓存失效，其他实例仍使用旧规则。

**缓解措施**：`policy/route.ts` 的 PUT/DELETE 操作会调用 `clearPolicyCache()`，但这只影响当前进程。

**Phase 5 可选方案**：
1. 使用 Redis 替代进程内缓存
2. 在缓存 key 中加入 `updatedAt` 时间戳，强制重新加载
3. 使用 Pub/Sub 广播缓存失效消息

---

## 🔧 可维护性评估

### 1. 代码复杂度 ✅

| 模块 | 行数 | 复杂度评价 |
|------|------|------------|
| `PolicyGateway` | ~260 行 | ✅ 职责清晰，每个方法 <50 行 |
| `PiSdkRuntime` | ~500 行 | ⚠️ 较长但可接受，Mock 事件流占了大部分 |
| `tool-policy.ts` | ~365 行 | ✅ 同步/异步版本分离，职责清晰 |
| `command-policy.ts` | ~206 行 | ✅ 规则集合 + check 函数 |
| `path-policy.ts` | ~177 行 | ✅ 路径安全检查逻辑独立 |

**软层观察**：`PiSdkRuntime` 的 `createMockPiEventStream` 方法（~150 行）虽然长，但它是 Mock 实现，Phase 5 替换为真实 Pi SDK 后会被删除。不需要现在重构。

### 2. 职责划分 ✅

```
PiSubAgent (subagent.ts)
  └── PiRuntime (runtime.ts)
        └── PiSdkRuntime (transports/sdk.ts)
              ├── 事件流生成（createMockPiEventStream）
              ├── Policy Gateway 前置拦截（checkPolicy）
              └── HIL 暂停/恢复（pausedRuns + followUp）

PolicyGateway (policy/index.ts)
  ├── 策略决策（checkTool）
  ├── 审计日志（recordAudit + persistAuditLog）
  └── 审批状态管理（updateApproval + findPendingApproval）

tool-policy.ts
  ├── 规则缓存（cachedPolicies + cacheTimestamp）
  └── 三层检查（tool → command → path）

command-policy.ts
  └── 命令白名单/黑名单（HIL/永久拒绝）

path-policy.ts
  └── 路径安全检查（workspace 内访问 + 敏感文件）
```

**评价**：每层的职责边界清晰，没有明显的"上帝对象"。

### 3. 配置外部化 ✅

| 配置项 | 当前状态 | 评价 |
|--------|----------|------|
| 策略规则 | ✅ DB 驱动（PolicyRule 表） | 运行时可更新 |
| 审批超时 | ✅ 可配置（PolicyConfig.approvalTimeoutMs） | 默认 5 分钟 |
| HIL 启用 | ✅ 可配置（PolicyConfig.hilEnabled） | 支持关闭 |
| 审计日志 | ✅ 可配置（PolicyConfig.auditEnabled） | 支持关闭 |

---

## ✨ 最佳实践

### 符合的最佳实践 ✅

| 实践 | 实现位置 | 说明 |
|------|----------|------|
| **审计日志 6W** | PolicyAuditLog 字段 | Who/What/When/Where/Why/How 完整 |
| **缓存失效策略** | clearPolicyCache() | 规则变更时主动清除 |
| **数据库索引** | @@index([userId, createdAt], [tool, createdAt], ...) | 查询模式匹配 |
| **异步写入** | persistAuditLog 用 catch 吞掉错误 | 不阻塞 tool_call |
| **降级方案** | 内存日志 + DB 双轨查询 | 容错设计 |
| **路径安全** | path.relative() 判断 workspace 内访问 | 防路径遍历 |
| **敏感文件检查** | PROTECTED_PATTERNS + SENSITIVE_EXTENSIONS | 多层防护 |
| **单例模式** | getPolicyGateway() / getPiSubAgent() | 全局共享 |

### 轻微违反的最佳实践 ⚠️

| 实践 | 位置 | 说明 | 影响 |
|------|------|------|------|
| **API 版本化** | `/api/ai/work/*` | 未使用 `/v1/` 前缀 | 低，未来扩展时需注意 |
| **敏感数据脱敏** | PolicyAuditLog.args | Json 直接存储，未脱敏 | 中，Phase 5 需要补充 |
| **乐观锁** | SubAgentRun.status | 未使用版本号 | 低，当前是直接 UPDATE |

---

## 💳 技术债务

### 已识别的 Mock 实现

| 位置 | 当前状态 | Phase 5 替换方案 |
|------|----------|------------------|
| `sdk.ts:126` `createMockPiEventStream` | Mock 事件流 | 接入真实 Pi SDK 事件流 |
| `sdk.ts:109-120` tool_call hook | 注释掉的 Policy 集成 | 取消注释，测试集成 |
| `sdk.ts:188-189` followUp | TODO 注释 | 调用真实 Pi SDK.followUp() |
| `sdk.ts:243-245` resume | TODO 注释 | 从数据库恢复 session 状态 |

### 已识别的 TODO

| 位置 | TODO 内容 | 优先级 |
|------|-----------|--------|
| `sdk.ts:93` | `userName` TODO | 低，可从 session 获取 |
| `sdk.ts:156` | `steer()` 未实现 | 中，Phase 5 验证 steer 需求 |
| `sdk.ts:196` | `abort()` 调用 Pi SDK | 中，Phase 5 接入真实 API |

### 归档与清理策略 ⚠️

| 主题 | 当前状态 | 建议 |
|------|----------|------|
| 审计日志归档 | 无归档策略 | Phase 6 接入 ELK/Loki（设计文档已提及） |
| 历史数据清理 | 无清理机制 | 建议添加 `createdAt` TTL 索引，定期归档 >90 天数据 |
| runStore 内存清理 | 无主动清理 | 进程重启时自动清理，但长时间运行可能 OOM |

---

## 🎯 改进建议

### 高优先级（Phase 5 必须处理）

#### 1. 补充 SubAgentRun 缓存重建

**问题**：进程重启时 `pausedRuns` Map 丢失，待审批的 run 无法恢复。

**建议**：在 `PiSdkRuntime` 初始化时，从数据库查询 `status = "WAITING_APPROVAL"` 的 run，重建 pausedRuns：

```typescript
// sdk.ts constructor
async function rebuildPausedRuns() {
  const waitingRuns = await prisma.subAgentRun.findMany({
    where: { status: "WAITING_APPROVAL" }
  });
  for (const run of waitingRuns) {
    this.pausedRuns.set(run.runId, {
      resolve: (input: string) => { /* 重新构造 resolve */ },
      reject: (error: Error) => { /* 重新构造 reject */ },
    });
  }
}
```

#### 2. PolicyAuditLog 敏感数据脱敏

**问题**：`args` 字段可能包含密码、token 等敏感信息。

**建议**：在 `persistAuditLog` 之前添加脱敏步骤：

```typescript
function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'credential'];
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) =>
      sensitiveKeys.some(sk => k.toLowerCase().includes(sk))
        ? [k, '[REDACTED]']
        : [k, v]
    )
  );
}
```

### 中优先级（Phase 5 可选处理）

#### 3. 命令/路径规则外部化

当前 `command-policy.ts` 和 `path-policy.ts` 仍使用硬编码的 Set/Regex。建议在 Phase 5 统一迁移到 `PolicyRule` 表。

#### 4. API 版本化

当前 API 路径 `/api/ai/work/approve` 未版本化。Phase 6 扩展时建议改为 `/api/v1/ai/work/approve`。

### 低优先级（未来版本考虑）

#### 5. Redis 分布式缓存

当前策略缓存是进程内的，多实例部署时需要 Redis。

#### 6. OpenTelemetry 集成

`SubAgentRun` 表预留了 `result: Json` 字段，Phase 7 可接入 OpenTelemetry 实现分布式追踪。

---

## 审查结论

### 状态：✅ APPROVED

**理由**：
1. HIL 闭环设计合理，Promise + resolve 模式清晰可追踪
2. 三表职责划分清晰，审计/规则/运行状态各自独立
3. PolicyGateway 作为中心化审计点的设计合理，可测试性强
4. 代码组织遵循单一职责原则，可维护性高
5. 技术债务已识别，有明确的 Phase 5 替换计划

### 需要在 Phase 5 落地前确认的事项

| 事项 | 优先级 | 确认人 |
|------|--------|--------|
| SubAgentRun 缓存重建方案 | 🔴 必须 | fullstack-developer |
| PolicyAuditLog 敏感数据脱敏 | 🔴 必须 | fullstack-developer |
| 命令/路径规则外部化范围 | 🟡 建议 | 主代理决策 |
| Pi SDK 真实 API 接入计划 | 🔴 必须 | fullstack-developer |

### 给 fullstack-developer 的建议

Phase 5 接入真实 Pi SDK 时，重点关注：

1. **事件流接口**：确认 Pi SDK 的事件格式与 `PiEvent` 类型定义是否一致
2. **tool_call hook**：确认 Pi SDK 是否提供 `on('tool_call')` 类似的拦截 API
3. **followUp API**：确认 Pi SDK 的 followUp 调用方式
4. **会话恢复**：确认 Pi SDK 是否支持从 `sessionId` 恢复会话

---

## 参考文件

| 文件 | 作用 |
|------|------|
| `docs/ai/phase-4-db-schema-design.md` | 三表设计文档 |
| `features/ai/agents/work/policy/index.ts` | PolicyGateway 核心 |
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | PiSdkRuntime 实现 |
| `features/ai/agents/work/policy/tool-policy.ts` | 策略动态加载 |
| `app/api/ai/work/approve/route.ts` | HIL 审批 API |
| `app/api/ai/work/policy/route.ts` | PolicyRule CRUD API |
| `prisma/schema.prisma` | 三表 + 枚举定义 |
| `scripts/phase-4-full-verify.ts` | 功能验证脚本 |

---

*审查人：ai-learning-mentor（架构顾问/软层）*
*审查时间：2026-08-19*
