import { NextResponse } from "next/server";
import { TicketStatus } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireRoot } from "@/shared/lib/permissions";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    await requireRoot();
    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as TicketStatus | null;

    const tickets = await prisma.ticket.findMany({
      where: {
        assignees: { some: { userId } },
        ...(status ? { status } : {}),
      },
      orderBy: { ticketNo: "desc" },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
        project: { select: { id: true, name: true } },
        module: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ tickets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
