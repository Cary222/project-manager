<!-- reviewer: code-reviewer (硬层) -->

# AI Config P0/P1 — code-reviewer 硬层审查

**审查范围：**
- Task A: `lib/models-config-store.ts`（解耦循环依赖，改用环境变量）
- Task B: `features/ai/agents/work/subagents/pi/transports/sdk.ts`（移除 Prisma 查询，改用 api-key-store.ts）

---

## 审查结论

**Verdict: ⚠️ Approved with CRITICAL**

代码整体符合功能目标，但存在 **2 个必须修复的 CRITICAL 问题**（含 1 个 `cross-mentor` 标注的架构问题）和 **4 个建议改进项**。

---

## 7 个维度的审查结果

### 1. 类型安全

**评分：⚠️ 有问题**

`transports/sdk.ts` 中存在多处 `as any` 类型断言：

| 位置 | 行号 | 问题 |
|------|------|------|
| `createPiSession` | 252 | `ModelRuntime.create({...} as any)` — 绕过 SDK 选项类型检查 |
| `createPiSession` | 298 | `baseUrl ? { baseUrl } as any : undefined` — 参数类型不匹配 |
| `createPiSession` | 359 | `createAgentSession({...} as any)` — 完全绕过参数类型 |
| `getRegisteredTools` | 73 | `this.registeredTools.map((tool: any) => tool?.name)` — 未定义工具类型 |

**`models-config-store.ts` 类型安全良好：**
- 所有函数参数/返回值类型明确（`Record<string, unknown>` / `Promise<void>` / `Promise<Record<string, unknown>>`）
- `isRecord` 类型守卫设计合理
- 无 `any` / `as` 滥用

### 2. 错误处理

**评分：✅ 良好**

**models-config-store.ts:**
- `readModelsConfig`: JSON 解析失败时返回 `{ providers: {} }`（优雅降级）
- `writeModelsConfig`: `try/catch` 包裹文件操作

**transports/sdk.ts:**
- `setupCredentials`: `withRetry` 包装（maxAttempts: 2, baseDelay: 500ms）
- `createPiSession`: `withRetry` 包装（maxAttempts: 3, baseDelay: 1000ms）
- 凭证缺失时抛出明确错误信息
- 所有 Prisma 操作有 `try/catch`，非致命错误不阻塞执行

**边界 Case：`PI_RUNTIME_DIR` 未设置 → 正确 fallback 到 `~/.pi-runtime`**

### 3. 边界 Case

**评分：⚠️ 存在隐患**

**models-config-store.ts 边界处理良好：**
- `readModelsConfig`: 文件不存在时返回空 providers 对象 ✅
- `writeModelsConfig`: 目录不存在时 `mkdirSync({ recursive: true })` ✅

**transports/sdk.ts 边界 Case 存在隐患：**

| Case | 当前处理 | 风险 |
|------|---------|------|
| `getUserProviderRecords` 返回空数组 | 抛出错误（行282） | ✅ 正确 |
| `modelRuntime.getModel()` 找不到模型 | 回退到第一个可用模型 | ✅ 可接受 |
| `sendUserMessage` 抛出 | 仅 `console.error`，未向上传播 | ⚠️ 可能丢失关键错误 |
| `eventQueue` 无限增长 | 无上限控制 | ⚠️ 内存风险 |

### 4. 性能

**评分：✅ 无 N+1 问题**

- `api-key-store.ts` 使用 `findFirst`（单条查询），无 N+1
- `transports/sdk.ts` 中所有 Prisma 查询均在 `withRetry` 内，次数可控
- `models-config-store.ts` 使用同步文件 I/O，但仅在 API 路由调用（服务端），可接受

**注意：** `getAgentDir()` 从 async 改为同步，副作用评估：
- ✅ 无副作用：仅读取 `process.env`，不涉及 I/O
- ✅ 调用方 `getModelsConfigPath()` 已是 async，整体无变化

### 5. 安全

**评分：⚠️ CRITICAL — 多租户凭证隔离风险**

**models-config-store.ts:**
- ✅ 无安全风险（仅读文件系统）

**transports/sdk.ts — CRITICAL 问题：**

```245:234:features/ai/agents/work/subagents/pi/transports/sdk.ts
process.env.DEEPSEEK_API_KEY = cred.apiKey;
```

**问题：** `setupCredentials` 方法通过 `process.env` 全局设置 API key。在多租户环境中：
- 线程/并发请求共享同一 `process.env`
- 用户 A 的凭证可能被用户 B 的请求看到
- Pi SDK 在创建 session 时读取这些全局变量，造成跨用户凭证泄漏风险

