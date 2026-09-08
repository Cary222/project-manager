/**
 * 语义实体与关系抽取器 (Semantic Graph Extraction - LightRAG 模式)
 *
 * 工程参考：
 *   - LightRAG (lightrag/operate.py)
 *   - neo4j-graphrag-python (components/entity_relation_extractor.py)
 *
 * 核心职责：
 *   1. 从文本切块中抽取 (实体, 关系, 实体) 三元组
 *   2. 实体对齐 (Resolution)：归一化命名 + 优先绑定现有业务实体
 *   3. 挂接来源出处：关联 sourceDocumentId 与 sourceChunkId，记录置信度
 */

import {
  Prisma,
  type PrismaClient,
  type KnowledgeNodeType,
} from "@prisma/client";
import { normalizeEntityName } from "./types";

export interface ExtractedEntity {
  name: string;
  type: "CONCEPT" | "TECHNOLOGY" | "FEATURE" | "ORGANIZATION" | "CUSTOM";
  description?: string;
}

export interface ExtractedRelation {
  source: string;
  target: string;
  relType: string;
  description?: string;
  confidence?: number;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * 结构化解析 LLM 返回的三元组 JSON，具备容错能力
 */
export function parseExtractionJson(raw: string): ExtractionResult {
  try {
    // 寻找可能的 JSON 块
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? [
      null,
      raw,
    ];
    const cleaned = (jsonMatch[1] ?? raw).trim();
    const parsed = JSON.parse(cleaned);

    const entities: ExtractedEntity[] = [];
    if (Array.isArray(parsed.entities)) {
      for (const e of parsed.entities) {
        if (e && typeof e.name === "string" && e.name.trim()) {
          const rawType = String(e.type || "CONCEPT").toUpperCase();
          const validTypes = [
            "CONCEPT",
            "TECHNOLOGY",
            "FEATURE",
            "ORGANIZATION",
            "CUSTOM",
          ];
          const type = (
            validTypes.includes(rawType) ? rawType : "CONCEPT"
          ) as ExtractedEntity["type"];
          entities.push({
            name: e.name.trim(),
            type,
            description: e.description
              ? String(e.description).slice(0, 500)
              : undefined,
          });
        }
      }
    }

    const relations: ExtractedRelation[] = [];
    if (Array.isArray(parsed.relations)) {
      for (const r of parsed.relations) {
        if (
          r &&
          typeof r.source === "string" &&
          typeof r.target === "string" &&
          r.source.trim() &&
          r.target.trim()
        ) {
          relations.push({
            source: r.source.trim(),
            target: r.target.trim(),
            relType: String(r.relType || "RELATES_TO")
              .trim()
              .toUpperCase()
              .replace(/\s+/g, "_")
              .slice(0, 50),
            description: r.description
              ? String(r.description).slice(0, 500)
              : undefined,
            confidence:
              typeof r.confidence === "number"
                ? Math.min(Math.max(r.confidence, 0.1), 1.0)
                : 0.8,
          });
        }
      }
    }

    return { entities, relations };
  } catch (error) {
    console.error("[GraphExtraction] failed to parse JSON:", error);
    return { entities: [], relations: [] };
  }
}

/**
 * 将抽取出来的实体与关系持久化到 KnowledgeNode 与 KnowledgeEdge
 */
export async function persistExtractedGraph(
  db: Db,
  params: {
    extraction: ExtractionResult;
    sourceDocumentId: string;
    sourceChunkId: string;
    projectId?: string | null;
    extractorVersion?: string;
  },
): Promise<{ nodeCount: number; edgeCount: number }> {
  const {
    extraction,
    sourceDocumentId,
    sourceChunkId,
    projectId = null,
    extractorVersion = "lightrag-v1",
  } = params;

  if (extraction.entities.length === 0) {
    return { nodeCount: 0, edgeCount: 0 };
  }

  const nameToNodeId = new Map<string, string>();
  let nodeCount = 0;
  let edgeCount = 0;

  // 1. 实体对齐与 Upsert
  for (const entity of extraction.entities) {
    const normalized = normalizeEntityName(entity.type, entity.name);

    // 检查是否有现有同名节点（优先已有业务或语义实体）
    const existing = await db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT id FROM pm."KnowledgeNode"
        WHERE "normalizedName" = ${normalized}
          AND ("projectId" IS NULL OR "projectId" = ${projectId})
        LIMIT 1;
      `,
    );

    let nodeId: string;
    if (existing.length > 0) {
      nodeId = existing[0].id;
    } else {
      const created = await db.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`
          INSERT INTO pm."KnowledgeNode" (
            "id", "type", "canonicalName", "normalizedName", "description", "projectId", "metadata", "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid()::text,
            ${entity.type}::pm."KnowledgeNodeType",
            ${entity.name},
            ${normalized},
            ${entity.description ?? null},
            ${projectId},
            '{}'::jsonb,
            now(),
            now()
          )
          ON CONFLICT ("type", "normalizedName", "projectId")
          DO UPDATE SET "updatedAt" = now()
          RETURNING id;
        `,
      );
      nodeId = created[0].id;
      nodeCount++;
    }

    nameToNodeId.set(entity.name.toLowerCase(), nodeId);

    // 挂接 chunk 来源映射 (KnowledgeNodeSource)
    await db.$executeRaw`
      INSERT INTO pm."KnowledgeNodeSource" ("id", "nodeId", "sourceDocumentId", "sourceChunkId", "confidence", "createdAt")
      VALUES (
        gen_random_uuid()::text,
        ${nodeId},
        ${sourceDocumentId},
        ${sourceChunkId},
        0.8,
        now()
      )
      ON CONFLICT DO NOTHING;
    `;
  }

  // 2. 关系 Upsert
  for (const rel of extraction.relations) {
    const srcId = nameToNodeId.get(rel.source.toLowerCase());
    const tgtId = nameToNodeId.get(rel.target.toLowerCase());

    if (!srcId || !tgtId || srcId === tgtId) continue;

    await db.$executeRaw`
      INSERT INTO pm."KnowledgeEdge" (
        "id", "sourceId", "targetId", "relType", "weight", "confidence", "sourceType",
        "extractorVersion", "projectId", "sourceDocumentId", "sourceChunkId", "metadata", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text,
        ${srcId},
        ${tgtId},
        ${rel.relType},
        1.0,
        ${rel.confidence ?? 0.8},
        'EXTRACTED'::pm."KnowledgeEdgeSourceType",
        ${extractorVersion},
        ${projectId},
        ${sourceDocumentId},
        ${sourceChunkId},
        '{}'::jsonb,
        now(),
        now()
      )
      ON CONFLICT ("sourceId", "targetId", "relType")
      DO UPDATE SET
        "confidence" = GREATEST(pm."KnowledgeEdge"."confidence", EXCLUDED."confidence"),
        "updatedAt" = now();
    `;
    edgeCount++;
  }

  return { nodeCount, edgeCount };
}
