# ProjectHub AI 配置体系 — Stage 4 调研报告

**日期**: 2026-08-21  
**阶段**: Shared Model Discovery 分析  
**调研范围**: registry.ts / model-discovery.ts / model-catalog.ts / model-scope.ts / models-cache.ts

---

## A. 当前 Discovery 真实数据流

### 1. User Scope Discovery（/api/ai/models）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ GET /api/ai/models                                                       │
│   - Source: UserApiKey DB (User + SYSTEM)                               │
│   - Credential: resolveCredential(userId, provider)                       │
│   - Scope: userId                                                       │
│   - Cache: user-models-cache (per userId, 5min TTL)                     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ loadUserModelsWithCache(userId, () => getEnabledModels(userId))           │
│   - Cache key: `${userId}:${userGeneration}`                           │
│   - Invalidation: per-user generation counter                            │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ getEnabledModels(userId)  [registry.ts:304]                            │
│   1. getSystemCredentials() → SYSTEM providers                          │
│   2. For each SYSTEM provider: discoverModelsFromAPI()                │
│   3. Add AGNES_MODELS (hardcoded)                                     │
│   4. getUserProviderRecords(userId) → USER providers                   │
│   5. For each USER provider: discoverModelsFromAPI()                  │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ discoverModelsFromAPI(options)  [registry.ts:212]                     │
│   - Fetch: `${endpoint}/models`                                       │
│   - Auth: Bearer token (Authorization header)                          │
│   - Normalize: ModelCatalogEntry[]                                     │
│   - Capabilities: infer from model ID string                            │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Return: ModelCatalogEntry[]                                             │
│   - id: `provider:modelId`                                             │
│   - provider, modelName, displayName, capabilities, enabled, apiFormat  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. Workspace Scope Discovery（/api/models）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ GET /api/models?cwd=/path                                               │
│   - Source: models.json (Pi Workspace)                                  │
│   - Credential: Pi ModelRuntime (setRuntimeApiKey)                       │
│   - Scope: cwd                                                        │
│   - Cache: models-cache (per cwd, 60s TTL)                             │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ loadModelsWithCache(cwd, () => loadModels(cwd))                       │
│   - Cache key: cwd                                                    │
│   - Invalidation: generation counter                                  │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ loadModels(cwd)  [app/api/models/route.ts:34]                          │
│   - getModelRuntime(cwd) → Pi ModelRuntime                           │
│   - resolveVisibleModels(runtime) → filtered by enabledModels          │
│   - Get default provider/model from settings                           │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ resolveVisibleModels(runtime)  [lib/model-scope.ts:106]                │
│   - Uses pi's resolveModelScopeWithDiagnostics()                       │
│   - Supports glob patterns (e.g. "anthropic/*:high")                   │
│   - Returns: visible[], scopedModels[], thinkingLevelPins, warnings    │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Return: ModelsData                                                    │
│   - models: Record<string, string>                                    │
│   - modelList: {id, name, provider}[]                                │
│   - defaultModel, thinkingLevels, thinkingLevelPins                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. Pi Model Discovery（/api/models-config/discover）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ POST /api/models-config/discover                                       │
│   - Source: user-submitted provider config                            │
│   - Credential: Pi SDK auth parsing                                   │
│   - Temp models.json creation                                        │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ resolveModelDiscoveryAuth(providerName, provider)  [lib/model-discovery-auth.ts]│
│   1. Create temp models.json with provider config                      │
│   2. ModelRuntime.create({ modelsPath })                            │
│   3. modelRuntime.getAuth(model) → apiKey + headers                  │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ fetch(endpoint) with auth headers                                     │
│   - buildModelsListUrl(baseUrl, api)                                 │
│   - buildHeaders(api, apiKey, configured)                             │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ parseDiscoveredModels(response)  [lib/model-discovery.ts:45]            │
│   - Extract model list from response                                  │
│   - Normalize to DiscoveredModel[]                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## B. Workspace / User Discovery 对比

