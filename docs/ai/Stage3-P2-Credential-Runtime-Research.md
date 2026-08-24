# Stage 3 P2: PiSubAgent Credential Runtime 注入方式深度研究

> 研究日期：2026-08-21
> 研究范围：`features/ai/agents/work/subagents/pi/transports/sdk.ts` + Pi SDK 内部实现
> 研究目标：分析 `setupCredentials()` 中 `process.env` 修改是否可以被删除

---

## A. 当前 Credential Runtime 注入链

```
PiSubAgent.start()
    │
    ▼
sdk.ts:start()
    │
    ├─ [步骤 1] setupCredentials(userId, provider)  ← ❌ 设置 process.env（可删除）
    │       │
    │       └─ resolveCredentialWithFallback(userId, provider, env)
    │              │
    │              └─ 设置 process.env.DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
    │
    ├─ [步骤 2] createPiSession(input)  ← ✅ 真正生效的凭证注入
    │       │
    │       ├─ ModelRuntime.create()
    │       │       └─ 创建 RuntimeCredentials wrapper
    │       │
    │       ├─ resolveCredentialWithFallback(userId, provider)
    │       │
    │       ├─ modelRuntime.setRuntimeApiKey(sdkProviderName, apiKey, { baseUrl })
    │       │       └─ 存入 RuntimeCredentials.overrides Map
    │       │
    │       ├─ modelRuntime.getProviderAuthStatus(sdkProviderName)
    │       │
    │       └─ createAgentSession({ modelRuntime, model, cwd })
    │              └─ 使用 modelRuntime.getAuth() 读取凭证（优先读 overrides）
    │
    └─ [步骤 3] sendUserMessage(prompt)
```

**关键发现：步骤 1 设置的 `process.env` 没有任何消费者。**

---

## B. setRuntimeApiKey 能力覆盖矩阵

| Provider | setRuntimeApiKey | baseURL 支持 | headers 支持 | Auth 格式 | 验证来源 |
|----------|-----------------|--------------|-------------|-----------|----------|
| OpenAI | ✅ 完全支持 | ✅ `{ baseUrl }` 参数 | ❌ 不直接支持 | `apiKey` | `runtime-credentials.js:8-9` |
| Anthropic | ✅ 完全支持 | ✅ `{ baseUrl }` 参数 | ❌ 不直接支持 | `apiKey` | `runtime-credentials.js:8-9` |
| DeepSeek | ✅ 完全支持（映射为 `openai`） | ✅ `{ baseUrl }` 参数 | ❌ 不直接支持 | `apiKey` | `runtime-credentials.js:8-9` |
| Google | ✅ 完全支持 | ✅ `{ baseUrl }` 参数 | ❌ 不直接支持 | `apiKey` | `runtime-credentials.js:8-9` |
| Groq | ✅ 完全支持 | ✅ `{ baseUrl }` 参数 | ❌ 不直接支持 | `apiKey` | `runtime-credentials.js:8-9` |
| Together | ✅ 完全支持 | ✅ `{ baseUrl }` 参数 | ❌ 不直接支持 | `apiKey` | `runtime-credentials.js:8-9` |
| OpenRouter | ✅ 完全支持 | ✅ `{ baseUrl }` 参数 | ❌ 不直接支持 | `apiKey` | `runtime-credentials.js:8-9` |

**验证方法：**
- TypeScript 签名：`model-runtime.d.ts:82`
- 运行时实现：`runtime-credentials.js:8-9`（`RuntimeCredentials` 类）
- 文档示例：`examples/sdk/12-full-control.ts:22`

**结论：`setRuntimeApiKey()` 支持所有当前使用的 provider，baseURL 通过 `{ baseUrl }` 选项传递。**

---

## C. process.env 的真实使用点

### C1. Pi SDK 内部

| 文件 | 行号 | 使用内容 | 用途 |
|------|------|---------|------|
| `model-runtime.js` | 88 | `process.env.PI_OFFLINE` | 控制是否允许从网络刷新模型目录 |
| `auth-storage.js` | - | **无** | 不读取任何 API key 相关的 env |
| `runtime-credentials.js` | - | **无** | 只操作内存 Map，不读 env |
| `sdk.js` | - | **无** | `createAgentSession()` 不读取 env 中的 API key |

