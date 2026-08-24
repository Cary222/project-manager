# ProjectHub AI 配置体系 — Stage 3 深度分析

**日期**: 2026-08-21
**更新**: 2026-08-21 16:55（架构深度分析 + 数据流图）
**阶段**: AI 配置体系统一 — CredentialService 梳理
**调研范围**: Chat / WorkAgent / PiSubAgent / /api/ai/providers / models-config/discover
**约束**: 不修改 PiSubAgent Runtime 边界，不删除 models.json

---

## 一、当前 Credential 架构

### 1.1 ProjectHub Credential 层

#### `api-key-store.ts` — 统一凭证存储

| 函数 | 职责 | 入口 |
|------|------|------|
| `resolveCredential(userId, provider)` | 二级降级（USER → SYSTEM） | `registry.ts` |
| `resolveCredentialWithFallback(userId, provider, env)` | 三级降级（SYSTEM → USER → ENV） | `sdk.ts` / `summarizer.ts` |
| `saveApiKey(input)` | 加密存储 + 缓存失效 | `/api/ai/providers POST` |
| `deleteApiKey(id, userId)` | 软删除 + 缓存失效 | `/api/ai/providers DELETE` |
| `getSystemCredentials()` | 获取所有 SYSTEM provider | `registry.ts` |
| `getUserProviderRecords(userId)` | 获取用户 provider 列表 | `sdk.ts` / `voice-credentials.ts` |

**数据流**:
```
API Route (POST /api/ai/providers)
  ↓ encrypt(apiKey)
  ↓ prisma.userApiKey.create/update
  ↓ invalidateUserModelsCache(userId) / invalidateAllUserModelsCache()
DB (pm.userApiKey)
```

#### `registry.ts` — 模型发现与实例创建

| 函数 | 职责 | 入口 |
|------|------|------|
| `getEnabledModels(userId)` | 获取所有可用模型（SYSTEM + USER + Agnes） | `/api/ai/models GET` |
| `createModel(userId, modelRef)` | 创建模型实例 | `generate-response.ts` |
| `discoverModelsFromAPI(options)` | 调用 Provider /models 接口 | `getEnabledModels()` |
| `normalizeBaseURL(baseURL)` | 规范化 baseURL（导出给 api-key-store） | `api-key-store.ts` |

**数据流**:
```
/api/ai/models GET
  ↓ loadUserModelsWithCache(userId, getEnabledModels)
  ↓
getEnabledModels(userId)
  ├─ getSystemCredentials() → discoverModelsFromAPI()
  ├─ Agnes hardcoded models
  └─ getUserProviderRecords(userId) → resolveCredential() → discoverModelsFromAPI()
```

---

### 1.2 Pi Credential 层

#### `lib/model-discovery-auth.ts` — Pi SDK Auth 解析

| 函数 | 职责 | 入口 |
|------|------|------|
| `resolveModelDiscoveryAuth(providerName, provider)` | 使用 Pi SDK 解析 auth.json | `/api/models-config/discover POST` |

**数据流**:
```
POST /api/models-config/discover
  ↓ buildHeaders() + fetch(endpoint)
  ↓
resolveModelDiscoveryAuth(providerName, provider)
  ↓ mkdtempSync() 创建临时 models.json
  ↓ ModelRuntime.create({ modelsPath })
  ↓ modelRuntime.getAuth(model)
  ↓ 返回 { apiKey, headers }
  ↓ rmSync() 删除临时目录
```

#### `sdk.ts` — PiSubAgent Runtime 凭证配置

| 函数 | 职责 | 入口 |
|------|------|------|
| `setupCredentials(userId, provider)` | 设置环境变量 | `start()` |
| `createPiSession(input)` | 创建 Pi Session + 注册 API Key | `start()` |

**数据流**:
```
PiSubAgent.start(input)
  ↓
setupCredentials(userId, provider)
  ↓ resolveCredentialWithFallback(userId, provider, env)
  ↓ 设置 process.env（历史遗留）
  ↓
createPiSession(input)
  ↓ ModelRuntime.create()
  ↓ resolveCredentialWithFallback(userId, provider)
  ↓ modelRuntime.setRuntimeApiKey(provider, apiKey, { baseUrl })
  ↓ modelRuntime.getModel() / getAvailable()
  ↓ createAgentSession({ cwd, modelRuntime, model })
```