| 维度 | Workspace | User |
|------|----------|------|
| **Source** | `models.json` (Pi Workspace file) | UserApiKey DB |
| **Credential** | Pi ModelRuntime `setRuntimeApiKey()` | `resolveCredential(userId, provider)` |
| **Scope** | `cwd` (项目目录) | `userId` (用户) |
| **Cache** | `models-cache` (per cwd, 60s) | `user-models-cache` (per userId, 5min) |
| **Model Runtime** | Pi SDK `ModelRuntime` | Registry `createModel()` |
| **Response Type** | `ModelsData` (Pi types) | `ModelCatalogEntry[]` |
| **Capabilities** | From models.json | From `inferCapabilities()` |
| **Thinking Levels** | Supported | Not supported |
| **Glob Patterns** | Supported (via pi) | Not supported |
| **Fallback** | None | Agnes hardcoded models |

### 必须保持不同

| 维度 | 原因 |
|------|------|
| **Source** | Workspace 是文件系统配置，User 是数据库凭证 |
| **Credential** | Pi Runtime 隔离 vs DB 凭证 |
| **Cache Key** | Workspace ≠ User 必须隔离 |
| **Response Type** | Pi types vs AI SDK types |

### 可以共享

| 能力 | 共享方式 |
|------|---------|
| **Model Discovery (HTTP)** | 两者都调用 Provider API |
| **URL Building** | `buildModelsListUrl()` |
| **Response Parsing** | `parseDiscoveredModels()` |
| **Model Catalog** | `model-catalog.ts` (prices/metadata) |

---

## C. Provider Registry 当前职责

`registry.ts` 当前承担了 **6 个职责**：

| 职责 | 函数 | 复杂度 |
|------|------|---------|
| **Provider Registry** | `KNOWN_DEFAULTS`, `HARDCODED_PROVIDERS` | 低 |
| **Model Discovery** | `discoverModelsFromAPI()` | 高 |
| **Model Catalog** | `AGNES_MODELS`, `inferCapabilities()` | 中 |
| **Model Creation** | `createModel()` | 高 |
| **Credential Access** | `resolveCredential()`, `getSystemCredentials()` | 低 |
| **BaseURL Normalization** | `normalizeBaseURL()`, `getEffectiveBaseURL()` | 低 |
| **Response Normalization** | `withResponseNormalization()` | 中 |

### 职责分析

**混杂问题**:
- `discoverModelsFromAPI()` 是真正的 **Discovery**
- `createModel()` 是 **Runtime Creation**
- `resolveCredential()` 是 **Credential Access**（已统一到 api-key-store.ts）

**建议拆分**:
```
registry.ts 当前
        │
        ├── 保留: Provider Registry (常量定义)
        ├── 保留: BaseURL Normalization (工具函数)
        ├── 保留: Response Normalization
        ├── 拆分: Model Discovery → model-discovery.ts
        ├── 拆分: Model Creation → model-runtime.ts
        └── 保留: AGNES_MODELS (hardcoded catalog entry)
```

**但**: 当前不需要拆分 `registry.ts`。它的工作方式是内聚的，且没有明显的重复或冲突。

---

## D. Discovery / Catalog 重复逻辑

### 当前状态

| 能力 | registry.ts | model-discovery.ts | model-catalog.ts |
|------|-------------|-------------------|-------------------|
| **URL Building** | ❌ | ✅ `buildModelsListUrl()` | ❌ |
| **Response Parsing** | ❌ | ✅ `parseDiscoveredModels()` | ❌ |
| **Capability Inference** | ✅ `inferCapabilities()` | ❌ | ❌ |
| **Model Catalog (prices)** | ❌ | ❌ | ✅ `flattenModelsDevCatalog()` |
| **Model Search** | ❌ | ❌ | ✅ `searchModelCatalog()` |
| **Model Recommendation** | ❌ | ❌ | ✅ `recommendModelCatalogPreset()` |

### 重复逻辑分析

**不存在严重重复**。各文件职责清晰：

- `registry.ts`: 负责调用 Provider API + 创建模型实例
- `model-discovery.ts`: 负责 Pi ModelRuntime + 响应解析
- `model-catalog.ts`: 负责价格元数据 + 搜索推荐

---

## E. 可以抽成 Shared Domain 的能力

### 1. URL Building（已有）

```typescript
// model-discovery.ts 已导出
export function buildModelsListUrl(baseUrl: string, api: string): URL
```