**cross-mentor:** 此问题涉及多租户隔离架构决策，需 ai-learning-mentor 评估是否可以接受或需要重构为请求级凭证传递。

**其他安全观察：**
- ✅ API key 明文未写入日志（仅记录长度）
- ✅ 凭证解密在 `api-key-store.ts` 内部完成，不外泄
- ✅ 无 XSS / injection 风险

### 6. FSD 边界

**评分：⚠️ 存在边界问题**

| 文件 | FSD 定位 | 依赖关系 | 评估 |
|------|----------|----------|------|
| `lib/models-config-store.ts` | `lib/` 共享层 | `lib/atomic-file`, `lib/models-cache` | ✅ 正确 |
| `transports/sdk.ts` | `features/ai/agents/work/...` | `features/ai/llm/credentials/api-key-store` | ⚠️ 跨 feature 子模块调用 |

**`models-config-store.ts` FSD 合规：**
- 仅依赖 `lib/` 模块，符合 shared layer 定位
- 注释清晰说明了与 Pi Runtime / ProjectHub 的职责边界

**`transports/sdk.ts` FSD 边界问题：**
- `features/ai/agents/work/subagents/pi/transports/` 调用 `features/ai/llm/credentials/api-key-store`
- 这跨越了 `agents` 和 `llm` 两个 feature 子模块
- 建议评估：`llm/credentials` 是否应提升为 `shared/lib` 供跨 feature 调用

### 7. 测试覆盖

**评分：❌ 无测试**

两个文件均无单元测试或集成测试：
- `models-config-store.ts`: 建议补充 `readModelsConfig` / `writeModelsConfig` / `normalizeModelsConfigCosts` 的单元测试
- `transports/sdk.ts`: 建议补充 `setupCredentials` / `createPiSession` 的 mock 测试

---

## 发现的问题

### CRITICAL（必须修复）

#### C1: `as any` 类型断言绕过安全检查

**文件：** `features/ai/agents/work/subagents/pi/transports/sdk.ts`

**位置：**
- 行 252: `ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false } as any)`
- 行 298: `{ baseUrl } as any`
- 行 359: `createAgentSession({ cwd, modelRuntime, model } as any)`

**问题：** 3 处 `as any` 完全绕过 TypeScript 类型检查。Pi SDK 的 API 可能已稳定，`as any` 会隐藏类型不匹配的 bug。

**建议：** 定义 `SdkModelRuntimeOptions` / `SdkSessionOptions` 接口，替代 `as any`。

**优先级：** P0

---

#### C2: 多租户凭证隔离风险（cross-mentor）

**文件：** `features/ai/agents/work/subagents/pi/transports/sdk.ts`

**位置：** 行 176-234（`setupCredentials` 方法）

**问题：** 通过 `process.env` 全局设置 API key，在 Node.js 多租户环境（SSR / Serverless / Worker）中可能导致跨用户凭证泄漏。

```176:234:features/ai/agents/work/subagents/pi/transports/sdk.ts
// ⚠️ 设置环境变量（Pi SDK 会读取）
// 注意：这会修改全局 process.env，多租户场景有隔离风险
const providerName = provider || "deepseek";

if (providerName === "deepseek") {
  process.env.DEEPSEEK_API_KEY = cred.apiKey;
```

**影响：** 高 — 安全漏洞

**建议：** 
1. 调查 Pi SDK 是否支持运行时传递凭证（见注释行 174）
2. 如果不支持，考虑在调用前清理 `process.env`
3. 或者在文档中明确此模块不支持多租户并发

**cross-mentor:** 请 ai-learning-mentor 评估此问题的业务影响范围和多租户场景优先级。

**优先级：** P0

---

### MAJOR（建议改进）

#### M1: 事件队列无上限控制

**文件：** `features/ai/agents/work/subagents/pi/transports/sdk.ts`

**位置：** 行 398 `eventQueue`

**问题：** `eventQueue` 是无界数组，在 Pi SDK 事件频率高于消费速度时可能无限增长，导致 OOM。

**建议：** 添加队列大小上限，超限时记录警告并丢弃最旧事件。

```typescript
const MAX_QUEUE_SIZE = 1000;
if (eventQueue.length >= MAX_QUEUE_SIZE) {
  console.warn(`[PiSdkRuntime] Event queue full, dropping oldest event`);
  eventQueue.shift(); // 丢弃最旧
}
```

**优先级：** P1

---

#### M2: `sendUserMessage` 错误未传播

**文件：** `features/ai/agents/work/subagents/pi/transports/sdk.ts`

