import { prisma } from "@/shared/db/client";

export interface AmbiguousCandidate {
  id: string;
  label: string;
  summary: string;
  entityType: "user" | "note" | "ticket" | "project" | "weekly_report";
}

const CANDIDATE_LIMIT = 3;

/**
 * Search several entity types when the query does not contain a strong type signal.
 */
export async function searchAmbiguousEntities(
  query: string,
  _viewerUserId?: string,
): Promise<AmbiguousCandidate[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const userQuery = normalizedQuery.slice(0, 10);
  const [usersResult, notesResult, ticketsResult, projectsResult] = await Promise.allSettled([
    prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: userQuery, mode: "insensitive" } },
          { searchName: { contains: normalizedQuery, mode: "insensitive" } },
        ],
        bannedAt: null,
      },
      take: CANDIDATE_LIMIT,
      select: { id: true, name: true, email: true },
    }),
    prisma.pkmNote.findMany({
      where: { title: { contains: normalizedQuery, mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      take: CANDIDATE_LIMIT,
      select: { id: true, title: true, updatedAt: true },
    }),
    prisma.ticket.findMany({
      where: { title: { contains: normalizedQuery, mode: "insensitive" } },
      orderBy: { ticketNo: "desc" },
      take: CANDIDATE_LIMIT,
      select: { id: true, ticketNo: true, title: true },
    }),
    prisma.project.findMany({
      where: { name: { contains: normalizedQuery, mode: "insensitive" } },
      take: CANDIDATE_LIMIT,
      select: { id: true, name: true },
    }),
  ]);

  const candidates: AmbiguousCandidate[] = [];

  if (usersResult.status === "fulfilled") {
    for (const user of usersResult.value) {
      candidates.push({
        id: user.id,
        label: `${user.name ?? user.email}（用户）`,
        summary: user.email,
        entityType: "user",
      });
    }
  }

  if (notesResult.status === "fulfilled") {
    for (const note of notesResult.value) {
      candidates.push({
        id: note.id,
        label: `${note.title}（笔记）`,
        summary: `更新于 ${note.updatedAt.toLocaleDateString("zh-CN")}`,
        entityType: "note",
      });
    }
  }

  if (ticketsResult.status === "fulfilled") {
    for (const ticket of ticketsResult.value) {
      candidates.push({
        id: ticket.id,
        label: `#${ticket.ticketNo} ${ticket.title}（工单）`,
        summary: "",
        entityType: "ticket",
      });
    }
  }

  if (projectsResult.status === "fulfilled") {
    for (const project of projectsResult.value) {
      candidates.push({
        id: project.id,
        label: `${project.name}（项目）`,
        summary: "",
        entityType: "project",
      });
    }
  }

  return candidates;
}
