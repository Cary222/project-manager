import { NextResponse } from "next/server";
import { TicketStatus } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const session = await requireSession();
    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as TicketStatus | null;

    // 非本人或管理员只能查看公开信息
    const isSelf = session.user.id === userId;
    const isAdmin = session.user.role === "ROOT" || session.user.role === "ADMIN";

    if (!isSelf && !isAdmin) {
      // 非本人只能看基本信息
      const tickets = await prisma.ticket.findMany({
        where: {
          assignees: { some: { userId } },
          status: { not: "CLOSED" }, // 隐藏已关闭
          ...(status ? { status } : {}),
        },
        orderBy: { ticketNo: "desc" },
        take: 50,
        select: {
          id: true,
          ticketNo: true,
          title: true,
          status: true,
          priority: true,
          project: { select: { id: true, name: true } },
          module: { select: { id: true, name: true } },
        },
      });
      return NextResponse.json({ tickets });
    }

    // 本人或管理员查看全部
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
        priority: true,
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
