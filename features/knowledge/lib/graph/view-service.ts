import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  GRAPH_EDGE_LIMIT,
  GRAPH_NODE_LIMIT,
  type GraphViewData,
  type GraphViewEdge,
  type GraphViewNode,
} from "./view-types";

const identifier = z.string().trim().min(1).max(200).optional();
export const graphQuerySchema = z.object({
  nodeId: identifier,
  projectId: identifier,
  noteId: identifier,
  depth: z.coerce.number().int().min(1).max(2).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(GRAPH_NODE_LIMIT)
    .default(GRAPH_NODE_LIMIT),
  q: z.string().trim().max(120).default(""),
});
export type GraphQuery = z.infer<typeof graphQuerySchema>;
export type GraphViewer = { id: string; role?: string };

/** Resolve labels and ACL against live business rows, never cached graph metadata/visibility. */
export function liveAccessSql(viewer: GraphViewer, projectId?: string) {
  return Prisma.sql`
    allowed_projects AS MATERIALIZED (
      SELECT p.id, p.name FROM pm."Project" p
      WHERE (${viewer.role === "ROOT"} OR p."ownerId" = ${viewer.id}
        OR EXISTS (SELECT 1 FROM pm."UserOnProject" m WHERE m."projectId" = p.id AND m."userId" = ${viewer.id}))
        AND (${projectId ?? null}::text IS NULL OR p.id = ${projectId ?? null})
    ),
    allowed_tickets AS MATERIALIZED (
      SELECT t.* FROM pm."Ticket" t JOIN allowed_projects p ON p.id = t."projectId"
    ),
    allowed_notes AS MATERIALIZED (
      SELECT n.* FROM pm."PkmNote" n WHERE (n."userId" = ${viewer.id} OR n."isPublic")
      AND (${projectId ?? null}::text IS NULL OR n."projectId" = ${projectId ?? null})
    ),
    allowed_meetings AS MATERIALIZED (
      SELECT m.* FROM pm."ProjectMeeting" m JOIN allowed_projects p ON p.id = m."projectId"
    ),
    allowed_files AS MATERIALIZED (
      SELECT f.id, f."originalName" FROM pm."UploadedFile" f WHERE f.status = 'ACTIVE' AND (
        f."uploaderId" = ${viewer.id} OR EXISTS (
          SELECT 1 FROM pm."FileReference" r WHERE r."fileAssetId" = f.id AND r."deletedAt" IS NULL AND (
            (r."sourceType" = 'PROJECT' AND r."sourceId" IN (SELECT id FROM allowed_projects)) OR
            (r."sourceType" = 'TICKET' AND r."sourceId" IN (SELECT id FROM allowed_tickets)) OR
            (r."sourceType" = 'PKM_NOTE' AND r."sourceId" IN (SELECT id FROM allowed_notes)) OR
            (r."sourceType" = 'PROJECT_MEETING' AND r."sourceId" IN (SELECT id FROM allowed_meetings)) OR
            (r."sourceType" = 'TICKET_COMMENT' AND EXISTS (
              SELECT 1 FROM pm."TicketComment" c JOIN allowed_tickets t ON t.id = c."ticketId" WHERE c.id = r."sourceId"))
          )
        )
      )
    ),
    live_entities AS (
      SELECT 'PROJECT'::text AS type, p.id, 'projectId'::text AS key, p.name AS label, '/projects/' || p.id AS href FROM allowed_projects p
      UNION ALL SELECT 'TICKET', t.id, 'ticketId', '#' || t."ticketNo" || ' ' || t.title, '/tickets/' || t.id FROM allowed_tickets t
      UNION ALL SELECT 'COMMIT', c.id, 'commitId', left(c."commitSha", 8) || ' ' || c.subject, '/tickets/' || c."ticketId" FROM pm."TicketCommit" c JOIN allowed_tickets t ON t.id = c."ticketId"
      UNION ALL SELECT 'MODULE', m.id, 'moduleId', m.name, '/projects/' || r."projectId" FROM pm."Module" m JOIN pm."Responsibility" r ON r.id = m."responsibilityId" JOIN allowed_projects p ON p.id = r."projectId"
      UNION ALL SELECT 'MEETING', m.id, 'meetingId', m.title, '/projects/' || m."projectId" || '?tab=meetings' FROM allowed_meetings m
      UNION ALL SELECT 'PKM_NOTE', n.id, 'noteId', n.title, '/pkm/notes/' || n.id FROM allowed_notes n
      UNION ALL SELECT 'DOCUMENT', d.id, 'documentId', f."originalName", NULL::text FROM pm."Document" d JOIN allowed_files f ON f.id = d."fileAssetId" WHERE d.status = 'READY'
      UNION ALL SELECT 'USER', u.id, 'userId', coalesce(u.name, '用户'), NULL::text FROM pm."User" u WHERE u.id = ${viewer.id}
        OR EXISTS (SELECT 1 FROM pm."UserOnProject" m JOIN allowed_projects p ON p.id = m."projectId" WHERE m."userId" = u.id)
        OR EXISTS (SELECT 1 FROM allowed_tickets t WHERE t."creatorId" = u.id)
        OR EXISTS (SELECT 1 FROM pm."TicketAssignee" a JOIN allowed_tickets t ON t.id = a."ticketId" WHERE a."userId" = u.id)
    )`;
}

