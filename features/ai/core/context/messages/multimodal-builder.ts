/**
 * Multimodal Content Builder — pure function.
 *
 * 把 (text, imageUrls[]) → LangChain HumanMessage content 结构。
 *
 * 与 messages-builder 的关系：
 * - messages-builder 仍然接受 string 形式的 currentMessage
 * - 但 messages-builder 现在会读 currentInput.multimodal 字段
 *   来构造 [{ type: "text", text }, { type: "image_url", image_url: { url } }]
 *
 * 关键约束：
 * - 无图片时退化为字符串 content（LangChain 默认路径，行为不变）
 * - 有图片时使用 array content（OpenAI Chat Completions 风格）
 * - 始终是 HumanMessage 而不是 SystemMessage（多模态只对 user role 有意义）
 */

export type MultimodalTextPart = { type: "text"; text: string };
export type MultimodalImagePart = { type: "image_url"; image_url: { url: string } };
export type MultimodalPart = MultimodalTextPart | MultimodalImagePart;

/**
 * 构造多模态 HumanMessage content。
 *
 * @param text 用户输入的文本（必填，即使只有图片也要有 text 字段占位）
 * @param imageUrls data URI 或 https URL 列表
 * @returns
 *   - 无图片：返回 string（向后兼容所有非多模态路径）
 *   - 有图片：返回 MultimodalPart[] 数组
 */
export function buildMultimodalContent(
  text: string,
  imageUrls?: string[],
): string | MultimodalPart[] {
  if (!imageUrls || imageUrls.length === 0) {
    return text;
  }
  const parts: MultimodalPart[] = [{ type: "text", text }];
  for (const url of imageUrls) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
}

/**
 * 反向：从 BaseMessage.content 拆出 text 和 imageUrls。
 * 用于在 generate-response 中读取当前消息的 image part（追加搜索上下文时不能覆盖）。
 */
export function extractTextAndImageUrls(
  content: string | MultimodalPart[],
): { text: string; imageUrls: string[] } {
  if (typeof content === "string") {
    return { text: content, imageUrls: [] };
  }
  let text = "";
  const imageUrls: string[] = [];
  for (const part of content) {
    if (part.type === "text") {
      text = text ? `${text}\n\n${part.text}` : part.text;
    } else {
      imageUrls.push(part.image_url.url);
    }
  }
  return { text, imageUrls };
}
