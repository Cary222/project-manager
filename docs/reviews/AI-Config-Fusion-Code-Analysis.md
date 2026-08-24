# AI Config 代码现状调研

> 调研时间：2026-08-21
> 调研者：fullstack-developer
> 目的：Stage 0 — 全面了解 Pi Web UI 与 ProjectHub 现有 AI 配置代码的现状，为融合方案提供事实依据

---

## 一、API 路由清单

### A. Pi 系统（models-config 系列）

| # | 路径 | 方法 | 功能 | 存储后端 | 行数 | 依赖 |
|---|------|------|------|----------|------|------|
| P1 | `/api/models-config` | GET/PUT | 读写 `models.json` 文件 | `lib/models-config-store.ts`（文件系统） | 19 | `readModelsConfig` / `writeModelsConfig` |
| P2 | `/api/models-config/catalog` | GET | 代理 models.dev 目录 API，带 60min 缓存 | 无状态 | 79 | `@/lib/model-catalog`（`flattenModelsDevCatalog` / `searchModelCatalog`） |
| P3 | `/api/models-config/discover` | POST | 从 provider API 动态发现模型列表 | 无状态 | 89 | `@/lib/model-discovery` / `@/lib/model-discovery-auth` |
| P4 | `/api/models-config/test` | POST | 测试模型连通性（创建临时 models.json + Pi ModelRuntime） | 无状态（临时文件） | 122 | `@earendil-works/pi-coding-agent` |

**Pi 存储架构**：`models.json` 文件，路径由 Pi SDK 的 `getAgentDir()` 决定（全局）。

### B. ProjectHub 系统（ai/providers + ai/models 系列）

| # | 路径 | 方法 | 功能 | 存储后端 | 行数 | 依赖 |
|---|------|------|------|----------|------|------|
| H1 | `/api/ai/providers` | GET/POST/PUT/DELETE | CRUD 用户/系统 API Key | Prisma `UserApiKey` 表 + AES-256-GCM 加密 | 295 | `features/ai/llm/credentials/api-key-store.ts` |
| H2 | `/api/ai/models` | GET | 返回用户可见模型列表（SYS+USER 合并） | 无状态 | 26 | `features/ai/llm/providers/registry.ts` |
| H3 | `/api/models` | GET | 返回当前项目可见模型（含 scope 过滤、thinking level pin） | 无状态 | 27 | `@/lib/model-scope` / `@/lib/model-discovery` |
| H4 | `/api/plugins` | GET/POST | AI 扩展插件管理（install/remove/update/disable/enable） | `DefaultPackageManager`（Pi SDK） | 366 | `@earendil-works/pi-coding-agent` |
| H5 | `/api/skills` | GET/PATCH | Skill 列表 + 启用/禁用 | `DefaultPackageManager` | — | `@earendil-works/pi-coding-agent` |
| H6 | `/api/skills/check` | POST | 检查 skill 更新 | 无状态 | — | `@earendil-works/pi-coding-agent` |
| H7 | `/api/skills/update` | POST | 更新 skill | 无状态 | — | `@earendil-works/pi-coding-agent` |
| H8 | `/api/skills/search` | GET | 从 skills.sh 搜索 skill | 无状态 | — | `@earendil-works/pi-coding-agent` |
| H9 | `/api/skills/install` | POST | 安装 skill | 无状态 | — | `@earendil-works/pi-coding-agent` |
| H10 | `/api/ai/work/run` | POST | 启动 Work Agent（SSE 流式响应） | 无状态 | 286 | `features/ai/agents/work/graph.ts` / `getPiSubAgent()` |

**ProjectHub 存储架构**：Prisma `UserApiKey` 表，AES-256-GCM 加密存储，3 级回退（SYSTEM → USER → ENV）。

### C. Agent Session 相关

| # | 路径 | 方法 | 功能 | 依赖 |
|---|------|------|------|------|
| A1 | `/api/agent/new` | POST | 创建/确保 session 存在 | Pi SDK AgentSession |
| A2 | `/api/agent/[sessionId]` | GET | 获取 session 运行状态 | Pi SDK |
| A3 | `/api/agent/[sessionId]/events` | GET (SSE) | 流式事件推送 | Pi SDK 事件流 |
| A4 | `/api/sessions` | GET | 列出所有 session | Pi SDK |
| A5 | `/api/sessions/[id]` | GET | 获取 session 详情 | Pi SDK |
| A6 | `/api/sessions/[id]/state` | GET | 获取 agent 运行时状态 | Pi SDK |

