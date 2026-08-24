# AI Config 融合架构分析

> **角色**：ai-learning-mentor（软层审查）
> **分析日期**：2026-08-21
> **版本**：v1.0

---

## 一、现状分析

### 1.1 双系统架构全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Pi Web UI 系统                               │
│  features/ai/ui/ai-workspace/                                       │
│  ├── ModelsConfig.tsx (2317行) ←── 全套模型配置 UI                  │
│  ├── lib/model-catalog.ts  ←── 重导出 @/lib/model-catalog          │
│  ├── lib/model-discovery.ts ←── 重导出 @/lib/model-discovery        │
│  ├── models-config-helpers.ts ←── UI 层成本解析辅助                  │
│  └── models-config-store.ts ←── 读写 Pi Agent 目录的 models.json   │
└─────────────────────────────────────────────────────────────────────┘
                              ↕ 循环依赖
┌─────────────────────────────────────────────────────────────────────┐
│                     ProjectHub 业务系统                             │
│  lib/                                                                │
│  ├── model-catalog.ts (415行) ←── 完整模型目录（含定价/共识/匹配）     │
│  ├── model-discovery.ts (79行) ←── API 响应解析                     │
│  ├── models-config-store.ts ←── 包装 Pi store（通过 pi-coding-agent）│
│  └── models-cache.ts ←── 缓存层                                     │
│                                                                       │
│  app/api/ai/                                                         │
│  ├── providers/route.ts (295行) ←── 凭证 CRUD + 连接测试           │
│  └── models/route.ts (26行) ←── 动态模型发现                        │
│                                                                       │
│  features/ai/llm/                                                    │
│  ├── providers/registry.ts (442行) ←── 核心模型注册表                │
│  ├── credentials/api-key-store.ts (481行) ←── 加密存储 + 三级降级    │
│  └── providers/types.ts ←── 类型定义                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 功能重叠矩阵

| 功能模块 | Pi 实现 | ProjectHub 实现 | 重叠程度 |
|---------|--------|----------------|---------|
| **Provider 配置** | ❌ 无独立实现 | ✅ `api-key-store.ts` (481行)<br>DB 加密存储，三级降级链路 | **无重叠** |
| **Model Discovery** | ⚠️ 仅重导出 | ✅ `model-discovery.ts`<br>API 响应解析 + 智能容错 | **Pi 100% 依赖 PH** |
| **Model Catalog** | ⚠️ 仅重导出 | ✅ `model-catalog.ts` (415行)<br>完整定价 + 共识 + provider 匹配 | **Pi 100% 依赖 PH** |
| **Credential 存储** | ❌ 无 | ✅ `UserApiKey` 表<br>加密存储 + soft-delete | **无重叠** |
| **Thinking/Reasoning** | ⚠️ `reasoning?: boolean` | ✅ `inferCapabilities()` 推断<br>`registry.ts` 支持 | **Pi 元数据已含，PH 逻辑更强** |
| **模型设置 UX** | ✅ `ModelsConfig.tsx` (2317行)<br>完整配置 UI | ❌ 无独立配置页 | **Pi 成熟度 >> PH** |
| **Provider Registry UI** | ❌ 无 | ✅ `ProvidersConfig.tsx`<br>用户级 Provider 配置 | **PH 独立实现** |

### 1.3 关键发现

1. **Pi 已深度依赖 ProjectHub**
   - `model-catalog.ts` 和 `model-discovery.ts` 都是重导出
   - `models-config-store.ts` 内部调用 `@earendil-works/pi-coding-agent`

2. **循环依赖风险**
   ```
   Pi lib/ → 重导出 @/lib/model-catalog → 实际执行 lib/model-catalog.ts
   lib/models-config-store.ts → 调用 @earendil-works/pi-coding-agent → 依赖 Pi
   ```

3. **Pi 的真正价值在于 UX**
   - `ModelsConfig.tsx` 是完整模型配置界面（2317行）
   - 包含 provider 图标映射（40+ provider）、成本表单、模型预览

4. **ProjectHub 的真正价值在于数据层**
   - DB 持久化（`UserApiKey` 表）
   - 三级凭证降级（SYSTEM → USER → ENV）
   - 动态模型发现（`discoverModelsFromAPI`）
   - AI SDK 集成（createModel + fetch 包装）

