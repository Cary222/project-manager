# Unified Model Registry — 重构方案

## 目标

彻底拆掉 Site / Workspace 双套模型体系，统一为：

```
Site DB 模型配置（UserApiKey + 动态发现模型）
            ↓
      Unified Model Registry
            ↓
   ┌────────┴────────┐
   ↓                 ↓
完整设置           AI Workspace
Pi 模型配置 UI      Model Selector
                       +
                 本地 model.json
```

## 核心规则

1. **DB 是站点模型唯一主数据源** — UserApiKey + 动态 Discovery
2. **AI Workspace 先加载 DB 模型，再加载本地 `model.json`，合并后生成 Provider/Model 列表**
3. `model.json` 只属于本地 Workspace，**不再把站点模型同步写入 `model.json`**
4. **删除** `blockedInheritedNames`、`hiddenProviders`、`syncSiteModelsToWorkspace` 及所有继承逻辑
5. `UserAiModelPreference` 只保留模型偏好（enabled/favorite/thinkingLevel 等）
6. Settings 和 AI Workspace 共用同一个 Site Model Registry

## 改动文件清单

### Tier 1 — 核心 Registry 重构

| 文件 | 改动 |
|------|------|
| `features/ai/llm/providers/registry.ts` | 保持不变（DB → Discovery 链路） |
| `features/ai/llm/credentials/api-key-store.ts` | 保持不变（凭证 CRUD） |
| `features/ai/llm/preferences/user-model-preferences.ts` | **删除** `hiddenProviders` 相关逻辑 |
| `features/ai/llm/providers/user-providers.ts` | 保持不变 |
| `features/ai/llm/model-runtime-config.ts` | 保持不变 |

### Tier 2 — Adapter 层重构

| 文件 | 改动 |
|------|------|
| `features/ai/ui/ai-workspace/models-config-adapter.ts` | **彻底重写**：移除继承逻辑，改为 site DB 只读 + local model.json 合并 |
| `features/ai/ui/model-settings/adapter.tsx` | **删除** `isInherited` 方法定义 |

### Tier 3 — API 层重构

| 文件 | 改动 |
|------|------|
| `app/api/models/route.ts` | **重写**：`syncSiteModelsToWorkspace` → 直接加载 site DB + model.json 合并 |
| `app/api/models-config/route.ts` | 保持不变（只读写 model.json） |
| `app/api/ai/providers/route.ts` | 保持不变 |
| `app/api/ai/models/route.ts` | 保持不变 |

### Tier 4 — 数据库迁移

| 文件 | 改动 |
|------|------|
| `prisma/schema.prisma` | **删除** `hiddenProviders` 字段 |
| `prisma/migrations/` | 新增 migration 移除字段 |

### Tier 5 — 清理 legacy 代码

| 文件 | 改动 |
|------|------|
| `lib/rpc-manager.ts` | **删除** `syncSiteModelsToWorkspace` 调用 |
| `features/ai/ui/ai-workspace/models-config-adapter.test.ts` | 更新测试 |

## 详细实现

### 1. Unified Site Registry（新函数）

```typescript
// lib/unified-model-registry.ts

export interface UnifiedModelEntry {
  provider: string;
  modelName: string;
  modelRef: string; // "provider:modelName"
  displayName: string;
  capabilities: ModelCapability[];
  apiFormat: ApiFormat;
  source: "site" | "local";
}

export interface UnifiedProviderEntry {
  provider: string;
  baseURL: string | null;
  apiFormat: ApiFormat;
  apiKey?: string;
  models: UnifiedModelEntry[];
  source: "site" | "local";
}

/**
 * 统一模型注册表：Site DB + Local model.json 合并
 * 
 * 合并规则：
 * 1. Site DB models（只读）：来自 UserApiKey + Discovery
 * 2. Local model.json（本地覆盖）：用户本地配置的 Provider/Model
 * 3. 优先级：Local > Site（同名 provider 时 local 覆盖）
 */
export async function getUnifiedSiteModels(userId: string): Promise<UnifiedProviderEntry[]>
export async function getUnifiedSiteModelList(userId: string): Promise<UnifiedModelEntry[]>
```

### 2. PiWorkspaceAdapter 重写

原 `load()` 7 步复杂逻辑 → 简化为 3 步：

```typescript
// 新 load() 逻辑
async load(): Promise<ModelsJson> {
  // 1. 读取本地 model.json
  const localConfig = await fetch("/api/models-config").then(r => r.json());
  
  // 2. 读取 Site DB 模型（只读）
  const siteModels = await getUnifiedSiteModels(userId);
  
  // 3. 合并：Local 覆盖 Site
  const merged = mergeSiteAndLocal(siteModels, localConfig);
  return merged;
}
```

**删除**：
- `blockedInheritedNames` / `inheritedNames`
- `loadHiddenInheritedProviders()` / `saveHiddenInheritedProviders()`
- `loadSiteInheritedConfig()`
- `isInherited()` 方法
- `remove()` 中的隐藏逻辑
- `syncSiteModelsToWorkspace` 函数

### 3. /api/models/route.ts 重写

原逻辑：
```
syncSiteModelsToWorkspace(cwd) → getModelRuntime → resolveVisibleModels
```

新逻辑：
```
getUnifiedSiteModels(userId) + getLocalModels(cwd) → merge → resolveVisibleModels
```

### 4. UserAiModelPreference 清理

删除字段：
- `hiddenProviders` (JSON array)

保留字段：
- `enabled` (Boolean)
- `favorite` (Boolean)
- `thinkingLevel` (String?)
- `temperature` (Float?)
- `maxTokens` (Int?)

### 5. Database Migration

```sql
-- 删除 hiddenProviders 字段
ALTER TABLE "pm"."UserAiModelPreference" DROP COLUMN IF EXISTS "hiddenProviders";
```

## 实施顺序

1. **Phase 1**: 创建 `lib/unified-model-registry.ts`
2. **Phase 2**: 重写 `models-config-adapter.ts`（PiWorkspaceAdapter）
3. **Phase 3**: 重写 `/api/models/route.ts`
4. **Phase 4**: 删除 `hiddenProviders` 相关代码（preferences、API route）
5. **Phase 5**: Database migration
6. **Phase 6**: 清理 `rpc-manager.ts` 中的 `syncSiteModelsToWorkspace`
7. **Phase 7**: 更新测试文件
8. **Phase 8**: 构建验证

## 风险与回滚

- **风险 1**: 删除 `syncSiteModelsToWorkspace` 后，历史 sessions 的模型列表可能变化
  - **缓解**: 新逻辑在 `/api/models` 层面合并，兼容旧 sessions
- **风险 2**: `hiddenProviders` 删除后，历史用户偏好数据丢失
  - **缓解**: Migration 前备份数据
- **风险 3**: Pi SDK 的 `ModelRuntime` 仍然只读 `model.json`
  - **缓解**: 保持 `/api/models-config` 完整功能，用户可继续配置本地模型
