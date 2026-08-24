---
name: Pi ProjectHub 融合计划
overview: 渐进式融合 Pi Web UI 与 ProjectHub，保留 Pi 的成熟 UX 和配置能力，同时统一到 ProjectHub 的数据层和业务体系。采用 KEEP（直接迁移）→ ADAPT（改造对接）→ MERGE（合并重构）三阶段策略，优先解决模型配置同步问题。
todos:
  - id: phase0-provider-registry
    content: "【P0】迁移 Pi Provider Registry 体系：displayName/icon/authType/endpoint/compatibility，成为 ProjectHub 平台能力"
    status: pending
  - id: phase0-model-discovery
    content: "【P0】创建 ModelDiscoveryService：统一 Pi parseDiscoveredModels() + ProjectHub discoverModelsFromAPI()"
    status: pending
  - id: phase0-model-catalog
    content: "【P0】迁移 Pi model-catalog.ts + models.dev 集成，成为 ProjectHub 平台能力"
    status: pending
  - id: phase0-credential-system
    content: "【P0】重构 Credential 系统：UI 吸收 Pi 风格，DB 加密存储，单向同步到 models.json"
    status: pending
  - id: phase0-unified-api
    content: "【P0】创建 /api/models 统一路由，替代现有的 /api/ai/models、/api/models-config/*、/api/ai/providers"
    status: pending
  - id: phase1-agent-workspace-ux
    content: "【P1】迁移 Pi Agent Workspace UX：ChatWindow/MessageView/ChatInput/ModelSelector/SessionSidebar"
    status: pending
  - id: phase1-tool-registry
    content: "【P1】迁移 Pi ToolCallRegistry + FileExplorer"
    status: pending
  - id: phase1-think-reasoning
    content: "【P1】迁移 Thinking/Reasoning 配置：thinkingLevelMap，UI 采用 Pi，DB 存储"
    status: pending
  - id: phase2-artifacts
    content: "【P2】迁移 Artifacts + Sandbox，与 ProjectHub 已有目录整合"
    status: pending
  - id: phase2-sandbox-runtime
    content: "【P2】迁移 SandboxRuntime，与 ProjectHub 已有 runtime 整合"
    status: pending
  - id: phase3-documentation
    content: "【P3】编写融合架构文档和用户配置指南"
    status: pending
  - id: phase3-testing
    content: "【P3】编写单元测试、集成测试和 E2E 测试覆盖"
    status: pending
isProject: false
---

# Pi → ProjectHub 渐进式融合计划

> **架构原则**：
> - **Pi = AI Capability Reference**（成熟的 AI 能力参考实现）
> - **ProjectHub = AI SaaS System of Record**（业务真相源）
>
> **"谁设计" ≠ "谁存储"**：Pi 设计 UI/UX，ProjectHub 接管数据层。

## 三层存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                         ProjectHub                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ① DB (Product Data — Source of Truth)                      │
│  换电脑后还需要的：                                           │
│  ├── UserProviderCredential (加密)                           │
│  ├── ModelPreference (用户默认模型/推理级别)                   │
│  ├── AgentModelConfig (Agent 模型配置)                        │
│  ├── ProjectAiConfig (项目级 AI 配置)                        │
│  ├── ModelCatalog (平台元数据)                                │
│  ├── ChatMessage / AgentRun (产品历史)                       │
│  └── ArtifactMetadata (产品数据)                              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ② Object/File Storage (Content — 内容真相)                  │
│  大文件：                                                     │
│  ├── Artifact 内容 (HTML/SVG/DOCX/PDF)                       │
│  ├── 生成的图片/视频                                          │
│  └── 上传的附件                                              │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ③ Local Runtime Files (Pi — Runtime Compatibility Layer)    │
│  PiSubAgent 专用：                                           │
│  ├── models.json (Pi Compatibility Projection)               │
│  ├── sessions/ (Pi Session 状态)                             │
│  └── cache/ (可重新生成的缓存)                               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 数据分类判断标准