---

## 二、融合边界决策

### 2.1 核心原则

```
┌────────────────────┐      ┌─────────────────────────────────────┐
│  Pi = Capability    │      │  ProjectHub = System of Record      │
│  Reference (UX)    │ ───▶ │  (数据层 + 业务逻辑)                 │
└────────────────────┘      └─────────────────────────────────────┘
       负责                     负责
  • 模型配置 UI               • DB 持久化
  • Provider 图标映射         • 凭证加密存储
  • 成本表单交互              • 三级降级链路
  • 模型预览/搜索             • 动态模型发现
  • 运行时配置读取            • AI SDK 集成
```

### 2.2 "谁设计 / 谁存储" 决策表

| 模块 | 存储位置 | 设计位置 | 理由 |
|------|----------|----------|------|
| Provider 配置 | **ProjectHub DB** | ProjectHub | 凭证必须加密存 DB |
| Model Discovery | **ProjectHub DB** | ProjectHub | 动态发现 + 缓存 |
| Model Catalog 元数据 | **ProjectHub DB** | ProjectHub | 定价/共识需要持久化 |
| 模型运行时配置 | **Pi models.json** | **Pi** | 运行时偏好（可丢失） |
| Provider 图标 | N/A | **Pi** | 纯展示资源 |
| 成本表单数据 | **ProjectHub DB** | **Pi UX** | UI 在 Pi，存储在 PH |

---

## 三、KEEP / ADAPT / MERGE / REFACTOR / REMOVE 矩阵

### 3.1 模块分类

| 模块 | 当前路径 | 分类 | 理由 | 行动 |
|------|----------|------|------|------|
| **Model Catalog** | `lib/model-catalog.ts` | **KEEP** | 完整定价 + 共识算法，Pi 已依赖 | 保持，扩展功能 |
| **Model Discovery** | `lib/model-discovery.ts` | **KEEP** | API 解析逻辑，Pi 已依赖 | 保持，合并到 registry |
| **Provider Registry** | `features/ai/llm/providers/registry.ts` | **KEEP** | 核心注册逻辑，AI SDK 集成 | 保持，清理重复代码 |
| **Credential Store** | `features/ai/llm/credentials/api-key-store.ts` | **KEEP** | DB 加密存储，三级降级 | 保持，唯一真相源 |
| **Models Config Store** | `lib/models-config-store.ts` | **REFACTOR** | 当前包装 Pi，改为包装 DB | 迁移到 DB |
| **Models Config Helpers** | `features/ai/ui/ai-workspace/models-config-helpers.ts` | **KEEP** | UI 辅助函数，与 Pi UX 紧耦合 | 保持 |
| **Models Config Route** | `app/api/models-config/route.ts` | **REFACTOR** | 当前读写 Pi 文件，改为读写 DB | 迁移到 DB |
| **Models API Route** | `app/api/ai/models/route.ts` | **MERGE** | 合并到 registry 逻辑 | 与 registry 合并 |
| **Providers API Route** | `app/api/ai/providers/route.ts` | **KEEP** | 完整 CRUD，逻辑清晰 | 保持，作为唯一入口 |
| **Pi lib/model-catalog.ts** | `features/ai/ui/ai-workspace/lib/model-catalog.ts` | **REMOVE** | 仅重导出，无实际逻辑 | 删除重导出 |
| **Pi lib/model-discovery.ts** | `features/ai/ui/ai-workspace/lib/model-discovery.ts` | **REMOVE** | 仅重导出，无实际逻辑 | 删除重导出 |

### 3.2 详细决策理由

#### ✅ KEEP: `lib/model-catalog.ts`
- 415 行完整实现，含共识算法、provider 匹配
- Pi 的 UI 已通过重导出使用此文件
- 未来扩展定价推荐、模型对比等功能的基础

#### ✅ KEEP: `features/ai/llm/credentials/api-key-store.ts`
- 唯一凭证存储层，DB 加密
- 三级降级链路（SYSTEM → USER → ENV）
- `UserApiKey` 表是 ProjectHub 的核心数据资产

#### ⚠️ REFACTOR: `lib/models-config-store.ts`
**问题**：当前包装 `@earendil-works/pi-coding-agent`，读取 Pi 目录的 `models.json`
**目标**：改为直接读写 DB 或缓存表