---

## 二、数据流图（4 条路径）

### 路径 A：ProjectHub Provider Settings

```
┌──────────────────────────────────────────────────────────────┐
│  UI (AI Settings → Provider Config)                         │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼ POST/DELETE /api/ai/providers
┌──────────────────────────────────────────────────────────────┐
│  app/api/ai/providers/route.ts                              │
│  ├── GET   → getMaskedKeyInfo(userId)                      │
│  ├── POST  → saveApiKey() / saveSystemProvider()           │
│  ├── PUT   → 测试连接（fetch /v1/models）                   │
│  └── DELETE → deleteApiKey() / deleteSystemProvider()       │
└──────────────────────────┬─────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌─────────────────────────┐  ┌─────────────────────────────┐
│ api-key-store.ts        │  │ lib/user-models-cache.ts   │
│ ─────────────────────── │  │ ─────────────────────────  │
│ saveApiKey()            │  │ invalidateUserModelsCache()│
│  ├─ encrypt(apiKey)     │  │ invalidateAllUserModelsCache()
│  ├─ prisma.userApiKey  │  └─────────────────────────────┘
│  └─ invalidateUser()    │              ↑
│                          │              │ 触发时机
│ deleteApiKey()           │              │
│  ├─ prisma.update       │  ┌─────────────────────────────┐
│  │   (deletedAt=now)    │  │ • saveApiKey()              │
│  └─ invalidateUser()    │  │ • deleteApiKey()            │
│                          │  │ • saveSystemProvider()      │
│ resolveCredential()      │  │ • deleteSystemProvider()    │
│  ├─ USER → decrypt()    │  └─────────────────────────────┘
│  └─ SYSTEM → decrypt()  │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│  PostgreSQL: community.pm.userApiKey                        │
│  ├─ userId (nullable for SYSTEM)                           │
│  ├─ ownerType (SYSTEM / USER)                              │
│  ├─ provider (openai / deepseek / anthropic / ...)         │
│  ├─ encryptedKey / iv / authTag (AES-GCM 加密)              │
│  ├─ baseURL (可选)                                         │
│  ├─ transport (proxy / direct)                             │
│  └─ apiFormat (openai-chat / anthropic / ...)              │
└──────────────────────────────────────────────────────────────┘
```

---

### 路径 B：ProjectHub Model Discovery

```
┌──────────────────────────────────────────────────────────────┐
│  UI (AI Settings → Model Selector)                          │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼ GET /api/ai/models
┌──────────────────────────────────────────────────────────────┐
│  app/api/ai/models/route.ts                                 │
│  ─────────────────────────────────────────────────────────  │
│  loadUserModelsWithCache(userId, getEnabledModels)           │
└──────────────────────────┬─────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌─────────────────────────┐  ┌─────────────────────────────────┐
│ lib/user-models-cache.ts│  │  cache miss → loader 触发       │
│ ─────────────────────── │  │                                 │
│ Cache Key:              │  └─────────────┬───────────────────┘
│   ${userId}:${gen}      │                │
│                         │                ▼
│ TTL: 5 分钟             │  ┌─────────────────────────────────┐
│                         │  │ registry.ts:getEnabledModels() │
│ 命中检查:                │  │ ───────────────────────────────── │
│   entries.get(cacheKey) │  │                                 │
│   expiresAt > now       │  │ ① SYSTEM providers               │
│                         │  │   getSystemCredentials()         │
│ In-flight 去重:         │  │   → discoverModelsFromAPI()     │
│   inFlight.get(key)    │  │                                 │
│                         │  │ ② Agnes hardcoded models         │
└─────────────────────────┘  │   (agn-2.5-flash 等)            │
                              │                                 │
                              │ ③ USER providers                │
                              │   getUserProviderRecords()      │
                              │   → resolveCredential()         │
                              │   → discoverModelsFromAPI()     │
                              └──────────────┬──────────────────┘
                                             │
                    ┌─────────────────────────┼─────────────────┐
                    ▼                         ▼                 ▼
         ┌──────────────────┐  ┌──────────────────────┐  ┌────────────┐
         │ OpenAI /v1/models│  │ DeepSeek /v1/models │  │ 其他       │
         │ Bearer ${apiKey} │  │ Bearer ${apiKey}     │  │ Provider   │
         └──────────────────┘  └──────────────────────┘  └────────────┘
```

