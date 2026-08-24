# ProjectHub AI 配置体系 — Stage 5 调研报告

**日期**: 2026-08-21  
**阶段**: Pi AI Configuration / UX Fusion  
**调研范围**: Pi ModelsConfig UI / ProjectHub 当前能力 / 功能重叠矩阵

---

## 一、Pi ModelsConfig UI 能力分析

### 1. Provider 配置

| 能力 | Pi 当前实现 | 说明 |
|------|------------|------|
| **Provider Icons** | ✅ 40+ icons | 使用 @lobehub/icons |
| **OAuth Login** | ✅ OAuthFlow | 支持 OAuth 登录 |
| **API Key Login** | ✅ ApiKeyDetail | 用户输入 API Key |
| **Custom Provider** | ✅ ProviderDetail | 自定义 BaseURL/API/Headers |
| **OpenAI Compatible** | ✅ | api = "openai-completions" |
| **Anthropic Compatible** | ✅ | api = "anthropic-messages" |
| **Google Compatible** | ✅ | api = "google-generative-ai" |
| **Custom Headers** | ✅ HeaderListEditor | Key-value headers |

### 2. Model 配置

| 能力 | Pi 当前实现 | 说明 |
|------|------------|------|
| **Model Discovery** | ✅ discoverModelsFromAPI | 调用 /api/models-config/discover |
| **Model Search** | ✅ discoveryQuery filter | 前端过滤 |
| **Batch Model Add** | ✅ checkbox selection | 批量选择添加 |
| **Model Catalog Fill** | ✅ recommendModelCatalogPreset | 填充 price/capabilities |
| **Model Testing** | ✅ /api/models-config/test | 测试连接 |
| **Thinking Level Map** | ✅ ThinkingLevelMapEditor | 模型级 thinking 配置 |
| **DeepSeek Compat** | ✅ thinkingFormat | DeepSeek 兼容选项 |
| **Cost Editing** | ✅ modelCostToDraft | 编辑 input/output/cache 价格 |
| **Context Window** | ✅ | contextWindow 字段 |
| **Max Tokens** | ✅ | maxTokens 字段 |

### 3. Thinking / Reasoning

| 能力 | Pi 当前实现 | 说明 |
|------|------------|------|
| **Thinking Levels** | ✅ 7 levels | off/minimal/low/medium/high/xhigh/max |
| **Thinking Colors** | ✅ LEVEL_COLORS | 可视化颜色 |
| **Default/Disabled/Custom** | ✅ 三态 | Thinking Level 三种状态 |
| **Per-model Thinking** | ✅ thinkingLevelMap | 模型级绑定 |

---

## 二、ProjectHub 当前能力

### 1. Credential Management

| 能力 | ProjectHub 实现 | 位置 |
|------|---------------|------|
| **UserApiKey DB** | ✅ | Prisma UserApiKey |
| **CredentialService** | ✅ | api-key-store.ts |
| **Encryption** | ✅ | encryption.ts |
| **System Provider** | ✅ | saveSystemProvider |
| **User Provider** | ✅ | saveApiKey |
| **Credential Fallback** | ✅ | resolveCredentialWithFallback |

### 2. Model Discovery

| 能力 | ProjectHub 实现 | 位置 |
|------|---------------|------|
| **User Discovery** | ✅ | /api/ai/models → registry.ts |
| **Workspace Discovery** | ✅ | /api/models → model-discovery.ts |
| **Pi Auth Parsing** | ✅ | model-discovery-auth.ts |
| **Dynamic Discovery** | ✅ | /api/models-config/discover |
| **Capability Inference** | ✅ | inferCapabilities (registry.ts) |

### 3. Model Catalog

| 能力 | ProjectHub 实现 | 位置 |
|------|---------------|------|
| **models.dev 解析** | ✅ | model-catalog.ts |
| **Price Recommendation** | ✅ | recommendModelCatalogPreset |
| **Model Search** | ✅ | searchModelCatalog |
| **Catalog API** | ✅ | /api/models-config/catalog |

### 4. API Routes