**当前使用**:
- `/api/models-config/discover` 直接调用
- Voice 使用 `discoverModelsFromAPI()` 内部使用

**建议**: 保持现状，已经是 shared utility。

### 2. Response Parsing（已有）

```typescript
// model-discovery.ts 已导出
export function parseDiscoveredModels(value: unknown): DiscoveredModel[]
```

**当前使用**:
- `/api/models-config/discover` 直接调用

**建议**: 保持现状，已经是 shared utility。

### 3. Capability Inference（分散）

**当前**:
- `registry.ts:inferCapabilities()` - 从模型 ID 推断能力

**Voice** 也有类似逻辑:
```typescript
// features/ai/audio/credentials.ts
const VOICE_MODEL_PATTERNS = {
  tts: [/\btts\b/i, ...],
  stt: [/\basr\b/i, ...],
}
```

**建议**: 暂不统一。Voice 的 capability matching 是独立的领域逻辑。

### 4. BaseURL Normalization（已有）

```typescript
// registry.ts 已导出
export function normalizeBaseURL(baseURL: string): string
export function getEffectiveBaseURL(provider: string, customBaseURL?: string | null): string
```

**当前使用**:
- `api-key-store.ts` re-export
- `voice-credentials.ts` → 已不再使用（Stage 3 改动）

**建议**: 保持现状。

---

## F. 不应该统一的能力

### 1. Cache 抽象

| Cache | Key | TTL | Source |
|-------|-----|-----|--------|
| `models-cache` | cwd | 60s | Workspace |
| `user-models-cache` | userId | 5min | User |

**结论**: 两者职责不同，不能合并。

### 2. Model Runtime

| Runtime | 用于 | 创建方式 |
|---------|------|---------|
| Pi ModelRuntime | `/api/models` | `ModelRuntime.create({ modelsPath })` |
| AI SDK Models | `/api/ai/models` | `createModel()` |

**结论**: Runtime 隔离是正确设计。

### 3. Credential Resolution

| Scope | Function |
|-------|----------|
| User | `resolveCredential(userId, provider)` |
| Workspace | `setRuntimeApiKey(provider, apiKey, { baseUrl })` |

**结论**: 已经统一到 `api-key-store.ts`（User scope），Workspace 保持 Pi Runtime 边界。

---

## G. 推荐最终 Service / Domain 边界

### 当前架构

```
lib/
├── model-discovery.ts      # Pi ModelRuntime + 响应解析
├── model-catalog.ts        # 价格/元数据 + 搜索
├── model-scope.ts          # 模型 scope 解析
├── models-cache.ts         # Workspace cache
├── user-models-cache.ts     # User cache
└── model-discovery-auth.ts # Pi Auth 解析

features/ai/llm/providers/
├── registry.ts             # Provider Registry + Model Discovery + Creation
├── agnes/proxy.ts         # Agnes proxy fetch
└── types.ts              # Provider types
```

### 推荐边界（不移动文件）

```
Shared Model Domain
        │
        ├── Discovery
        │   ├── registry.ts:discoverModelsFromAPI()     [Provider API discovery]
        │   ├── lib/model-discovery.ts:parseDiscoveredModels() [Response parsing]
        │   └── lib/model-discovery-auth.ts             [Pi Auth parsing]
        │
        ├── Catalog
        │   └── lib/model-catalog.ts                   [Prices/Metadata]
        │
        ├── Resolver
        │   ├── registry.ts:getEnabledModels()         [User scope]
        │   └── lib/model-scope.ts                    [Workspace scope]
        │
        └── Runtime
            ├── registry.ts:createModel()            [AI SDK models]
            └── lib/model-discovery.ts:getModelRuntime() [Pi ModelRuntime]

Caches (独立，不统一)
        │
        ├── Workspace: lib/models-cache.ts
        └── User: lib/user-models-cache.ts

Credentials (Stage 3 已统一)
        │
        └── features/ai/llm/credentials/api-key-store.ts
```

### 职责边界清晰化