---

### 路径 C：Pi Model Discovery（Workspace Scope）

```
┌──────────────────────────────────────────────────────────────┐
│  UI (Pi Workspace → Models Config)                         │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼ POST /api/models-config/discover
┌──────────────────────────────────────────────────────────────┐
│  app/api/models-config/discover/route.ts                    │
│  ─────────────────────────────────────────────────────────  │
│  buildHeaders() + fetch(endpoint)                           │
│  → 20s timeout                                             │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  lib/model-discovery-auth.ts                                │
│  ─────────────────────────────────────────────────────────  │
│  resolveModelDiscoveryAuth(providerName, provider)           │
│                                                           │
│  1. mkdtempSync() → 创建临时目录                           │
│  2. writeFileSync("models.json") → 临时配置                 │
│  3. ModelRuntime.create({ modelsPath })                     │
│  4. modelRuntime.getAuth(model)                             │
│  5. 返回 { apiKey, headers }                               │
│  6. rmSync() → 删除临时目录                                │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Pi SDK (@earendil-works/pi-coding-agent)                  │
│  ├─ ModelRuntime.create()                                  │
│  ├─ getAuth(model) → 解析 auth.json / env                  │
│  └─ 临时 models.json（用完即删）                           │
└──────────────────────────────────────────────────────────────┘
```

---

### 路径 D：PiSubAgent Runtime

