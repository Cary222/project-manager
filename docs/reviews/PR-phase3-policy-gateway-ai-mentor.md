<!-- reviewer: ai-learning-mentor (软层) -->
# Phase 3 Policy Gateway 软架构审查

审查时间：2026-08-18
审查范围：Phase 3 Policy Gateway + HIL + Pi Runtime 架构设计

---

## 审查摘要

| 维度 | 结论 |
|------|------|
| **总体评价** | **CHANGES_REQUIRED** |
| **架构问题** | 3 个（1 Critical, 2 Major） |
| **设计建议** | 5 个 |
| **Phase 4 风险** | 2 个 |

---

## 审查详情

### 1. 架构分层

#### 1.1 Policy Gateway 三层职责 ✅

| 层次 | 文件 | 职责 | 评价 |
|------|------|------|------|
| 入口 | `policy/index.ts` | PolicyGateway 门面，统一调度 | ✅ 清晰 |
| 工具策略 | `tool-policy.ts` | 工具风险分级 + 路由到 command/path policy | ✅ 合理 |
| 命令策略 | `command-policy.ts` | 命令白名单/黑名单 | ✅ 基本完整 |
| 路径策略 | `path-policy.ts` | 路径黑名单 + workspace 隔离 | ✅ 正确使用 `path.relative()` |

**评价**：三层架构符合设计文档，职责边界清晰。`PolicyGateway.check()` 作为统一入口，依次调用各层策略。

#### 1.2 PiRuntime 抽象层 ✅

```
SubAgent (subagent.ts)
    ↓
PiRuntime (runtime.ts) — 接口定义
    ↓
PiSdkRuntime (transports/sdk.ts) — 实现
```

**评价**：抽象合理，Transport 层设计支持 mock → 真实 SDK 的渐进式迁移。

#### 1.3 调用链符合依赖倒置原则 ✅

```
Pi tool_call
    ↓
Pi Extension Hook (tool-interceptor)
    ↓
PolicyGateway.check()
    ↓
ToolPolicy → CommandPolicy / PathPolicy
    ↓
ALLOW / APPROVE / DENY
```

**评价**：符合设计文档 v3 的"三层安全边界"原则。

---

### 2. 职责边界

#### 2.1 PolicyGateway 职责 ✅

`PolicyGateway` 承担：
- 配置管理（enabled/hilEnabled/timeout）
- 策略链式调用
- 审计日志记录

**评价**：没有承担过多职责，委托给各 Policy 函数处理。

#### 2.2 PiSubAgent 与 PiRuntime 边界 ✅

- `PiSubAgent`：Work Agent 业务封装（start/resume/cancel）
- `PiRuntime`：运行时抽象（与 SDK/RPC 解耦）

**评价**：边界清晰，符合设计文档的三层分离原则。

#### 2.3 事件翻译位置 ✅

- `events.ts`：负责 Pi 原生事件 → SubAgentEvent 翻译
- `transports/sdk.ts`：负责调用 Policy Gateway 前置拦截

**评价**：事件翻译和 Policy 拦截分离正确。

---

### 3. 扩展性

#### 3.1 添加新 Policy 规则 ✅

当前设计通过 `TOOL_POLICIES` 字典扩展：

```typescript
// tool-policy.ts
const TOOL_POLICIES: Record<string, ToolPolicy> = {
  // 新工具只需添加条目
  "new_tool": { risk: "medium", requiresApproval: false },
};
```

**评价**：扩展新工具规则不需要修改 PolicyGateway 代码。

#### 3.2 支持新 Transport ⚠️

`createPiRuntime()` 支持动态加载：

```typescript
if (mode === "sdk") { ... }
if (mode === "rpc") { throw new Error("RPC not implemented"); }
```

**评价**：接口已定义，但 RPC Transport 尚未实现（Phase 3 范围外）。

#### 3.3 支持新 SubAgent 类型 ✅

`BaseSubAgent` 接口定义通用契约：

```typescript
interface BaseSubAgent {
  readonly type: string;
  start(run: SubAgentRun, input: SubAgentInput): Promise<SubAgentHandle>;
  cancel(runId: string): Promise<void>;
  resume(runId: string, userInput: string): Promise<SubAgentHandle>;
  getRun(runId: string): SubAgentRun | undefined;
}
```

**评价**：未来可接入 claude-code 等只需实现同一接口。

---

### 4. 可维护性

#### 4.1 Policy 配置外部化 ⚠️ Major

**当前状态**：白名单/黑名单硬编码在代码中：

```typescript
// command-policy.ts
const ALLOW_COMMANDS = new Set([
  "git status", "git diff", ...
]);
const HIL_COMMANDS = new Set([...]);
```

