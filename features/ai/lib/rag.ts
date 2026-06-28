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
      return `[${index + 1}] ${source}：${result.title}\n${result.snippet}`;
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
2. 如果检索结果与问题相关，请引用来源
3. 如果知识库中没有相关信息，请明确说明"根据知识库暂无相关信息"
4. 回答要简洁、专业、实用

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
