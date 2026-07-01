/**
 * 文档/文本分块工具。
 * 服务端上传 / Worker 向量化 / 迁移脚本共用。
 */

const DEFAULT_MAX_CHARS = 1500;
const DEFAULT_OVERLAP = 200;

/**
 * 把长文本按字符数切块，重叠区保证语义连续性。
 * @param text 原始文本
 * @param maxChars 单块最大字符数（默认 1500）
 * @param overlap 相邻块重叠字符数（默认 200）
 */
export function splitIntoChunks(
  text: string,
  maxChars = DEFAULT_MAX_CHARS,
  overlap = DEFAULT_OVERLAP,
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const end = Math.min(cursor + maxChars, normalized.length);
    let slice = normalized.slice(cursor, end);

    // 尝试在边界处找到更自然的断点
    if (end < normalized.length) {
      const lastParagraph = slice.lastIndexOf("\n\n");
      const lastSentence = slice.lastIndexOf("。");
      const lastNewline = slice.lastIndexOf("\n");
      const breakPoint = Math.max(lastParagraph, lastSentence, lastNewline);
      if (breakPoint > maxChars * 0.5) {
        slice = slice.slice(0, breakPoint);
      }
    }

    chunks.push(slice.trim());
    cursor += slice.length - overlap;
  }
  return chunks;
}

export const CHUNK_DEFAULTS = {
  maxChars: DEFAULT_MAX_CHARS,
  overlap: DEFAULT_OVERLAP,
} as const;
