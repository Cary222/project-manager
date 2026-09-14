/**
 * Data Scope & ACL Policy — 服务端数据权限范围（Chat / Work 共享）。
 *
 * 服务端强制，不靠 prompt：
 * ROOT → 全部项目；普通用户 → 仅 UserOnProject 成员项目。
 * 返回 projectIds 供后续所有业务查询（Ticket, Project, Commit, StatusHistory）做 where 过滤。
 */

import { prisma } from "@/shared/db/client";
import type { Prisma } from "@prisma/client";

export interface DataScope {
  mode: "all_projects" | "member_projects";
  projectIds: string[];
  truncated: boolean;
}

/**
 * 解析当前用户能看到哪些项目。
 * ROOT → 全部；普通用户 → 仅 UserOnProject 成员项目。
 */
export async function resolveDataScope(
  userId: string,
  role?: string | null,
  limit = 200,
): Promise<DataScope> {
  // 如果调用方没传 role，查一次库获取
  let resolvedRole = role;
  if (!resolvedRole) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    resolvedRole = user?.role ?? "USER";
  }

  if (resolvedRole === "ROOT") {
    const all = await prisma.project.findMany({
      select: { id: true },
      take: limit + 1,
    });
    return {
      mode: "all_projects",
      projectIds: all.slice(0, limit).map((p) => p.id),
      truncated: all.length > limit,
    };
  }

  const member = await prisma.userOnProject.findMany({
    where: { userId },
    select: { projectId: true },
    take: limit + 1,
  });

  return {
    mode: "member_projects",
    projectIds: member.slice(0, limit).map((m) => m.projectId),
    truncated: member.length > limit,
  };
}

/** 把 scope 转成 Prisma Project where 片段；空范围返回不可能命中的条件，而不是放开。 */
export function scopeWhere(scope: DataScope): Prisma.ProjectWhereInput {
  if (scope.mode === "all_projects") {
    return {};
  }
  if (scope.projectIds.length === 0) {
    return { id: "__no_access__" };
  }
  return { id: { in: scope.projectIds } };
}

/** 把 scope 转成 Prisma Ticket where 片段。 */
export function ticketScopeWhere(scope: DataScope): Prisma.TicketWhereInput {
  if (scope.mode === "all_projects") {
    return {};
  }
  if (scope.projectIds.length === 0) {
    return { projectId: "__no_access__" };
  }
  return { projectId: { in: scope.projectIds } };
}

/** 校验用户是否有权访问指定项目 */
export function assertProjectAccess(scope: DataScope, projectId: string): boolean {
  if (scope.mode === "all_projects") return true;
  return scope.projectIds.includes(projectId);
}

/** 过滤出用户有权访问的项目 ID 列表 */
export function filterAccessibleProjects(scope: DataScope, projectIds: string[]): string[] {
  if (scope.mode === "all_projects") return [...projectIds];
  return projectIds.filter((id) => scope.projectIds.includes(id));
}
