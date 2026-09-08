/**
 * Graph Retriever (GraphRAG 核心检索算子)
 *
 * 核心逻辑参考 pg-raggraph 与 LightRAG：
 *   1. 种子实体链接 (Seed Entity Linking)：根据 Query 提取实体锚点
 *   2. 1~2 Hop 递归 CTE 展开：探索知识网络拓扑邻域，记录推导路径
 *   3. 实体-切块映射 (Entity-to-Chunk Mapping)：通过 KnowledgeNodeSource 反查 SearchDocument
 *   4. 安全与权限过滤 (ACL Filtering)：项目权限与私密笔记过滤
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { visibleGraphSql } from "./view-service";

export interface GraphCandidateChunk {
  documentId: string; // SearchDocument.id
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  projectId: string | null;
  hopDistance: number;
  hitFrequency: number;
  paths: string[];
  graphScore: number;
}

export interface GraphRetrievalOptions {
  query: string;
  projectId?: string | null;
  viewerUserId?: string | null;
  viewerRole?: string | null;
  limit?: number;
  maxHops?: number;
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * 从 Query 中提取可能的实体名称与关键词候选
 */
export function extractQueryEntityTerms(query: string): string[] {
  const terms: string[] = [];
  const trimmed = query.trim();
  if (!trimmed) return terms;

  // 1. 提取工单号，如 "#10208" 或 "10208"
  const ticketMatches = trimmed.match(/#?(\d{5,})/g);
  if (ticketMatches) {
    for (const m of ticketMatches) {
      const num = m.replace(/^#/, "");
      terms.push(`#${num}`);
      terms.push(`ticket_${num}`);
    }
  }

  // 2. 提取整句关键连续词
  terms.push(trimmed);

  // 3. 按空格分词（过滤单字）
  const words = trimmed.split(/[\s,，、；;]+/).filter((w) => w.length >= 2);
  for (const w of words) {
    if (!terms.includes(w)) terms.push(w);
  }

  return terms.slice(0, 10);
}

/**
 * 核心图检索算子
 */
export async function searchGraphCandidates(
  db: Db,
  options: GraphRetrievalOptions,
): Promise<GraphCandidateChunk[]> {
  const {
    query,
    projectId = null,
    viewerUserId = null,
    viewerRole = null,
    limit = 20,
    maxHops = 2,
  } = options;

  if (!query.trim()) return [];

  const entityTerms = extractQueryEntityTerms(query);
  if (entityTerms.length === 0) return [];

  const viewer = {
    id: viewerUserId ?? "anonymous",
    role: viewerRole ?? "USER",
  };

  // 1. 种子定位：通过 ILIKE 在用户可见的节点中查找匹配的种子节点
  const ctes = visibleGraphSql(viewer, projectId ?? undefined);
  const termPatterns = entityTerms.map(
    (t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`,
  );

  const seedRows = await db.$queryRaw<
    Array<{ id: string; label: string; type: string }>
  >(
    Prisma.sql`
      WITH ${ctes}
      SELECT id, label, type
      FROM visible_nodes
      WHERE ${Prisma.join(
        termPatterns.map((p) => Prisma.sql`label ILIKE ${p}`),
        " OR ",
      )}
      ORDER BY length(label) ASC, id
      LIMIT 8;
    `,
  );

  if (seedRows.length === 0) {
    return [];
  }

  const seedIds = seedRows.map((r) => r.id);
  const hops = Math.min(Math.max(maxHops, 1), 2);

  // 2. 递归 CTE 展开 1~2 跳并搜集关联的 SearchDocument
  const graphHitRows = await db.$queryRaw<
    Array<{
      chunk_id: string;
      hop_depth: number;
      hit_freq: number;
      path_repr: string;
    }>
  >(
    Prisma.sql`
      WITH RECURSIVE ${ctes},
      neighborhood AS (
        SELECT
          id,
          0 AS depth,
          label AS path_acc,
          ARRAY[id]::text[] AS visited
        FROM visible_nodes
        WHERE id = ANY(ARRAY[${Prisma.join(seedIds)}]::text[])

        UNION ALL

        SELECT
          e2.id,
          n.depth + 1,
          n.path_acc || ' -[' || r.label || ']-> ' || e2.label,
          n.visited || e2.id
        FROM neighborhood n
        JOIN visible_edges r ON (r.source = n.id OR r.target = n.id)
        JOIN visible_nodes e2 ON e2.id = CASE WHEN r.source = n.id THEN r.target ELSE r.source END
        WHERE n.depth < ${hops}
          AND NOT (e2.id = ANY(n.visited))
      )
      SELECT
        s."sourceChunkId" AS chunk_id,
        MIN(n.depth)::int AS hop_depth,
        COUNT(*)::int AS hit_freq,
        MIN(n.path_acc) AS path_repr
      FROM neighborhood n
      JOIN pm."KnowledgeNodeSource" s ON s."nodeId" = n.id
      WHERE s."sourceChunkId" IS NOT NULL
      GROUP BY s."sourceChunkId"
      ORDER BY MIN(n.depth) ASC, COUNT(*) DESC
      LIMIT ${limit * 2};
    `,
  );

  if (graphHitRows.length === 0) {
    return [];
  }

  // 3. 批量拉取真实的 SearchDocument 实体
  const chunkIds = graphHitRows.map((r) => r.chunk_id);
  const documents = await db.$queryRaw<
    Array<{
      id: string;
      sourceType: string;
      sourceId: string;
      chunkIndex: number;
      title: string;
      content: string;
      metadata: Record<string, unknown>;
      projectId: string | null;
      userId: string | null;
      isPublic: boolean | null;
    }>
  >(
    Prisma.sql`
      SELECT
        sd.id,
        sd."sourceType"::text AS "sourceType",
        sd."sourceId",
        sd."chunkIndex",
        sd.title,
        sd.content,
        sd.metadata,
        sd."projectId",
        (sd.metadata->>'noteUserId') AS "userId",
        (sd.metadata->>'noteIsPublic')::boolean AS "isPublic"
      FROM pm."SearchDocument" sd
      WHERE sd.id = ANY(ARRAY[${Prisma.join(chunkIds)}]::text[])
    `,
  );

  const docMap = new Map(documents.map((d) => [d.id, d]));
  const results: GraphCandidateChunk[] = [];

  for (const hit of graphHitRows) {
    const doc = docMap.get(hit.chunk_id);
    if (!doc) continue;

    // ACL 安全复核：
    // 若为 PKM_NOTE，必须属于当前用户或为公开笔记
    if (doc.sourceType === "PKM_NOTE") {
      const isOwner = viewerUserId && doc.userId === viewerUserId;
      const isPublic = doc.isPublic === true;
      if (!isOwner && !isPublic && viewerRole !== "ROOT") {
        continue;
      }
    }

    // 计算图打分：跳数越小分越高，命中频次作为加成
    // 0 跳 (种子直接关联 chunk): base 1.0; 1 跳: 0.8; 2 跳: 0.5
    const hopWeight =
      hit.hop_depth === 0 ? 1.0 : hit.hop_depth === 1 ? 0.8 : 0.5;
    const freqBoost = Math.min(hit.hit_freq * 0.1, 0.5);
    const score = hopWeight + freqBoost;

    results.push({
      documentId: doc.id,
      sourceType: doc.sourceType,
      sourceId: doc.sourceId,
      chunkIndex: doc.chunkIndex,
      title: doc.title,
      content: doc.content,
      metadata: doc.metadata ?? {},
      projectId: doc.projectId,
      hopDistance: hit.hop_depth,
      hitFrequency: hit.hit_freq,
      paths: [hit.path_repr],
      graphScore: score,
    });

    if (results.length >= limit) break;
  }

  return results;
}
