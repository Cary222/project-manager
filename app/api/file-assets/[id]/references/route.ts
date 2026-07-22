import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * 为 FileAsset 创建 FileReference 引用记录。
 * 典型场景：项目文档上传后，创建 sourceType="PROJECT" 的引用。
 * 支持 sourceType：PROJECT | TICKET | TICKET_COMMENT | PKM_NOTE
 * 幂等：同一 (fileAssetId, sourceType, sourceId) 已存在则直接返回已有记录。
 */
export async function POST(
  request: Request,
  { params }: RouteParams,
) {
  try {
    const session = await requireSession();
    const { id: fileAssetId } = await params;
    const body = await request.json() as {
      sourceType: string;
      sourceId: string;
    };

    if (!body.sourceType || !body.sourceId) {
      return NextResponse.json(
        { error: "sourceType and sourceId are required" },
        { status: 400 },
      );
    }

    const validSourceTypes = ["PROJECT", "TICKET", "TICKET_COMMENT", "PKM_NOTE"];
    if (!validSourceTypes.includes(body.sourceType)) {
      return NextResponse.json(
        { error: `Invalid sourceType. Must be one of: ${validSourceTypes.join(", ")}` },
        { status: 400 },
      );
    }

    // 验证 FileAsset 存在
    const fileAsset = await prisma.fileAsset.findUnique({
      where: { id: fileAssetId },
      select: { id: true },
    });
    if (!fileAsset) {
      return NextResponse.json({ error: "FILE_ASSET_NOT_FOUND" }, { status: 404 });
    }

    // 幂等：已存在直接返回
    const existing = await prisma.fileReference.findFirst({
      where: {
        fileAssetId,
        sourceType: body.sourceType as "PROJECT",
        sourceId: body.sourceId,
        deletedAt: null,
      },
    });
    if (existing) {
      return NextResponse.json({ id: existing.id, deduplicated: true });
    }

    const ref = await prisma.fileReference.create({
      data: {
        fileAssetId,
        sourceType: body.sourceType as "PROJECT",
        sourceId: body.sourceId,
      },
    });

    return NextResponse.json({ id: ref.id, deduplicated: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
