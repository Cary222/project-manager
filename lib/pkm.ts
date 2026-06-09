export type PkmAttachment = {
  name: string;
  url: string;
  mimeType: string;
  size: number;
};

export const PKM_ATTACHMENT_MAX_COUNT = 8;
export const PKM_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;

export function isPkmAttachment(value: unknown): value is PkmAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const item = value as Record<string, unknown>;
  return (
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    typeof item.url === "string" &&
    item.url.trim().length > 0 &&
    typeof item.mimeType === "string" &&
    item.mimeType.trim().length > 0 &&
    typeof item.size === "number" &&
    Number.isFinite(item.size) &&
    item.size >= 0
  );
}

export function normalizePkmAttachments(input: unknown) {
  if (!Array.isArray(input)) return [] as PkmAttachment[];

  const seen = new Set<string>();
  const attachments: PkmAttachment[] = [];

  for (const value of input) {
    if (!isPkmAttachment(value)) continue;

    const name = value.name.trim();
    const url = value.url.trim();
    const mimeType = value.mimeType.trim();
    const size = Math.round(value.size);

    if (!name || !url || !mimeType || size < 0 || size > PKM_ATTACHMENT_MAX_SIZE) {
      continue;
    }

    const key = `${name}:${size}:${url.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    attachments.push({
      name,
      url,
      mimeType,
      size,
    });

    if (attachments.length >= PKM_ATTACHMENT_MAX_COUNT) {
      break;
    }
  }

  return attachments;
}

/**
 * 从 Markdown 正文中提取内嵌 data URL 图片，返回图片列表和去掉这些图片后的纯正文。
 * 只处理 data:image/ 开头的内嵌图片，外部链接图片不受影响。
 */
export type InlineImage = { src: string; name: string };

const INLINE_IMAGE_PATTERN = /!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g;

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
