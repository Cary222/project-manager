<!-- reviewer: code-reviewer (硬层) -->
# Phase 5: Production Readiness - Code Review

## 审查摘要

**总体评价**：Phase 5 实现了一套完整的生产就绪基础设施（P0 真实 SDK 集成 + P1 错误恢复/并发 + P2 监控/超时）。类型层面存在 3 处阻塞 tsc 错误，运行时存在 1 处凭证泄露风险和 1 处 HIL 未集成。P1/P2 基础设施设计扎实，但部分处于 TODO 状态未激活。

**严重问题数量**：
- P0 阻塞级：**3 项**（2 处 tsc 错误 + 1 处凭证泄露）
- P1 重要：**6 项**
- P2 优化建议：**7 项**

---

## 1. 总览

| 维度 | 评估 |
|------|------|
| **P0 完成度** | ⚠️ 部分完成：SDK 集成 + 事件翻译已实现，但有 3 处 tsc 错误阻塞 build |
| **P1 完成度** | ✅ 设计完整：重试/错误分类/并发控制/状态恢复均已实现（部分为 TODO 状态） |
| **P2 完成度** | ✅ 设计完整：结构化日志/指标收集/超时管理/资源监控均已实现 |
| **类型安全** | ⚠️ 3 处 tsc 错误，1 处 `any` 泄漏（`createPiSession` 参数） |
| **凭证安全** | ⚠️ 1 处 process.env 全局污染（凭证写入后未清理） |
| **并发安全** | ✅ ConcurrencyController 单线程内存实现，逻辑正确 |
| **数据库操作** | ✅ SubAgentRun 写入/更新有 try-catch，错误不影响主流程 |
| **测试覆盖** | ⚠️ P0 验证脚本存在，但 import 路径错误无法运行 |

---

## 2. Critical Issues (P0)

### P0-1 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:20` — 错误的 import 路径**

- **位置**: `sdk.ts:20`
  ```typescript
  import { withRetry, classifyError, ErrorType } from "./error-recovery";
  ```
- **Impact**: `error-recovery.ts` 位于 `features/ai/agents/work/subagents/pi/error-recovery.ts`，相对路径应为 `../error-recovery` 而非 `./error-recovery`。**tsc 报 `TS2307: Cannot find module './error-recovery'`**，整个文件无法通过类型检查。
- **Suggestion**: 将 `./error-recovery` 改为 `../error-recovery`。

---

### P0-2 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:100` — 返回类型 `string | undefined` 赋值给 `string`**

- **位置**: `sdk.ts:100`（`createPiSession` 返回语句）
  ```typescript
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  ```
- **Impact**: `generateRunId()` 返回 `string | undefined`（`slice` 在边界情况下可能返回 `undefined`），`createPiSession` 声明返回 `Promise<any>`，tsc 报 `TS2322: Type 'string | undefined' is not assignable to type 'string'`。
- **Suggestion**: `generateRunId` 返回值加非空断言 `!` 或加 `?? ""`兜底。

---

### P0-3 🚨 **`features/ai/agents/work/subports/sdk.ts:551` — 同样 `string | undefined` 问题**

- **位置**: `sdk.ts:551`
  ```typescript
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  ```
- **Impact**: 与 P0-2 同根，但影响的是 `generateSessionId`。
- **Suggestion**: 同 P0-2。

---

### P0-4 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:191-197` — API 密钥写入 process.env 全局污染（凭证泄露风险）**

- **位置**: `sdk.ts:191-197`
  ```typescript
  process.env.OPENAI_API_KEY = cred.apiKey;
  if ((provider || "deepseek") === "deepseek" || cred.baseURL.includes("deepseek")) {
    process.env.OPENAI_API_BASE_URL = cred.baseURL;
  }
  ```
- **Impact**: `setupCredentials` 将解密后的 API 密钥写入 `process.env`。这是**进程级全局状态**：
  1. **跨请求污染**：Next.js 是多请求共享进程，A 用户的 key 会残留在 env 中被 B 用户复用。
  2. **日志泄露风险**：`console.log` 打印了 `cred.baseURL`，如被错误配置可能泄露明文。
  3. **环境变量不可清理**：`process.env` 在 Node.js 生命周期内无法删除，只能覆盖。
- **Suggestion**:
  - 方案 A（推荐）：使用 `ModelRuntime.create` 的 `apiKey` 参数直接传入，而非依赖 `process.env`。
  - 方案 B：如 SDK 必须读 env，在每个 request 开始时用 `Reflect.set(process.env, 'OPENAI_API_KEY', ...)` 并在结束时恢复旧值（脆弱）。
  - 移除 `sdk.ts:195` 的 console.log 中的 baseURL 打印，或改为只打印 provider 名。

---

## 3. High Priority (P1)

### P1-1 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:206-238` — `createPiSession` 参数大量 `as any`，绕过类型检查**

