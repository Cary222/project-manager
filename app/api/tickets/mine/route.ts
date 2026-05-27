import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

export async function GET() {
  try {
    const session = await requireSession();
    const tickets = await prisma.ticket.findMany({
      where: {
        assignees: {
          some: { userId: session.user.id },
        },
      },
      orderBy: { ticketNo: "desc" },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
        project: {
          select: { id: true, name: true },
        },
        module: {
          select: {
            name: true,
            responsibility: { select: { kind: true } },
          },
        },
      },
    });
    return NextResponse.json({ tickets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