**结论：Pi SDK 内部不读取 `process.env.OPENAI_API_KEY`、`process.env.ANTHROPIC_API_KEY` 等 API key 环境变量。**

### C2. ProjectHub PiSubAgent

| 文件 | 行号 | 设置内容 | 是否必要 |
|------|------|---------|---------|
| `sdk.ts` | 231 | `process.env.DEEPSEEK_API_KEY = cred.apiKey` | ❌ 不被 Pi SDK 读取 |
| `sdk.ts` | 234 | `process.env.OPENAI_API_KEY = cred.apiKey` | ❌ 不被 Pi SDK 读取 |
| `sdk.ts` | 237 | `process.env.ANTHROPIC_API_KEY = cred.apiKey` | ❌ 不被 Pi SDK 读取 |
| `sdk.ts` | 242-244 | `process.env.OPENAI_API_BASE_URL = cred.baseURL` | ❌ 不被 Pi SDK 读取 |

**结论：`setupCredentials()` 中所有 `process.env` 修改都是冗余的，Pi SDK 不依赖它们。**

### C3. resolveCredentialWithFallback 中的 process.env

在 `sdk.ts:202-205` 中，`resolveCredentialWithFallback` 第三个参数作为 fallback：

```typescript
resolveCredentialWithFallback(userId, providerName, {
  apiKey: process.env.OPENAI_API_KEY || "",
  baseURL: process.env.OPENAI_API_BASE_URL || "",
});
```

这是 **ProjectHub 的 fallback 链**，用于在没有 DB 凭证时使用环境变量作为最后防线。这是合理的，不应删除。

---

## D. 多租户隔离风险评估

### D1. process.env 污染分析

| 场景 | 风险等级 | 说明 |
|------|---------|------|
| 单进程串行 | 🟢 无风险 | 同一时间只有一个 `process.env` 值 |
| 单进程并发 | 🟡 低风险 | Next.js 单 worker 处理请求，但中间件可能并发 |
| 多进程 | 🔴 高风险 | 每个 worker 有独立 `process.env`，不互相影响 |
| Next.js Dev HMR | 🟡 低风险 | HMR 会重启 worker，但通常不是并发场景 |
| 测试并行 | 🔴 高风险 | Vitest 并行测试会互相覆盖 API key |

### D2. RuntimeCredentials 隔离分析

```
RuntimeCredentials.overrides: Map<string, string>
    │
    ├─ User A: overrides.set("openai", "sk-A-from-db")
    ├─ User B: overrides.set("openai", "sk-B-from-db")
    └─ 每个 ModelRuntime 实例有独立的 overrides Map
```

**结论：每个 `ModelRuntime.create()` 创建独立实例，`setRuntimeApiKey()` 的凭证完全隔离。**

### D3. 实际风险场景

```typescript
// setupCredentials() 中的 process.env 修改
process.env.OPENAI_API_KEY = "sk-A";  // 覆盖全局值

// createPiSession() 中通过 setRuntimeApiKey 注入
await modelRuntime.setRuntimeApiKey("openai", "sk-A", { baseUrl: "..." });
// Pi SDK 会优先使用 RuntimeCredentials.overrides 中的值
```

**关键点：即使 `process.env` 被修改，Pi SDK 的凭证读取顺序是：**

1. `RuntimeCredentials.overrides`（`setRuntimeApiKey` 设置的）← 最高优先
2. `AuthStorage.read()`（`auth.json` 文件）← 中等优先
3. 环境变量 fallback（由 Provider 实现决定）← 最低优先

**当前 `setupCredentials()` 设置的 `process.env` 是最低优先级的值，但 Pi SDK 永远不会被执行到这里，因为 `setRuntimeApiKey()` 已经注入了最高优先级的凭证。**

---

## E. 删除 process.env 修改的可行性分析

