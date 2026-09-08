/**
 * 确定性业务图同步 (Deterministic Business Graph Sync)
 *
 * 零 LLM 消耗，直接从 Prisma 数据生成 KnowledgeNode + KnowledgeEdge。
 * 幂等设计：全量 upsert，可重复执行。
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { normalizeEntityName, BusinessRelTypes as R } from "./types";

type NodeUpsert = {
  type: Parameters<typeof normalizeEntityName>[0];
  canonicalName: string;
  projectId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

// ─── 内部工具 ──────────────────────────────────────────────────────

function makeNode(u: NodeUpsert) {
  const normalizedName = normalizeEntityName(u.type, u.canonicalName);
  // Prisma 要求 unique composite where 中 nullable 字段用空字符串代替 null
  const projectIdForWhere = u.projectId ?? "";
  return {
    where: {
      type_normalizedName_projectId: {
        type: u.type,
        normalizedName,
        projectId: projectIdForWhere,
      },
    },
    create: {
      type: u.type,
      canonicalName: u.canonicalName,
      normalizedName,
      description: u.description ?? null,
      metadata: (u.metadata ?? {}) as Prisma.InputJsonValue,
      // 使用关系连接而非直接 projectId 字段（满足 Prisma checked create 类型）
      ...(u.projectId ? { project: { connect: { id: u.projectId } } } : {}),
    },
    update: {
      canonicalName: u.canonicalName,
      description: u.description ?? undefined,
      metadata: u.metadata ? (u.metadata as Prisma.InputJsonValue) : undefined,
    },
  };
}

async function upsertNode(prisma: PrismaClient, u: NodeUpsert) {
  const args = makeNode(u);
  return prisma.knowledgeNode.upsert(args);
}

async function upsertEdge(
  prisma: PrismaClient,
  sourceId: string,
  targetId: string,
  relType: string,
  projectId?: string | null,
) {
  return prisma.knowledgeEdge.upsert({
    where: {
      sourceId_targetId_relType: { sourceId, targetId, relType },
    },
    create: {
      relType,
      confidence: 1.0,
      sourceType: "BUSINESS",
      sourceNode: { connect: { id: sourceId } },
      targetNode: { connect: { id: targetId } },
      ...(projectId ? { project: { connect: { id: projectId } } } : {}),
    },
    update: {},
  });
}

// ─── 公共 API ──────────────────────────────────────────────────────

export interface SyncStats {
  nodes: number;
  edges: number;
  durationMs: number;
}

/**
 * 全量同步：将现有业务数据写入知识图谱。
 * 幂等，可在 Worker 或 CLI 中反复调用。
 */