| 问题 | 答案 | 存储位置 |
|------|------|----------|
| **换电脑后还需要？** | ✅ 是 | DB |
| **Runtime 为了运行方便产生？** | ✅ 是 | Local Files |
| **丢了能重新生成？** | ✅ 是 | Cache/Files |
| **产品历史/权限/审计？** | ✅ 是 | DB |

## 分层职责

| 层级 | 存储 | 管理者 | Source of Truth |
|------|------|--------|-----------------|
| **Credentials** | DB (加密) | ProjectHub UI | ✅ DB |
| **Model Catalog** | DB + Cache | Discovery Service | ✅ DB |
| **User Preferences** | DB | ProjectHub UI | ✅ DB |
| **Pi models.json** | Local File | Pi Adapter | ❌ DB Projection |
| **Pi sessions** | Local Files | Pi Runtime | ❌ Runtime State |
| **Artifacts** | Object Storage | ProjectHub | ✅ Content |
| **Chat History** | DB | ProjectHub | ✅ DB |

---

## 融合边界（核心决策）

### Pi = AI Capability Reference（优先吸收）

```
Provider Registry
Model Discovery
Model Import
Capability Detection
Thinking / Reasoning
Model Settings UX
Provider Settings UX
Connection Test
Model Search / Filter
Agent Workspace UX
Chat / Thinking / Tool Call
Streaming / Model Selector
```

**判断标准**：这是"AI 产品的通用能力"吗？
- 是 → **Pi 是更好的参考实现，大胆吸收**

### ProjectHub = AI SaaS System of Record（保持初心）

```
用户 / 组织 / 项目 / 权限
Credential 所有权
数据库 / AI Session 历史
WorkAgent / 业务工具
项目上下文 / 审计
计费 / 配额
```

**判断标准**：这是"ProjectHub 的 SaaS 业务能力"吗？
- 是 → **ProjectHub 自己说了算**

### 融合层（需要自己做）

```
ModelConfigService
ProviderRegistry
ModelCatalog
CredentialAdapter
AgentModelConfig
Event Adapter
Runtime Config
```

---

## 融合矩阵（按 P0-P2 优先级）

### P0：Model / Provider 体系（最高优先级）

| 模块 | Pi 实现 | 策略 | 最终归属 |
|------|---------|------|----------|
| **Provider Registry** | 完整 Provider 体系（displayName/icon/authType/endpoint/compatibility） | **Pi-first** | 迁移到 ProjectHub，成为平台能力 |
| **Model Discovery** | `parseDiscoveredModels()` + 多协议支持 | **Pi-first** | 统一为 `ModelDiscoveryService` |
| **Model Catalog** | `lib/model-catalog.ts` + models.dev | **Pi-first** | 迁移到 ProjectHub |
| **Capability Detection** | 关键词匹配推断能力 | **Pi-first** | 成为 ModelDefinition 一部分 |
| **Thinking / Reasoning** | thinkingLevelMap | **Pi-first** | UI 采用，DB 存储 |
| **Credential** | UI 参考 Pi | **ProjectHub** | UI 吸收 Pi 风格，DB 加密存储 |
| **Connection Test** | OAuth SSE 流 | **Pi-first** | 迁移到 ProjectHub |

### P1：Agent Workspace UX

| 模块 | Pi 实现 | 策略 | 最终归属 |
|------|---------|------|----------|
| **Chat Window** | 流式渲染 + 懒加载 + 分组折叠 | **Pi-first** | 直接迁移 |
| **Message View** | memo + Thinking 折叠 + Diff | **Pi-first** | 直接迁移 |
| **Chat Input** | Draft 保存 + @ 补全 + Slash | **Pi-first** | 迁移 Draft 和 @ 补全 |
| **Model Selector** | 推理级别 + 模型选择 | **Pi-first** | 成为统一 ModelConfigService UI |
| **Tool Call Registry** | 注册表模式 | **Pi-first** | 直接迁移 |
| **FileExplorer** | Git 感知 + 上传 + mention | **Pi-first** | 直接迁移 |

