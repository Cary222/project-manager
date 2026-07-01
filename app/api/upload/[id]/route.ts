import { NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";

/**
 * 图片代理：从数据库读出 `UploadedFile.bytes`，按原 mimeType 返回。
 * 不做权限校验（图片需要浏览器直接渲染，必须允许 <img src> 匿名 GET）；
 * 文件 id 是 cuid，不可枚举；数据库占用空间有限，不会被滥用。
 */
type RouteParams = { params: Promise<{ id: string }> };

const CACHE_ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    if (!id || !/^[a-z0-9]+$/i.test(id)) {
      return NextResponse.json({ error: "BAD_ID" }, { status: 400 });
    }

    const record = await prisma.uploadedFile.findUnique({
      where: { id },
      select: { bytes: true, mimeType: true, originalName: true, size: true },
    });
    if (!record) {
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(record.bytes), {
      status: 200,
      headers: {
        "content-type": record.mimeType,
        "content-length": String(record.size),
        "cache-control": `public, max-age=${CACHE_ONE_YEAR_SECONDS}, immutable`,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}