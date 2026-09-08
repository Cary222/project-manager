/**
 * 确定性建立 KnowledgeNode 与 SearchDocument (Chunk) 的来源映射 (KnowledgeNodeSource)
 *
 * 核心逻辑：
 * 遍历现有的 SearchDocument 表，根据 (sourceType, sourceId) 找到对应的 KnowledgeNode，
 * 将其作为确定性来源 (confidence = 1.0) 关联到 KnowledgeNodeSource。
 * 幂等设计：按 (nodeId, sourceChunkId) 去重。
 */

import { Prisma, type PrismaClient } from "@prisma/client";

export interface SyncSourcesResult {
  linkedCount: number;
  durationMs: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

export async function syncNodeChunkSources(db: Db): Promise<SyncSourcesResult> {
  const t0 = Date.now();

  // 使用原生 SQL 高效批量插入映射关系：
  // 1. TICKET: KnowledgeNode (metadata->>'ticketId' = SearchDocument.sourceId)
  // 2. PKM_NOTE: KnowledgeNode (metadata->>'noteId' = SearchDocument.sourceId)
  // 3. COMMIT: KnowledgeNode (metadata->>'commitId' = SearchDocument.sourceId)
  // 4. DOCUMENT: KnowledgeNode (metadata->>'documentId' = SearchDocument.sourceId)
  const result = await db.$executeRaw`
    INSERT INTO pm."KnowledgeNodeSource" ("id", "nodeId", "sourceChunkId", "confidence", "createdAt")
    SELECT
      gen_random_uuid()::text AS id,
      n.id AS "nodeId",
      sd.id AS "sourceChunkId",
      1.0 AS confidence,
      now() AS "createdAt"
    FROM pm."SearchDocument" sd
    JOIN pm."KnowledgeNode" n ON (
      (sd."sourceType" = 'TICKET' AND n.type = 'TICKET' AND n.metadata->>'ticketId' = sd."sourceId") OR
      (sd."sourceType" = 'PKM_NOTE' AND n.type = 'PKM_NOTE' AND n.metadata->>'noteId' = sd."sourceId") OR
      (sd."sourceType" = 'COMMIT' AND n.type = 'COMMIT' AND n.metadata->>'commitId' = sd."sourceId") OR
      (sd."sourceType" = 'DOCUMENT' AND n.type = 'DOCUMENT' AND n.metadata->>'documentId' = sd."sourceId")
    )
    WHERE NOT EXISTS (
      SELECT 1 FROM pm."KnowledgeNodeSource" existing
      WHERE existing."nodeId" = n.id AND existing."sourceChunkId" = sd.id
    );
  `;

  return {
    linkedCount: Number(result),
    durationMs: Date.now() - t0,
  };
}
