"use server";

import { prisma } from "@/shared/db/client";
import type { UserProfileData } from "@/features/ai/lib/summarizer";

export type UserSkill = {
  kind: string;
};

export type UserTicketSummary = {
  id: string;
  ticketNo: number;
  title: string;
  status: string;
  progress: number;
};

export type UserProjectSummary = {
  id: string;
  name: string;
  role: string;
};

export type WeeklyReportSummary = {
  id: string;
  weekStart: Date;
  title: string;
  hasAiSummary: boolean;
};

export type AiProfileSummary = {
  hasProfile: boolean;
  sourceSummaryCount: number;
  updatedAt: Date | null;
  /** LLM-summarized attributes; null if no AI profile has been generated yet. */
  profile: UserProfileData | null;
};

export type UserProfile = {
  id: string;
  name: string | null;
  email: string;
  bio: string | null;
  role: string;
  createdAt: Date;
  skills: UserSkill[];
  recentTickets: UserTicketSummary[];
  projects: UserProjectSummary[];
  recentReports: WeeklyReportSummary[];
  aiProfile: AiProfileSummary;
  stats: {
    totalTickets: number;
    completedTickets: number;
    activeProjects: number;
    totalReports: number;
  };
};

export type TeamMember = {
  id: string;
  name: string | null;
  email: string;
  bio: string | null;
  role: string;
  skills: UserSkill[];
  hasAiProfile: boolean;
  stats: {
    totalTickets: number;
    completedTickets: number;
    activeProjects: number;
  };
};

export async function getUserProfileAction(userId: string): Promise<UserProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      responsibilities: { select: { kind: true } },
      createdTickets: {
        select: { id: true, ticketNo: true, title: true, status: true, progress: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      userOnProjects: {
        include: {
          project: {
            select: { id: true, name: true, status: true },
          },
        },
        take: 10,
      },
      weeklyReports: {
        select: { id: true, weekStart: true, title: true, aiSummary: true },
        orderBy: { weekStart: "desc" },
        take: 5,
      },
      aiProfile: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const completedTickets = await prisma.ticket.count({
    where: {
      creatorId: userId,
      status: { in: ["DONE"] },
    },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    bio: user.bio,
    role: user.role,
    createdAt: user.createdAt,
    skills: user.responsibilities.map((r) => ({ kind: r.kind })),
    recentTickets: user.createdTickets.map((t) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      title: t.title,
      status: t.status,
      progress: t.progress,
    })),
    projects: user.userOnProjects.map((up) => ({
      id: up.project.id,
      name: up.project.name,
      role: up.role,
    })),
    recentReports: user.weeklyReports.map((r) => ({
      id: r.id,
      weekStart: r.weekStart,
      title: r.title,
      hasAiSummary: !!r.aiSummary,
    })),
    aiProfile: {
      hasProfile: user.aiProfile !== null,
      sourceSummaryCount: user.aiProfile?.sourceSummaryCount ?? 0,
      updatedAt: user.aiProfile?.updatedAt ?? null,
      profile: (user.aiProfile?.profile as UserProfileData | undefined) ?? null,
    },
    stats: {
      totalTickets: user.createdTickets.length,
      completedTickets,
      activeProjects: user.userOnProjects.length,
      totalReports: user.weeklyReports.length,
    },
  };
}

export async function getTeamMembersAction(): Promise<TeamMember[]> {
  const users = await prisma.user.findMany({
    where: { bannedAt: null },
    include: {
      responsibilities: { select: { kind: true } },
      userOnProjects: {
        where: { project: { status: "ACTIVE" } },
        select: { projectId: true },
      },
      createdTickets: {
        select: { status: true },
      },
      aiProfile: { select: { userId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const memberIds = users.map((u) => u.id);
  const ticketCounts = await prisma.ticket.groupBy({
    by: ["creatorId"],
    _count: { _all: true },
    where: { creatorId: { in: memberIds } },
  });

  const completedCounts = await prisma.ticket.groupBy({
    by: ["creatorId"],
    _count: { _all: true },
    where: {
      creatorId: { in: memberIds },
      status: { in: ["DONE"] },
    },
  });

  const ticketMap = Object.fromEntries(ticketCounts.map((t) => [t.creatorId, t._count._all]));
  const completedMap = Object.fromEntries(completedCounts.map((t) => [t.creatorId, t._count._all]));

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    bio: user.bio,
    role: user.role,
    skills: user.responsibilities.map((r) => ({ kind: r.kind })),
    hasAiProfile: user.aiProfile !== null,
    stats: {
      totalTickets: ticketMap[user.id] ?? 0,
      completedTickets: completedMap[user.id] ?? 0,
      activeProjects: user.userOnProjects.length,
    },
  }));
}
