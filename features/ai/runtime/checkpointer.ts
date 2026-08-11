/**
 * Checkpointer Factory — LangGraph Checkpointer 工厂
 *
 * 支持 Memory（开发/测试）和 Postgres（生产）两种 Checkpointer。
 * 根据配置类型自动选择合适的实现。
 */

import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver, CompiledStateGraph } from "@langchain/langgraph";
import type { CheckpointerConfig } from "./types";

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a checkpointer based on configuration.
 */
export function createCheckpointer(config: CheckpointerConfig): BaseCheckpointSaver {
  switch (config.type) {
    case "memory":
      return createMemoryCheckpointer();
    case "postgres":
      return createPostgresCheckpointer(config.threadId);
    default:
      console.warn(`[CheckpointerFactory] Unknown type "${config.type}", falling back to Memory`);
      return createMemoryCheckpointer();
  }
}

// ============================================================================
// Memory Checkpointer
// ============================================================================

/**
 * Create an in-memory checkpointer for development/testing.
 * WARNING: State is lost on server restart.
 */
export function createMemoryCheckpointer(): BaseCheckpointSaver {
  return new MemorySaver();
}

// ============================================================================
// Postgres Checkpointer
// ============================================================================

/**
 * Create a Postgres-based checkpointer for production.
 * Requires pg checkpointing to be configured in LangGraph.
 *
 * Note: This is a placeholder. Full implementation requires:
 * 1. PostgresSaver from @langchain/langgraph/checkpoint/postgres
 * 2. Database connection pool
 * 3. Migration for checkpoint tables
 */
export function createPostgresCheckpointer(threadId: string): BaseCheckpointSaver {
  // Lazy import to avoid loading pg when not needed
  // import { PostgresSaver } from "@langchain/langgraph/checkpoint/postgres";

  console.warn(
    `[CheckpointerFactory] Postgres checkpointer not fully implemented. ` +
    `Falling back to Memory for threadId="${threadId}".`
  );

  // TODO: Implement full Postgres checkpointer:
  // const pool = await getPool();
  // return PostgresSaver.fromPool(pool, { threadId });
  return createMemoryCheckpointer();
}

// ============================================================================
// Checkpointer Utilities
// ============================================================================

/**
 * Get or create a checkpointer for a given thread.
 * Useful for maintaining consistent checkpoints across multiple operations.
 */
const checkpointerCache = new Map<string, BaseCheckpointSaver>();

export function getOrCreateCheckpointer(config: CheckpointerConfig): BaseCheckpointSaver {
  const key = `${config.type}:${config.threadId}`;

  if (!checkpointerCache.has(key)) {
    checkpointerCache.set(key, createCheckpointer(config));
  }

  return checkpointerCache.get(key)!;
}

/**
 * Clear checkpointer cache. Call this on server shutdown for memory checkpointer.
 */
export function clearCheckpointerCache(): void {
  checkpointerCache.clear();
}

/**
 * Invalidate checkpointer for a specific thread.
 */
export function invalidateCheckpointer(threadId: string): void {
  for (const key of checkpointerCache.keys()) {
    if (key.endsWith(`:${threadId}`)) {
      checkpointerCache.delete(key);
    }
  }
}