```ts
// 当前实现（问题）
async function getAgentDir() {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  return getAgentDir();
}

// 目标实现（迁移后）
async function getModelsConfig() {
  // 从 DB 或缓存读取，与 Pi 解耦
}
```

#### ❌ REMOVE: Pi 重导出文件
- `features/ai/ui/ai-workspace/lib/model-catalog.ts`
- `features/ai/ui/ai-workspace/lib/model-discovery.ts`

这两个文件只是 `export * from "@/lib/..."`，没有任何实际逻辑。Pi 组件应直接 import ProjectHub 的模块。

---

## 四、最终目录结构

### 4.1 融合后目标结构

```
features/ai/
├── llm/                          # LLM 核心层（ProjectHub 主导）
│   ├── providers/
│   │   ├── registry.ts          # ✅ 模型注册表 + 动态发现
│   │   ├── types.ts             # ✅ 类型定义
│   │   └── init.ts              # ✅ 初始化逻辑
│   ├── credentials/
│   │   ├── api-key-store.ts     # ✅ 凭证存储（DB 加密）
│   │   └── encryption.ts        # ✅ 加密工具
│   └── model-catalog/           # 🆕 模型目录子模块
│       ├── catalog.ts           # 定价 + 共识 + provider 匹配
│       ├── discovery.ts         # API 解析 + 模型发现
│       └── types.ts             # 目录类型定义
│
├── ui/
│   ├── model-select/            # 已有：模型选择器 UI
│   ├── providers-config/        # 🆕 Provider 配置 UI（复用 Pi UX）
│   │   ├── ProvidersConfig.tsx  # Provider 列表 + 添加表单
│   │   ├── ProviderCard.tsx     # 单个 Provider 卡片
│   │   └── hooks/               # 关联 hooks
│   └── ai-workspace/             # Pi Workspace UI（保留）
│       ├── ModelsConfig.tsx     # ✅ 完整模型配置 UI（Pi 设计）
│       ├── lib/                 # 清理后只保留 Pi 特有逻辑
│       │   ├── pi-types.ts     # Pi 特有类型
│       │   ├── streaming-message.ts
│       │   └── ...
│       └── models-config-helpers.ts  # ✅ UI 辅助函数

lib/
├── model-catalog.ts             # ⚠️ 迁移到 features/ai/llm/model-catalog/
├── model-discovery.ts           # ⚠️ 迁移到 features/ai/llm/model-catalog/
├── models-config-store.ts       # ⚠️ 改为 DB 包装，不依赖 Pi
└── models-cache.ts             # ✅ 保持，缓存层
```

### 4.2 文件迁移清单

| 操作 | 源路径 | 目标路径 |
|------|--------|----------|
| 迁移 | `lib/model-catalog.ts` | `features/ai/llm/model-catalog/catalog.ts` |
| 迁移 | `lib/model-discovery.ts` | `features/ai/llm/model-catalog/discovery.ts` |
| 重构 | `lib/models-config-store.ts` | 直接读 DB，不依赖 Pi |
| 删除 | `features/ai/ui/ai-workspace/lib/model-catalog.ts` | - |
| 删除 | `features/ai/ui/ai-workspace/lib/model-discovery.ts` | - |

---

## 五、Discover / Catalog / Resolver 关系

### 5.1 三者职责边界

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Discover（发现层）                               │
│  lib/model-discovery.ts                                             │
│                                                                      │
│  职责：从 Provider API 拉取模型列表，解析响应                        │
│  输入：Provider baseURL + API Key                                    │
│  输出：DiscoveredModel[]（id, name）                                 │
│                                                                      │
│  关键函数：                                                          │
│  • parseDiscoveredModels(value) → 从 /v1/models 响应提取模型列表     │
│  • buildModelsListUrl(baseUrl, api) → 构造正确端点                   │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     Catalog（目录层）                               │
│  lib/model-catalog.ts                                               │
│                                                                      │
│  职责：管理模型元数据（定价、能力、上下文窗口）                       │
│  输入：Discover 发现的模型 + 外部定价数据                            │
│  输出：ModelCatalogEntry[]（含完整元数据）                            │
│                                                                      │
│  关键函数：                                                          │
│  • recommendModelCatalogPreset() → 推荐定价策略                      │
│  • searchModelCatalog() → 搜索 + 排序                                │
│  • flattenModelsDevCatalog() → 解析外部配置                         │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                     Resolver（解析层）                               │
│  features/ai/llm/credentials/api-key-store.ts                       │
│                                                                      │
│  职责：解析实际调用的凭证（三级降级）                                │
│  输入：userId + provider                                             │
│  输出：CredentialRecord（baseURL + apiKey + transport + apiFormat）  │
│                                                                      │
│  关键函数：                                                          │
│  • resolveCredential() → USER key 优先                              │
│  • resolveCredentialWithFallback() → SYSTEM → USER → ENV 降级        │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 数据流向图