**问题**：
- 修改白名单需要改代码 + 重新部署
- 无法针对不同用户/workspace 配置不同策略
- 无法在运行时动态调整

**建议**：
```
Phase 4 优先事项：
- 将 ALLOW_COMMANDS / HIL_COMMANDS / DENY_COMMANDS 迁移到 DB 表
- 添加 Admin UI 配置界面
- 支持 per-workspace / per-user 策略覆盖
```

#### 4.2 审计日志持久化 ⚠️ Major

**当前状态**：审计日志仅存储在内存中：

```typescript
// policy/index.ts
private auditLog: PolicyAuditEntry[] = [];
if (this.auditLog.length > 1000) {
  this.auditLog = this.auditLog.slice(-1000); // 内存上限
}
```

**问题**：
- Node.js 重启后日志丢失
- 无法跨进程/跨实例查询
- 无法满足合规审计需求

**建议**：
```
Phase 4 优先事项：
- 审计日志写入 DB 表 PolicyAuditLog
- 添加 DB schema 迁移
- 保留内存缓存用于快速查询
```

#### 4.3 全局单例配置不可变 ❌ Critical

**问题**：

```typescript
// policy/index.ts
let globalPolicyGateway: PolicyGateway | null = null;

export function getPolicyGateway(config?: PolicyConfig): PolicyGateway {
  if (!globalPolicyGateway) {
    globalPolicyGateway = new PolicyGateway(config);
  }
  return globalPolicyGateway; // 忽略后续 config 参数
}
```

**问题**：
- 首次调用后，后续传入的 `config` 被忽略
- 不同功能模块无法使用不同配置
- 单例模式限制了测试灵活性

**建议**：
```typescript
// 方案 A：单例 + 配置更新方法
export function updatePolicyConfig(config: Partial<PolicyConfig>): void {
  if (globalPolicyGateway) {
    Object.assign(globalPolicyGateway.config, config);
  }
}

// 方案 B：移除全局单例，由调用方管理生命周期
export { PolicyGateway };
```

---

### 5. HIL 流程

#### 5.1 流程完整性 ✅

```
Pi tool_call 拦截
    ↓
PolicyGateway.check() → decision: "approve"
    ↓
SubAgentEvent: approval_required
    ↓
SSE → WorkModePanel.tsx
    ↓
用户点击批准/拒绝
    ↓
POST /api/ai/work/approve
    ↓
resume Pi execution
```

**评价**：流程设计完整。

#### 5.2 超时机制 ✅

```typescript
// policy/index.ts
approvalTimeoutMs: 5 * 60 * 1000, // 5 分钟
timeoutDecision: "deny", // 超时默认拒绝
```

**评价**：超时机制已实现，5 分钟默认 deny 符合设计文档。

#### 5.3 API 未实现 ⚠️

**当前状态**：

```typescript
// WorkModePanel.tsx - handleApprove
const response = await fetch("/api/ai/work/approve", {
  // TODO: 调用 API 发送审批决策
  ...
});
```

**问题**：
- `/api/ai/work/approve` 路由尚未实现
- 审批决策无法传递给 Pi Runtime
- HIL 流程在 Phase 3 是"假闭环"

**建议**：
```
Phase 4 优先级 P0：
- 实现 /api/ai/work/approve 路由
- 连接 PolicyGateway.getAuditLog() 获取待审批项
- 调用 PiRuntime.followUp() 恢复执行
```

#### 5.4 批量审批 ❌ Not Supported

**当前状态**：`pendingApproval` 只存储单个审批请求。

**问题**：
- 多个工具调用需要逐个审批
- 无法一次性审批整个任务计划

**建议**：
- Phase 4 评估是否需要批量审批功能
- 如果需要，扩展 UI 和 API

---

### 6. Phase 4 准备

#### 6.1 Mock → 真实 SDK 迁移路径 ✅

```typescript
// transports/sdk.ts - 当前状态
const mockStream = this.createMockPiEventStream(runId, sessionId);
const events = translateEvents(mockStream as AsyncIterable<PiEvent>, runId);

// 目标状态
const piSession = await createPiSession({ ... });
const events = translateEvents(piSession.subscribe(), runId);
```

**评价**：迁移路径清晰，TODO 注释标注了替换位置。

#### 6.2 Policy Gateway 集成到 graph.ts ⚠️

**当前状态**：
- Policy Gateway 已在 `transports/sdk.ts` 中被引用（延迟导入）
- 但 `graph.ts` 的 tool_call 拦截点尚未接入

**问题**：
- Phase 3 的 Policy Gateway 只在 Pi SDK Transport 层生效
- 如果 graph.ts 直接调用工具（不走 Pi SDK），Policy 不生效

