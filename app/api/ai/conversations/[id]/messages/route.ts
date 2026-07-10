import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { streamText, stepCountIs } from "ai";
import { requireSession } from "@/shared/lib/permissions";
import {
  appendMessage,
  getConversation,
  getOrCreateProfile,
} from "@/features/ai/lib/conversation-store";
import { retrieveContext, buildRagPrompt, extractSourceReferences } from "@/features/ai/lib/rag";
import type { SourceReference as RagSourceReference } from "@/features/ai/lib/rag";
import { speculationCache, shouldSpeculate } from "@/features/ai/lib/speculation-cache";
import { enqueueSummarizeConversation } from "@/features/ai/lib/background-jobs";
import { agnesFlash } from "@/features/ai/lib/agnes-provider";
import { toolsetForMode, maxStepsForMode } from "@/features/ai/tools";
import { setSearchKnowledgeViewer, setSearchKnowledgeConversationId } from "@/features/ai/tools/search-knowledge";
import { setSearchStructuredViewer } from "@/features/ai/tools/search-structured";

type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
};

interface StructuredToolOutput {
  summary: string;
  sources: Array<{ index: number; title: string; url: string; type: string }>;
  _debug?: string;
}

function extractSourcesFromToolResults(
  toolResults: Array<{ toolName: string; output: unknown }>,
  ragSources: RagSourceReference[] = []
): RagSourceReference[] {
  const sources: RagSourceReference[] = [];
  let index = 1;

  // Add RAG sources first
  for (const src of ragSources) {
    sources.push({ ...src, index: index++ });
  }

  for (const { toolName, output } of toolResults) {
    if (!output || typeof output !== "object") continue;
    const o = output as Record<string, unknown>;

    // Handle searchStructured with _debug marker (new structured format)
    if (toolName === "searchStructured" && o._debug === "structured_with_sources" && Array.isArray(o.sources)) {
      for (const src of o.sources as StructuredToolOutput["sources"]) {
        sources.push({
          index: index++,
          title: src.title,
          url: src.url,
          type: src.type as RagSourceReference["type"],
        });
      }
    }
  }

  return sources;
}

const messageSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationHistory: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .optional(),
  mode: z.enum(["auto", "search", "chat", "web"]).optional().default("auto"),
  forceSearch: z.boolean().optional().default(false),
});

function buildSystemPrompt(
  userName: string,
  mode: string,
  useRag: boolean,
  profile: unknown
): string {
  const baseIntro = `你叫"小星"，是恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。`;

  const ragDuty = `${baseIntro}你的职责是帮助用户：1. 了解项目工单状态和进度 2. 查找相关的提交记录 3. 回顾个人笔记和知识库内容 4. 解答项目管理相关问题。`;
  const chatDuty = `${baseIntro}你的职责是帮助用户进行日常对话和问题解答，擅长：项目管理相关问题的咨询和建议；技术讨论和方案设计；日常工作的沟通和协调；通用知识问题的解答。`;

  const duty = useRag ? ragDuty : chatDuty;
  const style = "回答特点：简洁、专业、友好；善用列表和结构化表达；主动提供相关链接和操作建议；遇到不确定的问题，诚实说明。";
  const userContext = `当前用户：${userName}`;

  // Mode-specific tool guidance — supplements the hard rules below.
  // Without explicit mode context the model infers which tool to use and often picks
  // searchStructured for people queries even when searchKnowledge would be better.
  const modeHints: Record<string, string> = {
    search: `【知识检索模式必须遵守以下规则】
RULE 1（最高优先级）：第一步必须调用 searchKnowledge，输入用户原话（如"许敏捷最近在干啥"）即可。
RULE 2（绝对禁止）：禁止用 searchStructured 的 type=user 或 userId="中文名" 去查人，searchKnowledge 比它精准得多。
RULE 3：searchKnowledge 返回结果后，再用 searchStructured 补充查工单/周报详情（用 resolved userId）。`,
    auto: `【通用模式】先用 searchStructured 快速查询工单和周报；如果搜索结果不理想，再用 searchKnowledge 做深度语义检索。`,
    web: `【联网模式】先用 webSearch 联网搜索；必要时用 searchStructured 查项目内部数据。`,
    chat: ``,
  };
  const modeHint = modeHints[mode] ?? modeHints.auto ?? "";

  // Hard rules for tool usage — without these the model often picks the wrong type
  // and (because stopWhen caps steps) ends up with no text at all.
  // NOTE: search mode uses its own rules in modeHint above to avoid conflict here.
  const toolRules = mode === "search" ? `` : `
工具使用硬规则：
- 用户问"某人在做什么 / 最近开发 / 周报 / 工单"时，user 参数必须用 type=user 或 type=weekly_report，绝不要用 type=ticket 去反查。
- 如果一次工具调用返回"未找到"或"没有找到符合条件的"，必须换一种 type 或参数重试；不要直接放弃。
- 即使工具全部失败，也必须给用户一段自然语言回复（说明已尝试但暂无数据），绝不输出空回复。`;

  const profileSummary = formatProfile(profile);
  const profileBlock = profileSummary
    ? `\n${profileSummary}`
    : "";

  return `${duty}\n${style}\n${userContext}${profileBlock}${toolRules}${modeHint}`;
}