- **位置**: `sdk.ts:217` (`ModelRuntime.create({...} as any)`) 和 `sdk.ts:227` (`createAgentSession({...} as any)`)
- **Impact**: `as any` 完全绕过了 TypeScript 类型检查，SDK API 变更（如 `allowModelNetwork` 参数名改变）不会触发编译错误。Phase 0 spike 验证了 0.84.2，但版本升级后静默失效。
- **Suggestion**: 定义 `ModelRuntimeOptions` 和 `CreateAgentSessionOptions` 接口，逐字段对应 SDK 类型，不用 `as any`。

---

### P1-2 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:116-117` — Policy Gateway 未集成**

- **位置**: `sdk.ts:116-117`
  ```typescript
  // 4. 注册 tool_call hook（Policy Gateway 前置拦截）
  // TODO Phase 5 P1: 集成 Policy Gateway
  ```
- **Impact**: Phase 3 设计了三层 Policy Gateway，但 Phase 5 P0 实现中 `sdk.ts` 只 import 了 `getPolicyGatewayInstance()` 但从未调用。**所有 tool_call 在 Pi SDK 层直接执行**，没有任何 Policy 拦截。
- **Suggestion**: 在 `createPiEventStream` 的 `tool_call` 事件处理路径中，插入 `await checkPolicy(...)` 调用。

---

### P1-3 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:248-344` — `createPiEventStream` 适配未验证**

- **位置**: `sdk.ts:248-344`
- **Impact**: `createPiEventStream` 中有大量"假设 SDK API 长这样"的代码：
  - `session.subscribe()` 调用方式未验证（264 行）
  - `session.sessionId` / `session.id` 的适配（258 行）
  - `createFallbackEventStream` 直接 throw（316-320 行）
  - `isCompletionEvent` 的类型判断（349-358 行）
  
  Phase 5 P0 的核心承诺是"真实 Pi SDK 集成"，但这些适配点全部是"推测"而非"验证"。如果 SDK API 不同，代码会静默失败或抛出难以排查的错。
- **Suggestion**: 在 `phase-5-p0-verify.ts` 中添加 SDK API 兼容性检查（验证 `subscribe()` 是否为函数、返回类型等）。

---

### P1-4 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:62-88` — SubAgentRun 创建失败后继续执行**

- **位置**: `sdk.ts:70-88`
  ```typescript
  } catch (error) {
    console.error("[PiSdkRuntime] Failed to persist SubAgentRun:", error);
    // 非致命错误，继续执行
  }
  ```
- **Impact**: 与 Phase 4 Review 的 P2-1 相同问题：DB 写入失败后 run 仍启动，导致 `awaitCompletion` / `abort` 的 DB update（569-578 行 / 447-456 行）会因 `where: { id: runId }` 找不到而抛错。
- **Suggestion**: 区分"可恢复的非致命错误"（context injection 失败）和"必须拒绝启动的致命错误"（DB 写入失败）。DB 写入失败应抛错。

---

### P1-5 🚨 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:390-420` — `followUp` HIL 恢复逻辑与 Phase 4 HIL 未对齐**

- **位置**: `sdk.ts:390-420`
  - 第 413 行：`pausedRun.resolve(input)` 仅发送字符串
  - 第 418-419 行：`TODO Phase 5: 调用真实 Pi SDK 的 followUp API` — 注释掉未实现
- **Impact**: Phase 4 HIL 设计中，`followUp` 需要传递用户决策（approve/deny）+ 理由。但此处只是把字符串发回 Pi SDK，`pausedRuns` 的 `resolve` 签名是 `(value: string) => void`，无法传递结构化的决策信息。
- **Suggestion**: 
  1. `pausedRuns` 的 resolver 应接受结构化类型 `{ decision: "approved" | "denied"; reason?: string }`
  2. `followUp` 的参数应扩展为包含决策信息

---

### P1-6 ⚡ **`scripts/phase-5-p0-verify.ts:17-18` — import 路径错误**

- **位置**: `phase-5-p0-verify.ts:17-18`
  ```typescript
  import { PiSdkRuntime } from "../features/ai/agents/work/subagents/pi/transports/sdk";
  import type { PiRunInput } from "../features/ai/agents/work/subagents/pi/runtime";
  ```
- **Impact**: 脚本从 `scripts/` 目录 import，`../features/` 指向的是 `features/features/...`（不存在）。**脚本无法运行**。
- **Suggestion**: 改为 `../../features/ai/agents/work/subagents/pi/transports/sdk`。

---

## 4. Medium Priority (P2)

### P2-1 🔹 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:77-78` — `"system"` 魔法字符串作为 userId fallback**

