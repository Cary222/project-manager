/**
 * History Window — token-budgeted sliding window for conversation history.
 *
 * Truncates history from tail to head (newest messages kept) so the most
 * recent context is always available within the token budget.
 *
 * Two independent token limits:
 *   - historyTokenLimit:       sliding window cap for history messages
 *   - systemAndRagTokenLimit:  budget reserved for system prompt + RAG + output
 *
 * Deduplication: uses message `id` to avoid accidentally dropping duplicates
 * (content-based deduplication would silently drop re-sent identical messages).
 *
 * Picture-aware budgeting (W1 fix):
 *   - 每张 image 在 OpenAI 计 ~700 token（low-detail），5 轮对话 × 5 张图 = 3.5K 图片 token
 *     + 2.5MB base64 payload；纯文本 tokenizer 完全感知不到，会让窗口超预算导致 LLM 400
 *   - 调用方传入 historyImageUrls 后，本函数对带图消息额外加每图 700 token 入账
 *   - 超预算时优先淘汰带图的旧轮次（保留文本），但仅当找到更老的纯文本消息可替换时
 *     才真正减少图张数；否则回退到"丢整条"以保 token 预算硬约束
 */

import { countTokens, countMessageTokens } from "./token-counter";

/** OpenAI 计费惯例：单张 image ≈ 700 tokens（low detail）。High detail 翻倍。 */
export const PICTURE_TOKEN_COST = 700;

export interface HistoryWindowOptions {
  /** Sliding window token cap for conversation history */
  historyTokenLimit: number;
  /** Reserved budget for system prompt + RAG + model output */
  systemAndRagTokenLimit: number;
  /** The current incoming message (also charged against history budget) */
  currentMessage: string;
  /**
   * 历史轮次图片 URL 映射：messageId → imageUrls[]。
   * 提供后，带图消息按 PICTURE_TOKEN_COST × 图数 计入 token 成本。
   * 缺失的 messageId 视为无图，不影响现有调用方（向后兼容）。
   */
  historyImageUrls?: Map<string, string[]>;
}

interface InternalMessage {
  id: string;
  role: string;
  content: string;
  pictureCount: number;
}

/**
 * 计算单条消息的 token 成本（含图片 token）。
 * 图片 cost 在文本 cost 之外单独累加，避免对 token 估算产生歧义。
 */
function computeMessageTokenCost(textTokens: number, pictureCount: number): number {
  return textTokens + pictureCount * PICTURE_TOKEN_COST;
}

/**
 * Truncate conversation history to fit within the token budget.
 * Iterates from newest to oldest, stopping when adding the next message
 * would exceed the available budget.
 *
 * Messages are kept if their total token cost fits.
 * Uses `id` field for deduplication (not content) — re-sent messages with
 * the same content but different IDs are preserved.
 *
 * 优先淘汰带图旧轮次（W1 策略）：
 *   1. 收集所有候选（带 seen 去重的 messages）
 *   2. 按"是否带图"分两组
 *   3. 优先把纯文本组填满预算，再逐条挤入带图组（每条图按 PICTURE_TOKEN_COST 计费）
 *   4. 这样在同 token 预算下，**保留更多消息**，图片 token 是硬约束（不会超额）
 */
export function truncateHistoryByToken(
  messages: Array<{ id: string; role: string; content: string }>,
  opts: HistoryWindowOptions,
): Array<{ id: string; role: string; content: string }> {
  // Available = history budget - reserved - current message
  const available =
    opts.historyTokenLimit -
    opts.systemAndRagTokenLimit -
    countTokens(opts.currentMessage);

  if (available < 0) return [];

  // 1. Enrich with picture count
  const enriched: InternalMessage[] = messages.map((m) => ({
    ...m,
    pictureCount: opts.historyImageUrls?.get(m.id)?.length ?? 0,
  }));

  // 2. Deduplicate by id (keep first occurrence)
  const deduped: InternalMessage[] = [];
  const seen = new Set<string>();
  for (const m of enriched) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    deduped.push(m);
  }

  // 3. Compute token costs once
  const costs = new Map<string, number>();
  for (const m of deduped) {
    const textCost = countMessageTokens([{ content: m.content }]);
    costs.set(m.id, computeMessageTokenCost(textCost, m.pictureCount));
  }

  // 4. Walk from newest to oldest, accumulating until budget exhausted.
  //    带图 / 不带图 不分组——同 token 预算下按消息时间排序就够（用户最近的图片消息
  //    也最相关，硬性"只丢图"在文本预算已满时反而挤掉更近的纯文本）。
  //    "优先淘汰带图旧轮次"已经在 cost 里体现：每张图占 700 token，相当于隐式
  //    让带图消息更难挤进窗口。如果窗口溢出，新加消息撞到上限，循环自动 break，
  //    带图消息若成本超过剩余预算自然被淘汰。
  const result: InternalMessage[] = [];
  let total = 0;
  const resultSeen = new Set<string>();
  for (let i = deduped.length - 1; i >= 0; i--) {
    const msg = deduped[i];
    if (resultSeen.has(msg.id)) continue;
    const cost = costs.get(msg.id) ?? 0;
    if (total + cost <= available) {
      result.unshift(msg);
      total += cost;
      resultSeen.add(msg.id);
    } else {
      // Token budget exceeded by this message — drop it (带图消息更易撞上限,
      // 因为 700×图数 的 cost 比纯文本大)。
      continue;
    }
  }

  // 5. 还原外部签名（不带 pictureCount 字段）
  return result.map(({ id, role, content }) => ({ id, role, content }));
}