import "server-only";

import { prisma } from "@/shared/db/client";
import type { WorkRunRef } from "./work-run-ref";

/** Rebuilds the Work list from existing durable business records; no task table. */
export async function listWorkRunRefs(userId: string): Promise<WorkRunRef[]> {
  const [workflowsRes, meetingsRes, sessionsRes] = await Promise.allSettled([
    prisma.workflowRun.findMany({
      where: {
        userId,
        kind: "RUN",
        workflowType: { in: ["weekly_report", "project-progress"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, workflowType: true, status: true, updatedAt: true },
    }),
    prisma.projectMeeting.findMany({
      where: {
        OR: [
          { creatorId: userId },
          { project: { ownerId: userId } },
          { project: { members: { some: { userId } } } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        projectId: true,
      },
    }),
    prisma.piSessionOwnership.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { piSessionId: true, updatedAt: true },
    }),
  ]);

  const workflows =
    workflowsRes.status === "fulfilled" ? workflowsRes.value : [];
  const meetings = meetingsRes.status === "fulfilled" ? meetingsRes.value : [];
  const sessions = sessionsRes.status === "fulfilled" ? sessionsRes.value : [];

  return [
    ...workflows.map(
      (run): WorkRunRef =>
        run.workflowType === "project-progress"
          ? {
              kind: "project_progress",
              source: "WorkflowRun",
              sourceId: run.id,
              status: run.status,
              title: "项目进展汇总",
              updatedAt: run.updatedAt.toISOString(),
            }
          : {
              kind: "weekly_report",
              source: "WorkflowRun",
              sourceId: run.id,
              status: run.status,
              title: "周报生成",
              updatedAt: run.updatedAt.toISOString(),
            },
    ),
    ...meetings.map(
      (meeting): WorkRunRef => ({
        kind: "meeting_minutes",
        source: "ProjectMeeting",
        sourceId: meeting.id,
        status: meeting.status,
        title: meeting.title,
        updatedAt: meeting.updatedAt.toISOString(),
        projectId: meeting.projectId,
      }),
    ),
    ...sessions.map(
      (session): WorkRunRef => ({
        kind: "coding",
        source: "PiSessionOwnership",
        sourceId: session.piSessionId,
        status: "ready",
        title: "Coding Task",
        updatedAt: session.updatedAt.toISOString(),
      }),
    ),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