- **Impact**: `userId: input.userId || "system"` — DB `SubAgentRun.userId` 有 FK 指向 `User(id)`，`"system"` 用户不存在会导致 FK 约束失败（或依赖软约束无报错）。
- **Suggestion**: 显式抛 `InputValidationError`，或要求调用方必须提供 `userId`。

### P2-2 🔹 **`features/ai/agents/work/subagents/pi/transports/sdk.ts:549` — `checkPolicy` 中的 `runId` 用生成的而非传入的**

- **位置**: `sdk.ts:547`
  ```typescript
  runId: this.generateRunId(),
  ```
- **Impact**: `checkPolicy` 使用新生成的 `runId` 而非当前 run 的 ID，Policy Gateway 审计日志中记录的是错误的 runId。
- **Suggestion**: 传入真实的 `runId` 参数。

### P2-3 🔹 **`features/ai/agents/work/subagents/pi/error-recovery.ts:33-36` — `classifyError` 对非 Error 对象调用 `.message`**

- **位置**: `error-recovery.ts:33-36`
  ```typescript
  const message = error instanceof Error ? error.message : String(error);
  const lowerMsg = message.toLowerCase();
  ```
- **Impact**: `String(undefined)` 返回 `"undefined"`，`toLowerCase()` 不报错但逻辑错误。如果传入 `{ code: "ERR_NETWORK" }`，`String({...})` 返回 `"[object Object]"`，包含不了 `"network"` 关键词，分类为可重试（碰巧正确但不稳定）。
- **Suggestion**: 如果 error 是对象，先尝试取 `error.message` / `error.code` / `error.errno`，再 fallback 到 `String(error)`。

### P2-4 🔹 **`features/ai/agents/work/subagents/pi/events.ts:266` — `translateSingleEvent` 中 `result` 类型映射使用了条件类型**

- **位置**: `events.ts:266`
  ```typescript
  result: piEvent.result as SubAgentEvent extends { type: "run_completed"; result: infer R } ? R : never,
  ```
- **Impact**: 条件类型 `SubAgentEvent extends ...` 在编译时对联合类型求值，行为可能不符合预期。更直接的写法是直接 cast 为 `SubAgentResult`。
- **Suggestion**: 改为 `result: piEvent.result as SubAgentResult`。

### P2-5 🔹 **`features/ai/agents/work/subagents/pi/concurrency.ts:119-124` — 队列超时清理在 resolve 后才移除**

- **位置**: `concurrency.ts:121-124`
  ```typescript
  const timeout = setTimeout(() => {
    this.removeFromQueue(runId);
    reject(new Error(`Queue timeout (${this.config.queueTimeoutMs}ms)`));
  }, this.config.queueTimeoutMs);
  ```
- **Impact**: 当 `wrappedResolve` 调用时，超时 timer 仍在运行（虽然会立即被 `clearTimeout` 清理）。但如果 `wrappedResolve` 没被调用（resolve 路径没覆盖所有 exit），timer 会触发 `reject`，然后 `removeFromQueue` 也会被调用（index 找到了）。这是对的，但 `wrappedResolve` 之外的 exit（reject 路径）没有清理 timer。
- **Suggestion**: 在 Promise 的 `finally` 或显式的 `try/catch` 中清理 timer。

### P2-6 🔹 **`features/ai/agents/work/subagents/pi/monitoring.ts:78` — `JSON.stringify` 大对象可能阻塞 event loop**

- **位置**: `monitoring.ts:78`
  ```typescript
  const output = JSON.stringify(entry);
  ```
- **Impact**: `entry.metadata` 可能包含大型对象（API 响应、错误堆栈等），`JSON.stringify` 是同步阻塞操作，在热路径上可能影响性能。
- **Suggestion**: 在 metadata 超过阈值时截断，或使用 `JSON.stringifyAsync`（pino 库内部处理）。

### P2-7 🔹 **`features/ai/agents/work/subagents/pi/context.ts:40-41` — workspace 文件写入竞态条件**

- **位置**: `context.ts:40-41`
  ```typescript
  await fs.mkdir(contextDir, { recursive: true });
  await fs.writeFile(contextFile, contextContent, "utf-8");
  ```
- **Impact**: 多进程/多实例场景下，`mkdir` + `writeFile` 之间存在竞态（另一个进程可能同时写入同一目录）。虽然是小概率，但会导致文件内容不可预测。
- **Suggestion**: 使用 `fs.writeFile(contextFile, content, { flag: 'w' })` 配合 `recursive: true`（fs/promises 16+ 支持）。

---

## 5. Positive Points

1. **Pi 事件类型系统完整**：`types.ts` 的 discriminated union `PiEvent` 覆盖了 15+ 事件类型，结构清晰。

2. **错误分类设计合理**：`error-recovery.ts` 的 `ErrorType` 枚举 + `classifyError` 覆盖了生产常见错误模式（网络超时/认证失败/资源耗尽）。

