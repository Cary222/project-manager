import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const ticketNo = Number(id);

    const sourceTicket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: {
            userId: true,
          },
        },
        module: {
          select: {
            name: true,
          },
        },
        project: {
          include: {
            responsibilities: {
              include: {
                modules: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!sourceTicket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const canRead =
      sourceTicket.creatorId === session.user.id ||
      sourceTicket.assignees.some((assignee) => assignee.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canRead) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const recordRows = await prisma.$queryRaw<
      Array<{
        status: string;
        errorMessage: string | null;
        draftTitle: string;
        draftDescription: string | null;
        programAssigneeIds: string[];
        designAssigneeIds: string[];
        targetTicketId: string | null;
        targetTicketNo: number | null;
        targetTicketTitle: string | null;
      }>
    >`
      SELECT
        r.status,
        r."errorMessage",
        r."draftTitle",
        r."draftDescription",
        r."programAssigneeIds",
        r."designAssigneeIds",
        r."targetTicketId",
        t."ticketNo" AS "targetTicketNo",
        t.title AS "targetTicketTitle"
      FROM pm."DesignProgramBinding" AS r
      LEFT JOIN pm."Ticket" AS t ON t.id = r."targetTicketId"
      WHERE r."sourceTicketId" = ${sourceTicket.id}
      LIMIT 1
    `;

    const record = recordRows[0]
      ? {
          status: recordRows[0].status,
          errorMessage: recordRows[0].errorMessage,
          draftTitle: recordRows[0].draftTitle,
          draftDescription: recordRows[0].draftDescription,
          programAssigneeIds: recordRows[0].programAssigneeIds,
          designAssigneeIds: recordRows[0].designAssigneeIds,
          targetTicket: recordRows[0].targetTicketId
            ? {
                id: recordRows[0].targetTicketId,
                ticketNo: recordRows[0].targetTicketNo ?? 0,
                title: recordRows[0].targetTicketTitle ?? "",
              }
            : null,
        }
      : null;

    if (record?.targetTicket) {
      return NextResponse.json({
        mode: "bound",
        record,
        targetTicket: record.targetTicket,
        candidateTicket: null,
      });
    }

    const programResponsibility = sourceTicket.project.responsibilities.find(
      (responsibility) => responsibility.kind === "PROGRAM"
    );
    const candidateModule =
      programResponsibility?.modules.find((module) => module.name === sourceTicket.module.name) ?? null;

    const candidateTicket = candidateModule
      ? await prisma.ticket.findFirst({
          where: {
            id: { not: sourceTicket.id },
            projectId: sourceTicket.projectId,
            moduleId: candidateModule.id,
            title: normalizeText(sourceTicket.title),
          },
          orderBy: { createdAt: "desc" },
          include: {
            assignees: { select: { userId: true } },
          },
        })
      : null;

    // 权限检查：候选人必须对候选单有读权限
    const canAccessCandidate =
      candidateTicket &&
      (candidateTicket.creatorId === session.user.id ||
        candidateTicket.assignees.some((a) => a.userId === session.user.id) ||
        session.user.role === "ROOT");

    const accessibleCandidate = canAccessCandidate ? candidateTicket : null;

    return NextResponse.json({
      mode: accessibleCandidate ? "candidate" : "unbound",
      record: record ?? {
        status: "PENDING",
        errorMessage: null,
        draftTitle: normalizeText(sourceTicket.title),
        draftDescription: null,
        programAssigneeIds: [],
        designAssigneeIds: [],
        targetTicket: null,
      },
      targetTicket: null,
      candidateTicket: accessibleCandidate
        ? { id: accessibleCandidate.id, ticketNo: accessibleCandidate.ticketNo, title: accessibleCandidate.title }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