### P2：Artifacts 与 Sandbox

| 模块 | Pi 实现 | 策略 | 最终归属 |
|------|---------|------|----------|
| **ArtifactsPanel** | MIME 路由 + 多 Tab | **MERGE** | 与 ProjectHub 已有整合 |
| **Artifact Sandbox** | SandboxRuntime | **KEEP** | 直接迁移 |
| **MarkdownBody** | Mermaid + 插件链 | **MERGE** | 对比后合并 |

---

## 渐进式融合路线图

### Phase 0：Provider / Model 体系（P0 — 最高优先级）

**目标**：以 Pi 为蓝本重构 AI Platform Capability Layer，ProjectHub 接管数据层。

#### 0.1 迁移 Pi Provider Registry 体系（Pi-first）

```
Pi Provider 体系
    ↓
完整吸收
    ↓
迁移到 ProjectHub
    ↓
成为平台能力
```

**Pi 的 Provider 结构（直接采用）**：

```typescript
// features/ai/provider/types.ts

interface Provider {
  id: string
  displayName: string
  icon: string
  authType: 'apiKey' | 'oauth' | 'deviceCode'
  endpoint: string
  compatibility: string[]  // ['openai-chat', 'anthropic', ...]
  capabilities: {
    chat: boolean
    completion: boolean
    streaming: boolean
    vision: boolean
    reasoning: boolean
    functionCalling: boolean
  }
  modelDiscovery: {
    enabled: boolean
    endpoint: string
    path: string
  }
  connectionTest?: {
    type: 'chat' | 'models' | 'custom'
    prompt?: string
  }
}
```

**内置 Provider 列表（直接采用）**：

```typescript
export const BUILT_IN_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    authType: 'apiKey',
    endpoint: 'https://api.openai.com',
    compatibility: ['openai-chat'],
    capabilities: { chat: true, completion: true, streaming: true, vision: true, reasoning: false, functionCalling: true },
    modelDiscovery: { enabled: true, endpoint: 'https://api.openai.com', path: '/v1/models' }
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    authType: 'apiKey',
    endpoint: 'https://api.anthropic.com',
    compatibility: ['anthropic'],
    capabilities: { chat: true, completion: false, streaming: true, vision: true, reasoning: true, functionCalling: true },
    modelDiscovery: { enabled: true, endpoint: 'https://api.anthropic.com', path: '/v1/models' }
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    authType: 'apiKey',
    endpoint: 'https://openrouter.ai/api',
    compatibility: ['openai-chat', 'anthropic'],
    capabilities: { chat: true, completion: true, streaming: true, vision: true, reasoning: true, functionCalling: true },
    modelDiscovery: { enabled: true, endpoint: 'https://openrouter.ai/api', path: '/v1/models' }
  },
  // ... 更多 Provider
]
```

#### 0.2 创建 ModelDiscoveryService（统一发现）

```typescript
// features/ai/model-config/discovery-service.ts

export class ModelDiscoveryService {
  async discover(provider: Provider, credential: UserCredential): Promise<ModelDefinition[]> {
    // 1. 根据 compatibility 选择发现协议
    const protocol = this.selectDiscoveryProtocol(provider.compatibility)
    
    // 2. 调用 provider discovery endpoint
    const raw = await this.fetchModels(protocol, credential)
    
    // 3. 解析为 NormalizedModel
    return this.parseModels(provider.id, raw, protocol)
    
    // 4. 推断能力（Pi 关键词匹配）
    return models.map(m => ({
      ...m,
      capabilities: this.inferCapabilities(m.id)
    }))
  }
  
  private selectDiscoveryProtocol(compatibility: string[]): DiscoveryProtocol {
    if (compatibility.includes('anthropic')) return 'anthropic'
    if (compatibility.includes('google')) return 'google'
    return 'openai'  // 默认 OpenAI 兼容
  }
}
```

