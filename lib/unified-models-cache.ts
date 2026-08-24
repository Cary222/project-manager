/**
 * Unified Models Cache — Shared cache for getUnifiedModels() results
 *
 * Used by both:
 * - /api/ai/models/registry (Settings dialog)
 * - /api/models (ChatInput dropdown)
 *
 * Avoids redundant HTTP discovery calls when both endpoints are called.
 *
 * Cache key: userId
 * TTL: 5 minutes
 * Invalidation: via generation counter (incremented on credential changes)
 *
 * =============================================================================
 * 失效时机（由 api-key-store.ts 调用）
 * =============================================================================
 * - saveApiKey()               → invalidateUnifiedModelsCache()  (USER)
 * - deleteApiKeyById()        → invalidateUnifiedModelsCache()  (USER)
 * - deleteApiKey()            → invalidateUnifiedModelsCache()  (USER)
 * - saveSystemProvider()       → invalidateUnifiedModelsCache()  (SYSTEM, 全量)
 * - deleteSystemProviderById() → invalidateUnifiedModelsCache()  (SYSTEM, 全量)
 * - deleteSystemProvider()     → invalidateUnifiedModelsCache()  (SYSTEM, 全量)
 *
 * 注意：generation counter 全局递增，所有 userId 的缓存均失效。
 */

import type { UnifiedProviderEntry } from "./unified-model-registry";

interface UnifiedModelsCacheState {
  entries: Map<string, { data: UnifiedProviderEntry[]; expiresAt: number }>;
  inFlight: Map<string, Promise<UnifiedProviderEntry[]>>;
  generation: number;
}

declare global {
  var __unifiedModelsCacheState: UnifiedModelsCacheState | undefined;
}

const UNIFIED_MODELS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheState(): UnifiedModelsCacheState {
  if (!globalThis.__unifiedModelsCacheState) {
    globalThis.__unifiedModelsCacheState = {
      entries: new Map(),
      inFlight: new Map(),
      generation: 0,
    };
  }
  return globalThis.__unifiedModelsCacheState;
}

/**
 * Load unified models with caching.
 * Both /api/ai/models/registry and /api/models use this to avoid redundant HTTP discovery.
 */
export async function loadUnifiedModelsWithCache(
  userId: string | null,
  loader: () => Promise<UnifiedProviderEntry[]>
): Promise<UnifiedProviderEntry[]> {
  if (!userId) return loader();

  const state = getCacheState();
  const cacheKey = userId;

  const cached = state.entries.get(cacheKey);
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.data;
    }
    state.entries.delete(cacheKey);
  }

  const existingLoad = state.inFlight.get(cacheKey);
  if (existingLoad) {
    return existingLoad as Promise<UnifiedProviderEntry[]>;
  }

  const generation = state.generation;
  const loadPromise: Promise<UnifiedProviderEntry[]> = Promise.resolve()
    .then(loader)
    .then((data) => {
      if (state.generation !== generation) {
        return data;
      }
      const now = Date.now();
      for (const [key, entry] of state.entries) {
        if (entry.expiresAt <= now) state.entries.delete(key);
      }
      state.entries.set(cacheKey, { data, expiresAt: now + UNIFIED_MODELS_CACHE_TTL_MS });
      return data;
    })
    .finally(() => {
      if (state.inFlight.get(cacheKey) === loadPromise) {
        state.inFlight.delete(cacheKey);
      }
    });

  state.inFlight.set(cacheKey, loadPromise);
  return loadPromise;
}

/**
 * Invalidate unified models cache.
 * Call this when user's provider credentials change.
 */
export function invalidateUnifiedModelsCache(): void {
  const state = getCacheState();
  state.generation += 1;
  state.entries.clear();
  state.inFlight.clear();
}

/**
 * Reset cache state — for testing only.
 * Resets generation to 0 and clears all entries.
 * WARNING: Do not call in production code.
 */
export function __resetUnifiedModelsCacheState(): void {
  const state = getCacheState();
  state.generation = 0;
  state.entries.clear();
  state.inFlight.clear();
}