---

## 二、数据流图

### 2.1 Pi models.json 存储流（独立于 DB）

```
用户配置 UI (ModelsConfig.tsx)
    │
    │  PUT /api/models-config
    ▼
lib/models-config-store.ts
    │  writePrivateFileAtomicSync()
    ▼
Pi AgentDir/models.json  (文件系统)
    │
    │  readPrivateFileSync()
    ▼
Pi ModelRuntime (SDK)
    │
    │  createModel()
    ▼
Pi SubAgent 执行 (transports/sdk.ts)
```

**特点**：
- 无需 DB，所有配置存文件系统
- 路径固定在 Pi SDK 的 agent dir
- 每个用户有独立配置（通过 Pi SDK 的 agent dir 隔离）

### 2.2 ProjectHub API Key 存储流（基于 DB）

```
用户配置 UI (model-select/useApiKeys.ts)
    │
    │  POST /api/ai/providers
    ▼
app/api/ai/providers/route.ts
    │
    │  saveApiKey() — AES-256-GCM 加密
    ▼
credentials/api-key-store.ts
    │
    ▼
Prisma — UserApiKey 表
    │
    │  resolveCredentialWithFallback()
    ▼
credentials/encryption.ts  (解密)
    │
    │  createModel()
    ▼
ProjectHub LLM Registry (providers/registry.ts)
    │
    │  discoverModelsFromAPI()
    ▼
/api/ai/models (GET)
```

**特点**：
- 凭证加密存储（AES-256-GCM）
- 3 级回退：SYSTEM → USER → ENV
- 动态模型发现（`/v1/models` 端点）

### 2.3 Work Agent 执行流

```
POST /api/ai/work/run
    │
    ▼
WorkAgentGraph (LangGraph)
    │
    ├── executeWorkflow → workflow 执行
    │
    └── executeCoding → PiSubAgent
                            │
                            │  setupCredentials(userId)
                            ▼
                        Prisma UserApiKey → resolveCredentialWithFallback()
                            │
                            ▼
                        PiSdkRuntime.start()
                            │
                            ▼
                        SSE 事件流 → /api/agent/[sessionId]/events
```

### 2.4 Plugin/Skill 管理流

```
PluginsConfig.tsx / SkillsConfig.tsx
    │
    ▼
/api/plugins (GET/POST)
/api/skills (GET/PATCH)
    │
    ▼
DefaultPackageManager (Pi SDK)
    │
    │  global scope → Pi SDK agent dir
    │  project scope → 项目 .pi/ 目录
    ▼
Pi Coding Agent 运行时注册
```

---

## 三、代码重复点

### 3.1 模型类型定义重复

| 位置 | 类型名 | 用途 | 重复度 |
|------|--------|------|--------|
| `lib/model-catalog.ts` | `ModelCatalogEntry` | models.dev 目录条目 | 核心定义 |
| `lib/api-types.ts` | `PluginPackageInfo` / `SkillInfo` | Pi UI API 类型 | 仅 re-export |
| `features/ai/ui/ai-workspace/lib/model-catalog.ts` | — | re-export `lib/model-catalog.ts` | **完全重复**（3 行 re-export） |
| `features/ai/ui/ai-workspace/lib/model-discovery.ts` | — | re-export `lib/model-discovery.ts` | **完全重复**（3 行 re-export） |
| `features/ai/llm/providers/types.ts` | `ModelCatalogEntry` | 用户级模型条目 | **字段重复但独立定义** |
| `lib/model-discovery.ts` | `DiscoveredModel` | 从 API 发现的模型 | 核心定义 |
| `features/ai/ui/ai-workspace/ModelsConfig.tsx` | `ModelEntry` / `ProviderEntry` | Pi UI 模型配置类型 | **本地定义（~2317 行组件内）** |

### 3.2 Provider 发现逻辑重复

