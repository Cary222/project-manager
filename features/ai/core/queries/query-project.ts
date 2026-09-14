/**
 * Project query for search-structured.
 */

import { prisma } from "@/shared/db/client";
import type { StructuredResult, SourceReference } from "@/features/ai/types/structured";
import { DISAMBIGUATION_THRESHOLDS } from "@/features/ai/types/structured";
import { resolveDataScope, scopeWhere } from "@/features/ai/core/policy/data-scope";

export interface ProjectQueryInput {
  id?: string;
  filters?: {
    status?: string;
  };
  limit?: number;
  viewerUserId?: string;
}

/**
 * Execute a project query.
 * Handles both specific project lookups and listing all active projects.
 */
export async function queryProject(input: ProjectQueryInput): Promise<StructuredResult> {
  const { id, filters: _filters } = input;

  if (!id) {
    // List active projects with dataScope ACL
    let where: Record<string, unknown> = { status: "ACTIVE" };
    if (input.viewerUserId) {
      const dataScope = await resolveDataScope(input.viewerUserId);
      const scopeFilter = scopeWhere(dataScope);
      if (scopeFilter.id) where.id = scopeFilter.id;
    }
    const projects = await prisma.project.findMany({
      where,
      orderBy: { name: "asc" },
      take: 20,
      select: { id: true, name: true },
    });
    if (projects.length === 0) return { summary: "当前没有活跃项目", sources: [] };


    const sources: SourceReference[] = projects.map((p, i) => ({
      index: i + 1,
      title: p.name,
      url: `/projects/${p.id}`,
      type: "project" as const
    }));
    return {
      summary: `当前活跃项目：\n${projects.map((p) => `• ${p.name} → /projects/${p.id}`).join("\n")}`,
      sources
    };
  }

  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      owner: { select: { name: true } },
      responsibilities: {
        orderBy: { kind: "asc" },
        include: {
          modules: {
            orderBy: { name: "asc" },
            include: {
              tickets: {
                select: { status: true, priority: true, deadline: true, ticketNo: true, title: true, id: true },
              },
            },
          },
        },
      },
    },
  });

  if (!project) return { summary: `未找到项目 ID: ${id}`, sources: [] };
  if (input.viewerUserId) {
    const dataScope = await resolveDataScope(input.viewerUserId);
    if (dataScope.mode !== "all_projects" && !dataScope.projectIds.includes(project.id)) {
      return { summary: `无权访问项目 "${project.name}"（不属于你所在的项目）`, sources: [] };
    }
  }

  let total = 0;
  let done = 0;
  let overdue = 0;
  const now = new Date();

  for (const resp of project.responsibilities) {
    for (const mod of resp.modules) {
      for (const t of mod.tickets) {
        total++;
        if (t.status === "DONE" || t.status === "CLOSED") done++;
        if (t.deadline && new Date(t.deadline) < now && t.status !== "DONE" && t.status !== "CLOSED") {
          overdue++;
        }
      }
    }
  }

  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const inProgress = total - done;

  return {
    summary: `项目：${project.name}
负责人：${project.owner?.name ?? "未知"}
状态：${project.status}
进度：${done}/${total} 完成（${pct}%）| 进行中 ${inProgress} | 逾期 ${overdue} 个
链接：/projects/${project.id}`,
    sources: [{
      index: 1,
      title: project.name,
      url: `/projects/${project.id}`,
      type: "project" as const
    }]
  };
}
