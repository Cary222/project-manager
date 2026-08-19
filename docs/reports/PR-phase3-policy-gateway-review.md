<!-- merged by Main from code-reviewer + ai-learning-mentor -->
# Phase 3 Policy Gateway + HIL + Pi Runtime 综合审查报告

审查时间：2026-08-18  
审查范围：Phase 3 Policy Gateway + HIL + Pi Runtime Mock  
审查人员：code-reviewer (硬层) + ai-learning-mentor (软层)  
合并人员：Main Agent

---

## 执行摘要

| 维度 | 评价 |
|------|------|
| **总体结论** | **CHANGES_REQUIRED** |
| **架构设计** | ✅ 合理（三层分离、依赖倒置、渐进式迁移） |
| **Critical 问题** | 2 个（已修复 1 个，1 个为误报） |
| **Major 问题** | 7 个（3 个软层 + 4 个硬层） |
| **Minor 问题** | 7 个（4 个软层 + 3 个硬层） |

### Phase 4 阻塞项（必须修复）

| 优先级 | 问题 | 影响 | 责任方 |
|--------|------|------|--------|
| **P0** | `/api/ai/work/approve` API 未实现 | HIL 流程假闭环，无法真正审批 | Backend |
| **P1** | 审计日志仅存内存 | 服务重启丢失，不满足审计合规 | Backend + DB |
| **P1** | Policy 规则硬编码 | 修改策略需改代码 + 重部署 | Backend + DB |
| **P2** | PiSdkRuntime 核心方法未实现 | `steer/followUp/resume` 抛异常 | Backend |

---

## 一、架构审查（软层）

### 1.1 三层分离 ✅

```
PolicyGateway (index.ts) — 门面 + 审计
    ↓
ToolPolicy (tool-policy.ts) — 工具风险分级 + 路由
    ↓ (根据工具类型自动调用)
    ├─ CommandPolicy (command-policy.ts) — 命令白名单/黑名单
    └─ PathPolicy (path-policy.ts) — 路径保护 + workspace 隔离
```

**评价**：职责边界清晰，符合设计文档 v3 的"三层安全边界"原则。

### 1.2 PiRuntime 抽象层 ✅

```
PiSubAgent (subagent.ts) — Work Agent 业务封装
    ↓
PiRuntime (runtime.ts) — 接口定义（支持 SDK/RPC 切换）
    ↓
PiSdkRuntime (transports/sdk.ts) — Mock 实现
```

**评价**：抽象合理，支持渐进式迁移（Mock → 真实 SDK）。

### 1.3 HIL 流程 ✅

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
POST /api/ai/work/approve (TODO)
    ↓
resume Pi execution
```

**评价**：流程设计完整，超时机制（5 分钟）已实现。

---

## 二、Critical 问题分析

### C1. ❌ PolicyGateway 未串联三层检查（误报，已澄清）

**code-reviewer 原判断**：  
> `PolicyGateway.check()` 仅调用 `checkTool()`，未调用 `checkCommand` 和 `checkPaths`。

**Main 复查结果**：  
`checkTool()` 内部已经根据工具类型自动调用了其他两层：
- Line 152-161: Shell 工具 → `checkCommand()`
- Line 164-172: 文件工具 → `checkPaths()`

**修复措施**：  
在 `policy/index.ts:60-68` 添加注释澄清三层检查逻辑，避免误解。

**结论**：误报，架构正确。

---

### C2. ✅ 验证脚本使用不存在的 `type` 字段（已修复）

**问题**：  
`scripts/phase-3-verify.ts:24,39` 传入了 `type: "tool"`，但 `PolicyContext` 接口无此字段。

**修复措施**：  
移除 `type` 字段，验证脚本通过。

```bash
✅ Phase 3 验证通过！
  ✓ Policy Gateway 三层检查
  ✓ Pi SDK Transport (Mock)
  ✓ 事件翻译增强
  ✓ graph.ts 集成
