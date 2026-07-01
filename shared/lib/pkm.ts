/**
 * 文件附件的统一格式（PR10）。
 * 格式：{ fileId, name?, mimeType?, size? }
 * UI 渲染：/api/upload/<fileId>
 */
export type FileAttachment = {
  fileId: string;
  name?: string;
  mimeType?: string;
  size?: number;
};

export const PKM_ATTACHMENT_MAX_COUNT = 8;
export const PKM_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;

/**
 * 从 Markdown 正文中提取内嵌图片，返回图片列表和去掉这些图片后的纯正文。
 * 匹配两类：
 *   - `![alt](data:image/...)` 客户端遗留的 data URL 图片
 *   - `![alt](/api/upload/<id>)` 服务端上传的图片代理 URL
 */
export type InlineImage = { src: string; name: string };

const INLINE_IMAGE_PATTERN =
  /!\[([^\]]*)\]\((data:image\/[^)\s]+|\/api\/upload\/[a-z0-9]+)\)/gi;

export function extractInlineImages(markdown: string): {
  images: InlineImage[];
  plainContent: string;
} {
  const images: InlineImage[] = [];
  const seen = new Set<string>();

  const plainContent = markdown.replace(INLINE_IMAGE_PATTERN, (_match, name, src) => {
    const imageName = name.trim() || `图片${images.length + 1}`;
    if (seen.has(src)) return "";
    seen.add(src);
    images.push({ src, name: imageName });
    return "";
  });

  return {
    images,
    plainContent: plainContent.replace(/^\s*[\r\n]+/, "").trim(),
  };
}

/**
 * 将图片列表重新拼回 Markdown 图片语法。
 * 可选传入已有正文，将图片 Markdown 拼到正文最前面。
 */
export function composeImageMarkdown(
  images: InlineImage[],
  existingContent = ""
): { content: string; newImages: InlineImage[] } {
  const existingSrcs = new Set<string>();
  INLINE_IMAGE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_IMAGE_PATTERN.exec(existingContent)) !== null) {
    existingSrcs.add(match[2]);
  }

  const newImages = images.filter((img) => !existingSrcs.has(img.src));
  const imageMarkdown = newImages
    .map((img) => `![${img.name}](${img.src})`)
    .join("\n");

  const combined =
    imageMarkdown && existingContent.trim()
      ? `${imageMarkdown}\n\n${existingContent.trim()}`
      : imageMarkdown || existingContent;

  return { content: combined, newImages };
}

// -----------------------------------------------------------------------
// FileAttachment 迁移工具（PR10）
// -----------------------------------------------------------------------
import { sha256Hex } from "@/shared/lib/hash";
import { prisma } from "@/shared/db/client";

/**
 * 从旧 base64 url 格式提取（兼容旧 PkmNote.attachments）。
 * 旧格式：{ name, url (data:base64), mimeType, size }
 * 新格式：{ fileId, name?, mimeType?, size? }
 *
 * 同时处理新格式（已有 fileId）直接透传。
 */
export async function extractFileAttachmentsFromLegacy(
  legacyAttachments: unknown,
  userId: string,
): Promise<{ attachments: FileAttachment[]; convertedFileIds: string[] }> {
  if (!Array.isArray(legacyAttachments)) return { attachments: [], convertedFileIds: [] };

  const attachments: FileAttachment[] = [];
  const convertedFileIds: string[] = [];

  for (const item of legacyAttachments) {
    if (!item || typeof item !== "object") continue;
    const att = item as Record<string, unknown>;

    // 新格式：直接有 fileId → 透传
    if (typeof att.fileId === "string") {
      attachments.push({
        fileId: att.fileId,
        name: typeof att.name === "string" ? att.name : undefined,
        mimeType: typeof att.mimeType === "string" ? att.mimeType : undefined,
        size: typeof att.size === "number" ? att.size : undefined,
      });
      continue;
    }

    // 旧格式：url 是 data URL → 转换
    if (typeof att.url === "string" && att.url.startsWith("data:")) {
      try {
        const base64 = att.url.split(",")[1];
        if (!base64) continue;
        const bytes = Buffer.from(base64, "base64");
        const hash = sha256Hex(bytes);

        // 去重：相同 hash+size 只存一份
        const existing = await prisma.fileAsset.findUnique({
          where: { hash_size: { hash, size: bytes.length } },
          select: { id: true },
        });

        let fileId: string;
        if (existing) {
          fileId = existing.id;
        } else {
          const created = await prisma.fileAsset.create({
            data: {
              uploaderId: userId,
              originalName: typeof att.name === "string" ? att.name : "untitled",
              mimeType: typeof att.mimeType === "string" ? att.mimeType : "application/octet-stream",
              size: bytes.length,
              bytes,
              hash,
              status: "ACTIVE",
            },
            select: { id: true },
          });
          fileId = created.id;
        }

        attachments.push({
          fileId,
          name: typeof att.name === "string" ? att.name : undefined,
          mimeType: typeof att.mimeType === "string" ? att.mimeType : undefined,
          size: typeof att.size === "number" ? att.size : bytes.length,
        });
        convertedFileIds.push(fileId);
      } catch (error) {
        console.warn("[pkm] failed to convert legacy base64 attachment:", error);
      }
    }
  }

  return { attachments, convertedFileIds };
}
