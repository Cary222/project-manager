import { tool } from "ai";
import { z } from "zod";
import { retrieveContext } from "@/features/ai/search/rag";
import { speculationCache } from "@/features/ai/search/speculation-cache";

/**
 * searchKnowledge uses module-scoped viewerUserId and conversationId that are
 * injected per-request via setters. This is because Agnes does NOT support
 * `contextSchema` (Vercel AI SDK extension), so we cannot pass runtime context
 * through toolsContext.
 */
let currentViewerUserId: string | null = null;
let currentConversationId: string | null = null;

export function setSearchKnowledgeViewer(userId: string | null) {
  currentViewerUserId = userId;
}

export function setSearchKnowledgeConversationId(conversationId: string | null) {
  currentConversationId = conversationId;
}

export const searchKnowledge = tool({
  description:
    `【语义搜索 - 深度检索工具】
定位：分层查询的第二步（深挖），不适用于快速浅查

适用场景：
- 搜索用户个人笔记或公司知识库（如"上次讨论的 X"、"关于 Y 的笔记"）
- 语义模糊的问题（用户说不清楚要找什么，但能描述内容）
- 需要附件内容、讨论上下文时
- 需要跨类型综合结果（同时涉及人+工单+笔记的讨论）
- 关键词不明确时（如"最近相关的讨论"、"类似的问题"）

输出特点：
- 返回相关文档片段 + 在长笔记中的位置（第 N/M 段）
- 附件状态提示（哪些附件已索引、哪些正在后台索引）
- 语义相似度排序

【不擅长 - 请用 searchStructured】：
- 精确 ID 查询（工单号 #10156、项目 ID、commit SHA）→ 用 searchStructured
- 进度统计、完成率、逾期数统计 → 用 searchStructured
- 列出所有活跃项目、用户工单列表 → 用 searchStructured`,
  inputSchema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ query, limit }) => {
    // 优先检查预测性缓存
    if (currentConversationId) {
      const cached = speculationCache.get(currentConversationId, query);
      if (cached) {
        console.log(
          `[searchKnowledge] cache HIT for "${query.slice(0, 50)}", returning ${cached.results.length} results`
        );
        return cached;
      }
    }

    // 缓存未命中，执行真正的检索
    try {
      const result = await retrieveContext(query, {
        limit,
        userId: currentViewerUserId,
      });
      console.log(`[searchKnowledge.execute] query="${query.slice(0,40)}" results=${Array.isArray(result.results) ? result.results.length : typeof result.results} contextLen=${result.contextText.length} typeof_result=${typeof result} constructor=${result?.constructor?.name} keys=${result ? Object.keys(result).join(',') : 'null'}`);

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 当 embedding 服务不可用时，返回一个明确的提示消息
      // 让 AI 可以告知用户知识库检索暂时不可用
      if (
        msg.includes("EMBEDDING_API_URL_MISSING") ||
        msg.includes("EMBEDDING_API_TIMEOUT") ||
        msg.includes("EMBEDDING_API_HTTP") ||
        msg.includes("EMBEDDING_VECTOR_INVALID") ||
        msg.includes("EMBEDDING_DIMENSION")
      ) {
        console.warn(`[searchKnowledge] Embedding service unavailable: ${msg}`);
        return {
          results: [],
          contextText: "",
          _error: `知识库检索暂时不可用（${msg}）。建议用户稍后重试，或使用 searchStructured 工具进行精确查询。`,
        };
      }
      // 其他错误仍然抛出
      throw error;
    }
  },
});