export async function syncBusinessGraph(
  prisma: PrismaClient,
): Promise<SyncStats> {
  const t0 = Date.now();
  let nodes = 0;
  let edges = 0;

  // ── 1. Projects ──────────────────────────────────────────────────
  const projects = await prisma.project.findMany({
    select: { id: true, name: true, description: true },
  });

  const projectNodeMap = new Map<string, string>(); // projectId → nodeId
  for (const p of projects) {
    const node = await upsertNode(prisma, {
      type: "PROJECT",
      canonicalName: p.name,
      projectId: p.id,
      description: p.description,
      metadata: { projectId: p.id },
    });
    projectNodeMap.set(p.id, node.id);
    nodes++;
  }

  // ── 2. Users ─────────────────────────────────────────────────────
  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
  });

  const userNodeMap = new Map<string, string>(); // userId → nodeId
  for (const u of users) {
    const displayName = u.name || u.email;
    const node = await upsertNode(prisma, {
      type: "USER",
      canonicalName: displayName,
      description: null,
      metadata: { userId: u.id, email: u.email },
    });
    userNodeMap.set(u.id, node.id);
    nodes++;
  }

  // ── 3. Modules（含 Responsibility → Project 关系）────────────────
  const modules = await prisma.module.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      responsibility: { select: { projectId: true, kind: true } },
    },
  });

  const moduleNodeMap = new Map<string, string>(); // moduleId → nodeId
  for (const m of modules) {
    const projectId = m.responsibility.projectId;
    const node = await upsertNode(prisma, {
      type: "MODULE",
      canonicalName: m.name,
      projectId,
      description: m.description,
      metadata: { moduleId: m.id, responsibilityKind: m.responsibility.kind },
    });
    moduleNodeMap.set(m.id, node.id);
    nodes++;

    // Project → HAS_MODULE → Module
    const pNode = projectNodeMap.get(projectId);
    if (pNode) {
      await upsertEdge(prisma, pNode, node.id, R.HAS_MODULE, projectId);
      edges++;
    }
  }

  // ── 4. Tickets ───────────────────────────────────────────────────
  const tickets = await prisma.ticket.findMany({
    select: {
      id: true,
      ticketNo: true,
      title: true,
      projectId: true,
      moduleId: true,
      creatorId: true,
      status: true,
      assignees: { select: { userId: true } },
    },
  });

  const ticketNodeMap = new Map<string, string>(); // ticketId → nodeId
  for (const t of tickets) {
    const node = await upsertNode(prisma, {
      type: "TICKET",
      canonicalName: `#${t.ticketNo} ${t.title}`,
      projectId: t.projectId,
      description: t.title,
      metadata: { ticketId: t.id, ticketNo: t.ticketNo, status: t.status },
    });
    ticketNodeMap.set(t.id, node.id);
    nodes++;

    // Project → HAS_TICKET → Ticket
    const pNode = projectNodeMap.get(t.projectId);
    if (pNode) {
      await upsertEdge(prisma, pNode, node.id, R.HAS_TICKET, t.projectId);
      edges++;
    }

    // Ticket → BELONGS_TO_MODULE → Module
    const mNode = moduleNodeMap.get(t.moduleId);
    if (mNode) {
      await upsertEdge(
        prisma,
        node.id,
        mNode,
        R.BELONGS_TO_MODULE,
        t.projectId,
      );
      edges++;
    }

    // Ticket → CREATED_BY → User
    const cNode = userNodeMap.get(t.creatorId);
    if (cNode) {
      await upsertEdge(prisma, node.id, cNode, R.CREATED_BY, t.projectId);
      edges++;
    }

    // Ticket → ASSIGNED_TO → User (多人)
    for (const a of t.assignees) {
      const aNode = userNodeMap.get(a.userId);
      if (aNode) {
        await upsertEdge(prisma, node.id, aNode, R.ASSIGNED_TO, t.projectId);
        edges++;
      }
    }
  }

  // ── 5. TicketCommits ─────────────────────────────────────────────
  const commits = await prisma.ticketCommit.findMany({
    select: {
      id: true,
      ticketId: true,
      commitSha: true,
      subject: true,
      author: true,
      ticket: { select: { projectId: true } },
    },
  });

  for (const c of commits) {
    const projectId = c.ticket.projectId;
    const node = await upsertNode(prisma, {
      type: "COMMIT",
      canonicalName: c.commitSha.substring(0, 8),
      projectId,
      description: c.subject,
      metadata: { commitId: c.id, commitSha: c.commitSha, author: c.author },
    });
    nodes++;

    // Ticket → MENTIONS_COMMIT → Commit
    const tNode = ticketNodeMap.get(c.ticketId);
    if (tNode) {
      await upsertEdge(prisma, tNode, node.id, R.MENTIONS_COMMIT, projectId);
      edges++;
    }
  }

  // ── 6. PkmNotes ──────────────────────────────────────────────────
  const notes = await prisma.pkmNote.findMany({
    select: {
      id: true,
      title: true,
      userId: true,
      projectId: true,
      isPublic: true,
    },
  });

  for (const n of notes) {
    const node = await upsertNode(prisma, {
      type: "PKM_NOTE",
      canonicalName: n.title,
      projectId: n.projectId,
      metadata: { noteId: n.id, isPublic: n.isPublic },
    });
    nodes++;

    // PkmNote → AUTHORED_BY → User
    const uNode = userNodeMap.get(n.userId);
    if (uNode) {
      await upsertEdge(prisma, node.id, uNode, R.AUTHORED_BY, n.projectId);
      edges++;
    }

    // PkmNote → BELONGS_TO_PROJECT → Project
    if (n.projectId) {
      const pNode = projectNodeMap.get(n.projectId);
      if (pNode) {
        await upsertEdge(
          prisma,
          node.id,
          pNode,
          R.BELONGS_TO_PROJECT,
          n.projectId,
        );
        edges++;
      }
    }
  }

  // ── 7. Documents (via FileAsset → FileReference) ─────────────────
  const docs = await prisma.document.findMany({
    where: { status: "READY" },
    select: {
      id: true,
      fileAsset: {
        select: {
          id: true,
          originalName: true,
          uploaderId: true,
          references: {
            where: { sourceType: "PROJECT", deletedAt: null },
            select: { sourceId: true },
          },
        },
      },
    },
  });

  for (const d of docs) {
    const fa = d.fileAsset;
    // 一个文档可能关联多个项目（通过 FileReference）
    const projectIds = fa.references.map((r) => r.sourceId);
    const primaryProject = projectIds[0] ?? null;

    const node = await upsertNode(prisma, {
      type: "DOCUMENT",
      canonicalName: fa.originalName,
      projectId: primaryProject,
      metadata: { documentId: d.id, fileAssetId: fa.id },
    });
    nodes++;

    // Document → AUTHORED_BY → User (uploader)
    const uNode = userNodeMap.get(fa.uploaderId);
    if (uNode) {
      await upsertEdge(prisma, node.id, uNode, R.AUTHORED_BY, primaryProject);
      edges++;
    }

    // Document → BELONGS_TO_PROJECT → Project
    for (const pid of projectIds) {
      const pNode = projectNodeMap.get(pid);
      if (pNode) {
        await upsertEdge(prisma, node.id, pNode, R.BELONGS_TO_PROJECT, pid);
        edges++;
      }
    }
  }

  // ── 8. ProjectMeetings ───────────────────────────────────────────
  const meetings = await prisma.projectMeeting.findMany({
    select: {
      id: true,
      title: true,
      projectId: true,
      creatorId: true,
      meetingDate: true,
    },
  });

  for (const m of meetings) {
    const node = await upsertNode(prisma, {
      type: "MEETING",
      canonicalName: m.title,
      projectId: m.projectId,
      metadata: { meetingId: m.id, meetingDate: m.meetingDate?.toISOString() },
    });
    nodes++;

    // Project → HAS_MEETING → Meeting
    const pNode = projectNodeMap.get(m.projectId);
    if (pNode) {
      await upsertEdge(prisma, pNode, node.id, R.HAS_MEETING, m.projectId);
      edges++;
    }

    // Meeting → CREATED_BY → User
    const cNode = userNodeMap.get(m.creatorId);
    if (cNode) {
      await upsertEdge(prisma, node.id, cNode, R.CREATED_BY, m.projectId);
      edges++;
    }
  }

  return { nodes, edges, durationMs: Date.now() - t0 };
}
