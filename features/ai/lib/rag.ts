import { searchDocuments } from "@/shared/lib/search";
import type { SearchResultItem } from "@/shared/lib/search-types";

export interface RagContext {
  results: SearchResultItem[];
  contextText: string;
}

export async function retrieveContext(
  query: string,
  options: { limit?: number; projectId?: string | null; userId?: string | null } = {}
): Promise<RagContext> {
  const { limit = 5, projectId = null, userId = null } = options;

  const data = await searchDocuments({
    query,
    projectId,
    limit,
    viewerUserId: userId,
  });

  const contextText = data.results
    .map((result, index) => {
      const metadata = result.metadata ?? {};
      const source = result.type === "ticket" ? "工单" :
                     result.type === "commit" ? "提交记录" : "笔记";

      const lines: string[] = [];
      lines.push(`[${index + 1}] ${source}：${result.title}`);

      // Surface chunk position so the LLM can pinpoint the answer inside a long
      // note (which may have been split into many chunks).
      if (typeof metadata.chunkIndex === "number" && typeof metadata.totalChunks === "number") {
        lines.push(`位置：第 ${metadata.chunkIndex + 1}/${metadata.totalChunks} 段`);
      }

      // Tell the LLM whether the note's attachments have been indexed yet.
      // Otherwise it falls back to "我无法访问附件" — which is technically
      // true but unhelpful: the user uploaded those attachments on purpose.
      if (result.type === "note" && (metadata.noteAttachmentCount ?? 0) > 0) {
        const total = metadata.noteAttachmentCount ?? 0;
        const indexed = metadata.noteIndexedAttachmentCount ?? 0;
        if (indexed < total) {
          lines.push(`附件状态：该笔记共 ${total} 个附件，已索引 ${indexed} 个（剩余 ${total - indexed} 个正在后台索引，约 1-2 分钟内可检索）`);
        } else if (indexed > 0) {
          lines.push(`附件状态：${total} 个附件已全部索引`);
        }
      }

      lines.push(result.snippet);
      return lines.join("\n");
    })
    .join("\n\n");

  return {
    results: data.results,
    contextText,
  };
}

export function buildRagPrompt(query: string, context: RagContext): string {
  if (!context.contextText) {
    return `你是项目管理的 AI 助手。请回答用户的问题。

用户问题：${query}

注意：知识库中没有找到相关信息，请根据你的知识回答，并说明这一点。`;
  }

  return `你是项目管理的 AI 助手，擅长分析项目工单、提交记录和个人笔记来回答用户问题。

## 知识库检索结果
${context.contextText}

## 回答要求
1. 基于以上检索结果回答用户问题
2. 如果检索结果与问题相关，请引用来源（包括"第 N/M 段"以便用户定位）
3. 如果某条检索结果的"附件状态"显示还有未索引的附件，告知用户"该笔记还有 X 个附件正在后台索引，当前可检索的是已索引的部分"——不要笼统地说"我无法访问附件"
4. 如果知识库中没有相关信息，请明确说明"根据知识库暂无相关信息"
5. 回答要简洁、专业、实用

用户问题：${query}`;
}

export interface SourceReference {
  index: number;
  title: string;
  url: string;
  type: "ticket" | "commit" | "note";
}

export function extractSourceReferences(results: SearchResultItem[]): SourceReference[] {
  return results.slice(0, 5).map((result, index) => ({
    index: index + 1,
    title: result.title,
    url: result.url,
    type: result.type,
  }));
}