| 位置 | 逻辑 | 复杂度 |
|------|------|--------|
| `lib/model-discovery.ts` | `buildModelsListUrl()` / `parseDiscoveredModels()` | 415 行，完整支持 OpenAI / Anthropic / Google / 通用兼容 |
| `features/ai/llm/providers/registry.ts` | `discoverModelsFromAPI()` | 442 行，含 Agnes 特殊处理和 provider 默认值 |

**重复程度**：两个独立实现，都能从 `/v1/models` 发现模型。Pi 版本更通用（支持多种 API 类型），ProjectHub 版本更业务化（含 Agnes fallback）。

### 3.3 凭证管理重复

| 位置 | 逻辑 |
|------|------|
| `features/ai/llm/credentials/api-key-store.ts` | SYSTEM + USER 分离，AES-256-GCM 加密，Prisma 存储 |
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 直接读 Prisma `UserApiKey` 表，含 3 级回退 |

**重复程度**：`transports/sdk.ts` 自己写了 Prisma 查询逻辑（`findFirst` / `findMany`），而不是调用 `api-key-store.ts` 的 `resolveCredentialWithFallback()`。虽然最终结果一致，但代码路径不统一。

### 3.4 工具库 re-export 重复

| 位置 | 内容 |
|------|------|
| `lib/api-types.ts` | re-export `@/features/ai/ui/ai-workspace/lib/api-types` |
| `features/ai/ui/ai-workspace/lib/model-catalog.ts` | re-export `@/lib/model-catalog` |
| `features/ai/ui/ai-workspace/lib/model-discovery.ts` | re-export `@/lib/model-discovery` |

**问题**：`lib/` 层依赖 `features/ai/ui/` 的类型，形成循环依赖风险。正确方向应该是 `features/ai/ui/` 依赖 `lib/` 层。

---

## 四、依赖关系图

### 4.1 核心依赖树

```
models.json 文件 (Pi 文件系统存储)
    │
    ├── Read by: lib/models-config-store.ts
    │              └── getModelRuntime() → Pi SDK ModelRuntime
    │                                    └── transports/sdk.ts (createPiSession)
    │
    └── Write by: /api/models-config/route.ts
                     └── ModelsConfig.tsx (PUT)

Prisma UserApiKey 表
    │
    ├── Write by: /api/ai/providers/route.ts
    │              └── api-key-store.ts
    │
    └── Read by:
         ├── /api/ai/models/route.ts
         │     └── providers/registry.ts
         │           └── getEnabledModels()
         │
         ├── transports/sdk.ts (setupCredentials)
         │     └── resolveCredentialWithFallback()
         │
         └── PiSdkRuntime (createModel)

Pi SDK (@earendil-works/pi-coding-agent)
    │
    ├── 使用 models.json 路径 → getAgentDir()
    ├── 使用 Prisma UserApiKey → transports/sdk.ts
    │
    ├── AgentSession / ModelRuntime
    │     └── models-config 存储
    │
    └── DefaultPackageManager
          ├── /api/plugins (插件管理)
          └── /api/skills (Skill 管理)
```

### 4.2 UI 组件依赖关系

```
AppShell.tsx
    ├── ModelsConfig.tsx (2317行)
    │     ├── lib/model-catalog (re-export)
    │     ├── lib/model-discovery (re-export)
    │     ├── models-config API (PUT/GET /api/models-config)
    │     ├── catalog API (/api/models-config/catalog)
    │     ├── discover API (/api/models-config/discover)
    │     └── test API (/api/models-config/test)
    │
    ├── PluginsConfig.tsx (1092行)
    │     └── /api/plugins
    │
    ├── SkillsConfig.tsx (1402行)
    │     ├── /api/skills
    │     ├── /api/skills/check
    │     ├── /api/skills/update
    │     └── /api/skills/search
    │
    └── useAgentSession.ts (1951行)
          ├── /api/agent/new
          ├── /api/agent/[sessionId]
          ├── /api/agent/[sessionId]/events (SSE)
          ├── /api/sessions/[id]
          └── /api/sessions/[id]/state
```

### 4.3 跨系统桥接点

