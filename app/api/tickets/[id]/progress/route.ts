import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/permissions";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await context.params;
    const body = (await request.json()) as { progress?: number };
    const progress = Math.max(0, Math.min(100, Number(body.progress ?? 0)));

    const ticket = await prisma.ticket.update({
      where: { id },
      data: { progress },
    });

    return NextResponse.json({ ticket });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