```
┌──────────────────────────────────────────────────────────────┐
│  PiSubAgent (LangGraph Node)                               │
│  features/ai/agents/work/graph.ts                          │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  sdk.ts:PiSdkRuntime.start(input)                          │
│  ─────────────────────────────────────────────────────────  │
│  1. injectRuntimeContext() → .projecthub/AGENT_CONTEXT.md  │
│  2. setupCredentials(userId, provider)                     │
│  3. createPiSession(input)                                 │
│  4. subscribe(events) → 事件流                             │
│  5. sendUserMessage(prompt)                               │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  sdk.ts:setupCredentials(userId, provider)                 │
│  ─────────────────────────────────────────────────────────  │
│  resolveCredentialWithFallback(userId, provider, env)       │
│  ↓                                                         │
│  设置 process.env（历史遗留）                                │
│  DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY     │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  sdk.ts:createPiSession(input)                             │
│  ─────────────────────────────────────────────────────────  │
│  1. ModelRuntime.create({ allowModelNetwork: false })      │
│  2. resolveCredentialWithFallback(userId, provider)        │
│  3. modelRuntime.setRuntimeApiKey(provider, apiKey, baseUrl)│
│  4. modelRuntime.getAvailable() → 获取可用模型             │
│  5. createAgentSession({ cwd, modelRuntime, model })       │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Pi SDK (@earendil-works/pi-coding-agent)                  │
│  ├─ ModelRuntime.create()                                  │
│  ├─ setRuntimeApiKey() → 注册凭证                          │
│  ├─ getAvailable() → 动态发现模型                          │
│  └─ createAgentSession() → 创建会话                         │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、重复逻辑矩阵

| 能力 | ProjectHub 实现 | Pi 实现 | 是否重复 | 推荐统一方式 |
|------|----------------|---------|----------|--------------|
| **API Key 获取** | `api-key-store.ts:resolveCredential()` | `sdk.ts:setupCredentials()` | ⚠️ 部分重复 | `sdk.ts` 复用 `api-key-store`，保持现状（`sdk.ts` 已有注释说明） |
| **三级降级链路** | `api-key-store.ts:resolveCredentialWithFallback()` | - | ❌ 无重复 | 已统一 |
| **Credential Fallback** | `registry.ts` + `api-key-store.ts` | - | ❌ 无重复 | 已统一 |
| **BaseURL 规范化** | `registry.ts:normalizeBaseURL()` (导出) | `api-key-store.ts` 导入使用 | ❌ 无重复 | 已统一 |
| **Headers 生成** | `models-config/discover/buildHeaders()` | Pi SDK Provider Auth | ⚠️ 轻微重复 | 保持分离（Pi 层专用） |
| **Provider Auth** | - | Pi SDK (40+ providers) | ❌ 无重复 | **KEEP** — Pi SDK 专有 |
| **Encryption** | `api-key-store.ts` (AES-GCM) | - | ❌ 无重复 | **KEEP** — ProjectHub 专有 |
| **模型发现** | `registry.ts:discoverModelsFromAPI()` | `models-config/discover` | ⚠️ 职责分离 | 保持分离（B→ProjectHub 业务，C→Pi Workspace） |

---

## 四、Pi SDK 依赖边界

### 4.1 KEEP（继续复用）

| Pi 能力 | 位置 | 用途 | 理由 |
|---------|------|------|------|
| `ModelRuntime.create({ modelsPath })` | `lib/model-discovery.ts` | Workspace scope 模型 | Pi Runtime 专属 |
| `modelRuntime.getAuth(model)` | `lib/model-discovery-auth.ts` | Auth 解析（从 auth.json） | Pi SDK 专有 |
| `modelRuntime.setRuntimeApiKey()` | `sdk.ts:308` | 注册凭证到 Runtime | Phase 5 P0 修复 |
| `modelRuntime.getAvailable()` | `sdk.ts:342` | 获取可用模型 | Pi SDK 专有 |
| `createAgentSession()` | `sdk.ts:369` | 创建 Pi Session | Pi SDK 专有 |
| `models.json` 解析 | `lib/models-config-store.ts` | Pi 配置存储 | **约束** — 不删除 |
| `completeSimple()` | `/api/models-config/test` | 模型连接测试 | Pi SDK 能力 |

### 4.2 ADAPT（通过 Adapter 连接）

| 场景 | 当前 | 推荐 | 说明 |
|------|------|------|------|
| PiSubAgent 凭证获取 | `sdk.ts` 直接查询 `api-key-store` | 保持现状 | `sdk.ts` 已是 Adapter 角色 |
| Voice Credential | `voice-credentials.ts` 调用 `api-key-store` | 保持现状 | 已正确使用 |

### 4.3 REMOVE（不应该依赖的）

| 当前依赖 | 问题 | 推荐处理 |
|---------|------|---------|
| `sdk.ts` 设置 `process.env` | 多租户隔离风险 | Phase 6 研究 `setRuntimeApiKey()` 是否可替代 |

---

## 五、循环依赖分析

### 5.1 静态 Import 分析

```
features/ai/llm/credentials/api-key-store.ts
  ├─ imports: "@/lib/user-models-cache" (导出 invalidate 函数)
  ├─ imports: "@/features/ai/llm/providers/registry" (normalizeBaseURL, getEffectiveBaseURL)
  └─ NO imports from: registry (只导入 registry 导出的函数)

features/ai/llm/providers/registry.ts
  ├─ imports: "@/features/ai/llm/credentials/api-key-store" (resolveCredential, getSystemCredentials)
  └─ NO imports from: api-key-store.ts (只调用不导入 api-key-store 的内部)

lib/model-discovery-auth.ts
  └─ dynamic import: "@earendil-works/pi-coding-agent" (延迟加载)

features/ai/agents/work/subagents/pi/transports/sdk.ts
  └─ dynamic import: "../../../policy/index" (延迟加载，避免循环)
```

**结论**: ❌ **存在静态循环依赖**（Stage 2 引入）

### 5.2 循环依赖详情（Stage 2 引入）

```
api-key-store.ts (第8行)
  └─ imports: normalizeBaseURL, getEffectiveBaseURL from registry.ts
       ↓
registry.ts (第15-16行)
  └─ imports: resolveCredential from api-key-store.ts
       ↓
形成循环！
```

**影响**: TypeScript 编译可能正常，但 Rollup/Webpack 在生产构建时可能出现问题。

### 5.3 解决方案

**方案 A（推荐）**: 将 `normalizeBaseURL` 和 `getEffectiveBaseURL` 移到一个独立文件

```
lib/normalize-base-url.ts (新文件)
  └─ export function normalizeBaseURL(baseURL: string): string
  └─ export function getEffectiveBaseURL(provider: string, customBaseURL?: string | null): string

api-key-store.ts
  └─ imports from lib/normalize-base-url.ts (替代 registry.ts)