| Domain | 职责 | 边界 |
|--------|------|------|
| **CredentialService** | 凭证 CRUD / Resolution / Decryption | UserApiKey DB |
| **DiscoveryService** | Provider API 调用 / 响应解析 | registry.ts + model-discovery.ts |
| **CatalogService** | 价格元数据 / 搜索推荐 | model-catalog.ts |
| **ResolverService** | 模型选择 / scope 解析 | registry.ts + model-scope.ts |
| **RuntimeService** | 模型实例创建 | registry.ts + model-discovery.ts |
| **CacheService** | 缓存（按 scope 隔离） | models-cache.ts + user-models-cache.ts |

---

## H. 迁移步骤

### P0: 不需要迁移

**当前架构已经合理**，不需要物理文件迁移。

### P1: 添加职责注释（文档化）

| 文件 | 注释 | 工作量 |
|------|------|--------|
| `registry.ts` | 明确职责边界 | 30min |
| `model-discovery.ts` | 明确 Pi 适配器职责 | 30min |
| `model-catalog.ts` | 明确价格元数据职责 | 30min |
| `model-scope.ts` | 明确 scope 解析职责 | 30min |

### P2: 可选优化（按需）

| 优化 | 说明 | 收益 | 风险 |
|------|------|------|------|
| Voice capability matching 重构 | 抽取共享的 capability inference | DRY | 🟡 中 |
| `models-cache.ts` 重构 | 提取缓存抽象 | 代码复用 | 🟢 低 |

---

## I. 当前重复逻辑清单

### 1. URL Building

| 文件 | 函数 | 状态 |
|------|------|------|
| `lib/model-discovery.ts` | `buildModelsListUrl()` | ✅ 已统一 |
| `app/api/models-config/discover/route.ts` | 直接调用 | ✅ 正确 |
| `registry.ts` | 内嵌调用 | ✅ 正确 |

### 2. Response Parsing

| 文件 | 函数 | 状态 |
|------|------|------|
| `lib/model-discovery.ts` | `parseDiscoveredModels()` | ✅ 已统一 |
| `app/api/models-config/discover/route.ts` | 直接调用 | ✅ 正确 |
| `registry.ts` | 内嵌解析 | ✅ 正确 |

### 3. BaseURL Normalization

| 文件 | 函数 | 状态 |
|------|------|------|
| `registry.ts` | `normalizeBaseURL()` | ✅ 已统一 |
| `api-key-store.ts` | re-export | ✅ 正确 |
| `voice-credentials.ts` | Stage 3 已移除重复 | ✅ 正确 |

### 4. Credential Resolution

| 文件 | 函数 | 状态 |
|------|------|------|
| `api-key-store.ts` | `resolveCredential()` | ✅ 已统一 |
| `voice-credentials.ts` | Stage 3 已移除重复 | ✅ 正确 |

---

## J. 结论

### 当前架构评价

| 方面 | 评价 |
|------|------|
| **职责分离** | ✅ Discovery / Catalog / Resolver / Runtime 已分离 |
| **缓存隔离** | ✅ Workspace ≠ User |
| **Credential 统一** | ✅ Stage 3 已完成 |
| **Pi 能力保留** | ✅ model-discovery-auth.ts 保留 |
| **Cache 抽象** | ✅ 两个独立的 cache（合理） |
| **代码重复** | ✅ 最小化 |

### 推荐行动

**Stage 4 不需要代码改动**。

仅需：

1. **添加职责注释**（P1，2 小时）
   - 对关键文件添加 docstring
   - 明确领域边界

2. **监控**（持续）
   - 观察 Voice / Model / Pi 的实际使用
   - 如有问题再针对性优化

### 后续阶段建议

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| Stage 5 | 职责注释完善 | P1 |
| Stage 6 | Voice capability matching 重构（可选） | P2 |
| Stage 7 | 文档化领域边界 | P1 |

---

## K. Stage 4 行动清单

### 本阶段（分析）✅ 完成

- [x] 扫描所有 Discovery 相关文件
- [x] 分析调用链
- [x] 识别重复逻辑
- [x] 确认架构合理性
- [x] 输出调研报告

### 下一步（实施）

- [ ] 用户确认后添加职责注释（P1）
- [ ] 确认 Stage 5 方向

---

**调研人**: Cursor Agent  
**调研时间**: 2026-08-21 17:15  
**结论**: 当前架构合理，不需要大规模重构，仅需文档化