### E1. Pi SDK 凭证读取链验证

```
modelRuntime.setRuntimeApiKey("openai", "sk-key")
    │
    ▼
RuntimeCredentials.setRuntimeApiKey(providerId, apiKey)
    └─ overrides.set(providerId, apiKey)  ← 存入内存 Map
    │
    ▼ (当 Pi SDK 需要发送请求时)
RuntimeCredentials.read(providerId)
    │
    ├─ 先查 overrides.get(providerId)  ← ✅ 返回 setRuntimeApiKey 设置的值
    └─ 若无 → this.store.read(providerId)  ← 读 auth.json 文件
```

**验证代码位置：`runtime-credentials.js:17-20`**

```javascript
async read(providerId, options) {
    options?.signal?.throwIfAborted();
    const override = this.overrides.get(providerId);
    return override ? { type: "api_key", key: override } : this.store.read(providerId, options);
}
```

### E2. 删除 process.env 修改的影响范围

| 组件 | 是否受影响 | 原因 |
|------|-----------|------|
| Pi SDK (`@earendil-works/pi-coding-agent`) | ❌ 不受影响 | SDK 不读取 process.env.API_KEY |
| `createAgentSession()` | ❌ 不受影响 | 凭证从 modelRuntime 获取 |
| `ModelRuntime.create()` | ❌ 不受影响 | 使用 `DefaultAuthStorage` 读 `auth.json` |
| 第三方库（如 `openai` SDK） | ⚠️ 可能受影响 | 某些旧版 SDK 直接读 env |

**验证：搜索整个 `node_modules/@earendil-works/pi-coding-agent` 和 `@earendil-works/pi-ai`，没有任何 `process.env` 读取 API key 的代码。**

---

## F. 推荐方案

### 方案 A：KEEP（保留 process.env）

**适用条件：** 保守策略，不希望有任何潜在风险

**风险：**
- 多进程并发时可能串号（但 Next.js 通常是单 worker）
- 维护成本：需要保持 `setupCredentials()` 与 `createPiSession()` 的同步

**优点：**
- 向后兼容
- 不需要任何修改

**缺点：**
- 冗余代码
- 误导后续开发者（以为 Pi SDK 依赖 process.env）

---

### 方案 B：MIGRATE（删除 process.env，只用 setRuntimeApiKey）

**适用条件：** 已确认 Pi SDK 不依赖 process.env

**前置验证：**
- [x] Pi SDK 内部不读取 process.env.API_KEY ✅
- [x] setRuntimeApiKey 覆盖所有当前 provider ✅
- [x] RuntimeCredentials 隔离机制正常 ✅
- [ ] 需要在实际并发场景下测试验证

**修改文件：**

| 文件 | 修改内容 |
|------|---------|
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 删除 `setupCredentials()` 中的 `process.env` 修改（第 225-246 行） |

**最小改动代码：**

```typescript
// 修改前 (sdk.ts:189-247)
private async setupCredentials(userId: string, provider?: string): Promise<void> {
  // ... 获取凭证逻辑 ...

  // ⚠️ 删除以下所有 process.env 修改
  if (providerName === "deepseek") {
    process.env.DEEPSEEK_API_KEY = cred.apiKey;  // 删除
  } else if (providerName === "openai") {
    process.env.OPENAI_API_KEY = cred.apiKey;    // 删除
  } else if (providerName === "anthropic") {
    process.env.ANTHROPIC_API_KEY = cred.apiKey; // 删除
  } else {
    process.env.OPENAI_API_KEY = cred.apiKey;    // 删除
    if (cred.baseURL) {
      process.env.OPENAI_API_BASE_URL = cred.baseURL; // 删除
    }
  }
}

// 修改后 (sdk.ts:189-218)
private async setupCredentials(userId: string, provider?: string): Promise<void> {
  // 保留凭证获取逻辑（用于 createPiSession 中的 setRuntimeApiKey）
  const cred = await withRetry(
    async () => {
      const providerName = provider || "deepseek";
      return await resolveCredentialWithFallback(userId, providerName, {
        apiKey: process.env.OPENAI_API_KEY || "",
        baseURL: process.env.OPENAI_API_BASE_URL || "",
      });
    },
    { maxAttempts: 2, baseDelay: 500 }
  );

  if (!cred) {
    throw new Error(`No API key found for provider "${provider || "deepseek"}".`);
  }

  // ✅ 不再设置 process.env，只在 createPiSession 中使用 setRuntimeApiKey
  console.log(`[PiSdkRuntime] Credential resolved from ${cred.ownerType} (transport: ${cred.transport})`);
}
```

