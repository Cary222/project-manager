import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { prisma } from "@/shared/db/client";

/**
 * AI 文件上传 API（用于 I2I / I2V 输入图片）
 *
 * 流程：
 * 1. multipart POST，表单字段：file, source
 * 2. 验证文件类型（仅图片）
 * 3. 将文件写入 AiFileAsset 表（storageType=REMOTE_URL 使用外部 URL）
 * 4. 返回 { id, url, name, mimeType }
 *
 * 第一版限制：仅支持 storageType=REMOTE_URL，URL 由前端通过 FormData source 字段传入
 */
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: NextRequest) {
  try {
    const session = await requireSession();

    const contentType = request.headers.get("content-type") || "";

    // JSON 模式：接收 Data URI，解码后存 bytes
    // storageType 仍为 BASE64（DashScope 等 Provider 直接接收 data URI，不需要反向抓取 URL），
    // 但数据本体存入无索引的 bytes 字段，storageKey 不写入（避免 B-tree 索引行超限：
    // PostgreSQL 索引单行上限 8191 字节，而 Base64 图片数据轻松超过这个大小）
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { fileName, storageKey: dataUri } = body as {
        fileName?: string;
        storageKey?: string;
      };

      if (!dataUri) {
        return NextResponse.json({ error: "Missing storageKey (data URI)" }, { status: 400 });
      }

      const match = dataUri.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/);
      if (!match) {
        return NextResponse.json(
          { error: "Invalid image data URI — expected data:image/...;base64,..." },
          { status: 400 }
        );
      }

      const mimeType = match[1];
      const bytes = Buffer.from(match[2], "base64");

      if (bytes.length > MAX_SIZE) {
        return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
      }

      const record = await prisma.aiFileAsset.create({
        data: {
          storageType: "BASE64",
          bytes,
          mimeType,
          size: bytes.length,
        },
        select: { id: true, mimeType: true, size: true },
      });

      return NextResponse.json({
        id: record.id,
        url: dataUri,
        name: fileName || "image.jpg",
        mimeType: record.mimeType,
      });
    }

    // REMOTE_URL / LOCAL 模式：接收 FormData
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "EXPECTED_MULTIPART" }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get("file");
    const source = form.get("source") as string | null;
    const storageType = form.get("storageType") as string | null;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });
    }

    // 验证文件类型
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "ONLY_IMAGE_ALLOWED" }, { status: 400 });
    }

    // REMOTE_URL 模式：前端上传到外部存储后传 URL，或者直接传 base64
    if (storageType === "REMOTE_URL") {
      const storageKey = form.get("storageKey") as string | null;

      if (!storageKey) {
        return NextResponse.json(
          { error: "REMOTE_URL mode requires storageKey field" },
          { status: 400 }
        );
      }

      // 验证 URL 格式
      let url: URL;
      try {
        url = new URL(storageKey);
      } catch {
        return NextResponse.json({ error: "INVALID_STORAGE_KEY_URL" }, { status: 400 });
      }

      // 只允许 https
      if (url.protocol !== "https:") {
        return NextResponse.json({ error: "MUST_BE_HTTPS" }, { status: 400 });
      }

      // 验证域名（可选的额外安全层）
      const allowedDomains = ["apihub.agnes-ai.com", "agnes-ai.com"];
      const isAllowed = allowedDomains.some(
        (d) => url.hostname === d || url.hostname.endsWith(`.${d}`)
      );
      if (!isAllowed) {
        // 对于其他可信域名也允许（如用户自己的图床）
        console.warn(`[api/ai/file-assets] Non-whitelisted domain: ${url.hostname}`);
      }

      const record = await prisma.aiFileAsset.create({
        data: {
          storageType: "REMOTE_URL",
          storageKey: storageKey,
          mimeType: file.type,
          size: Number(file.size),
          checksum: undefined,
        },
        select: { id: true, storageKey: true, mimeType: true, size: true },
      });

      return NextResponse.json({
        id: record.id,
        url: record.storageKey,
        name: file.name,
        mimeType: record.mimeType,
        size: record.size,
        storageType: "REMOTE_URL",
      });
    }

    // DATABASE 模式：直接存 bytes
    const bytes = Buffer.from(await file.arrayBuffer());

    const record = await prisma.aiFileAsset.create({
      data: {
        storageType: "DATABASE",
        mimeType: file.type,
        size: Number(file.size),
        bytes,
      },
      select: { id: true, mimeType: true, size: true },
    });

    // 返回访问 URL（通过 GET /api/ai/file-assets/[id]）
    const accessUrl = `/api/ai/file-assets/${record.id}`;

    return NextResponse.json({
      id: record.id,
      url: accessUrl,
      name: file.name,
      mimeType: record.mimeType,
      size: record.size,
      storageType: "DATABASE",
    });
  } catch (error) {
    console.error("[api/ai/file-assets] error:", error);
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
