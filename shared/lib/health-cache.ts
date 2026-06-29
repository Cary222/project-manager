/**
 * shared/lib/health-cache.ts
 *
 * 健康度 AI 总结缓存（in-memory，TTL = 1h）。
 * 不写 DB，因为 PR2 阶段 DB schema 改动需 migrate。
 */

const TTL = 60 * 60 * 1000; // 1 hour

type CacheEntry = { summary: string; generatedAt: number };

// Use globalThis so it survives Next.js dev HMR
const _cache = globalThis as typeof globalThis & {
  __health_summary_cache?: CacheEntry;
};

export function getCachedHealthSummary(): { summary: string; generatedAt: Date } | null {
  const entry = _cache.__health_summary_cache;
  if (!entry) return null;
  if (Date.now() - entry.generatedAt > TTL) {
    delete _cache.__health_summary_cache;
    return null;
  }
  return { summary: entry.summary, generatedAt: new Date(entry.generatedAt) };
}

export function setCachedHealthSummary(summary: string): void {
  _cache.__health_summary_cache = {
    summary,
    generatedAt: Date.now(),
  };
}