registry.ts
  └─ imports from lib/normalize-base-url.ts (替代 api-key-store.ts)
```

**方案 B**: 在 `api-key-store.ts` 内部内联 `normalizeBaseURL` 实现

```typescript
// api-key-store.ts 内部
function normalizeBaseURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/$/, "");
  if (!trimmed.includes("/v1")) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}
```

### 5.4 修复任务（补充到 P0）

| 优先级 | 任务 | 说明 |
|--------|------|------|
| **P0** | 消除 api-key-store ↔ registry 循环依赖 | 创建独立文件或内联实现 |

---

## 六、推荐 CredentialService API

### 6.1 接口设计草案

```typescript
// features/ai/llm/credentials/types.ts

/**
 * 统一凭证记录
 */
export interface CredentialRecord {
  provider: string;
  baseURL: string;
  apiKey: string;
  transport: "proxy" | "direct";
  apiFormat: ApiFormat;
  ownerType: "SYSTEM" | "USER";
}

/**
 * 降级策略配置
 */
export interface FallbackStrategy {
  systemProvider: boolean;  // 启用 SYSTEM provider fallback
  userProvider: boolean;    // 启用 USER provider fallback
  envVar: boolean;         // 启用环境变量 fallback
  agnesHardcoded: boolean; // 启用 Agnes hardcoded models
}

/**
 * 凭证服务接口
 * 
 * 职责边界：
 * - CredentialService 负责凭证的 CRUD、解析、降级
 * - 不负责 Provider Auth（Pi SDK 的 40+ provider auth 能力）
 */
export interface CredentialService {
  /**
   * 获取单个 Provider 的凭证
   * @param userId 用户 ID
   * @param provider Provider ID
   * @returns 解密后的凭证，或 null
   */
  resolveCredential(
    userId: string,
    provider: string
  ): Promise<CredentialRecord | null>;

  /**
   * 获取单个 Provider 的凭证（带降级策略）
   * @param userId 用户 ID
   * @param provider Provider ID
   * @param strategy 降级策略
   * @param envVarMap 环境变量映射
   */
  resolveCredentialWithFallback(
    userId: string,
    provider: string,
    strategy?: Partial<FallbackStrategy>,
    envVarMap?: Record<string, string>
  ): Promise<CredentialRecord | null>;

  /**
   * 保存用户凭证（加密存储）
   */
  saveApiKey(input: SaveApiKeyInput): Promise<MaskedKeyInfo>;

  /**
   * 删除凭证（软删除）
   */
  deleteApiKey(id: string, userId: string): Promise<void>;

  /**
   * 获取用户所有凭证（掩码信息）
   */
  getUserCredentials(userId: string): Promise<MaskedKeyInfo[]>;

  /**
   * 获取所有 SYSTEM provider 凭证
   */
  getSystemCredentials(): Promise<CredentialRecord[]>;

  /**
   * 获取用户配置的 provider 列表
   */
  getUserProviders(userId: string): Promise<Array<{ provider: string; baseURL: string | null }>>;

  /**
   * 检查是否已配置某 provider
   */
  hasProvider(userId: string, provider: string): Promise<boolean>;
}
```

### 6.2 PiAuthAdapter 接口

```typescript
// features/ai/llm/credentials/pi-adapter.ts

/**
 * PiAuthAdapter — 连接 ProjectHub Credential 和 Pi Runtime
 * 
 * 职责：
 * - 将 ProjectHub 凭证转换为 Pi Runtime 需要的格式
 * - 处理 Provider 名称映射（ProjectHub → Pi SDK）
 * - 验证认证状态
 */
export interface PiAuthAdapter {
  /**
   * 将 ProjectHub Credential 转换为 Pi Runtime API Key 配置
   */
  toRuntimeApiKey(credential: CredentialRecord): RuntimeApiKeyConfig;

  /**
   * 创建 Pi ModelRuntime 并注册凭证
   */
  createModelRuntime(
    credentials: CredentialRecord[],
    options?: CreateModelRuntimeOptions
  ): Promise<ModelRuntime>;

  /**
   * 验证凭证是否有效
   */
  validateCredential(credential: CredentialRecord): Promise<boolean>;
}

/**
 * Pi Runtime API Key 配置
 */
