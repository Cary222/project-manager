import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * 反查某个 FileAsset 的所有有效引用。
 * 用于 DocsTab 显示"哪些单子/笔记引用了这个文件"。
 *
 * PR10 决策：所有来源反查统一从 FileReference 读（不读 attachments Json）。
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    await requireSession();
    const { id } = await params;

    const references = await prisma.fileReference.findMany({
      where: { fileAssetId: id, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });

    // 按 sourceType 分组
    const grouped: Record<string, Array<{ sourceId: string; createdAt: string }>> = {};
    for (const ref of references) {
      if (!grouped[ref.sourceType]) grouped[ref.sourceType] = [];
      grouped[ref.sourceType].push({
        sourceId: ref.sourceId,
        createdAt: ref.createdAt.toISOString(),
      });
    }

    return NextResponse.json({
      fileAssetId: id,
      total: references.length,
      bySourceType: grouped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
