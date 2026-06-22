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

/**
 * 清洗从 PDF / PPTX / 文本附件提取出来的原始文本，再喂给 BGE-M3。
 *
 * 处理三类问题：
 * 1. Markdown 图片语法残留（PDF 复制粘贴来的 `![alt](data:image/...;base64,...)`）
 * 2. 大量冗余空白（PDF 页眉页脚 / 换行噪声 / 重复空格）
 * 3. PDF/OCR 特殊字符（Control characters, zero-width spaces）
 *
 * 注意：这里不调用 extractInlineImages，因为 PDF/PPTX 提取出来的文本
 * 不是完整 Markdown，! 可能出现在行中或各种位置。用更宽泛的替换。
 */
export function cleanExtractedTextForEmbedding(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1. 去掉 data:image base64 残留（PDF 复制粘贴产生）
  //    匹配：![任意文字](data:image/...;base64,XXXX) 整段抠掉
  //    也匹配孤立的 data:image/...;base64,... 序列（不带 ![]() 包裹）
  text = text.replace(/!\[[^\]]*\]\(data:image\/[^)\s]+\)/gi, "");
  text = text.replace(/data:image\/[^;\s]+;[^\s,)]+/gi, "");

  // 2. 去掉其他 data URL（不一定是图片，也可能是 PDF 里的嵌入资源）
  text = text.replace(/data:[^;\s]+;[^\s,)]+/gi, "");

  // 3. 去掉零宽字符、控制字符（OCR / PDF 复制残留）
  text = text.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202F\uFEFF]/g, " ");

  // 4. 去掉 base64 残留片段
  //    特征：长度 >= 40 的 [A-Za-z0-9+/=] 字符串，且含 >= 1 个 =
  //    注意：这个阈值足够宽，不会误伤普通文本（普通英文单词不含 =）
  text = text.replace(/[A-Za-z0-9+/]{40,}={1,3}/g, " ");

  // 5. 规范化空白
  text = text.replace(/[ \t]+\n/g, "\n");       // 行尾空格 tab 去掉
  text = text.replace(/\n{3,}/g, "\n\n");       // 超过两个连续换行缩到两个
  text = text.replace(/[ \t]{2,}/g, " ");       // 两个以上空格/tab 缩到一个
  text = text.replace(/^\s+/gm, "");            // 行首空白去掉

  return text.trim();
}