export interface RuntimeApiKeyConfig {
  providerName: string;  // Pi SDK 的 provider 名称
  apiKey: string;
  baseUrl?: string;
}
```

---

## 七、架构依赖图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ProjectHub Application                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   API / UI Layer                               │  │
│  │  ┌─────────────────────┐  ┌─────────────────────────────────┐ │  │
│  │  │ /api/ai/providers  │  │ /api/ai/models                  │ │  │
│  │  │ (CRUD + 测试)       │  │ (模型发现 + 缓存)               │ │  │
│  │  └─────────────────────┘  └─────────────────────────────────┘ │  │
│  │  ┌─────────────────────┐  ┌─────────────────────────────────┐ │  │
│  │  │ /api/models-config │  │ /api/models                     │ │  │
│  │  │ (Pi Workspace)     │  │ (Pi 模型发现)                   │ │  │
│  │  └─────────────────────┘  └─────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              CredentialService Layer                           │  │
│  │                                                               │  │
│  │  features/ai/llm/credentials/api-key-store.ts                 │  │
│  │  ├─ resolveCredential()      — 凭证解析                      │  │
│  │  ├─ resolveCredentialWithFallback() — 三级降级               │  │
│  │  ├─ saveApiKey()            — 加密存储                      │  │
│  │  ├─ deleteApiKey()           — 软删除                        │  │
│  │  └─ getSystemCredentials()  — SYSTEM provider                │  │
│  │                                                               │  │
│  │  features/ai/llm/providers/registry.ts                      │  │
│  │  ├─ getEnabledModels()       — 获取可用模型                   │  │
│  │  ├─ createModel()            — 创建模型实例                  │  │
│  │  └─ discoverModelsFromAPI()  — 动态发现                     │  │
│  │                                                               │  │
│  │  features/ai/audio/credentials.ts                            │  │
│  │  └─ resolveVoiceCredential() — Voice 专用                   │  │
│  │                                                               │  │
│  │  lib/user-models-cache.ts                                    │  │
│  │  └─ loadUserModelsWithCache() — 缓存层                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│       ┌──────────────────────┼──────────────────────┐               │
│       ▼                      ▼                      ▼               │
│  ┌─────────┐           ┌──────────┐          ┌──────────┐         │
│  │  Chat   │           │ WorkAgent │          │ PiSubAgent│         │
│  │ Feature │           │  Feature  │          │  Runtime  │         │
│  └────┬────┘           └────┬─────┘          └────┬─────┘         │
│       │                      │                    │                │
│       └──────────────────────┼────────────────────┘                │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    PiAuthAdapter Layer                         │  │
│  │                                                               │  │
│  │  features/ai/llm/credentials/pi-adapter.ts                   │  │
│  │  ├─ toRuntimeApiKey()       — 格式转换                       │  │
│  │  ├─ createModelRuntime()    — Runtime 创建                  │  │
│  │  └─ validateCredential()    — 验证                          │  │
│  │                                                               │  │
│  │  features/ai/agents/work/subagents/pi/transports/sdk.ts       │  │
│  │  └─ PiSdkRuntime            — Pi Session 管理                │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Pi SDK Layer                                  │
│  @earendil-works/pi-coding-agent                                    │
│  ├─ ModelRuntime.create()                                          │
│  ├─ setRuntimeApiKey() → Provider Auth (40+ providers)             │
│  ├─ getAvailable() → 模型发现                                      │
│  └─ createAgentSession() → 会话创建                                  │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Source of Truth                                  │
│                                                                      │
│  PostgreSQL: community.pm.userApiKey                                 │
│  ├─ userId (nullable for SYSTEM)                                   │
│  ├─ ownerType (SYSTEM / USER)                                       │
│  ├─ provider                                                        │
│  ├─ encryptedKey / iv / authTag (AES-GCM)                         │
│  ├─ baseURL / transport / apiFormat                                │
│  └─ deletedAt (软删除)                                              │
│                                                                      │
│  Local Files: ~/.pi/agent/models.json                               │
│  └─ Pi Workspace 配置（不删除，符合约束）                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 八、风险评估

### 8.1 安全风险

| 风险 | 描述 | 影响 | 缓解措施 |
|------|------|------|---------|
| **Credential 泄漏** | API Key 加密存储在 DB，但传输过程可能明文 | 🔴 高 | TLS + HTTPS；不在日志中打印 |
| **多租户串号** | `process.env` 全局污染 | 🟡 中 | Phase 6 研究 `setRuntimeApiKey()` 替代 |
| **加密不一致** | 不同模块使用不同加密方式 | 🟢 低 | 统一使用 `api-key-store.ts` 的 AES-GCM |

### 8.2 架构风险

| 风险 | 描述 | 影响 | 缓解措施 |
|------|------|------|---------|
| **循环依赖** | api-key-store ↔ registry **已存在**（Stage 2 引入） | 🟡 中 | 需修复（创建独立文件或内联实现） |
| **Provider Auth 不一致** | ProjectHub 用 API Key，Pi 用 SDK Auth | 🟡 中 | 保持分离（职责不同） |
| **BaseURL 不一致** | 不同模块规范化方式不同 | 🟢 低 | `normalizeBaseURL` 已统一导出 |

### 8.3 迁移风险

| 风险 | 描述 | 影响 | 缓解措施 |
|------|------|------|---------|
| **API Contract 破坏** | 修改凭证接口影响现有功能 | 🔴 高 | 不修改现有接口，只扩展 |
| **Pi Runtime 兼容性** | 新 CredentialService 可能与 Pi SDK 不兼容 | 🟡 中 | 保持 Pi 层独立 |
| **models.json 删除** | 误删 Pi Workspace 配置 | 🔴 高 | **严格禁止删除**，已在约束中明确 |

---

## 九、Stage 3 实施计划

### P0 任务（必须完成，阻塞后续 Stage）

#### P0.0: 修复循环依赖（Stage 2 引入）

**任务描述**: `api-key-store.ts` 和 `registry.ts` 之间存在循环依赖。

**修改文件**:
- `features/ai/llm/credentials/api-key-store.ts`（改用内联实现或从独立文件导入）
- 或新建 `lib/normalize-base-url.ts`

**方案 A（推荐）**: 创建独立文件

```typescript
// lib/normalize-base-url.ts
export function normalizeBaseURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/$/, "");
  if (!trimmed.includes("/v1")) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