**回归测试清单：**
- [ ] PiSubAgent 能正常启动
- [ ] PiSubAgent 能正确使用 USER provider
- [ ] PiSubAgent 能正确使用 SYSTEM provider
- [ ] OpenAI / Anthropic / DeepSeek / Google 等 provider 正常工作
- [ ] 自定义 baseURL 生效

**优点：**
- 消除冗余代码
- 避免 process.env 污染风险
- 更清晰的职责边界

**缺点：**
- 如果未来 Pi SDK 改变行为（开始读取 process.env），可能会有问题
- 需要实际并发场景测试验证

---

### 方案 C：HYBRID（保留部分 process.env）

**适用条件：** 某些场景需要 fallback

**保留：**
- `resolveCredentialWithFallback` 的 fallback 参数（用于在没有 DB 凭证时使用 env）

**删除：**
- `setupCredentials()` 中设置 `process.env` 的逻辑

**实现：**
```typescript
private async setupCredentials(userId: string, provider?: string): Promise<void> {
  // 只获取凭证，不设置 process.env
  const cred = await withRetry(
    async () => resolveCredentialWithFallback(userId, provider, {
      apiKey: process.env.OPENAI_API_KEY || "",
      baseURL: process.env.OPENAI_API_BASE_URL || "",
    }),
    { maxAttempts: 2, baseDelay: 500 }
  );

  if (!cred) {
    throw new Error(`No API key found. Please configure in Settings.`);
  }
  // ✅ 不设置 process.env
}
```

---

## G. 推荐决策

### **推荐：方案 C（HYBRID）**

**理由：**

1. **Pi SDK 不依赖 process.env**（已验证）
2. **消除冗余**：删除 `setupCredentials()` 中的 `process.env` 设置逻辑
3. **保留 fallback**：`resolveCredentialWithFallback` 的第三个参数作为 fallback 链是合理的
4. **更清晰**：职责边界更明确
5. **低风险**：改动小，易于回滚

### 关键验证点

- [x] Pi SDK `setRuntimeApiKey()` 支持所有当前 provider
- [x] Pi SDK 内部不读取 `process.env` 中的 API key
- [x] `setRuntimeApiKey()` 完全覆盖 `process.env` 的作用
- [x] `RuntimeCredentials` 提供实例级别隔离
- [ ] 删除后需要在实际并发场景下测试验证

### 未来考虑

如果未来需要支持第三方库（如旧版 `openai` SDK）直接读取 `process.env`，可以考虑：

1. 在 `createPiSession()` 中设置 `process.env`（仅在使用前设置，不保留）
2. 使用更短的生命周期：包装函数执行前后设置/清除

---

## H. 附录：关键代码位置

| 文件 | 关键内容 |
|------|---------|
| `sdk.ts:189-247` | `setupCredentials()` - 需要删除 process.env 设置 |
| `sdk.ts:256-388` | `createPiSession()` - 真正生效的凭证注入 |
| `runtime-credentials.js:8-20` | RuntimeCredentials 实现 - 凭证优先级验证 |
| `model-runtime.js:88` | Pi SDK 唯一读取 process.env 的地方（`PI_OFFLINE`） |
| `examples/sdk/12-full-control.ts:22` | 官方 setRuntimeApiKey 示例 |

---

## I. 参考文档

- Pi SDK 文档：`node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- 模型运行时类型：`node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts`
- 运行时凭证实现：`node_modules/@earendil-works/pi-coding-agent/dist/core/runtime-credentials.js`
