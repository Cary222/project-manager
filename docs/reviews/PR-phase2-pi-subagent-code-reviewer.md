<!-- reviewer: code-reviewer (硬层) -->
# Phase 2 — Pi SubAgent 接入 Code Review（硬层）

## 审查摘要
- 审查文件：8 个（types.ts, subagent.ts, events.ts, context.ts, graph.ts, route.ts, WorkModePanel.tsx, phase-2-verify.ts）
- Critical：4 个
- Major：5 个
- Minor：3 个
- tsc：`npx tsc --noEmit` 通过（仅有历史遗留错误，非 Phase 2 引入）
- 总体评价：**CONDITIONAL_PASS** — 需要先修复 Critical 问题

---

## Critical（必须修复）

### 1. [WorkModePanel.tsx:416-422] SSE 清理逻辑与实现不匹配

**问题**：停止按钮调用 `eventSourceRef.current.close()`，但 SSE 模式实际使用的是 `fetch + ReadableStream`，不是 `EventSource`。`eventSourceRef.current` 始终为 `null`，点击停止按钮无法真正停止流。

**影响**：用户点击停止后，流仍在后台继续读取，造成内存泄漏和 CPU 浪费。

**修复建议**：
```typescript
// 在组件顶层添加 ref
const readerRef = useRef<ReadableStreamDefaultReader | null>(null);

// 在 readStream 开始时保存 reader
readerRef.current = reader;

// 在停止按钮中正确取消
if (readerRef.current) {
  await readerRef.current.cancel();
}
```

---

### 2. [WorkModePanel.tsx:187-193] ReadableStream 缺少 cancel 控制

**问题**：`reader.read()` 循环没有 `AbortController` 或取消机制。当 SSE 连接中断或用户停止时，流无法被正确中断。

**影响**：长时间运行的 SSE 连接无法被取消，导致资源泄漏。

**修复建议**：
```typescript
const controller = new AbortController();

// 在 reader.read() 中检查 abort
const readStream = async () => {
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || controller.signal.aborted) break;
      // ...
    }
  } finally {
    reader.releaseLock();
  }
};

// 停止时调用
controller.abort();
```

---

### 3. [WorkModePanel.tsx:258-265] useEffect cleanup 与实现不匹配

**问题**：`useEffect` 清理函数检查 `eventSourceRef.current`，但 SSE 模式使用的是 `fetch + ReadableStream`，`eventSourceRef` 不会被赋值。组件卸载时无法清理正在进行的流。

**影响**：组件卸载时 SSE 流继续运行，造成内存泄漏。

**修复建议**：
```typescript
useEffect(() => {
  // 组件卸载时取消 fetch 流
  return () => {
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
    }
  };
}, []);
```

---

### 4. [route.ts:163-172] SSE 事件流缺少取消机制

**问题**：`for await (const event of handle.events)` 循环没有取消控制。当 SSE 连接中断时，`handle.events` AsyncIterable 无法被中断。

**影响**：SSE 连接中断后，后端 Pi session 仍在运行，造成资源浪费。

**修复建议**：
```typescript
// 使用 AbortSignal 控制
const abortController = new AbortController();

try {
  for await (const event of handle.events) {
    if (abortController.signal.aborted) break;
    // ...
  }
} finally {
  // 确保清理
  abortController.abort();
}
```

---

## Major（建议修复）

### 5. [context.ts:39-40] 文件写入缺少错误处理

**问题**：`fs.mkdir` 和 `fs.writeFile` 调用没有 try-catch。如果目录创建或文件写入失败（如磁盘满、权限问题），调用者无法感知错误。

**影响**：上下文注入失败时用户不会收到通知，可能导致 Pi session 使用错误的上下文。

**修复建议**：
```typescript
export async function injectRuntimeContext(...): Promise<void> {
  try {
    await fs.mkdir(contextDir, { recursive: true });
    await fs.writeFile(contextFile, contextContent, "utf-8");
  } catch (error) {
    console.error("Failed to inject runtime context:", error);
    throw new Error(`Failed to inject runtime context: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