export function getEffectiveBaseURL(
  provider: string,
  customBaseURL?: string | null
): string {
  const KNOWN_DEFAULTS: Record<string, string> = {
    deepseek: "https://api.deepseek.com",
    openai: "https://api.openai.com/v1",
    anthropic: "https://api.anthropic.com",
    // ...
  };
  const raw = customBaseURL?.trim() || KNOWN_DEFAULTS[provider] || `https://api.${provider}.com/v1`;
  return normalizeBaseURL(raw);
}
```

**预期收益**: 消除循环依赖，生产构建更稳定。

**风险**: 🟡 中 — 需要验证修改后功能正常。

**回归测试**:
```bash
curl http://localhost:3003/api/ai/models
curl -X POST http://localhost:3003/api/ai/providers -d '{"provider":"deepseek","name":"test","apiKey":"..."}'
```

---

#### P0.1: 消除 voice-credentials.ts 重复逻辑

**任务描述**: `voice-credentials.ts` 有独立的 `resolveProviderCredential()` 逻辑，与 `api-key-store.ts` 重复。

**修改文件**:
- `features/ai/audio/credentials.ts`

**预期收益**: 统一凭证解析链路，减少维护成本。

**风险**: 🟢 低 — 只是重构，不改变行为。

**回归测试**:
```bash
# TTS
curl -X POST http://localhost:3003/api/ai/audio/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text": "test", "voiceId": "alloy"}'

# STT
curl -X POST http://localhost:3003/api/ai/audio/transcribe \
  -F "file=@test.wav"