```
用户选择 Provider + Model
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Resolver（凭证解析）                                             │
│    resolveCredential(userId, provider)                              │
│    └── CredentialRecord { baseURL, apiKey, transport }             │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Discover（模型发现）                                             │
│    discoverModelsFromAPI(provider, baseURL, apiKey)                 │
│    └── DiscoveredModel[]                                            │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Catalog（目录查询）                                              │
│    searchModelCatalog(entries, query, providerHint)                 │
│    recommendModelCatalogPreset(entries, modelId, providerHint)      │
│    └── ModelCatalogEntry[] + PriceRecommendation                    │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Registry（模型实例化）                                           │
│    createModel(userId, modelRef)                                    │
│    └── AI SDK Model Instance                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 关键约束

1. **Discover 不存 DB**：只负责拉取和解析，不持久化
2. **Catalog 可缓存**：元数据变更频率低，可缓存
3. **Resolver 唯一凭证源**：所有模型调用必须经过此层
4. **Catalog 依赖 Discover**：目录条目由 Discover 发现的模型填充

---

## 六、推荐迁移顺序

### P0（阻塞级，必须先做）

#### P0-1: 解耦 `models-config-store.ts`
**当前问题**：`lib/models-config-store.ts` 依赖 `@earendil-works/pi-coding-agent`，循环依赖

**目标**：移除 Pi 依赖，改为：
1. 直接从 DB 读取 Provider 配置
2. 或使用内存缓存（与 Pi models.json 同步）

```ts
// 迁移后：lib/models-config-store.ts
export async function readModelsConfig(): Promise<Record<string, unknown>> {
  // 方案 A：从 DB 读取
  // 方案 B：内存缓存 + Pi 文件同步
  // 方案 C：完全移除，仅保留 catalog/discovery
}
```

#### P0-2: 删除 Pi 重导出文件
**操作**：
```bash
rm features/ai/ui/ai-workspace/lib/model-catalog.ts
rm features/ai/ui/ai-workspace/lib/model-discovery.ts
```

**影响**：Pi 组件需改为直接 import `@/lib/model-catalog` 和 `@/lib/model-discovery`

---

### P1（核心功能，完成后可用）

#### P1-1: 迁移 Catalog 到 features/ai/llm/
**操作**：
```bash
mkdir features/ai/llm/model-catalog/
mv lib/model-catalog.ts features/ai/llm/model-catalog/catalog.ts
mv lib/model-discovery.ts features/ai/llm/model-catalog/discovery.ts
```

**更新引用**：
- `lib/model-catalog.ts` → 重导出 `features/ai/llm/model-catalog/catalog.ts`
- Pi UI → 更新 import 路径

#### P1-2: 扩展 Catalog 类型
**新增**：
- `ModelCatalogEntry` 扩展字段：`capabilities`, `contextWindow`, `maxTokens`
- 与 `registry.ts` 的 `ModelCatalogEntry` 统一

---

### P2（优化级，提升体验）

#### P2-1: 复用 Pi `ModelsConfig.tsx` UX
**当前**：`features/ai/ui/model-select/` 有独立的模型选择器

**目标**：
1. 将 `ModelsConfig.tsx` 的 Provider 配置部分提取为 `ProvidersConfig.tsx`
2. 复用 `provider-icons` 映射（40+ provider）
3. 集成到 ProjectHub 的设置页面

#### P2-2: 统一凭证 UI
**当前**：
- Pi 无凭证 UI
- ProjectHub 有 `ProvidersConfig.tsx`

**目标**：
- 合并两套 UI
- 使用 Pi 的 Provider 图标
- 保持 ProjectHub 的 DB 存储逻辑

---

## 七、风险评估

### 7.1 高风险（必须解决）

| 风险 | 描述 | 影响 | 缓解措施 |
|------|------|------|----------|
| **循环依赖** | `lib/models-config-store.ts` → `@earendil-works/pi-coding-agent` | 构建失败、功能异常 | P0-1 立即解耦 |
| **Pi 重导出空洞** | Pi 组件可能 import 已删除的重导出文件 | 运行时错误 | P0-2 同步更新引用 |

### 7.2 中风险（需要关注）

| 风险 | 描述 | 影响 | 缓解措施 |
|------|------|------|----------|
| **类型不统一** | `registry.ts` 的 `ModelCatalogEntry` vs `catalog.ts` 的同名类型 | TS 类型冲突 | P1-2 统一类型定义 |
| **Pi Agent 目录依赖** | `getAgentDir()` 从 Pi 包获取 | Pi 包变更导致路径错误 | P1-1 迁移后消除 |

### 7.3 低风险（可接受）

| 风险 | 描述 | 影响 | 缓解措施 |
|------|------|------|----------|
| **迁移成本** | 文件移动 + import 更新 | 开发时间 | 分批次迁移，每次验证 |
| **Pi UI 适配** | Pi 组件需更新 import 路径 | 测试时间 | 批量搜索替换 |

---

## 八、验收标准检查表

### P0 验收

- [ ] `lib/models-config-store.ts` 不再 import `@earendil-works/pi-coding-agent`
- [ ] `features/ai/ui/ai-workspace/lib/model-catalog.ts` 已删除
- [ ] `features/ai/ui/ai-workspace/lib/model-discovery.ts` 已删除
- [ ] Pi 组件可直接 import `@/lib/model-catalog` 和 `@/lib/model-discovery`
- [ ] `npm run build` 通过，无循环依赖警告

### P1 验收

- [ ] `features/ai/llm/model-catalog/` 目录存在
- [ ] `lib/model-catalog.ts` 重导出新路径
- [ ] `registry.ts` 与 `catalog.ts` 类型定义无冲突
- [ ] `npm run type-check` 通过

### P2 验收

- [ ] `ProvidersConfig.tsx` 复用 Pi Provider 图标映射
- [ ] 模型配置页面可正常添加/删除 Provider
- [ ] 模型发现功能正常（动态从 API 拉取模型列表）

---

## 九、附录

### A. 相关文件清单

**ProjectHub 核心文件**：
- `lib/model-catalog.ts` — 模型目录（415行）
- `lib/model-discovery.ts` — 模型发现（79行）
- `lib/models-config-store.ts` — 配置存储（包装 Pi）
- `features/ai/llm/providers/registry.ts` — 模型注册表（442行）
- `features/ai/llm/credentials/api-key-store.ts` — 凭证存储（481行）
- `app/api/ai/providers/route.ts` — Provider API（295行）
- `app/api/ai/models/route.ts` — 模型 API（26行）

**Pi UI 文件**：
- `features/ai/ui/ai-workspace/ModelsConfig.tsx` — 模型配置 UI（2317行）
- `features/ai/ui/ai-workspace/lib/model-catalog.ts` — 重导出
- `features/ai/ui/ai-workspace/lib/model-discovery.ts` — 重导出
- `features/ai/ui/ai-workspace/models-config-helpers.ts` — UI 辅助

### B. 关键类型定义

```ts
// lib/model-catalog.ts
interface ModelCatalogEntry {
  key: string;
  providerId: string;
  providerName: string;
  providerBaseUrl?: string;
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost: ModelCatalogCost;
}

// features/ai/llm/providers/registry.ts
interface ModelCatalogEntry {
  id: string;
  modelName: string;
  displayName: string;
  modelRef: string;
  capabilities: string[];
  enabled: boolean;
  provider: string;
  apiFormat: ApiFormat;
  ownerType: "SYSTEM" | "USER";
}
```

> ⚠️ **类型冲突**：两处 `ModelCatalogEntry` 结构不同，需要 P1-2 统一

### C. 融合检查点

1. **2026-08-21**：完成架构分析（本文档）
2. **P0**：解耦 models-config-store + 删除重导出
3. **P1**：迁移 catalog 到 features/ai/llm/
4. **P2**：复用 Pi UX + 统一凭证 UI