| 路由 | 职责 |
|------|------|
| `/api/models` | Workspace Scope 模型（Pi Runtime） |
| `/api/models-config` | Workspace Scope 配置 CRUD |
| `/api/models-config/discover` | 动态模型发现 |
| `/api/models-config/catalog` | 模型价格查询 |
| `/api/models-config/test` | 模型连接测试 |
| `/api/ai/models` | User Scope 模型 |
| `/api/auth/providers` | OAuth Providers |
| `/api/auth/all-providers` | All Provider 状态 |

---

## 三、功能重叠矩阵

| 能力 | Pi 当前实现 | ProjectHub 当前实现 | 推荐方案 | 最终 Source | 最终 UI | 最终 Runtime | 操作 |
|------|----------|-----------------|---------|-----------|--------|-------------|------|
| **Provider Icons** | 40+ | 无 | KEEP | — | Pi | — | 直接复用 |
| **OAuth Login** | OAuthFlow | 无 | MERGE | DB (UserApiKey) | Pi | ProjectHub | 适配 ProjectHub DB |
| **API Key Login** | ApiKeyDetail | UserApiKey CRUD | MERGE | DB (UserApiKey) | Pi | ProjectHub | 适配 ProjectHub DB |
| **Custom Provider** | ProviderDetail | 无 | KEEP | models.json | Pi | Pi Runtime | 直接复用 |
| **BaseURL/API/Headers** | ✅ | 无 | KEEP | models.json | Pi | Pi Runtime | 直接复用 |
| **Model Discovery** | ✅ | ✅ (registry.ts) | ADAPT | models.json | Pi | Pi Runtime | Pi UI + registry.ts |
| **Model Catalog Fill** | ✅ | ✅ (model-catalog.ts) | KEEP | models.dev | Pi | — | 直接复用 |
| **Model Testing** | ✅ | /api/models-config/test | KEEP | — | Pi | Pi Runtime | 直接复用 |
| **Thinking Level** | ✅ ThinkingLevelMap | ✅ (model-scope.ts) | MERGE | models.json | Pi | Pi Runtime | Pi UI + model-scope.ts |
| **Cost Editing** | ✅ | 无 | KEEP | models.json | Pi | Pi Runtime | 直接复用 |
| **User Discovery** | 无 | ✅ (registry.ts) | KEEP | UserApiKey DB | ProjectHub | ProjectHub | 保持独立 |
| **User Credential** | 无 | ✅ (api-key-store) | KEEP | UserApiKey DB | ProjectHub | ProjectHub | 保持独立 |

---

## 四、KEEP / ADAPT / MERGE / REFACTOR / REMOVE

### KEEP（直接复用 Pi）

| 能力 | 理由 |
|------|------|
| Provider Icons | 40+ 完整，直接复用 |
| Custom Provider | Pi 成熟实现，适配 ProjectHub DB |
| Model Discovery UI | Pi UI + registry.ts 后端 |
| Model Catalog Fill | 复用 models.dev 数据 |
| Model Testing | 复用 /api/models-config/test |
| Thinking Level Map | Pi UI + model-scope.ts |
| Cost Editing | 复用 models.json 持久化 |
| DeepSeek Compat | Pi 实现完善 |

### MERGE（融合 ProjectHub）

| 能力 | Pi 实现 | ProjectHub 实现 | 融合方案 |
|------|--------|---------------|---------|
| OAuth Login | OAuthFlow | 无 | 复用 Pi UI，适配 ProjectHub DB (OAuthCredential?) |
| API Key Login | ApiKeyDetail | UserApiKey CRUD | 复用 Pi UI，适配 api-key-store.ts |
| Thinking Level | ThinkingLevelMap | model-scope.ts | Pi UI + model-scope.ts 逻辑 |

### ADAPT（适配后复用）

| 能力 | 方案 |
|------|------|
| Model Discovery | Pi UI 调用 /api/models-config/discover → registry.ts |
| Model Selector | Pi UI + registry.ts 混合 |

### REFACTOR（需要重构）

