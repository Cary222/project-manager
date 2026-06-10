import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

type PushRecordBody = {
  status?: "FAILED" | "SUCCEEDED" | "PENDING";
  errorMessage?: string | null;
  draftTitle?: string;
  draftDescription?: string | null;
  programAssigneeIds?: string[];
  designAssigneeIds?: string[];
  targetTicketId?: string | null;
};

type PushRecordRow = {
  id: string;
  status: string;
  errorMessage: string | null;
  draftTitle: string;
  draftDescription: string | null;
  programAssigneeIds: string[];
  designAssigneeIds: string[];
  targetTicketId: string | null;
  targetTicketNo: number | null;
  targetTicketTitle: string | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as PushRecordBody;
    const ticketNo = Number(id);

    const ticket = await prisma.ticket.findUnique({
      where: Number.isInteger(ticketNo) ? { ticketNo } : { id },
      include: {
        assignees: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    }

    const canUpdate =
      ticket.creatorId === session.user.id ||
      ticket.assignees.some((assignee) => assignee.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canUpdate) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const normalizedStatus =
      body.targetTicketId && body.status === undefined ? "SUCCEEDED" : body.status ?? "PENDING";

    const existingRows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM pm."DesignProgramBinding"
      WHERE "sourceTicketId" = ${ticket.id}
      LIMIT 1
    `;

    if (existingRows[0]) {
      await prisma.$executeRaw`
        UPDATE pm."DesignProgramBinding"
        SET
          status = ${normalizedStatus},
          "errorMessage" = ${body.errorMessage ?? null},
          "draftTitle" = ${body.draftTitle ?? ""},
          "draftDescription" = ${body.draftDescription ?? null},
          "programAssigneeIds" = ${body.programAssigneeIds ?? []}::text[],
          "designAssigneeIds" = ${body.designAssigneeIds ?? []}::text[],
          "targetTicketId" = ${body.targetTicketId ?? null},
          "updatedAt" = NOW()
        WHERE id = ${existingRows[0].id}
      `;
    } else {
      await prisma.$executeRaw`
        INSERT INTO pm."DesignProgramBinding" (
          id,
          "sourceTicketId",
          "targetTicketId",
          "createdById",
          status,
          "errorMessage",
          "draftTitle",
          "draftDescription",
          "programAssigneeIds",
          "designAssigneeIds",
          "createdAt",
          "updatedAt"
        ) VALUES (
          gen_random_uuid()::text,
          ${ticket.id},
          ${body.targetTicketId ?? null},
          ${session.user.id},
          ${normalizedStatus},
          ${body.errorMessage ?? null},
          ${body.draftTitle ?? ""},
          ${body.draftDescription ?? null},
          ${body.programAssigneeIds ?? []}::text[],
          ${body.designAssigneeIds ?? []}::text[],
          NOW(),
          NOW()
        )
      `;
    }

    const recordRows = await prisma.$queryRaw<PushRecordRow[]>`
      SELECT
        r.id,
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
      WHERE r."sourceTicketId" = ${ticket.id}
      LIMIT 1
    `;

    const row = recordRows[0];
    const record = row
      ? {
          status: row.status,
          errorMessage: row.errorMessage,
          draftTitle: row.draftTitle,
          draftDescription: row.draftDescription,
          programAssigneeIds: row.programAssigneeIds,
          designAssigneeIds: row.designAssigneeIds,
          targetTicket: row.targetTicketId
            ? {
                id: row.targetTicketId,
                ticketNo: row.targetTicketNo ?? 0,
                title: row.targetTicketTitle ?? "",
              }
            : null,
        }
      : null;

    return NextResponse.json({ record });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}