export function visibleGraphSql(viewer: GraphViewer, projectId?: string) {
  return Prisma.sql`${liveAccessSql(viewer, projectId)},
    visible_nodes AS MATERIALIZED (
      SELECT n.id, l.label, l.type, n."projectId", l.href, l.id AS "entityId"
      FROM pm."KnowledgeNode" n JOIN live_entities l ON n.type::text = l.type AND n.metadata ->> l.key = l.id
      WHERE (${projectId ?? null}::text IS NULL OR n."projectId" = ${projectId ?? null} OR n.type = 'USER')
    ),
    visible_edges AS MATERIALIZED (
      SELECT e.id, e."sourceId" AS source, e."targetId" AS target, e."relType" AS label
      FROM pm."KnowledgeEdge" e JOIN visible_nodes s ON s.id = e."sourceId" JOIN visible_nodes t ON t.id = e."targetId"
      WHERE e."sourceType" = 'BUSINESS' AND (e."projectId" IS NULL OR e."projectId" IN (SELECT id FROM allowed_projects))
    )`;
}

type Db = PrismaClient | Prisma.TransactionClient;
export async function searchGraphView(
  db: Db,
  viewer: GraphViewer,
  query: GraphQuery,
) {
  const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
  return db.$queryRaw<
    GraphViewNode[]
  >(Prisma.sql`WITH ${visibleGraphSql(viewer, query.projectId)}
    SELECT id, label, type, "projectId", href FROM visible_nodes
    WHERE label ILIKE ${pattern} ORDER BY label, id LIMIT ${Math.min(query.limit, 50)}`);
}

/** Bounded breadth-first expansion. ACL applies BEFORE every hop, including intermediate nodes. */
export async function readGraphView(
  db: Db,
  viewer: GraphViewer,
  query: GraphQuery,
): Promise<GraphViewData> {
  const ctes = visibleGraphSql(viewer, query.projectId);
  const seeds = await db.$queryRaw<GraphViewNode[]>(Prisma.sql`WITH ${ctes}
    SELECT id, label, type, "projectId", href FROM visible_nodes
    WHERE ${query.nodeId ? Prisma.sql`id = ${query.nodeId}` : query.noteId ? Prisma.sql`type = 'PKM_NOTE' AND "entityId" = ${query.noteId}` : Prisma.sql`type = 'PROJECT'`}
    ORDER BY label, id LIMIT ${Math.min(query.limit, 20)}`);
  if ((query.nodeId || query.noteId) && !seeds.length)
    throw new Error("NOT_FOUND");
  const nodes = new Map(seeds.map((node) => [node.id, node]));
  let frontier = [...nodes.keys()];
  let truncated = seeds.length === Math.min(query.limit, 20);
  for (
    let hop = 0;
    hop < query.depth && frontier.length && nodes.size < query.limit;
    hop++
  ) {
    const rows = await db.$queryRaw<GraphViewNode[]>(Prisma.sql`WITH ${ctes}
      SELECT DISTINCT v.id, v.label, v.type, v."projectId", v.href
      FROM unnest(ARRAY[${Prisma.join(frontier)}]::text[]) f(id)
      CROSS JOIN LATERAL (
        SELECT CASE WHEN e.source = f.id THEN e.target ELSE e.source END AS id
        FROM visible_edges e WHERE e.source = f.id OR e.target = f.id
        ORDER BY e.id LIMIT 25
      ) neighbor JOIN visible_nodes v ON v.id = neighbor.id
      ORDER BY v.id LIMIT ${query.limit + 1}`);
    const next: string[] = [];
    // Reaching either cap is reported conservatively, never advertised as a complete graph.
    truncated ||= rows.length >= 25 || rows.length > query.limit - nodes.size;
    for (const row of rows) {
      if (nodes.has(row.id) || nodes.size >= query.limit) continue;
      nodes.set(row.id, row);
      next.push(row.id);
    }
    frontier = next;
  }
  if (!nodes.size) return { nodes: [], edges: [], truncated: false };
  const ids = Prisma.join([...nodes.keys()]);
  const edges = await db.$queryRaw<GraphViewEdge[]>(Prisma.sql`WITH ${ctes}
    SELECT id, source, target, label FROM visible_edges
    WHERE source IN (${ids}) AND target IN (${ids}) ORDER BY id LIMIT ${GRAPH_EDGE_LIMIT + 1}`);
  return {
    nodes: [...nodes.values()],
    edges: edges.slice(0, GRAPH_EDGE_LIMIT),
    truncated: truncated || edges.length > GRAPH_EDGE_LIMIT,
  };
}