#### 0.3 迁移 Model Catalog（Pi-first）

```
lib/model-catalog.ts（Pi）
    ↓
迁移到 features/ai/model-catalog/
    ↓
接入 models.dev API
    ↓
1h 缓存
    ↓
成为 ProjectHub 平台能力
```

#### 0.4 重构 Credential 系统（ProjectHub 主导）

```typescript
// features/ai/credential/types.ts

interface UserCredential {
  id: string
  userId: string
  providerId: string
  encryptedApiKey: string  // 加密存储
  baseUrl?: string
  apiFormat: string
  headers?: Record<string, string>
  status: 'active' | 'invalid' | 'pending'
  thinkingLevelMap?: Record<string, string | null>  // Pi 特有
}

// DB Schema 扩展
model userApiKey {
  id              String   @id @default(cuid())
  userId          String
  providerId      String
  encryptedApiKey String
  baseUrl         String?
  apiFormat       String?
  headers         Json?
  thinkingLevelMap Json?  // { "medium": "claude-3-5-sonnet", ... }
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

#### 0.5 创建 PiModelConfigAdapter（单向同步）

```typescript
// features/ai/model-config/pi-adapter.ts

export class PiModelConfigAdapter {
  // 单向同步：DB → models.json
  async syncToPiModelsJson(userId: string): Promise<void> {
    // 1. 从 DB 读取 Credentials
    const credentials = await getUserCredentials(userId)
    
    // 2. 生成 Pi 格式
    const piConfig = this.toPiModelsConfig(credentials)
    
    // 3. 写入 ~/.pi/agent/models.json
    await writePiModelsConfig(piConfig)
  }
  
  // 不反向同步！models.json 是 Adapter Output，不是 Source of Truth
}
```

#### 0.6 创建 `/api/models` 统一路由

```
/api/models
├── GET /                      # 获取可用模型（合并 Credentials + Discovery）
├── POST /discover             # 发现模型
├── POST /test                 # 测试连接
├── GET /catalog?q=<id>        # Catalog 推荐
├── GET /providers             # 获取内置 Provider 列表
├── GET /credentials           # 获取用户 Credentials
├── POST /credentials          # 保存 Credential
├── PUT /credentials/:id       # 更新 Credential
├── DELETE /credentials/:id    # 删除 Credential
├── GET /preferences           # 获取用户偏好
└── PUT /preferences          # 保存用户偏好
```

---

### Phase 1：Agent Workspace UX（P1）

**目标**：以 Pi 为蓝本重构 AI Settings UI，成为 ProjectHub 新标准。

#### 1.1 重构 AI Settings UI（Pi-first）

```
Pi Settings UI
    ↓
完整吸收
    ↓
ProjectHub 数据层接管
    ↓
ProjectHub 风格重构
```

**目标结构**：

```
AI Settings (ProjectHub)
│
├── Providers
│   ├── Built-in Providers (OpenAI / Anthropic / OpenRouter / ...)
│   ├── Custom Provider
│   └── OpenAI / Anthropic Compatible
│
├── Models
│   ├── Search & Filter
│   ├── Capability Badge
│   ├── Reasoning Level
│   └── Default Model
│
├── Credentials
│   ├── Provider Credentials
│   ├── OAuth Connections
│   └── Connection Test
│
├── Runtime Defaults
│   ├── Reasoning Level (off / low / medium / high)
│   ├── Temperature
│   ├── Max Tokens
│   └── Tool Calling
│
└── Advanced
    ├── Endpoint Override
    ├── Custom Headers
    └── Discovery Refresh
