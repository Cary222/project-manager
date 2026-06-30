import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

export async function GET() {
  try {
    await requireSession();

    const users = await prisma.user.findMany({
      where: { bannedAt: null },
      include: {
        responsibilities: { select: { kind: true } },
        userOnProjects: {
          include: {
            project: { select: { id: true, name: true, status: true } },
          },
        },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }, { email: "asc" }],
    });

    const members = users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      bio: user.bio,
      role: user.role,
      skills: user.responsibilities.map((r) => ({ kind: r.kind })),
      projects: user.userOnProjects.map((up) => ({
        id: up.project.id,
        name: up.project.name,
        role: up.role,
        status: up.project.status,
      })),
    }));

    return NextResponse.json({ members });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
