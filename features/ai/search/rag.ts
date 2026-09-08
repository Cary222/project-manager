import { searchDocuments } from "@/features/knowledge/lib/search";
import type { SearchResultItem, SearchDocumentMetadata } from "@/features/knowledge/lib/search-types";
import { prisma } from "@/shared/db/client";
import { expandToParentSections } from "@/features/knowledge/lib/parent-child";

export interface RagContext {
  results: SearchResultItem[];
  contextText: string;
  knowledgePaths?: string[];
}

export async function retrieveContext(
  query: string,
  options: {
    limit?: number;
    projectId?: string | null;
    userId?: string | null;
    viewerRole?: string | null;
    useGraph?: boolean;
  } = {}
): Promise<RagContext> {
  const { limit = 5, projectId = null, userId = null, viewerRole = null, useGraph } = options;

  const data = await searchDocuments({
    query,
    projectId,
    limit,
    viewerUserId: userId,
    viewerRole,
    useGraph,
  });

  // 会议相关查询补充检索已发布的会议纪要
  let meetingResults: SearchResultItem[] = [];
  if (/会议|周会|例会|纪要/i.test(query)) {
    try {
      const meetings = await prisma.projectMeeting.findMany({
        where: {
          status: "PUBLISHED",
          ...(projectId ? { projectId } : {}),
        },
        orderBy: { meetingDate: "desc" },
        take: 3,
        include: {
          project: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true, email: true } },
        },
      });

      meetingResults = meetings.map((m) => {
        const dateStr = m.meetingDate ? new Date(m.meetingDate).toLocaleDateString("zh-CN") : "";
        const summary = m.publishedSummary || (
          typeof m.aiSummary === "object" && m.aiSummary !== null
            ? (m.aiSummary as { summary?: string }).summary ?? ""
            : ""
        );
        return {
          id: m.id,
          type: "doc" as const,
          title: `会议纪要：${m.title}（${dateStr}）`,
          snippet: summary.trim(),
          url: `/projects/${m.projectId}?tab=meetings`,
          project: { id: m.projectId, name: m.project?.name ?? "" },
          score: 1.0,
          keywordScore: 1.0,
          semanticScore: 1.0,
          updatedAt: m.updatedAt.getTime(),
          metadata: {
            meetingId: m.id,
            meetingDate: dateStr,
            parentId: `meeting_${m.id}`,
            parentChunkId: `meeting_${m.id}`,
            sectionTitle: `会议纪要：${m.title}`,
            parentContent: summary.trim(),
            isHierarchical: true,
          } as unknown as SearchDocumentMetadata,
        };
      });
    } catch {
      // ignore meeting fetch error
    }
  }

  const rawCombined = [...meetingResults, ...data.results].slice(0, limit);
  const expandableItems = rawCombined.map((r) => ({
    ...r,
    content: r.snippet,
  }));
  const expanded = expandToParentSections(expandableItems);
  const combinedResults = expanded.map((item) => ({
    ...item,
    snippet: item.content,
  }));

  // 收集所有的图谱推理路径（GraphRAG 可解释性）
  const allPaths: string[] = [];
  for (const r of combinedResults) {
    if (r.knowledgePaths && r.knowledgePaths.length > 0) {
      for (const p of r.knowledgePaths) {
        if (!allPaths.includes(p)) allPaths.push(p);
      }
    }
  }

  const contextText = combinedResults
    .map((result, index) => {
      const metadata = result.metadata ?? {};
      const source = result.type === "ticket" ? "工单" :
                     result.type === "commit" ? "提交记录" :
                     result.type === "doc" ? "项目文档" : "笔记";

      const lines: string[] = [];
      lines.push(`[${index + 1}] ${source}：${result.title}`);

      // Surface chunk position so the LLM can pinpoint the answer inside a long
      // note (which may have been split into many chunks).
      if (typeof metadata.chunkIndex === "number" && typeof metadata.totalChunks === "number") {
        lines.push(`位置：第 ${metadata.chunkIndex + 1}/${metadata.totalChunks} 段`);
      }

      // Tell the LLM whether the note's attachments have been indexed yet.
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
    results: combinedResults,
    contextText,
    knowledgePaths: allPaths.length > 0 ? allPaths : undefined,
  };
}

export function buildRagPrompt(query: string, context: RagContext): string {
  if (!context.contextText) {
    return `你是项目管理的 AI 助手。请回答用户的问题。

用户问题：${query}

注意：知识库中没有找到相关信息，请根据你的知识回答，并说明这一点。`;
  }

  const pathSection = context.knowledgePaths && context.knowledgePaths.length > 0
    ? `\n\n## 实体关联拓扑路径（GraphRAG 辅助推理线索）\n${context.knowledgePaths.map((p) => `- ${p}`).join("\n")}`
    : "";

  return `你是项目管理的 AI 助手，擅长分析项目工单、提交记录和个人笔记来回答用户问题。${pathSection}

## 知识库检索结果
${context.contextText}

## 回答要求
1. 基于以上检索结果回答用户问题
2. 如果检索结果与问题相关，请引用来源（包括"第 N/M 段"以便用户定位）
3. 如果某条检索结果的"附件状态"显示还有未索引的附件，告知用户"该笔记还有 X 个附件正在后台索引，当前可检索的是已索引的部分"——不要笼统地说"我无法访问附件"
4. 如果知识库中没有相关信息，请明确说明"根据知识库暂无相关信息"
5. 若提供了【实体关联拓扑路径】，可据此说明工单、模块与人员的关联关系，但所有具体结论仍必须以此处的切块正文为最终依据
6. 回答要简洁、专业、实用

用户问题：${query}`;
}

export interface SourceReference {
  index: number;
  title: string;
  url: string;
  type: "ticket" | "commit" | "note" | "doc";
  sources?: string[];
  knowledgePaths?: string[];
}

export function extractSourceReferences(results: SearchResultItem[]): SourceReference[] {
  return results.slice(0, 5).map((result, index) => ({
    index: index + 1,
    title: result.title,
    url: result.url,
    type: result.type,
    sources: result.sources,
    knowledgePaths: result.knowledgePaths,
  }));
}