```

#### 1.2 迁移 Chat Window（Pi-first）

```
features/ai/ui/ai-workspace/
├── ChatWindow.tsx          # Pi 流式渲染
├── MessageView.tsx         # Pi memo + Thinking
├── ChatInput.tsx          # Pi Draft + @补全
├── ModelSelector.tsx      # Pi 推理级别选择
├── SessionSidebar.tsx      # Pi 树形会话
└── ToolCallRegistry.tsx   # Pi 注册表模式
```

#### 1.3 迁移 Thinking / Reasoning 配置

```typescript
// features/ai/model-config/types.ts

interface ThinkingConfig {
  enabled: boolean
  level?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  provider?: string  // 指定支持 thinking 的 provider
}

interface AgentModelConfig {
  agentId: string
  modelId: string
  thinking?: ThinkingConfig
  temperature?: number
  maxTokens?: number
}
```

UI 采用 Pi 的 thinking selector，存储到 ProjectHub DB。

#### 1.4 迁移 FileExplorer（Pi-first）

```
features/ai/ui/ai-workspace/FileExplorer.tsx
    ↓
迁移到 features/ai/ui/
    ↓
对接 ProjectHub API
    ├── /api/git/status
    ├── /api/files/*
    └── /api/cwd/*
```

---

### Phase 2：Artifacts 与 Sandbox（P2）

**目标**：整合 Pi Artifacts 能力与 ProjectHub 已有实现。

#### 2.1 迁移 ArtifactsPanel（MERGE）

```
features/ai/ui/artifacts/（ProjectHub 已有）
    ↓
整合 Pi 的 MIME 路由系统
    ↓
保留 Pi 的多 Tab 展示
```

#### 2.2 迁移 SandboxRuntime（KEEP）

```
features/ai/ui/ai-workspace/runtime/
├── SandboxRuntimeProvider.ts
├── ConsoleRuntimeProvider.ts
└── SandboxedIframe.tsx
```

直接迁移，与 ProjectHub 集成。

---

### Phase 3：文档与测试（P3）

#### 3.1 文档

- `docs/ai/pi-fusion-architecture.md` — 融合架构说明
- `docs/ai/model-config-guide.md` — 用户配置指南
- `.cursor/skills/pm-dev/PROJECT-HUB.md` — 更新 AI Platform 章节

#### 3.2 测试

- 单元测试：`ModelDiscoveryService`
- 集成测试：Discovery + Catalog 流程
- E2E 测试：完整配置流程

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| **Pi 代码 vs ProjectHub 代码混淆** | 严格按边界：AI Capability → Pi-first，Platform → ProjectHub 自己做 |
| **models.json 成为第二个 Source of Truth** | Adapter 单向同步（DB → models.json），不反向 |
| **Pi SubAgent 启动时 models.json 过期** | AI Workspace 加载时同步 + Pi SubAgent 启动前同步 |
| **重复造轮子** | AI 通用能力（Provider/Model/Discovery）直接参考 Pi，不重新发明 |
| **Credential 安全问题** | 加密存储在 DB，models.json 只存加密后的引用 |

---

## 最终架构

```
                    ProjectHub AI Platform
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
  Provider Registry      Model Catalog       Credential Store
        │                     │                     │
        │                     ├── Capability        │
        │                     ├── Reasoning        │
        │                     ├── Context          │
        │                     └── Pricing          │
        │                                           │
        └─────────────────────┬─────────────────────┘
                              ▼
                       ModelConfigService
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
           Chat           WorkAgent        PiSubAgent
             │                │                │
             └────────────────┴────────────────┘
                              ▼
                        Unified Runtime
```

---

## 下一步行动

**Phase 0（P0）是最高优先级**，完成后整个 AI Platform 基础就建立了：

1. Provider Registry 体系（Pi-first）
2. ModelDiscoveryService（统一发现协议）
3. Credential 系统（ProjectHub 主导）
4. `/api/models` 统一路由