**建议**：
```
Phase 4 检查项：
- 确认 graph.ts 所有工具调用都经过 Pi SDK
- 如果有直接工具调用，需要在 graph.ts 层也接入 PolicyGateway
```

#### 6.3 Session 持久化 ⚠️

**当前状态**：
- `SubAgentRun` 使用内存 Map 存储
- Session ID 由 UUID 生成，无法跨进程恢复

**问题**：
- 服务重启后无法恢复运行中的任务
- 多实例部署时无法共享状态

**建议**：
```
Phase 4 检查项：
- SubAgentRun 进数据库
- Session 持久化到 DB
- 多实例部署时使用 Redis/DB 做状态共享
```

---

## 问题汇总

### Critical（必须修复）

| # | 问题 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| C1 | 全局单例配置不可变，后续 `config` 参数被忽略 | `policy/index.ts` | 不同模块无法使用不同配置 | 添加 `updatePolicyConfig()` 方法或移除单例 |

### Major（强烈建议优化）

| # | 问题 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| M1 | 审计日志仅存内存，服务重启丢失 | `policy/index.ts` | 无法满足审计合规需求 | Phase 4 迁移到 DB 表 |
| M2 | Policy 规则硬编码，无法运行时调整 | `command-policy.ts` 等 | 修改策略需要改代码 + 重部署 | Phase 4 支持 DB 配置 + Admin UI |
| M3 | `/api/ai/work/approve` API 未实现 | `WorkModePanel.tsx` | HIL 流程假闭环 | Phase 4 P0 实现 |

### Minor（改进建议）

| # | 问题 | 位置 | 建议 |
|---|------|------|------|
| 1 | `approval-policy.ts` 在设计文档中提及但未实现 | 目录结构 | 确认是否需要独立文件，或合并到 tool-policy.ts |
| 2 | `TOOL_POLICIES` 工具名称需要与 Pi SDK 匹配 | `tool-policy.ts` | 添加单元测试验证工具名称覆盖 |
| 3 | 批量审批未支持 | UI/API | Phase 4 评估需求 |
| 4 | PiRuntime 单测依赖 mock 事件流 | `transports/sdk.ts` | 添加集成测试验证真实 SDK |

---

## Phase 4 迁移检查清单

```
优先级 P0（阻塞功能）：
□ /api/ai/work/approve 路由实现
□ HIL 审批决策传递给 Pi Runtime
□ PiRuntime.followUp() 调用

优先级 P1（生产必需）：
□ 审计日志写入 DB
□ Policy 规则外部化到 DB
□ SubAgentRun 持久化到 DB

优先级 P2（可延迟）：
□ RPC Transport 实现
□ 批量审批功能
□ Admin UI 策略配置界面
□ 多实例 Session 共享（Redis/DB）
```

---

## 总体评价

**Phase 3 架构设计基本合理**，遵循了设计文档 v3 的核心原则：
- 三层安全边界正确实现
- Policy Gateway 门面模式清晰
- PiRuntime 抽象支持渐进式迁移
- HIL 流程设计完整

**但存在 3 个阻塞性问题需要 Phase 4 修复**：
1. **C1**：全局单例配置不可变
2. **M3**：HIL API 未实现，流程假闭环
3. **M1+M2**：审计日志和 Policy 配置未持久化，不满足生产要求

**Phase 4 建议**：
- P0 先把 HIL API 打通，让审批流程真正闭环
- P1 把审计和配置持久化，满足生产环境审计合规需求
- P2 再考虑 RPC Transport、批量审批等高级功能

---

## 附录：关键文件清单

| 文件 | 状态 | 备注 |
|------|------|------|
| `policy/index.ts` | ✅ 完整 | 单例配置问题需修复 |
| `policy/tool-policy.ts` | ✅ 完整 | |
| `policy/command-policy.ts` | ✅ 完整 | 硬编码配置待外部化 |
| `policy/path-policy.ts` | ✅ 完整 | |
| `policy/approval-policy.ts` | ❌ 缺失 | 设计文档有，代码无 |
| `subagents/pi/runtime.ts` | ✅ 完整 | |
| `subagents/pi/transports/sdk.ts` | ⚠️ Mock | TODO 标注迁移点 |
| `subagents/pi/subagent.ts` | ✅ 完整 | |
| `subagents/pi/events.ts` | ✅ 完整 | |
| `subagents/pi/context.ts` | ✅ 完整 | |
| `subagents/types.ts` | ✅ 完整 | |
| `ui/work/WorkModePanel.tsx` | ⚠️ HIL UI 完整 | API 调用需实现 |