| 桥接点 | 来源 | 目标 | 方式 |
|--------|------|------|------|
| **凭证消费** | `UserApiKey` 表 | Pi SubAgent | `transports/sdk.ts` 直接读 Prisma |
| **模型列表** | `/api/models` (ProjectHub) | `useAgentSession.ts` | 独立 API，与 Pi 分离 |
| **Work Agent** | `graph.ts` | `getPiSubAgent()` | `app/api/ai/work/run` 统一入口 |
| **类型共享** | `lib/api-types.ts` | Pi UI / ProjectHub | re-export 链 |

---

## 五、迁移影响评估

### 5.1 按模块风险分级

| 模块 | 文件 | 行数 | 风险 | 理由 |
|------|------|------|------|------|
| **models-config API** | `app/api/models-config/route.ts` | 19 | 🟡 中 | 仅做文件读写，依赖简单，可直接迁移 |
| **catalog API** | `app/api/models-config/catalog/route.ts` | 79 | 🟢 低 | 无状态代理，纯逻辑 |
| **discover API** | `app/api/models-config/discover/route.ts` | 89 | 🟢 低 | 无状态发现逻辑 |
| **test API** | `app/api/models-config/test/route.ts` | 122 | 🟡 中 | 依赖 Pi SDK ModelRuntime，需要评估 |
| **ModelsConfig.tsx** | `features/ai/ui/ai-workspace/ModelsConfig.tsx` | 2317 | 🔴 高 | 最大组件，含 Provider/Model/OAuth 配置，与 Pi 深度绑定 |
| **PluginsConfig.tsx** | `features/ai/ui/ai-workspace/PluginsConfig.tsx` | 1092 | 🟡 中 | 依赖 Pi SDK DefaultPackageManager |
| **SkillsConfig.tsx** | `features/ai/ui/ai-workspace/SkillsConfig.tsx` | 1402 | 🟡 中 | 依赖 Pi SDK DefaultPackageManager |
| **lib/model-catalog.ts** | `lib/model-catalog.ts` | 415 | 🟢 低 | 纯逻辑库，无外部依赖 |
| **lib/model-discovery.ts** | `lib/model-discovery.ts` | 93 | 🟢 低 | 纯逻辑库，无外部依赖 |
| **lib/models-config-store.ts** | `lib/models-config-store.ts` | 92 | 🟡 中 | 文件系统操作，需要评估路径策略 |
| **lib/api-types.ts** | `lib/api-types.ts` | 22 | 🟡 中 | re-export 层，需消除循环依赖 |
| **providers/registry.ts** | `features/ai/llm/providers/registry.ts` | 442 | 🔴 高 | Agnes 硬编码 + 用户模型合并逻辑 |
| **api-key-store.ts** | `features/ai/llm/credentials/api-key-store.ts` | 481 | 🟡 中 | Prisma 操作，需保持兼容 |
| **transports/sdk.ts** | `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 811 | 🔴 高 | 直接读 Prisma，有重复凭证查询逻辑 |
| **providers/types.ts** | `features/ai/llm/providers/types.ts` | 62 | 🟡 中 | 类型定义，与 Pi 类型可能有重叠 |
| **work/graph.ts** | `features/ai/agents/work/graph.ts` | 408 | 🟡 中 | LangGraph 编排，调用 Pi SubAgent |

### 5.2 高风险项详解

#### 风险 1：ModelsConfig.tsx 与 models.json 深度耦合 🔴

`ModelsConfig.tsx`（2317 行）是最大的耦合点：
- 直接读写 `/api/models-config`（models.json 文件）
- 设计理念是"本地 Pi CLI 的配置面板"
- 如果迁移到 ProjectHub，需要重新设计存储层（Prisma vs 文件系统）

**融合方案选项**：
- **选项 A**：保留 Pi 的 models.json 作为 Pi SubAgent 的配置源，ProjectHub 独立维护 `UserApiKey`
- **选项 B**：统一到 Prisma `UserApiKey`，Pi SubAgent 也读 DB
- **选项 C**：双写（Prisma + models.json），逐步迁移

#### 风险 2：transports/sdk.ts 凭证查询重复 🔴

`transports/sdk.ts` 自己写了 Prisma 查询，而不是调用 `api-key-store.ts`：

```typescript
// transports/sdk.ts 中自己写的查询（与 api-key-store.ts 重复）
const userProviderRecords = await prisma.userApiKey.findFirst({
  where: { userId, deletedAt: null },
});
const systemCreds = await prisma.userApiKey.findMany({
  where: { ownerType: "SYSTEM", deletedAt: null },
});
```

应该统一调用 `resolveCredentialWithFallback()`。

#### 风险 3：lib/ → features/ai/ui/ 反向依赖 🟡

`lib/api-types.ts` re-export 了 `features/ai/ui/ai-workspace/lib/api-types`：

```typescript
// lib/api-types.ts
export type { SkillSearchResult, ... } from "@/features/ai/ui/ai-workspace/lib/api-types";
```

这是架构异味：`lib/` 应该是最底层，不应该依赖 `features/`。

### 5.3 迁移策略建议

| 阶段 | 内容 | 风险 | 优先级 |
|------|------|------|--------|
| **Phase 1** | 消除循环依赖（lib/api-types.ts 重构） | 🟢 低 | P0 |
| **Phase 2** | 统一凭证查询（transports/sdk.ts 调用 api-key-store） | 🟡 中 | P1 |
| **Phase 3** | 评估 ModelsConfig.tsx 融合策略 | 🔴 高 | P2 |
| **Phase 4** | Plugin/Skill 配置保留 Pi SDK 方式 | 🟡 中 | P2 |

---

## 六、关键发现

### 6.1 存储架构的根本差异

| 维度 | Pi 系统 | ProjectHub 系统 |
|------|---------|----------------|
| **存储位置** | 文件系统（Pi agent dir） | Prisma 数据库 |
| **凭证加密** | 无（Pi 不管理凭证） | AES-256-GCM |
| **配置粒度** | 全局 + 项目 | 用户级 + 系统级 |
| **模型发现** | 动态发现（catalog API） | 动态发现（registry） |
| **回退机制** | 无 | 3 级回退（SYSTEM → USER → ENV） |

### 6.2 双轨并行现状

当前 ProjectHub **两套 AI 配置系统并行**：

1. **Pi 轨道**：`ModelsConfig.tsx` → `/api/models-config` → `models.json`
2. **ProjectHub 轨道**：`useApiKeys.ts` → `/api/ai/providers` → `UserApiKey` 表

Pi SubAgent（`transports/sdk.ts`）**目前读的是 ProjectHub 的 `UserApiKey` 表**，而不是 Pi 的 `models.json`。这说明**ProjectHub 已部分接管 Pi 的凭证管理**。

### 6.3 Agnes 硬编码问题

`providers/registry.ts` 硬编码了 Agnes 模型：

```typescript
// 硬编码的 Agnes 模型
const models: ModelCatalogEntry[] = [
  { id: "agnes-2.5-flash", modelName: "Agnes 2.5 Flash", ... },
  { id: "agnes-2.0-flash", modelName: "Agnes 2.0 Flash", ... },
  { id: "agnes-image-2.1-flash", modelName: "Agnes Image 2.1 Flash", ... },
  { id: "agnes-image-2.0-flash", modelName: "Agnes Image 2.0 Flash", ... },
  { id: "agnes-video-v2.0", modelName: "Agnes Video v2.0", ... },
];
```

这些是 Agnes 平台的专用模型，不是用户可配置的通用模型。

### 6.4 API 路由职责分离

| API | 职责 | 调用者 |
|-----|------|--------|
| `/api/models-config/*` | Pi UI 专属 | `ModelsConfig.tsx` |
| `/api/ai/providers` | ProjectHub 凭证管理 | `useApiKeys.ts` |
| `/api/models` | 项目级模型可见性 | `useAgentSession.ts` |
| `/api/plugins` | Pi 插件管理 | `PluginsConfig.tsx` |
| `/api/skills` | Pi Skill 管理 | `SkillsConfig.tsx` |

### 6.5 Pi SDK 依赖广泛

多个 API 路由都依赖 `@earendil-works/pi-coding-agent`：

- `/api/plugins` — `DefaultPackageManager`
- `/api/skills/*` — `DefaultPackageManager`
- `/api/models-config/test` — `ModelRuntime`
- `transports/sdk.ts` — 核心 Pi SDK
- `graph.ts` — `getWorkAgentGraph()` / `getPiSubAgent()`

### 6.6 思考层级（Thinking Level）配置

Pi 特有功能，在 `useAgentSession.ts` 中管理：

```typescript
// ThinkingLevelOption
type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
```

`/api/models` 返回 `thinkingLevelMaps` 和 `thinkingLevelPins`，用于模型级思考层级配置。

---

## 七、建议的融合策略

### 7.1 总体融合原则

```
Pi = AI Capability Reference（成熟的 AI 能力参考实现）
ProjectHub = AI SaaS System of Record（业务真相源）
```

### 7.2 分层融合方案

#### Layer 1：类型统一（低风险，高价值）🟢

**目标**：消除 `lib/api-types.ts` 对 `features/ai/ui/` 的反向依赖

**做法**：
1. 将 `features/ai/ui/ai-workspace/lib/api-types.ts` 中的类型移入 `lib/api-types.ts`
2. `features/ai/ui/ai-workspace/lib/api-types.ts` 改为 re-export `lib/api-types.ts`
3. 同理处理 `model-catalog.ts` 和 `model-discovery.ts` 的 re-export

**受益**：
- 消除循环依赖
- `lib/` 保持为最底层

#### Layer 2：凭证管理统一（中等风险，高价值）🟡

**目标**：消除 `transports/sdk.ts` 中重复的 Prisma 查询逻辑

**做法**：
1. 让 `transports/sdk.ts` 调用 `api-key-store.ts` 的 `resolveCredentialWithFallback()`
2. 移除 `transports/sdk.ts` 中直接写 Prisma 查询的代码
3. 统一凭证查询路径

**受益**：
- 凭证管理逻辑集中
- 便于未来增加 Provider 级别的 fallback 逻辑

#### Layer 3：models.json vs Prisma 决策（高风险，需讨论）🔴

**问题**：`ModelsConfig.tsx` 直接读写 `models.json`，而 ProjectHub 用 Prisma 存储凭证。两套系统如何共存？

**候选方案**：

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A：Prisma 为主** | 所有配置存 Prisma，Pi SubAgent 读 Prisma | 统一管理、便于审计 | 放弃 Pi 原生 models.json |
| **B：Pi 为主** | 保留 models.json，ProjectHub 通过 Pi SDK 间接管理 | 最小改动 | 配置分散，两套系统 |
| **C：分层桥接** | Prisma 管理凭证，Pi 保留模型元数据（cost/compat） | 各取所长 | 复杂度高 |
| **D：逐步迁移** | Phase 1 保留双写，Phase 2 统一到 Prisma | 风险可控 | 迁移周期长 |

**推荐**：方案 C（分层桥接），原因：
- 凭证（apiKey/baseURL/transport）天然适合 DB + 加密存储
- 模型元数据（cost/contextWindow/thinkingLevel）适合 JSON 文件（灵活、版本化）
- Pi SDK 的 `ModelRuntime` 需要 `models.json` 路径，可以保留

#### Layer 4：Plugin/Skill 配置（低优先级）🟡

**建议**：保持现状（`DefaultPackageManager` + Pi SDK），不做融合。

理由：
- Plugin/Skill 是 Pi 的核心能力，与 ProjectHub 业务无关
- 独立管理更清晰

### 7.3 融合路线图

```
Phase 0（立即可做）:
  ├── [P0] 消除循环依赖：lib/api-types.ts 重构
  └── [P0] 统一 re-export：features/ai/ui/lib/*.ts 只 re-export，不定义类型

Phase 1（1-2 周）:
  ├── [P1] 统一凭证查询：transports/sdk.ts → api-key-store.ts
  └── [P1] models-config API 保留（Pi UI 仍使用）

Phase 2（需讨论决策）:
  ├── [P2] 决定 models.json 策略（方案 A/B/C/D）
  ├── [P2] 评估 ModelsConfig.tsx 重构方案
  └── [P2] Agnes 硬编码模型迁移策略

Phase 3（长期）:
  ├── [P3] ProjectHub AI Settings UI 重构（合并 Pi 和 ProjectHub 配置）
  └── [P3] 文档和测试补全
```

### 7.4 关键依赖项

| 依赖 | 来源 | 影响 |
|------|------|------|
| `@earendil-works/pi-coding-agent` | Pi SDK | 广泛依赖，不能轻易替换 |
| `models.json` 文件系统路径 | Pi SDK | 迁移需要 Pi SDK 配合 |
| Prisma `UserApiKey` 表 | ProjectHub | 核心凭证表，结构稳定 |
| `DefaultPackageManager` | Pi SDK | Plugin/Skill 管理依赖 |

---

## 八、附录

### A. 文件清单（按行数排序）

| 文件 | 行数 | 分类 |
|------|------|------|
| `features/ai/ui/ai-workspace/ModelsConfig.tsx` | 2317 | Pi UI |
| `features/ai/ui/ai-workspace/AppShell.tsx` | 2308 | Pi UI |
| `features/ai/ui/ai-workspace/hooks/useAgentSession.ts` | 1951 | Pi UI |
| `features/ai/ui/ai-workspace/SkillsConfig.tsx` | 1402 | Pi UI |
| `features/ai/ui/ai-workspace/PluginsConfig.tsx` | 1092 | Pi UI |
| `features/ai/agents/work/subagents/pi/transports/sdk.ts` | 811 | Pi SubAgent |
| `features/ai/agents/work/subagents/pi/events.ts` | 321 | Pi SubAgent |
| `features/ai/agents/work/graph.ts` | 408 | Work Agent |
| `features/ai/llm/providers/registry.ts` | 442 | ProjectHub LLM |
| `features/ai/llm/credentials/api-key-store.ts` | 481 | ProjectHub LLM |
| `features/ai/llm/summarizer.ts` | 611 | ProjectHub LLM |
| `features/ai/llm/image-generator.ts` | 433 | ProjectHub LLM |
| `features/ai/llm/video-generator.ts` | 379 | ProjectHub LLM |
| `app/api/plugins/route.ts` | 366 | API |
| `app/api/ai/providers/route.ts` | 295 | API |
| `app/api/ai/work/run/route.ts` | 286 | API |
| `features/ai/agents/work/subagents/types.ts` | 261 | Pi SubAgent |
| `features/ai/agents/work/subagents/pi/runtime.ts` | 191 | Pi SubAgent |
| `features/ai/agents/work/subagents/pi/subagent.ts` | 192 | Pi SubAgent |
| `features/ai/ui/model-select/useApiKeys.ts` | 136 | ProjectHub UI |
| `lib/model-catalog.ts` | 415 | 共享库 |
| `lib/models-config-store.ts` | 92 | 共享库 |
| `lib/model-discovery.ts` | 93 | 共享库 |
| `lib/api-types.ts` | 22 | 共享库 |
| `app/api/models-config/test/route.ts` | 122 | API |
| `app/api/models-config/discover/route.ts` | 89 | API |
| `app/api/models-config/catalog/route.ts` | 79 | API |
| `app/api/models-config/route.ts` | 19 | API |
| `app/api/ai/models/route.ts` | 26 | API |
| `app/api/models/route.ts` | 27 | API |

### B. Prisma 模型依赖

```
UserApiKey (credentials)
  ├── ← api-key-store.ts (write/read)
  ├── ← transports/sdk.ts (setupCredentials)
  └── ← registry.ts (getEnabledModels)

AiConversation / AiChatMessage (history)
  └── ← summarizer.ts

AiFileAsset (storage)
  ├── ← image-generator.ts
  └── ← video-generator.ts

BackgroundJob / JobOutput (async)
  └── ← image-generator.ts / video-generator.ts
```

### C. 环境变量依赖

| 变量 | 用途 | 使用位置 |
|------|------|----------|
| `AI_DEFAULT_PROVIDER` | Agnes 默认 Provider | `model-runtime-config.ts` |
| `AI_DEFAULT_MODEL` | Agnes 默认模型 | `model-runtime-config.ts` |
| `AI_GATEWAY_BASE_URL` | Agnes Gateway URL | `model-runtime-config.ts` |
| `AGNES_API_KEY` | Agnes API Key（fallback） | `api-key-store.ts` |
| `HTTPS_PROXY` | 代理配置 | `agnes/proxy.ts` |