| 能力 | 当前问题 | 建议 |
|------|---------|------|
| Provider Auth | OAuth 和 API Key 分开处理 | 统一 CredentialService |

### REMOVE（不需要）

| 能力 | 理由 |
|------|------|
| 无 | — |

---

## 五、最终 ProjectHub AI Settings 信息架构

### 1. Tab 结构

```
AI Settings
├── Models Config        # Pi ModelsConfig（models.json）
│   ├── Provider List
│   │   ├── OAuth Providers (configured)
│   │   ├── API Key Providers (configured)
│   │   └── Custom Providers
│   ├── Provider Detail
│   │   ├── BaseURL / API Key / Headers
│   │   ├── Model Discovery
│   │   └── Thinking Level Map
│   └── Model Detail
│       ├── Model Info
│       ├── Cost Editing
│       ├── Capability Override
│       └── Connection Test
│
├── User Models          # ProjectHub（UserApiKey DB）
│   ├── Provider List (configured)
│   ├── Provider CRUD
│   └── Model Discovery
│
└── System Providers     # ProjectHub ROOT（SYSTEM UserApiKey）
    ├── Provider List
    ├── Provider CRUD
    └── Model Discovery
```

### 2. 数据边界

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          models.json (Workspace)                       │
│  - Pi Runtime 专用                                                      │
│  - BaseURL / API Key / Headers                                         │
│  - Model Discovery 结果                                                 │
│  - Thinking Level Map                                                   │
│  - Cost Editing                                                        │
│  - DeepSeek Compat                                                     │
│  - Provider Icons (静态资源)                                            │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       UserApiKey DB (ProjectHub)                         │
│  - User Scope 凭证                                                      │
│  - OAuth Credential (Future)                                           │
│  - API Key (已实现)                                                    │
│  - System Provider (ROOT)                                              │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           models.dev (外部)                              │
│  - 公共模型价格元数据                                                   │
│  - 能力信息                                                            │
│  - Context Window                                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 六、最终数据流

### Pi ModelsConfig (Workspace)

```
User UI (ModelsConfig.tsx)
    │
    ├── GET /api/models-config → models.json
    ├── PUT /api/models-config → models.json
    ├── POST /api/models-config/discover → registry.ts + Pi SDK
    ├── GET /api/models-config/catalog → models.dev
    ├── POST /api/models-config/test → Pi Runtime
    │
    └── Pi ModelRuntime
        ├── getModelRuntime() → Pi SDK
        ├── resolveVisibleModels() → model-scope.ts
        └── Thinking Level Map → model-scope.ts
```

### ProjectHub User Models (SaaS)

```
User UI (ProjectHub Settings)
    │
    ├── GET /api/ai/providers → UserApiKey DB
    ├── POST /api/auth/api-key/{provider}
    ├── DELETE /api/auth/api-key/{provider}
    │
    └── CredentialService (api-key-store.ts)
        ├── saveApiKey() → UserApiKey DB
        ├── deleteApiKey() → UserApiKey DB
        ├── resolveCredential() → UserApiKey DB
        └── getEnabledModels() → registry.ts
```

---

## 七、推荐目录结构

### 当前结构（保持）

```
features/ai/
├── llm/
│   ├── credentials/
│   │   ├── api-key-store.ts      # CredentialService
│   │   └── encryption.ts
│   └── providers/
│       ├── registry.ts            # User Discovery
│       └── types.ts
│
└── ui/ai-workspace/
    ├── ModelsConfig.tsx          # Pi ModelsConfig (直接复用)
    ├── models-config-helpers.ts   # Pi helpers
    └── lib/
        ├── model-catalog.ts      # Re-export
        └── model-discovery.ts    # Re-export

lib/
├── model-discovery.ts            # Pi ModelRuntime
├── model-scope.ts               # Thinking Level
├── model-catalog.ts             # models.dev
├── model-discovery-auth.ts       # Pi Auth
├── models-cache.ts              # Workspace cache
├── user-models-cache.ts         # User cache
└── models-config-store.ts       # models.json CRUD
```

### 推荐的融合方向（不移动文件）

