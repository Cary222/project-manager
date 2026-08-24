/**
 * Models Cache — Workspace Scope 的模型缓存
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - Workspace 模型的缓存（loadModelsWithCache）
 *   - 缓存失效（invalidateModelsCache）
 *   - 错误处理（withModelRuntimeError, withSafeModelLoadFailure）
 *
 * ❌ 不负责：
 *   - User 模型的缓存（由 user-models-cache.ts 提供）
 *   - 模型发现（由 registry.ts / model-discovery.ts 提供）
 *   - 模型价格元数据（由 model-catalog.ts 提供）
 *
 * =============================================================================
 * 为什么 User / Workspace Cache 不应该合并
 * =============================================================================
 * Workspace Cache（models-cache.ts）和 User Cache（user-models-cache.ts）必须保持隔离：
 *
 * 1. 缓存 Key 不同：
 *    - Workspace Cache Key：`cwd`（项目目录路径）
 *    - User Cache Key：`userId`（用户 ID）
 *
 * 2. 缓存 TTL 不同：
 *    - Workspace Cache TTL：60 秒（模型配置可能频繁变更）
 *    - User Cache TTL：5 分钟（用户配置相对稳定）
 *
 * 3. 失效触发不同：
 *    - Workspace Cache：cwd 变更时失效
 *    - User Cache：Provider CRUD 时失效（通过 generation counter）
 *
 * 4. 数据来源不同：
 *    - Workspace：models.json（Pi Workspace 文件）
 *    - User：UserApiKey DB（ProjectHub 数据库）
 *
 * 5. 服务对象不同：
 *    - Workspace Cache：PiSubAgent
 *    - User Cache：Chat / WorkAgent
 *
 * 合并的代价：
 * - 缓存 key 复杂度增加
 * - TTL 管理困难
 * - 失效逻辑混乱
 * - 没有明显收益
 *
 * =============================================================================
 * 缓存策略
 * =============================================================================
 * 1. TTL：60 秒
 *    - Pi 模型配置可能频繁变更
 *    - 60 秒足够平衡性能和一致性
 *
 * 2. 最大条目：32
 *    - 防止内存泄漏
 *    - LRU 淘汰策略
 *
 * 3. In-flight 请求去重：
 *    - 相同 cwd 的并发请求共享同一个 Promise
 *    - 避免重复加载
 *
 * 4. Generation Counter：
 *    - 变更时递增
 *    - 简化失效逻辑
 *
 * =============================================================================
 * ModelsData vs ModelCatalogEntry
 * =============================================================================
 * ModelsData（Workspace）：
 * - 来源：Pi ModelRuntime
 * - 包含：thinkingLevels、thinkingLevelPins、defaultModel
 * - 服务：PiSubAgent
 *
 * ModelCatalogEntry（User）：
 * - 来源：Provider API Discovery
 * - 包含：capabilities、apiFormat、ownerType
 * - 服务：Chat / WorkAgent
 *
 * =============================================================================
 * Discovery 链路
 * =============================================================================
 * /api/models
 *   → loadModelsWithCache(cwd, loader)    [models-cache.ts] ← 本文件
 *   → loadModels(cwd)                     [app/api/models/route.ts]
 *   → getModelRuntime(cwd)                [model-discovery.ts]
 *   → resolveVisibleModels(runtime)       [model-scope.ts]
 */

export interface ModelsData {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string }[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  /** `provider/modelId` → thinking level pinned by an `enabledModels` `:level` suffix. */
  thinkingLevelPins: Record<string, string>;
  modelError?: string;
  /** Warnings from resolving the `enabledModels` scope (e.g. a pattern matched nothing). */
  modelScopeWarnings?: string[];
}

interface ModelsCacheState {
  entries: Map<string, { data: ModelsData; expiresAt: number }>;
  inFlight: Map<string, Promise<ModelsData>>;
  generation: number;
}

declare global {
  var __piModelsCacheState: ModelsCacheState | undefined;
}

const MODELS_CACHE_TTL_MS = 60_000;
const MAX_MODELS_CACHE_ENTRIES = 32;
// Never interpolate the caught error here; SDK errors can contain paths and provider details.
const SAFE_MODEL_LOAD_FAILURE_MESSAGE = "Model list is temporarily unavailable. Check your configuration and try again.";

function getModelsCacheState(): ModelsCacheState {
  if (!globalThis.__piModelsCacheState) {
    globalThis.__piModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__piModelsCacheState;
}

export function invalidateModelsCache(): void {
  const state = getModelsCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

export function withModelRuntimeError(data: ModelsData, modelError: string | undefined): ModelsData {
  return modelError ? { ...data, modelError } : data;
}

export function withSafeModelLoadFailure(data: ModelsData): ModelsData {
  return { ...data, modelError: SAFE_MODEL_LOAD_FAILURE_MESSAGE };
}

export function loadModelsWithCache(cwd: string, loader: () => Promise<ModelsData>): Promise<ModelsData> {
  const state = getModelsCacheState();
  const cached = state.entries.get(cwd);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.data);
    state.entries.delete(cwd);
  }

  const existingLoad = state.inFlight.get(cwd);
  if (existingLoad) return existingLoad;

  const generation = state.generation;
  const loadPromise: Promise<ModelsData> = Promise.resolve()
    .then(loader)
    .then((data) => {
      if (state.generation === generation && state.inFlight.get(cwd) === loadPromise) {
        const now = Date.now();
        for (const [key, entry] of state.entries) {
          if (entry.expiresAt <= now) state.entries.delete(key);
        }
        while (state.entries.size >= MAX_MODELS_CACHE_ENTRIES) {
          const oldestKey = state.entries.keys().next().value;
          if (oldestKey === undefined) break;
          state.entries.delete(oldestKey);
        }
        state.entries.set(cwd, { data, expiresAt: now + MODELS_CACHE_TTL_MS });
      }
      return data;
    })
    .finally(() => {
      if (state.inFlight.get(cwd) === loadPromise) state.inFlight.delete(cwd);
    });

  state.inFlight.set(cwd, loadPromise);
  return loadPromise;
}
