import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";
import {
  graphQuerySchema,
  readGraphView,
  searchGraphView,
} from "./view-service";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export async function handleGraphRequest(
  req: NextRequest,
  kind: "subgraph" | "search",
) {
  try {
    const session = await requireSession();
    const parsed = graphQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: "图谱查询参数无效" },
        { status: 400, headers },
      );
    const query = parsed.data;
    const viewer = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, bannedAt: true },
    });
    if (!viewer || viewer.bannedAt) throw new Error("UNAUTHORIZED");
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '3000ms'`;
        if (query.projectId) {
          const project = await tx.project.findFirst({
            where: {
              id: query.projectId,
              ...(viewer.role === "ROOT"
                ? {}
                : {
                    OR: [
                      { ownerId: viewer.id },
                      { members: { some: { userId: viewer.id } } },
                    ],
                  }),
            },
            select: { id: true },
          });
          if (!project) throw new Error("NOT_FOUND");
        }
        return kind === "search"
          ? { results: query.q ? await searchGraphView(tx, viewer, query) : [] }
          : await readGraphView(tx, viewer, query);
      },
      { isolationLevel: "RepeatableRead", timeout: 10000 },
    );
    return NextResponse.json(result, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const status =
      message === "UNAUTHORIZED" ? 401 : message === "NOT_FOUND" ? 404 : 503;
    if (status === 503)
      console.error(
        "[knowledge-graph] read failed",
        error instanceof Error ? error.name : "unknown",
      );
    return NextResponse.json(
      {
        error:
          status === 401
            ? "请先登录"
            : status === 404
              ? "图谱不存在或无权访问"
              : "图谱暂时不可用，请稍后重试",
      },
      { status, headers },
    );
  }
}