```

---

#### P0.2: 统一 baseURL 规范化

**任务描述**: `voice-credentials.ts` 复制了 `normalizeBaseURL()` 逻辑，应统一使用 `registry.ts` 导出。

**修改文件**:
- `features/ai/audio/credentials.ts`

**预期收益**: 消除代码重复。

**风险**: 🟢 低 — 只是删除重复代码。

---

#### P0.3: 添加职责边界注释

**任务描述**: 为 `api-key-store.ts`、`registry.ts`、`voice-credentials.ts` 添加 JSDoc 注释，明确职责边界。

**修改文件**:
- `features/ai/llm/credentials/api-key-store.ts`
- `features/ai/llm/providers/registry.ts`
- `features/ai/audio/credentials.ts`

**预期收益**: 防止后续开发者破坏架构边界。

**风险**: 🟢 低 — 只添加注释。

---

### P1 任务（重要，但不阻塞）

#### P1.1: 清理 registry.ts 预先存在的 lint 警告

**任务描述**: `registry.ts` 有 2 个 `@typescript-eslint/no-explicit-any` 和 1 个 `no-unused-vars`。

**修改文件**:
- `features/ai/llm/providers/registry.ts`

**预期收益**: 代码质量提升。

**风险**: 🟢 低 — 小改动。

---

#### P1.2: 清理 user-models-cache.ts 无效 eslint-disable

**任务描述**: `lib/user-models-cache.ts:34` 的 eslint-disable directive 无效。

**修改文件**:
- `lib/user-models-cache.ts`

**预期收益**: 消除 lint 警告。

**风险**: 🟢 低 — 删除无效 directive。

---

#### P1.3: 导出 `getProviderCredential()` 内部函数

**任务描述**: `api-key-store.ts` 内部有 `resolveCredential()` 分解逻辑，可以提取为独立函数供 `voice-credentials.ts` 调用。

**修改文件**:
- `features/ai/llm/credentials/api-key-store.ts`

**预期收益**: 更好的代码复用。

**风险**: 🟢 低 — 提取函数。

---

### P2 任务（Nice-to-have）

#### P2.1: 研究 `setRuntimeApiKey()` 替代 `process.env`

**任务描述**: `sdk.ts` 设置 `process.env` 是历史遗留，存在多租户隔离风险。

**修改文件**:
- `features/ai/agents/work/subagents/pi/transports/sdk.ts`

**预期收益**: 提高多租户安全性。

**风险**: 🟡 中 — 需要验证 Pi SDK API。

**前置条件**: 确认 Pi SDK `setRuntimeApiKey()` 可完全替代 `process.env`。

---

#### P2.2: 添加 CredentialService 正式接口

**任务描述**: 将 `api-key-store.ts` 的函数封装为 `CredentialService` 接口。

**修改文件**:
- `features/ai/llm/credentials/service.ts`

**预期收益**: 更清晰的 API 边界。

**风险**: 🟢 低 — 新增文件。

---

## 十、严格禁止清单

确认以下项**不在 Stage 3 范围内**：

- [x] ❌ 修改 Prisma Schema
- [x] ❌ 删除 UserApiKey
- [x] ❌ 删除 models.json
- [x] ❌ 删除 `/api/models-config`
- [x] ❌ 合并 `/api/models` 与 `/api/ai/models`
- [x] ❌ 删除 Pi ModelRuntime
- [x] ❌ 重写 Provider-specific Auth（Pi SDK 40+ providers）
- [x] ❌ 移动整个 `lib/` 目录
- [x] ❌ 大规模移动目录
- [x] ❌ 修改无关 AI 功能

---

## 十一、Stage 3 核心原则确认

```text
✅ ProjectHub owns credentials (DB / Encryption / Ownership)
✅ Pi owns provider-specific runtime auth capabilities (40+ Provider Auth)
✅ CredentialService owns the shared credential contract
✅ Adapter connects the two
```

**最终目标**:

> ProjectHub 的凭证和 SaaS 数据归 ProjectHub 管；Pi 的成熟 Provider Auth 能力继续复用；两者通过清晰的 CredentialService / Adapter 边界连接。

---

## 附录：凭证架构演化历史

| 日期 | 事件 | 影响 |
|------|------|------|
| 2026-07-31 | 三级凭证降级链路实现 | `api-key-store.ts` 成为统一入口 |
| 2026-08-12 | Stage 2 缓存机制上线 | `/api/ai/models` 性能优化 |
| 2026-08-21 | Stage 2 验证通过 | 缓存机制正确 |
| 2026-08-21 | Stage 3 架构分析完成 | 明确职责边界 |

---

**文档版本**: v2.0（架构深度分析版）
**更新人**: ai-learning-mentor
**下次审查**: Stage 3 P0 任务完成后
