import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/db/client";
import { requireSession } from "@/shared/lib/permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSession();
    const { id } = await params;

    const asset = await prisma.aiFileAsset.findUnique({
      where: { id },
      select: {
        id: true,
        storageType: true,
        storageKey: true,
        mimeType: true,
        bytes: true,
        size: true,
      },
    });

    if (!asset) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (asset.storageType === "DATABASE" && asset.bytes) {
      const contentType = asset.mimeType ?? "application/octet-stream";
      // Prisma returns Buffer; convert to Uint8Array for NextResponse compatibility
      const uint8 = new Uint8Array(asset.bytes as Buffer);
      return new NextResponse(uint8, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    // OBJECT_STORAGE: 未来实现重定向到 storageKey URL
    if (asset.storageType === "OBJECT_STORAGE" && asset.storageKey) {
      return NextResponse.redirect(asset.storageKey);
    }

    // REMOTE_URL: 安全校验后 302 重定向
    if (asset.storageType === "REMOTE_URL" && asset.storageKey) {
      let url: URL;
      try {
        url = new URL(asset.storageKey);
      } catch {
        return NextResponse.json({ error: "Invalid storage URL" }, { status: 400 });
      }

      // 只允许 https
      if (url.protocol !== "https:") {
        return NextResponse.json({ error: "Invalid URL protocol" }, { status: 400 });
      }

      // 只允许已知 Provider 域名
      const ALLOWED_DOMAINS = ["apihub.agnes-ai.com", "agnes-ai.com"];
      const isAllowed = ALLOWED_DOMAINS.some(
        (d) => url.hostname === d || url.hostname.endsWith(`.${d}`)
      );
      if (!isAllowed) {
        return NextResponse.json({ error: "Provider domain not allowed" }, { status: 400 });
      }

      return NextResponse.redirect(asset.storageKey, 302);
    }

    return NextResponse.json({ error: "File data not available" }, { status: 404 });
  } catch (error) {
    console.error("[api/ai/file-assets/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
