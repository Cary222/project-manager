import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";

/**
 * 图片上传服务端入口。配对客户端 `shared/lib/upload.ts` 的 `uploadImage()`。
 * 流程：multipart `POST /api/upload` (form-data 字段 `file`) → 校验大小 + mime →
 * 落 DB `UploadedFile` 表（bytes BYTEA） → 返回 `{ url, id, name, mimeType, size }`。
 * url 形如 `/api/upload/<cuid>`，由 `app/api/upload/[id]/route.ts` 的 GET handler 代理返回字节。
 *
 * 设计取舍：
 * - 把图片存进数据库而不是 `public/uploads/`，是因为生产环境数据库是远端 PostgreSQL，
 *   多实例部署没有共享磁盘，直接存 DB 让 `GET /api/upload/[id]` 从任一实例都能取到。
 * - 当前只接图片类型；PKM 附件（PDF/Word/Excel 等）走的是另一条
 *   `POST /api/pkm/notes` + data URL 的路线，不在本路由 scope 内。
 */
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB，与 shared/lib/upload.ts 保持一致

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

export async function POST(request: Request) {
  try {
    const session = await requireSession();

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "EXPECTED_MULTIPART" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });
    }

    if (!IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const record = await prisma.uploadedFile.create({
      data: {
        uploaderId: session.user.id,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        bytes: buffer,
      },
      select: { id: true, originalName: true, mimeType: true, size: true },
    });

    return NextResponse.json({
      url: `/api/upload/${record.id}`,
      id: record.id,
      name: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}