3. **重试机制完善**：`withRetry` 支持指数退避 + 抖动 + 错误类型分类，比 Phase 4 Review 前的"无条件重试 3 次"健壮得多。

4. **并发控制器逻辑正确**：`ConcurrencyController` 的全局/用户二级限制 + FIFO 队列 + 超时清理，逻辑无竞态。

5. **性能指标计算正确**：`MetricsCollector.percentile()` 的百分位数算法正确（`ceil - 1`），P50/P95/P99 计算有效。

6. **凭证解密链路安全**：`api-key-store.ts` 使用 AES-GCM 加密（`encrypt`/`decrypt`），明文不落 DB，凭证链路设计合理。

7. **Schema 完整性**：Phase 4 新增的 `SubAgentRun` 表有 4 个索引（userId+startedAt / status+startedAt / agentType+startedAt / sessionId），覆盖了主要查询路径。

---

## 6. Phase 4 Review 遗留问题检查

| 遗留问题 | 当前状态 |
|----------|----------|
| **P0-1**: PolicyRule schema 字段不匹配 (`targetName`/`riskLevel` 不存在) | ⚠️ **未修复**：tsc 仍报 `PolicyRuleWhereInput` 类型错误 |
| **P0-2**: duplicate identifier `prisma` | ✅ **已修复**（sdk.ts 不再有重复 import） |
| **P0-3**: 隐式 `any` 类型 (`policy/index.ts:176`) | ⚠️ **未修复**：tsc 仍报 `Record<string, unknown>` 不兼容 `InputJsonValue` |
| **P1-1**: HIL Promise race condition | ✅ **已消除**：`sdk.ts` 重构后不再有两次 `set` |
| **P1-2**: `updateApproval` 无 ownership 检查 | ⚠️ **未修复**：`policy/index.ts` 仍无 check |
| **P1-3**: GET endpoint 字符串 includes 逻辑错误 | ⚠️ **未修复**：tsc 仍报 `PolicyRuleWhereInput` 类型错误 |
| **P1-5**: HIL timer 未在 cancel 时清理 | ✅ **已消除**：新实现无此路径 |
| **P1-6**: 审计日志内存+DB 一致性 | ⚠️ **未修复**：结构未变 |

**Phase 4 遗留的 P0 阻塞问题仍存在于当前代码库**（`app/api/ai/work/policy/route.ts` 和 `features/ai/agents/work/policy/index.ts`），这些是历史遗留，不是 Phase 5 的问题，但会在 `npm run build` 时阻塞整个项目。

---

## 7. 验证清单

### P0 阻塞项

- [ ] **P0-1**: 修复 `sdk.ts:20` import 路径 `./error-recovery` → `../error-recovery`
- [ ] **P0-2**: 修复 `generateRunId()` 返回 `string | undefined` 类型错误
- [ ] **P0-3**: 修复 `generateSessionId()` 返回 `string | undefined` 类型错误
- [ ] **P0-4**: 移除 `process.env` 全局污染，改用 SDK 参数传入 API key
- [ ] **P1-6**: 修复 `phase-5-p0-verify.ts` import 路径

### P1 重要项

- [ ] **P1-1**: 移除 `as any`，定义 SDK 参数接口
- [ ] **P1-2**: 实现 Policy Gateway 集成（`checkPolicy` 调用）
- [ ] **P1-3**: 添加 SDK API 兼容性检查验证
- [ ] **P1-4**: DB 写入失败时拒绝启动
- [ ] **P1-5**: `followUp` 支持结构化 HIL 决策

### P2 优化项

- [ ] **P2-1**: 移除 `"system"` 魔法字符串
- [ ] **P2-2**: 传入真实 `runId` 给 `checkPolicy`
- [ ] **P2-3**: 改进 `classifyError` 对象处理
- [ ] **P2-4**: 简化 `translateSingleEvent` result 类型
- [ ] **P2-5**: 清理 Promise timer
- [ ] **P2-6**: JSON.stringify 阈值保护
- [ ] **P2-7**: atomic 文件写入

### 回归测试

- [ ] Phase 4 的 `phase-4-full-verify.ts` 全部 10/10 通过
- [ ] `npm run build` 无错误（目前 Phase 4 遗留 P0 导致 build 失败）

---

## 8. 审查结论

- **状态**: ⚠️ **Approved with Required Changes**
- **理由**: P0-1/P0-2/P0-3 共 3 处 tsc 错误阻塞 build，P0-4 凭证安全问题必须修复。P1 基础设施设计扎实但 `Policy Gateway` 未激活，核心承诺"真实 Pi SDK 集成"缺少 API 兼容性验证。修复 P0 阻塞项后应能通过 build，但 P1-2（P0 级别的安全/策略功能）需在生产部署前实现。

---

*审查时间: 2026-08-19 | 审查者: code-reviewer (硬层)*