```

**结论**：已修复。

---

## 三、Major 问题汇总

### 软层（架构/设计）

| # | 问题 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| M1 | 审计日志仅存内存 | `policy/index.ts:38` | 服务重启丢失，不满足审计合规 | Phase 4 P1: 迁移到 DB 表 `PolicyAuditLog` |
| M2 | Policy 规则硬编码 | `command-policy.ts:11-19` | 修改策略需改代码 + 重部署 | Phase 4 P1: 外部化到 DB + Admin UI |
| M3 | `/api/ai/work/approve` API 未实现 | `WorkModePanel.tsx:460` | HIL 流程假闭环 | Phase 4 P0: 实现 API + 连接 `PiRuntime.followUp()` |
| M4 | 全局单例配置不可变 | `policy/index.ts:191-197` | 后续 `config` 参数被忽略 | 添加 `updatePolicyConfig()` 或移除单例 |

### 硬层（实现/安全）

| # | 问题 | 位置 | 影响 | 建议 |
|---|------|------|------|------|
| M5 | PiSdkRuntime 核心方法未实现 | `sdk.ts:126,134,157` | `steer/followUp/resume` 抛异常 | Phase 4 P2: 返回 mock 结果而非抛异常 |
| M6 | 命令白名单可被简单绕过 | `command-policy.ts:142-158` | `bash -c 'rm -rf'` 可绕过 | 增加转义/解析或依赖 Sandbox |
| M7 | 事件翻译大量使用类型断言 | `events.ts:169-252` | Pi SDK 事件结构变化时静默失败 | 增加 Zod schema 验证 |
| M8 | 并发安全问题 | `sdk.ts:37-40` | 多实例部署时竞态条件 | Phase 4 评估：Worker/多实例时改用 mutex |

---

## 四、Minor 问题

### 软层

1. **approval-policy.ts 缺失**：设计文档提及但未实现，确认是否需要独立文件
2. **TOOL_POLICIES 覆盖不完整**：需要与 Pi SDK 工具名称对齐，添加单测验证
3. **批量审批未支持**：Phase 4 评估需求
4. **PiRuntime 单测依赖 mock**：添加集成测试验证真实 SDK

### 硬层

5. **未使用的导入**：`SubAgentResult` 已导入但未使用
6. **未使用的参数**：`_runId`, `_input`, `_sessionId` 触发 ESLint 警告
7. **上下文注入错误处理过于宽泛**：`injectRuntimeContext` 失败时静默继续

---

## 五、正向发现（做得好的地方）

1. ✅ **路径检查使用 `path.relative()` 而非 `startsWith()`**  
   正确防止了路径遍历攻击。

2. ✅ **PolicyGateway 审计日志实现完整**  
   有 `recordAudit()`, `getAuditLog()`, `clearAuditLog()`，日志上限 1000 条防止内存泄漏。

3. ✅ **事件翻译覆盖了主要 PiEvent 类型**  
   `session_started`, `message`, `tool_call`, `tool_result`, `approval_required`, `progress`, `run_completed`。

4. ✅ **WorkModePanel HIL UI 实现清晰**  
   审批弹窗有 `handleApprove` / `handleDeny`，SSE 事件流解析完整。

5. ✅ **验证脚本覆盖核心功能**  
   4 个测试用例覆盖 Policy Gateway、Transport、事件翻译、graph 集成。

---

## 六、Phase 4 迁移路径

### 优先级 P0（阻塞功能）

```
□ 实现 /api/ai/work/approve 路由
□ HIL 审批决策传递给 Pi Runtime
□ PiRuntime.followUp() 调用
```

### 优先级 P1（生产必需）

```
□ 审计日志写入 DB (表: PolicyAuditLog)
□ Policy 规则外部化到 DB (表: PolicyRule)
□ SubAgentRun 持久化到 DB
□ 添加 DB schema 迁移
```

### 优先级 P2（可延迟）

```
□ PiSdkRuntime 核心方法实现（steer/followUp/resume）
□ RPC Transport 实现
□ 批量审批功能
□ Admin UI 策略配置界面
□ 多实例 Session 共享（Redis/DB）
□ 命令解析增强（防止 bash -c 绕过）
```

### 优先级 P3（优化）

```
□ 事件翻译增加 Zod schema 验证
□ 并发安全（多实例部署时）
□ 单测覆盖率提升
```

---

## 七、总体评价

**Phase 3 架构设计基本合理**：
- ✅ 三层安全边界正确实现
- ✅ Policy Gateway 门面模式清晰
- ✅ PiRuntime 抽象支持渐进式迁移
- ✅ HIL 流程设计完整
- ✅ 验证脚本通过

**但存在 4 个阻塞性问题需要 Phase 4 修复**：
1. **P0**: HIL API 未实现，流程假闭环
2. **P1**: 审计日志未持久化，不满足生产审计合规
3. **P1**: Policy 配置硬编码，无法运行时调整
4. **P2**: PiSdkRuntime 核心方法抛异常

**Phase 4 建议执行顺序**：
1. P0 先把 HIL API 打通，让审批流程真正闭环
2. P1 把审计和配置持久化，满足生产环境审计合规需求
3. P2 实现 PiSdkRuntime 核心方法 + RPC Transport
4. P3 再考虑批量审批、Admin UI 等高级功能

---

## 附录 A：审查方法

### 硬层审查（code-reviewer）

```bash
# 类型检查
npx tsc --noEmit features/ai/agents/work/policy/*.ts \
  features/ai/agents/work/subagents/pi/*.ts \
  features/ai/agents/work/subagents/pi/transports/*.ts \
  features/ai/ui/work/WorkModePanel.tsx

# ESLint 检查
npx eslint features/ai/agents/work/policy/*.ts \
  features/ai/agents/work/subagents/pi/*.ts \
  features/ai/agents/work/subagents/pi/transports/*.ts \
  --max-warnings 0

# 验证脚本
npx tsx scripts/phase-3-verify.ts
```

### 软层审查（ai-learning-mentor）

- 读取设计文档：`docs/ai/work-agent-pi-integration-plan.md`
- 读取实现代码：`features/ai/agents/work/policy/` + `subagents/pi/`
- 评估架构分层、职责边界、扩展性、可维护性
- 评估 HIL 流程完整性和 Phase 4 迁移路径

---

## 附录 B：关键文件清单

| 文件 | 状态 | 备注 |
|------|------|------|
| `policy/index.ts` | ✅ 完整 | 单例配置问题待优化 |
| `policy/tool-policy.ts` | ✅ 完整 | |
| `policy/command-policy.ts` | ✅ 完整 | 硬编码配置待外部化 |
| `policy/path-policy.ts` | ✅ 完整 | |
| `policy/approval-policy.ts` | ❌ 缺失 | 设计文档有，代码无 |
| `subagents/pi/runtime.ts` | ✅ 完整 | |
| `subagents/pi/transports/sdk.ts` | ⚠️ Mock | TODO 标注迁移点 |
| `subagents/pi/subagent.ts` | ✅ 完整 | |
| `subagents/pi/events.ts` | ✅ 完整 | 类型断言待优化 |
| `subagents/pi/context.ts` | ✅ 完整 | |
| `subagents/types.ts` | ✅ 完整 | |
| `ui/work/WorkModePanel.tsx` | ⚠️ HIL UI 完整 | API 调用需实现 |
| `app/api/ai/work/approve/route.ts` | ❌ 缺失 | P0 必须实现 |

---

**审查结论**：Phase 3 架构方向正确，核心功能已实现，但需要 Phase 4 优先修复 P0/P1 阻塞项后才能投入生产。