function formatProfile(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;
  const sections: string[] = [];

  const arr = (key: string, label: string) => {
    const v = p[key];
    if (Array.isArray(v) && v.length > 0) {
      sections.push(`${label}：${(v as unknown[]).join("、")}`);
    }
  };

  arr("roles", "角色");
  arr("interests", "兴趣");
  arr("expertise", "专长");
  arr("projects", "参与项目");
  arr("recentTopics", "近期话题");

  if (p.preferences && typeof p.preferences === "object") {
    const entries = Object.entries(p.preferences as Record<string, unknown>);
    if (entries.length > 0) {
      sections.push(
        `偏好：${entries.map(([k, v]) => `${k}=${String(v)}`).join("、")}`
      );
    }
  }

  return sections.length > 0 ? `用户画像：\n${sections.join("\n")}` : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    console.log(`[AI-MSG] POST start conv`);
    const session = await requireSession();
    const { id: conversationId } = await params;
    const body = await request.json();
    const { message, conversationHistory, mode, forceSearch } =
      messageSchema.parse(body);
    console.log(`[AI-MSG] parsed message="${message.slice(0, 80)}" mode=${mode}`);

    const conversation = await getConversation(conversationId, session.user.id);
    if (!conversation) {
      return NextResponse.json(
        { data: null, error: "Conversation not found" },
        { status: 404 }
      );
    }

    const [userProfile, appendUserMsg] = await Promise.all([
      getOrCreateProfile(session.user.id),
      appendMessage(conversationId, "user", message),
    ]);
    const profileData = userProfile?.profile ?? {};

    const useRag =
      mode === "search" ||
      (mode === "auto" && forceSearch);

    const ragPromise = useRag
      ? retrieveContext(message, { limit: 5, userId: session.user.id })
      : Promise.resolve({ results: [] as Awaited<ReturnType<typeof retrieveContext>>["results"], contextText: "" });

    // 预测性预加载：在 auto 模式下，检测到可能需要深挖时缓存 RAG 结果
    // 复用 ragPromise 结果，避免重复调用 retrieveContext
    if (mode === "auto" && shouldSpeculate(message)) {
      console.log(`[AI-MSG] speculation triggered for "${message.slice(0, 50)}"`);
      ragPromise
        .then((context) => {
          if (context.results.length > 0) {
            speculationCache.set(conversationId, message, context);
          }
        })
        .catch((e) => {
          console.log(`[AI-MSG] speculation prefetch failed: ${e}`);
        });
    }

    const systemPrompt = buildSystemPrompt(
      session.user.name || session.user.email,
      mode,
      useRag,
      profileData
    );

    const messages: Message[] = [];

    if (conversationHistory?.length) {
      for (const msg of conversationHistory.slice(-10)) {
        messages.push({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    const tools = toolsetForMode(mode);
    const isRagToolEnabled = tools && "searchKnowledge" in tools;
    const maxSteps = maxStepsForMode(mode as "auto" | "web" | "search" | "chat");

    console.log(`[AI-MSG] tools=${tools ? Object.keys(tools).join(",") : "none"} useRag=${useRag} maxSteps=${maxSteps}`);

    // Inject viewer userId and conversationId into module-scoped tool closures.
    // Necessary because Agnes does not support `toolsContext` / `contextSchema`.
    setSearchKnowledgeViewer(session.user.id);
    setSearchKnowledgeConversationId(conversationId);
    setSearchStructuredViewer(session.user.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = streamText({
      model: agnesFlash,
      system: systemPrompt,
      messages: [...messages, { id: "current", role: "user", content: message }],
      tools,
      // stopWhen: 在 stepCountIs(N) 时触发停止，此时模型已没有新 step 可用，
      // 会完成当前 step 的文本生成（不会中断正在生成的文本）
      stopWhen: stepCountIs(maxSteps),
      onFinish: async ({ text }) => {
        console.log(`[AI-MSG] onFinish textLen=${text?.length ?? 0} preview="${(text ?? "").slice(0, 80)}"`);
        const context = await ragPromise;
        const sources = isRagToolEnabled ? extractSourceReferences(context.results) : [];
        await appendMessage(conversationId, "assistant", text, sources.length > 0 ? sources : undefined);
        enqueueSummarizeConversation(conversationId, { force: true });
      },
    });

    const responseStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const enqueueData = (obj: object) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
          );
        };

        const toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
        const toolResults: Array<{ toolCallId: string; toolName: string; output: unknown }> = [];
        let ragSources: RagSourceReference[] = [];

        let textDeltaCount = 0;
        let totalTextChars = 0;
        let toolCallCount = 0;
        let toolResultCount = 0;
        let unknownPartCount = 0;
        const partTypes: string[] = [];

        try {
          console.log(`[AI-SSE] start conv=${conversationId} toolNames=[${tools ? Object.keys(tools).join(",") : "none"}]`);
          enqueueData({
            type: "conversation",
            id: conversationId,
            title: conversation.title,
          });

          for await (const part of result.fullStream) {
            partTypes.push(part.type);
            switch (part.type) {
              case "text-delta":
                textDeltaCount++;
                totalTextChars += part.text?.length ?? 0;
                enqueueData({ type: "text", delta: part.text });
                break;
              case "tool-call":
                toolCallCount++;
                toolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
                enqueueData({
                  type: "tool_call",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input,
                });
                break;
              case "tool-result":
                toolResultCount++;
                toolResults.push({ toolCallId: part.toolCallId, toolName: part.toolName, output: part.output });
                enqueueData({
                  type: "tool_result",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  output: part.output,
                });
                break;
              case "tool-error":
                enqueueData({
                  type: "tool_error",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  error: part.error instanceof Error ? part.error.message : String(part.error),
                });
                break;
              default:
                unknownPartCount++;
                break;
            }
          }
          console.log(
            `[AI-SSE] fullStream done. textDelta=${textDeltaCount}, textChars=${totalTextChars}, toolCall=${toolCallCount}, toolResult=${toolResultCount}, unknown=${unknownPartCount}, partTypes=[${partTypes.join(",")}]`
          );

          // (textStream fallback removed — it replays deltas already emitted by fullStream,
//  doubling every chunk on multi-step calls. fullStream's text-delta is the single
//  source of truth; result.text below is the safety net for the rare case where
//  the final step's text is not flushed as deltas.)

          // Final safety net: if no deltas were emitted, stream the resolved text once.
          try {
            const fullText = await result.text;
            console.log(`[AI-SSE] result.text len=${fullText?.length ?? 0}, preview="${(fullText ?? "").slice(0, 80)}"`);
            if (totalTextChars === 0 && fullText && fullText.length > 0) {
              console.log(`[AI-SSE] no deltas emitted, falling back to result.text`);
              enqueueData({ type: "text", delta: fullText });
              totalTextChars = fullText.length;
            }
          } catch (textErr) {
            console.log(`[AI-SSE] result.text read failed: ${textErr instanceof Error ? textErr.message : String(textErr)}`);
          }
        } catch (err) {
          console.error(`[AI-SSE] stream error:`, err);
          const msg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
            )
          );
        }

        console.log(`[AI-SSE] end conv=${conversationId} textCharsSent=${totalTextChars}`);

        // Extract and send sources from tool results and RAG
        try {
          const ragContext = await ragPromise;
          ragSources = isRagToolEnabled ? extractSourceReferences(ragContext.results) : [];
        } catch (e) {
          console.log(`[AI-SSE] failed to get RAG sources: ${e}`);
        }

        const allSources = extractSourcesFromToolResults(toolResults, ragSources);
        if (allSources.length > 0) {
          console.log(`[AI-SSE] sending sources event with ${allSources.length} sources`);
          enqueueData({ type: "sources", sources: allSources });
        }

        enqueueData({ type: "done" });
        controller.close();
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { data: null, error: "Invalid request body", details: err.issues },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}
