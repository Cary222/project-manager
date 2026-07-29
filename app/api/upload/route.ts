import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";
import { sha256Hex } from "@/shared/lib/hash";
import { enqueueIndexJob } from "@/worker/lib/jobs";

/**
 * 文件上传服务端入口。配对客户端 `shared/lib/upload.ts` 的 `uploadFile()`。
 * 流程：
 * 1. multipart `POST /api/upload` (form-data 字段 `file`, `clientHash`)
 * 2. 服务端重算 sha256 hash（权威值，客户端 hash 仅作 hint）
 * 3. 用服务端 hash + size 做去重检查（UNIQUE(hash, size)）
 * 4. 命中则返回已有 fileId；未命中则写入 `FileAsset` 表
 * 5. 返回 `{ url, fileId, name, mimeType, size, hash, deduplicated }`
 *
 * 设计取舍：
 * - 把文件存进数据库而不是 `public/uploads/`，是因为生产环境数据库是远端 PostgreSQL，
 *   多实例部署没有共享磁盘，直接存 DB 让 `GET /api/upload/[id]` 从任一实例都能取到。
 * - hash 去重：服务端重算确保权威性，避免客户端 hash 被篡改导致的重复存储。
 */
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB，与 shared/lib/upload.ts 保持一致

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

    // 1. 服务端重新计算 sha256（权威值）
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = sha256Hex(bytes);

    // 2. 用服务端 hash + size 做去重检查（客户端 clientHash 仅作 hint，不信任）
    const existing = await prisma.fileAsset.findUnique({
      where: { hash_size: { hash, size: file.size } },
      select: { id: true, originalName: true, mimeType: true, size: true, hash: true },
    });

    if (existing) {
      return NextResponse.json({
        url: `/api/upload/${existing.id}`,
        fileId: existing.id,
        name: existing.originalName,
        mimeType: existing.mimeType,
        size: existing.size,
        hash: existing.hash,
        deduplicated: true,
      });
    }

    // 3. 未命中则创建新记录
    const record = await prisma.fileAsset.create({
      data: {
        uploaderId: session.user.id,
        originalName: file.name,
        mimeType: file.type,
        size: file.size,
        bytes,
        hash,
        status: "ACTIVE",
      },
      select: { id: true, originalName: true, mimeType: true, size: true, hash: true },
    });

    // 4. 入队 IndexJob，Worker 会走 processFileAssetJob → Document → SearchDocument
    await enqueueIndexJob({ targetType: "FILE_ASSET", targetId: record.id });

    return NextResponse.json({
      url: `/api/upload/${record.id}`,
      fileId: record.id,
      name: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
      hash: record.hash,
      deduplicated: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}