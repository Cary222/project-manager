import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

type PushRecordRow = {
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
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

    const canRead =
      ticket.creatorId === session.user.id ||
      ticket.assignees.some((assignee) => assignee.userId === session.user.id) ||
      session.user.role === "ROOT";

    if (!canRead) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    const recordRows = await prisma.$queryRaw<PushRecordRow[]>`
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
      FROM pm."TicketPushRecord" AS r
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
