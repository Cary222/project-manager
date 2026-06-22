import { extractInlineImages, type PkmAttachment } from "@/shared/lib/pkm";

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const EXTERNAL_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const FENCED_CODE_BLOCK_PATTERN = /```[\w-]*\n?([\s\S]*?)```/g;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;

export function cleanMarkdownForEmbedding(markdown: string): string {
  if (!markdown) return "";

  const { plainContent } = extractInlineImages(markdown);

  let cleaned = plainContent.replace(MARKDOWN_LINK_PATTERN, (_match, text: string) => text);

  cleaned = cleaned.replace(EXTERNAL_IMAGE_PATTERN, (_match, alt: string) => alt.trim());

  cleaned = cleaned.replace(FENCED_CODE_BLOCK_PATTERN, (_match, code: string) => code);

  cleaned = cleaned.replace(INLINE_CODE_PATTERN, (_match, code: string) => code);

  cleaned = cleaned
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*\|?\s*[-:|\s]+\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/^---+$/gm, "")
    .replace(/^\*\*\*+$/gm, "");

  cleaned = cleaned.replace(/[ \t]+\n/g, "\n");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.replace(/[ \t]{2,}/g, " ");

  return cleaned.trim();
}

export function formatAttachmentLabel(attachment: Pick<PkmAttachment, "name" | "mimeType">): string {
  const name = attachment.name.trim();
  const mimeType = attachment.mimeType.trim();
  if (!mimeType) return name;
  return `${name} (${mimeType})`;
}
