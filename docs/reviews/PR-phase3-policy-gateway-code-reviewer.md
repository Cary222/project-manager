<!-- reviewer: code-reviewer (硬层) -->
# Phase 3 Policy Gateway 硬层技术审查

审查时间：2026-08-18
审查范围：Phase 3 Policy Gateway + HIL + Pi Runtime Mock

## 审查摘要
- **总体评价**：CHANGES_REQUIRED
- **Critical 问题**：2 个
- **Major 问题**：4 个
- **Minor 问题**：3 个

## 一、类型检查结果

### tsc --noEmit
```
features/ai/ui/work/WorkModePanel.tsx(4,34): error TS6142: Module './WorkflowLauncher' was resolved, but '--jsx' is not set.
features/ai/ui/work/WorkModePanel.tsx(5,36): error TS6142: Module './WorkflowStatusCard' was resolved, but '--jsx' is not set.
```
> ⚠️ **已知历史遗留**：这两个 JSX 配置问题是项目级问题，非 Phase 3 新增。

### ESLint
```
✖ 7 problems (0 errors, 7 warnings - maximum: 0)
```
全部为 unused variable 警告（`SubAgentResult`, `_runId`, `_input`, `_sessionId`）。

### 验证脚本
```
✅ Phase 3 验证通过！
  ✓ Policy Gateway 三层检查
  ✓ Pi SDK Transport (Mock)
  ✓ 事件翻译增强
  ✓ graph.ts 集成
```

---

## 二、Critical 问题（必须修复）

### 1. **[features/ai/agents/work/policy/index.ts:78]** PolicyGateway 未正确执行三层检查

**问题**：`PolicyGateway.check()` 仅调用 `checkTool()`，但未按架构文档要求调用 `checkCommand` 和 `checkPaths` 进行三层检查。

```typescript
// 当前实现（仅一层）
const result = checkTool(context);

// 架构文档要求（三层）
// 1. tool-policy → checkTool()
// 2. path-policy → checkPaths(ctx.filePaths, ctx.workspace)
// 3. command-policy → checkCommand(ctx.command)
```

**影响**：路径黑名单和命令白名单检查链被跳过，安全策略不完整。

**建议**：在 `checkTool()` 内部或 `PolicyGateway.check()` 中正确串联三层检查：
```typescript
// 方案 A：在 checkTool 内部串联
export function checkTool(context: PolicyContext): PolicyResult {
  // 1. Shell 工具：先检查命令
  if (tool === "bash" || tool === "shell" || tool === "execute") {
    const command = extractCommand(args);
    const cmdResult = checkCommand(command);
    if (cmdResult.decision !== "allow") return cmdResult;
  }

  // 2. 文件工具：检查路径
  const paths = extractPaths(args);
  if (paths.length > 0) {
    const pathResult = checkPaths(paths, workspace);
    if (pathResult.decision === "deny") return pathResult;
  }

  // 3. 高风险工具：要求审批
  ...
}
```

---

### 2. **[scripts/phase-3-verify.ts:24]** 验证脚本使用不存在的 `type` 字段

**问题**：`PolicyContext` 接口未定义 `type` 字段，但验证脚本传入了 `type: "tool"`：

```typescript
// verify.ts:23-30
await gateway.check({
  type: "tool",  // ❌ 不存在于 PolicyContext
  tool: "read_file",
  args: { path: "/tmp/test.txt" },
  runId: "test-run",
  userId: "test-user",
  workspace: "/tmp",
});
```

**影响**：类型不安全；虽然运行时因 TypeScript 擦除而不报错，但这是潜在 bug。

**建议**：移除不存在的 `type` 字段。

---

## 三、Major 问题（强烈建议修复）

### 3. **[features/ai/agents/work/subagents/pi/transports/sdk.ts]** PiSdkRuntime 核心方法未实现

**问题**：`steer()`, `followUp()`, `resume()` 全部抛出 "not implemented" 异常：

```typescript
async steer(_runId: string, _input: string): Promise<void> {
  throw new Error("steer() not implemented in Phase 3");
}

async followUp(_runId: string, _input: string): Promise<void> {
  throw new Error("followUp() not implemented in Phase 3");
}

async resume(_sessionId: string): Promise<PiRunHandle> {
  throw new Error("resume() not implemented in Phase 3");
}
```

**影响**：这些是 PiRuntime 接口的核心方法，生产环境中 HIL 审批恢复依赖 `resume()`。调用会导致运行时崩溃。

**建议**：
1. 在方法内返回合理的 mock 结果而非抛出异常
2. 或明确在运行时抛出有意义的 `NotImplementedError`

---

### 4. **[features/ai/agents/work/policy/command-policy.ts:142-158]** 字符串匹配可被绕过