```
app/api/
├── models-config/               # Workspace (Pi)
│   ├── route.ts                 # GET/PUT models.json
│   ├── discover/route.ts        # Dynamic discovery
│   ├── catalog/route.ts        # models.dev
│   └── test/route.ts           # Connection test
│
├── models/                      # Workspace (Pi)
│   └── route.ts                 # GET models
│
└── ai/
    ├── models/route.ts          # User Scope
    ├── providers/route.ts      # User providers
    └── ...
```

---

## 八、后续实施 Phase 拆分

### Phase 1: UI 融合（Pi ModelsConfig → ProjectHub）

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 集成 ModelsConfig.tsx | 直接复用 Pi UI | P0 |
| 适配 Provider Icons | 40+ icons 完整 | P0 |
| 适配 Thinking Level Map | Pi UI + model-scope.ts | P0 |
| 适配 Cost Editing | Pi UI + models.json | P0 |

**不修改**：models.json 持久化逻辑、Pi Runtime

### Phase 2: Credential 融合（OAuth）

| 任务 | 说明 | 优先级 |
|------|------|--------|
| OAuthCredential DB | 新增 Prisma Model | P1 |
| OAuth Flow UI | 复用 Pi OAuthFlow | P1 |
| CredentialService 扩展 | 支持 OAuth | P1 |

**约束**：不修改 UserApiKey Schema

### Phase 3: Model Selector 融合

| 任务 | 说明 | 优先级 |
|------|------|--------|
| 统一 Model Selector | Pi UI + ProjectHub models | P2 |
| 统一 Model Discovery | registry.ts 复用 | P2 |
| 统一 Catalog Fill | model-catalog.ts 复用 | P2 |

**不修改**：Pi Runtime、User Scope 边界

---

## 九、当前发现的问题

### 1. OAuth / API Key 分离

当前 Pi OAuth 和 API Key 分开处理：
- `OAuthDetail`：OAuth 登录
- `ApiKeyDetail`：API Key 登录

建议：统一为 `CredentialDetail`，支持多种认证方式。

### 2. Provider Icons 静态资源

`PROVIDER_ICONS` 是硬编码的 Map：
```typescript
const PROVIDER_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  "anthropic": { Icon: AnthropicIcon, hasColor: false },
  // ...
};
```

建议：考虑动态加载或简化。

### 3. Thinking Level Types

Pi 定义了自己的 `ThinkingLevel`：
```typescript
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
```

而 model-scope.ts 使用 `@earendil-works/pi-agent-core` 的 `ThinkingLevel`。

建议：统一使用 Pi SDK 的类型。

---

## 十、结论

### 核心发现

1. **Pi ModelsConfig 非常成熟**：40+ Provider Icons、OAuth/API Key、Model Discovery、Catalog Fill、Thinking Level、Cost Editing 等一应俱全。

2. **ProjectHub 的 SaaS 边界清晰**：UserApiKey DB、CredentialService、User Scope Discovery 独立于 Pi Runtime。

3. **不需要大规模重构**：Pi 的 UI 和 ProjectHub 的 DB 可以共存。

### 推荐行动

1. **直接复用 Pi ModelsConfig UI**
   - 不修改 models.json 持久化
   - 不修改 Pi Runtime
   - 直接集成 ModelsConfig.tsx

2. **保持 User Scope 独立**
   - CredentialService 保持
   - registry.ts 保持
   - User models 独立

3. **Future: OAuth Credential**
   - 新增 OAuthCredential Model
   - 扩展 CredentialService
   - 复用 Pi OAuthFlow UI

### 约束

- ❌ 不修改 models.json 格式
- ❌ 不删除 /api/models-config
- ❌ 不合并 /api/models 与 /api/ai/models
- ❌ 不修改 Prisma Schema（除非 OAuth）
- ❌ 不重构 Pi Runtime

---

**调研人**: Cursor Agent  
**调研时间**: 2026-08-21 17:30  
**结论**: Pi ModelsConfig UI 成熟，直接复用；ProjectHub DB 边界清晰，保持独立