**位置：** 行 144-146

```144:146:features/ai/agents/work/subagents/pi/transports/sdk.ts
piSession.sendUserMessage(input.prompt).catch((err: Error) => {
  console.error("[PiSdkRuntime] sendUserMessage failed:", err);
});
```

**问题：** `sendUserMessage` 的 Promise rejection 仅记录日志，不向上传播。如果模型初始化后消息发送失败，用户会看到 run "卡住" 而不是收到错误。

**建议：** 将错误挂载到 handle 上，或通过事件流发送错误。

**优先级：** P2

---

#### M3: 工具注册缺少类型定义

**文件：** `features/ai/agents/work/subagents/pi/transports/sdk.ts`

**位置：** 行 65-73

```65:73:features/ai/agents/work/subagents/pi/transports/sdk.ts
registerTool(tool: unknown): void {
  this.registeredTools.push(tool);
}

getRegisteredTools(): string[] {
  return this.registeredTools.map((tool: any) => tool?.name || 'unknown');
}
```

**问题：** `tool: unknown` 和 `tool: any` 都是类型安全漏洞。

**建议：** 定义 `RegisteredTool` 接口：

```typescript
interface RegisteredTool {
  name: string;
  execute: (args: unknown) => Promise<unknown>;
}
```

**优先级：** P2

---

### MINOR（可选改进）

#### m1: 文档中 Node.js 依赖未标注

**文件：** `lib/models-config-store.ts`

**位置：** 文件头部

**问题：** 文件使用 `node:fs` / `node:path` / `node:os`，但文档未说明仅限 Node.js 环境。

**建议：** 在 JSDoc 或文件头部添加 `@platform node` 标注。

---

#### m2: `getRegisteredTools` 返回 `unknown[]` 长度的 string 数组

**文件：** `features/ai/agents/work/subagents/pi/transports/sdk.ts`

**位置：** 行 72-74

**问题：** 语义上"获取已注册工具列表"应返回工具对象或工具 ID，而非仅名称。

**建议：** 如果仅需名称可保留；否则考虑返回 `{ name: string; id: string }[]`。

---

## tsc 错误分析

运行 `npx tsc --noEmit` 结果：

| 错误 | 相关文件 | 与本次改动关系 |
|------|----------|---------------|
| `app/api/models/route.ts:39` 类型不兼容 | `models/route.ts` | ❌ 无关（Pi SDK 集成问题，历史遗留）|
| `e2e/module-edit.spec.ts` | Playwright 测试 | ❌ 无关（测试文件类型错误）|
| `features/admin/admin.test.ts` | Admin 功能 | ❌ 无关（测试文件 import 路径问题）|

**结论：** 本次 P0/P1 改动（`models-config-store.ts` / `transports/sdk.ts`）**未引入新的 tsc 错误**。列出的错误均为历史遗留。

---

## 必须修复（如有 CRITICAL）

| # | 文件 | 行号 | 修复建议 |
|---|------|------|----------|
| C1 | `transports/sdk.ts` | 252, 298, 359 | 定义 SDK 类型接口替代 `as any` |
| C2 | `transports/sdk.ts` | 176-234 | 多租户凭证隔离方案（cross-mentor 评估优先级）|

---

## 建议改进（如有 MAJOR/MINOR）

| # | 优先级 | 描述 |
|---|--------|------|
| M1 | P1 | 事件队列添加上限控制 |
| M2 | P2 | `sendUserMessage` 错误应传播 |
| M3 | P2 | 工具注册添加类型定义 |
| m1 | P3 | 标注 Node.js 依赖 |

---

## Positive Points

- ✅ **解耦成功**：`models-config-store.ts` 不再依赖 Pi SDK，循环依赖问题已解决
- ✅ **凭证统一**：`transports/sdk.ts` 通过 `api-key-store.ts` 获取凭证，符合三级降级设计
- ✅ **错误处理完善**：所有网络/DB 操作均用 `withRetry` 包装
- ✅ **TypeScript 类型意识强**：`models-config-store.ts` 无 `any` 滥用
- ✅ **文档清晰**：JSDoc 注释完整，架构决策有记录
- ✅ **安全意识**：`models-config-store.ts` 的 API key 明文不写入日志

---

## Next Steps

1. **立即修复 C1**（`as any` 问题）— 类型安全是 P0
2. **C2 提交 cross-mentor**（多租户凭证隔离）— 评估业务影响后再决定
3. **补充测试覆盖** — M3 前置条件
4. **M1 / M2 / M3** — 可在后续迭代中处理

---

*审查完成时间：2026-08-21 15:45 UTC+8*