**问题**：命令白名单使用简单的 `includes()` 匹配，可被绕过：

```typescript
// 可被绕过的场景
"rm -rf" → `bash -c 'rm -rf /'`
"npm install" → `npx npm_install_malicious`
```

**影响**：应用层安全策略被绕过，但文档已明确说明"Policy 是应用级策略，最终安全靠 Sandbox/Container"。

**建议**：
1. 增加转义/解析逻辑，防止 `bash -c` 绕过
2. 或依赖更底层的 sandbox/container 作为最终安全边界

---

### 5. **[features/ai/agents/work/subagents/pi/events.ts:169-252]** 事件翻译大量使用 type assertion

**问题**：`translateSingleEvent` 大量使用 `as` 类型断言，无运行时验证：

```typescript
case "tool_call":
  return {
    type: "tool_call",
    runId,
    eventId: (piEvent.eventId as string) ?? "",
    tool: (piEvent.tool as string) ?? "",
    args: (piEvent.args as Record<string, unknown>) ?? {},
    callId: (piEvent.callId as string) ?? "",
  };
```

**影响**：如果 Pi SDK 发来的事件结构与预期不符，会静默返回空/null 值而非报错。

**建议**：增加 Zod schema 验证或类型守卫。

---

### 6. **[features/ai/agents/work/subagents/pi/transports/sdk.ts:37-40]** 并发安全问题

**问题**：`runStore` 和 `sessionStore` 使用普通 `Map`，无并发保护：

```typescript
private runStore = new Map<string, PiRunHandle>();
private sessionStore = new Map<string, string>();
```

**影响**：Node.js 单线程下暂无问题，但如果未来引入 Worker 或多实例，会出现竞态条件。

**建议**：如果 Phase 4+ 不引入并发，可以保持现状但加注释说明；否则改用 `Map` + mutex 或 `AsyncMap`。

---

## 四、Minor 问题（可选修复）

### 7. **[features/ai/agents/work/subagents/pi/subagent.ts:12]** 未使用的导入

**问题**：`SubAgentResult` 已导入但未使用。

### 8. **[features/ai/agents/work/subagents/pi/transports/sdk.ts:126,134,157,246]** 未使用的参数

**问题**：以下参数以 `_` 前缀但仍触发 ESLint 警告（最大警告数为 0）：
- `steer(_runId, _input)`
- `followUp(_runId, _input)`
- `resume(_sessionId)`
- `createMockPiEventStream(_sessionId)`

**建议**：使用 `// @ts-ignore` 或调整 ESLint 配置。

---

### 9. **[features/ai/agents/work/subagents/pi/context.ts:39-45]** 上下文注入错误处理过于宽泛

**问题**：`injectRuntimeContext` 失败时抛出异常，但调用处（`sdk.ts:54-70`）吞掉了异常并继续执行：

```typescript
// sdk.ts:67-70
} catch (error) {
  console.error("[PiSdkRuntime] Failed to inject context:", error);
  // 非致命错误，继续执行
}
```

**影响**：运行时上下文注入失败可能影响 Pi Agent 的任务理解，但不会崩溃。

**建议**：根据业务需求决定是否应该 fail-fast。当前"静默继续"可能是合理的设计。

---

## 五、正向发现

### 做得好的地方

1. **路径检查使用 `path.relative()` 而非 `startsWith()`**
   - 正确防止了路径遍历攻击

2. **PolicyGateway 审计日志实现完整**
   - 有 `recordAudit()`, `getAuditLog()`, `clearAuditLog()`
   - 日志上限 1000 条防止内存泄漏

3. **事件翻译覆盖了主要 PiEvent 类型**
   - `session_started`, `message`, `tool_call`, `tool_result`, `approval_required`, `progress`, `run_completed`

4. **WorkModePanel HIL UI 实现清晰**
   - 审批弹窗有 `handleApprove` / `handleDeny`
   - SSE 事件流解析完整

5. **验证脚本覆盖了核心功能**
   - 4 个测试用例覆盖 Policy Gateway、Transport、事件翻译、graph 集成

---

## 六、Next Steps

1. **修复 Critical 问题**：
   - [ ] PolicyGateway 串联三层检查（command-policy / path-policy / tool-policy）
   - [ ] 移除 verify.ts 中不存在的 `type` 字段

2. **修复 Major 问题**：
   - [ ] PiSdkRuntime 的 `steer/followUp/resume` 返回 mock 结果而非抛异常
   - [ ] 增加命令解析防止简单绕过
   - [ ] 考虑为 `translateSingleEvent` 增加类型守卫或 Zod 验证
   - [ ] 评估并发安全需求

3. **可选修复**：
   - [ ] 处理 ESLint unused variable 警告
   - [ ] 统一上下文注入错误处理策略
