import { NextResponse } from "next/server";
import { TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRoot, requireSession } from "@/lib/permissions";
import { allocateTicketNo } from "@/lib/ticket-counter";

export async function POST(request: Request) {
  try {
    const session = await requireRoot();
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      projectId?: string;
      moduleId?: string;
      assigneeId?: string;
      status?: TicketStatus;
      repoPaths?: string[];
    };

    if (!body.title?.trim() || !body.projectId || !body.moduleId) {
      return NextResponse.json(
        { error: "title, projectId and moduleId are required" },
        { status: 400 }
      );
    }

    const title = body.title.trim();
    const projectId = body.projectId;
    const moduleId = body.moduleId;
    const ticketNo = await allocateTicketNo();
    const assigneeId = body.assigneeId || null;
    const ticket = await prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          ticketNo,
          title,
          description: body.description?.trim() || null,
          projectId,
          moduleId,
          creatorId: session.user.id,
          assigneeId,
          status: body.status ?? TicketStatus.DEVELOPING,
          repoBindings: {
            create: (body.repoPaths ?? [])
              .filter((repoPath) => repoPath.trim().length > 0)
              .map((repoPath) => ({ repoPath: repoPath.trim() })),
          },
        },
        include: { repoBindings: true },
      });

      await tx.ticketAssigneeHistory.create({
        data: {
          ticketId: created.id,
          assigneeId,
          changedById: session.user.id,
        },
      });

      await tx.ticketStatusHistory.create({
        data: {
          ticketId: created.id,
          status: body.status ?? TicketStatus.DEVELOPING,
          changedById: session.user.id,
        },
      });

      return created;
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    const status = message === "FORBIDDEN" ? 403 : 401;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET() {
  try {
    await requireSession();
    const tickets = await prisma.ticket.findMany({
      orderBy: { ticketNo: "desc" },
      include: {
        module: { include: { responsibility: true } },
        assignee: {
          select: { id: true, name: true, email: true, role: true },
        },
        repoBindings: true,
        commits: {
          orderBy: { committedAt: "desc" },
          take: 20,
        },
      },
    });
    return NextResponse.json({ tickets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