```

---

### 6. [events.ts:10] 冗余类型定义

**问题**：`type AsyncIterable<T> = AsyncIterableIterator<T>` 重新定义了 TypeScript 内置类型，可能导致混淆。

**影响**：代码可读性降低，与标准库不一致。

**修复建议**：直接使用标准库的 `AsyncIterable<T>` 类型。

---

### 7. [graph.ts:128, route.ts:150] workspace 硬编码为 process.cwd()

**问题**：两处代码都将 `workspace` 设置为 `process.cwd()`，这是 Node.js 进程工作目录，不一定是用户实际项目目录。

**影响**：Pi session 可能在错误的目录启动，导致文件操作错误。

**修复建议**：
```typescript
// 从 session 或配置获取真实项目目录
const subAgentInput = {
  prompt: userInput,
  workspace: session.user.projectPath ?? process.cwd(), // 从会话获取
  contextFiles: [],
};
```

---

### 8. [subagent.ts:99-102] resume 方法错误处理不一致

**问题**：`resume` 方法检查 `run.status !== "paused"` 后抛出错误，但 Phase 2 注释说"暂不支持"。这会导致调用时抛出意外错误。

**影响**：如果用户意外调用 resume，会得到不友好的错误。

**修复建议**：
```typescript
// 明确标注不支持
async resume(runId: string, _userInput: string): Promise<SubAgentHandle> {
  throw new Error("Resume is not supported in Phase 2. Will be implemented in Phase 3.");
}
```

---

### 9. [WorkModePanel.tsx:196-225] readStream 函数缺少 finally 清理

**问题**：`readStream` 内部函数没有 `finally` 块来确保 `reader` 被释放。

**影响**：如果读取过程中出错，`reader` 可能不会被正确释放。

**修复建议**：
```typescript
const readStream = async () => {
  try {
    // ... existing code
  } finally {
    reader.releaseLock(); // 确保释放锁
  }
};
```

---

## Minor（可选优化）

### 10. [WorkModePanel.tsx:211] JSON.parse 双重解析

**问题**：`JSON.parse(jsonStr)` 只用于验证，但验证后的对象没有被复用。

**影响**：轻微性能浪费。

**修复建议**：
```typescript
const data = JSON.parse(jsonStr);
handleSSEEvent({ data } as MessageEvent);
```

---

### 11. [events.ts:193] 复杂的条件类型

**问题**：`piEvent.result as SubAgentEvent extends { type: "run_completed"; result: infer R } ? R : never` 这个条件类型过于复杂，可读性差。

**影响**：维护困难。

**修复建议**：拆分为独立的类型辅助函数。

---

### 12. [phase-2-verify.ts:153-157] 事件流测试逻辑问题

**问题**：`translateEvents(runId, emptyEvents())` 传入的是 generator 函数而非 AsyncIterable 对象。

**影响**：测试可能在 Phase 3 真实 SDK 接入时失败。

**修复建议**：更新测试以适配真实 AsyncIterable 接口。

---

## 正面发现

1. **类型设计良好**：`SubAgentEvent` 的 discriminated union 设计清晰，与架构文档一致。
2. **Mock 实现完整**：`createMockEventStream` 提供了完整的测试场景。
3. **无安全漏洞**：未发现 XSS、路径遍历或其他安全问题。
4. **Phase 2 范围控制严格**：没有实现 Policy Gateway 或真实 Pi SDK 调用。
5. **无 console.log**：代码中没有调试日志。
6. **命名约定一致**：遵循项目 camelCase 约定。
7. **context.ts 正确使用 path.join**：避免了路径拼接漏洞。

---

## 修复建议优先级

### P0（立即修复）
1. Critical #1-4：SSE 清理逻辑问题 — 必须修复，否则内存泄漏

### P1（本轮修复）
5. context.ts 文件写入错误处理
7. workspace 硬编码问题
9. readStream finally 清理

### P2（后续迭代）
6. 移除冗余类型定义
8. resume 方法明确标注不支持
10-12. 其他 Minor 优化

---

## 总结

Phase 2 代码整体质量良好，架构设计与文档一致。主要问题是 **SSE 清理逻辑与实现不匹配**：WorkModePanel 使用 `fetch + ReadableStream` 但清理代码引用 `EventSource`。这会导致：

1. 用户点击停止按钮无效
2. 组件卸载后流继续运行
3. 资源泄漏

**必须先修复 Critical 问题后再合并**。其余 Major 问题建议在本轮一并修复，Minor 问题可后续迭代处理。
