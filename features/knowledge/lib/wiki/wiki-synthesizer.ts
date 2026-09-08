import { prisma } from "@/shared/db/client";
import type { WikiPage, WikiSourceEvidence } from "./types";

export interface WikiDatabaseClient {
  project?: {
    findUnique: (args: unknown) => Promise<unknown>;
    findMany?: (args: unknown) => Promise<unknown>;
  };
  pkmNote?: {
    findMany: (args: unknown) => Promise<unknown>;
  };
  searchDocument?: {
    upsert: (args: unknown) => Promise<unknown>;
    findFirst?: (args: unknown) => Promise<unknown>;
    findMany?: (args: unknown) => Promise<unknown>;
  };
}

/**
 * Dynamically synthesizes an executive Project Wiki Page from live PostgreSQL business models:
 * Project -> Responsibilities -> Modules -> Tickets -> Commits, plus linked PKM Notes.
 */
export async function synthesizeProjectWiki(
  projectId: string,
  options?: { db?: WikiDatabaseClient | typeof prisma },
): Promise<WikiPage | null> {
  const db = (options?.db ?? prisma) as WikiDatabaseClient & typeof prisma;

  if (!db.project) return null;

  try {
    const project = (await db.project.findUnique({
      where: { id: projectId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        responsibilities: {
          include: {
            modules: {
              include: {
                tickets: {
                  take: 10,
                  orderBy: { ticketNo: "desc" },
                  include: {
                    commits: { take: 2 },
                  },
                },
              },
            },
          },
        },
      },
    })) as {
      id: string;
      name: string;
      status: string;
      owner?: { id: string; name: string | null; email: string } | null;
      responsibilities: Array<{
        modules: Array<{
          id: string;
          name: string;
          tickets: Array<{
            id: string;
            ticketNo: number;
            title: string;
            status: string;
            priority: number;
            commits: Array<{ id: string; commitSha: string; subject: string }>;
          }>;
        }>;
      }>;
    } | null;

    if (!project) return null;

    // Fetch linked PKM technical notes
    let notes: Array<{ id: string; title: string }> = [];
    if (db.pkmNote) {
      notes =
        ((await db.pkmNote.findMany({
          where: { projectId },
          take: 5,
          select: { id: true, title: true },
        })) as Array<{ id: string; title: string }>) ?? [];
    }

    const modules = project.responsibilities.flatMap((r) => r.modules);
    const tickets = modules.flatMap((m) => m.tickets);
    const commits = tickets.flatMap((t) => t.commits);

    const sourceEvidence: WikiSourceEvidence[] = [
      {
        id: project.id,
        type: "project",
        title: project.name,
        url: `/projects/${project.id}`,
      },
      ...tickets.slice(0, 8).map((t) => ({
        id: t.id,
        type: "ticket" as const,
        title: `#${t.ticketNo} ${t.title}`,
        url: `/tickets/${t.id}`,
      })),
      ...commits.slice(0, 4).map((c) => ({
        id: c.id,
        type: "commit" as const,
        title: `${c.commitSha.slice(0, 7)} ${c.subject}`,
        url: `/tickets/${c.id}`,
      })),
      ...notes.map((n) => ({
        id: n.id,
        type: "note" as const,
        title: n.title,
        url: `/pkm/notes/${n.id}`,
      })),
    ];

    const slug = `project-${project.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")}`;
    const ownerName = project.owner?.name ?? project.owner?.email ?? "待指定";

    const keyModules = modules.map((m) => ({
      name: m.name,
      description: `包含 ${m.tickets.length} 项核心任务工单`,
    }));

    const relatedTickets = tickets.slice(0, 10).map((t) => ({
      ticketNo: t.ticketNo,
      title: t.title,
    }));

    const summary = `${project.name} 是当前系统正在推进的核心研发项目。由负责人 ${ownerName} 统筹，涵盖 ${modules.length} 个功能模块与 ${tickets.length} 项关联工单，当前项目状态为 ${project.status}。`;

    const content = `# 《${project.name} 项目研发全貌与技术架构总览》

## 1. 项目定位与团队责任
- **项目名称**：${project.name}
- **项目负责人**：${ownerName}
- **项目运行状态**：${project.status}

## 2. 核心技术模块与分工
${
  modules.length > 0
    ? modules
        .map(
          (m) =>
            `- **${m.name}**：包含 ${m.tickets.length} 项核心任务与技术实现`,
        )
        .join("\n")
    : "- 暂无明确模块划分"
}

## 3. 关键工单与推进里程碑
${
  tickets.length > 0
    ? tickets
        .slice(0, 8)
        .map(
          (t) =>
            `- **#${t.ticketNo}**：${t.title}（状态：${t.status}，优先级：P${t.priority}）`,
        )
        .join("\n")
    : "- 暂无关联工单"
}

## 4. 关联技术文档与设计规范
${
  notes.length > 0
    ? notes.map((n) => `- **${n.title}**（/pkm/notes/${n.id}）`).join("\n")
    : "- 暂无关联的技术文档笔记"
}
`;

    const nowIso = new Date().toISOString();

    return {
      id: `wiki_${project.id}`,
      slug,
      title: `《${project.name} 项目研发全貌与技术架构总览》`,
      category: "project_overview",
      projectId: project.id,
      projectName: project.name,
      summary,
      content,
      keyModules,
      relatedTickets,
      sourceEvidence,
      version: 1,
      generatedAt: nowIso,
      updatedAt: nowIso,
    };
  } catch (error) {
    console.warn(
      `[WikiSynthesizer] failed to synthesize wiki for project ${projectId}:`,
      error,
    );
    return null;
  }
}

/**
 * Persists and indexes a synthesized WikiPage into PostgreSQL SearchDocument.
 * Makes synthesized knowledge traceable, searchable via keyword & vector, and persistent.
 */
export async function syncWikiPageToSearchDocument(
  page: WikiPage,
  options?: { db?: WikiDatabaseClient | typeof prisma },
): Promise<{ id: string }> {
  const db = (options?.db ?? prisma) as WikiDatabaseClient & typeof prisma;

  if (!db.searchDocument) {
    return { id: `mock_search_doc_${page.id}` };
  }

  const url = `/projects/${page.projectId ?? "knowledge"}?tab=wiki&slug=${page.slug}`;

  const doc = (await db.searchDocument.upsert({
    where: {
      sourceType_sourceId_chunkIndex: {
        sourceType: "DOCUMENT",
        sourceId: page.id,
        chunkIndex: 0,
      },
    },
    update: {
      projectId: page.projectId ?? null,
      title: page.title,
      content: `${page.summary}\n\n${page.content}`,
      url,
      metadata: {
        isWiki: true,
        slug: page.slug,
        category: page.category,
        sourceEvidence: page.sourceEvidence,
        version: page.version,
        generatedAt: page.generatedAt,
      },
    },
    create: {
      sourceType: "DOCUMENT",
      sourceId: page.id,
      chunkIndex: 0,
      projectId: page.projectId ?? null,
      title: page.title,
      content: `${page.summary}\n\n${page.content}`,
      url,
      metadata: {
        isWiki: true,
        slug: page.slug,
        category: page.category,
        sourceEvidence: page.sourceEvidence,
        version: page.version,
        generatedAt: page.generatedAt,
      },
    },
    select: { id: true },
  })) as { id: string };

  return doc;
}
