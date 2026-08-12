/**
 * task-router.ts — Frontend lightweight intent resolution for Auto mode UX hint.
 *
 * Responsibilities:
 * - Provide a lightweight, non-authoritative hint for UI feedback
 * - Used only in Auto mode to show users what the system is detecting
 * - Does NOT affect actual agent routing (that is handled by detect-intent.ts)
 *
 * Authority: NON-AUTHORITATIVE
 * Actual task routing is done by: features/ai/agents/conversation/nodes/detect-intent.ts
 */

/** Task category for frontend display */
export type AiTaskCategory = "chat" | "image" | "video";

/** Tool sub-mode within chat category */
export type ChatToolMode = "chat" | "search" | "web";

/** Resolved intent from frontend analysis */
export interface ResolvedAiIntent {
  category: AiTaskCategory;
  toolMode?: ChatToolMode;
}

/**
 * Resolve user input to a task category for frontend display.
 *
 * Three-layer logic:
 * 1. Explicit generation intent (verb + object) → image/video
 * 2. Weak generation intent (question patterns) → chat with toolMode
 * 3. Everything else → chat
 */
export function resolveIntent(input: string): ResolvedAiIntent {
  const trimmed = input.trim();

  // ─── Layer 1: Explicit generation intent ───────────────────────────────────

  // 图片生成：三步检测
  // 1. 标准分离正则（动词 + 对象分别检测）
  // 2. 有量词或"的" → 直接触发 image
  // 3. 无量词/de：检查对象词独立性
  //    - 重叠（objStart < verbEnd）：对象词与动词某字重叠
  //      - 末尾对象词（afterObj === undefined）→ 不是复合词，不触发
  //      - 后续字符 ≠ 对象词首字 → 是复合词（如"风景画"）→ 触发
  //    - 不重叠：检查单字动词+单字对象（相邻相同）→ 不触发
  const imageVerbPattern = /(?:帮我|请)?(?:生成|画|创作|制作|做)(?:一张|一幅)?/i;
  const imageObjectPattern = /(?:图片?|图|画像|照片|封面|海报|画)/i;
  const hasImageIntent = imageVerbPattern.test(trimmed) && imageObjectPattern.test(trimmed);
  if (hasImageIntent) {
    const hasQuantifier = /(?:一张|一幅)/.test(trimmed);
    const hasDe = /的/.test(trimmed);
    if (hasQuantifier || hasDe) {
      return { category: "image" };
    }
    const verbMatch = imageVerbPattern.exec(trimmed);
    const objMatch = imageObjectPattern.exec(trimmed);
    if (verbMatch && objMatch) {
      const verbEnd = verbMatch.index + verbMatch[0].length;
      const objStart = objMatch.index;
      const objWord = objMatch[0];
      if (objStart < verbEnd) {
        const afterObj = trimmed[objStart + objWord.length];
        if (afterObj !== undefined && afterObj !== objWord[0]) {
          return { category: "image" };
        }
      } else {
        const verbText = verbMatch[0].replace(/^(?:帮我|请)?/, "");
        const isSameSingle = verbText.length === 1 && objWord === verbText && objStart === verbEnd;
        if (!isSameSingle) {
          return { category: "image" };
        }
      }
    }
  }

  // 视频生成：动词 + 对象
  const videoVerbPattern = /(?:帮我|请)?(?:生成|制作|创作)(?:一个?|段?)?/i;
  const videoObjectPattern = /(?:视频?|短片|动画|影片)/i;
  if (videoVerbPattern.test(trimmed) && videoObjectPattern.test(trimmed)) {
    return { category: "video" };
  }

  // ─── Layer 2: Weak generation intent → chat with toolMode ───────────────────

  // 知识库检索模式（先判断，避免被弱生成模式覆盖）
  if (/(?:知识库|文档|rga|RAG)/i.test(trimmed)) {
    return { category: "chat", toolMode: "search" };
  }

  // 联网搜索模式
  if (/(?:天气|联网|搜索|实时)/i.test(trimmed)) {
    return { category: "chat", toolMode: "web" };
  }

  // 讨论/查询类模式（怎么、是什么、为什么、对比、分析等）
  const weakGenerationPatterns =
    /(?:怎么|如何|是什么|为什么|哪个好|有哪些|对比|分析|介绍|讲解|说明|原理|技术|方法|思路)/i;
  if (weakGenerationPatterns.test(trimmed)) {
    // 默认通用对话
    return { category: "chat", toolMode: "chat" };
  }

  // ─── Layer 3: Default → chat ───────────────────────────────────────────────
  return { category: "chat", toolMode: "chat" };
}

/**
 * Get a short task hint string for frontend display.
 * Returns undefined for chat category (no specific hint needed).
 */
export function getTaskHint(intent: ResolvedAiIntent): string | undefined {
  if (intent.category === "image") return "image";
  if (intent.category === "video") return "video";
  return undefined;
}
