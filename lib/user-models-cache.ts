/**
 * User Models Cache — User Scope 的模型缓存
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - User 模型的缓存（loadUserModelsWithCache）
 *   - 缓存失效（invalidateUserModelsCache）
 *   - 全量失效（invalidateAllUserModelsCache）
 *   - Per-user generation 管理
 *
 * ❌ 不负责：
 *   - Workspace 模型的缓存（由 models-cache.ts 提供）
 *   - 模型发现（由 registry.ts 提供）
 *   - 模型价格元数据（由 model-catalog.ts 提供）
 *
 * =============================================================================
 * 为什么 User / Workspace Cache 不应该合并
 * =============================================================================
 * 与 models-cache.ts 的区别：
 *
 * | 维度 | User Cache | Workspace Cache |
 * |------|-----------|----------------|
 * | Key | userId | cwd |
 * | TTL | 5 分钟 | 60 秒 |
 * | 来源 | UserApiKey DB | models.json |
 * | 服务 | Chat / WorkAgent | PiSubAgent |
 * | 失效 | Provider CRUD | cwd 变更 |
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
 * 1. TTL：5 分钟
 *    - User 配置相对稳定
 *    - 5 分钟足够平衡性能和一致性
 *
 * 2. 最大条目：128
 *    - 防止内存泄漏
 *    - LRU 淘汰策略
 *
 * 3. In-flight 请求去重：
 *    - 相同 userId 的并发请求共享同一个 Promise
 *    - 避免重复调用 Provider API
 *
 * 4. Generation Counter：
 *    - generation：全局 generation，SYSTEM provider 变更时递增
 *    - userGenerations：Per-user generation，USER provider 变更时递增
 *    - 缓存 key：`${userId}:${userGeneration}`
 *
 * =============================================================================
 * 失效时机
 * =============================================================================
 * api-key-store.ts 在以下操作后会调用失效函数：
 * - saveApiKey() → invalidateUserModelsCache(userId)
 * - deleteApiKeyById() → invalidateUserModelsCache(userId)
 * - deleteApiKey() → invalidateUserModelsCache(userId)
 * - saveSystemProvider() → invalidateAllUserModelsCache()
 * - deleteSystemProviderById() → invalidateAllUserModelsCache()
 * - deleteSystemProvider() → invalidateAllUserModelsCache()
 *
 * =============================================================================
 * Discovery 链路
 * =============================================================================
 * /api/ai/models
 *   → loadUserModelsWithCache(userId, loader)  [user-models-cache.ts] ← 本文件
 *   → getEnabledModels(userId)                 [registry.ts]
 *   → discoverModelsFromAPI()                  [registry.ts]
 *   → 返回 ModelCatalogEntry[]
 *
 * =============================================================================
 * 相关文件
 * =============================================================================
 * - lib/models-cache.ts：Workspace 模型缓存
 * - features/ai/llm/credentials/api-key-store.ts：凭证 CRUD 时调用失效
 */

import type { ModelCatalogEntry } from "@/features/ai/llm/providers/types";

export interface UserModelsCacheEntry {
  models: ModelCatalogEntry[];
  cachedAt: number;
}

// ---------------------------------------------------------------------------
// Cache state — module-level singleton on global to survive Next.js HMR
// ---------------------------------------------------------------------------

interface UserModelsCacheState {
  entries: Map<string, { data: UserModelsCacheEntry; expiresAt: number }>;
  inFlight: Map<string, Promise<UserModelsCacheEntry>>;
  // Generation counter — incremented on any credential change
  generation: number;
  // Per-user generation — incremented when specific user's credentials change
  userGenerations: Map<string, number>;
}

declare global {
  // eslint-disable-next-line no-var
  var __userModelsCacheState: UserModelsCacheState | undefined;
}

const USER_MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 128;

// ---------------------------------------------------------------------------
// State access
// ---------------------------------------------------------------------------

function getCacheState(): UserModelsCacheState {
  if (!globalThis.__userModelsCacheState) {
    globalThis.__userModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
      userGenerations: new Map(),
    };
  }
  return globalThis.__userModelsCacheState;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load user models with caching.
 * Returns cached data if valid, otherwise calls the loader and caches result.
 *
 * @param userId - User identifier for cache isolation
 * @param loader - Async function to fetch models when cache miss
 */
export async function loadUserModelsWithCache(
  userId: string,
  loader: () => Promise<ModelCatalogEntry[]>
): Promise<ModelCatalogEntry[]> {
  if (!userId) {
    // No caching for anonymous requests
    return loader();
  }

  const state = getCacheState();
  const userGen = state.userGenerations.get(userId) ?? state.generation;
  const cacheKey = `${userId}:${userGen}`;

  const cached = state.entries.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.data.models;
    }
    state.entries.delete(cacheKey);
  }

  // Deduplicate in-flight requests for same cache key
  const existingLoad = state.inFlight.get(cacheKey);
  if (existingLoad) {
    return (await existingLoad).models;
  }

  const loadPromise: Promise<UserModelsCacheEntry> = Promise.resolve()
    .then(loader)
    .then((models) => {
      const now = Date.now();
      // Clean up expired entries
      for (const [key, entry] of state.entries) {
        if (entry.expiresAt <= now) {
          state.entries.delete(key);
        }
      }
      // Evict oldest if at capacity
      while (state.entries.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = state.entries.keys().next().value;
        if (oldestKey === undefined) break;
        state.entries.delete(oldestKey);
      }
      const entry: UserModelsCacheEntry = { models, cachedAt: now };
      state.entries.set(cacheKey, { data: entry, expiresAt: now + USER_MODELS_CACHE_TTL_MS });
      return entry;
    })
    .finally(() => {
      if (state.inFlight.get(cacheKey) === loadPromise) {
        state.inFlight.delete(cacheKey);
      }
    });

  state.inFlight.set(cacheKey, loadPromise);
  return (await loadPromise).models;
}

/**
 * Invalidate cache for a specific user.
 * Call this when user's provider credentials change.
 */
export function invalidateUserModelsCache(userId?: string): void {
  const state = getCacheState();
  if (userId) {
    // Invalidate specific user's cache by incrementing their generation
    const currentGen = state.userGenerations.get(userId) ?? state.generation;
    state.userGenerations.set(userId, currentGen + 1);
  }
  // Also increment global generation for system provider changes
  state.generation += 1;
}

/**
 * Invalidate all user model caches.
 * Call this for system-wide changes (e.g., system provider updates).
 */
export function invalidateAllUserModelsCache(): void {
  const state = getCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
  state.userGenerations.clear();
}
