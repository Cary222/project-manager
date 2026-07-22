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
import { webSearch } from "@/features/ai/tools/web-search";
import { searchKnowledge, setSearchKnowledgeViewer, setSearchKnowledgeConversationId } from "@/features/ai/tools/search-knowledge";
import { searchStructured, setSearchStructuredViewer } from "@/features/ai/tools/search-structured";
import { shouldUseWebSearch, shouldUseRag } from "@/features/ai/lib/detector";

// LangGraph StateGraph entry point (lazy-loaded)
import { agentGraph } from "@/features/ai/graph/agent";
import { injectSearchKnowledgeContext } from "@/features/ai/graph/nodes/search-knowledge";
import { injectSearchStructuredContext } from "@/features/ai/graph/nodes/search-structured";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

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
  useWebSearch: z.boolean().optional().default(false),
  clientCity: z.string().optional(),
});

function buildSystemPrompt(
  userName: string,
  mode: string,
  useRag: boolean,
  profile: unknown,
  geo?: string | null
): string {
  const baseIntro = `你叫"小星"，是恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。`;

  const ragDuty = `${baseIntro}你的职责是帮助用户：1. 了解项目工单状态和进度 2. 查找相关的提交记录 3. 回顾个人笔记和知识库内容 4. 解答项目管理相关问题。`;
  const chatDuty = `${baseIntro}你的职责是帮助用户进行日常对话和问题解答，擅长：项目管理相关问题的咨询和建议；技术讨论和方案设计；日常工作的沟通和协调；通用知识问题的解答。`;

  const duty = useRag ? ragDuty : chatDuty;
  const style = "回答特点：简洁、专业、友好；善用列表和结构化表达；主动提供相关链接和操作建议；遇到不确定的问题，诚实说明。";
  const userContext = `当前用户：${userName}`;
  const geoContext = geo ? `\n用户所在城市：${geo}（用于天气等实时数据查询）` : "";

  // Mode-specific tool guidance — supplements the hard rules below.
  // Without explicit mode context the model infers which tool to use and often picks
  // searchStructured for people queries even when searchKnowledge would be better.
  const modeHints: Record<string, string> = {
    search: `【知识检索模式必须遵守以下规则】
RULE 1（最高优先级）：第一步必须调用 searchKnowledge，输入用户原话（如"许敏捷最近在干啥"）即可。
RULE 2（绝对禁止）：禁止用 searchStructured 的 type=user 或 userId="中文名" 去查人，searchKnowledge 比它精准得多。
RULE 3：searchKnowledge 返回结果后，再用 searchStructured 补充查工单/周报详情（用 resolved userId）。`,
    auto: `【通用模式规则】
第一步：根据用户消息判断意图。
  - 如果问天气、新闻、实时数据（股价/汇率/比赛结果等），立即调用 webSearch，query 加上用户所在城市（如"北京 天气"）。
  - 如果问项目内部数据（工单/人/周报/模块），先用 searchStructured 快速查询；如果结果不理想，再用 searchKnowledge 做深度语义检索。
第二步：根据工具返回结果组织最终回复。如果工具全部返回空，继续对话，不要直接放弃。`,
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

  return `${duty}\n${style}\n${userContext}${geoContext}${profileBlock}${toolRules}${modeHint}`;
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
    const { message, conversationHistory, mode, forceSearch, useWebSearch, clientCity } =
      messageSchema.parse(body);
    console.log(`[AI-MSG] parsed message="${message.slice(0, 80)}" mode=${mode}`);

    // 把客户端城市名传给 system prompt，用于天气等实时数据搜索
    const geoCity = clientCity ?? null;
    if (geoCity) {
      console.log(`[AI-MSG] client city=${geoCity}`);
    }

    const conversation = await getConversation(conversationId, session.user.id);
    if (!conversation) {
      return NextResponse.json(
        { data: null, error: "Conversation not found" },
        { status: 404 }
      );
    }

    // ── LangGraph StateGraph branch ──────────────────────────────────────────
    if (process.env.USE_LANGGRAPH === "true") {
      return handleLangGraphRequest({
        request,
        conversationId,
        message,
        conversationHistory,
        mode,
        forceSearch,
        session,
        conversation,
        clientCity: geoCity,
      });
    }
    // ── End LangGraph branch ─────────────────────────────────────────────────

    const [userProfile, appendUserMsg] = await Promise.all([
      getOrCreateProfile(session.user.id),
      appendMessage(conversationId, "user", message),
    ]);
    const profileData = userProfile?.profile ?? {};

    const useRag =
      mode === "search" ||
      (mode === "auto" && forceSearch);

    // auto 模式意图检测：优先用前端传来的 webSearch 标志（前端有地理位置）
    // 后备兜底：后端再次检测消息关键词，防止前端漏判
    const autoNeedsWeb = mode === "auto" && (useWebSearch || shouldUseWebSearch(message));

    // auto 模式深层内容查询 → 也触发 RAG
    // shouldUseRag 在 auto 模式（forceMode=undefined）时根据消息内容自动判断
    const autoNeedsRag = mode === "auto" && shouldUseRag(message);

    const ragPromise = (useRag || autoNeedsRag)
      ? retrieveContext(message, { limit: 5, userId: session.user.id })
      : Promise.resolve({ results: [] as Awaited<ReturnType<typeof retrieveContext>>["results"], contextText: "" });

    // 预测性预加载：
    // - auto 模式下浅层查询（工单/项目/人）：预热 searchKnowledge，用户深挖时直接命中缓存
    // - search 模式（强制深挖）不预热，因为会直接执行 searchKnowledge
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
      profileData,
      autoNeedsWeb ? geoCity : null
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

    // auto 模式意图检测：优先用前端传来的 webSearch 标志（前端有地理位置）
    // 后备兜底：后端再次检测消息关键词，防止前端漏判
    let resolvedTools = tools;
    let resolvedMaxSteps = maxSteps;
    if (autoNeedsWeb) {
      resolvedTools = { webSearch, searchStructured };
      resolvedMaxSteps = 15;
      console.log(`[AI-MSG] intent=WEB_SEARCH detected, useWebSearch=${useWebSearch} city=${geoCity ?? "none"}`);
    } else if (mode === "auto") {
      // 默认用项目数据库工具（searchStructured 优先）
      resolvedTools = { searchStructured, searchKnowledge };
      resolvedMaxSteps = 20;
      console.log(`[AI-MSG] intent=PROJECT_DB detected`);
    }

    console.log(`[AI-MSG] tools=${resolvedTools ? Object.keys(resolvedTools).join(",") : "none"} useRag=${useRag} maxSteps=${resolvedMaxSteps}`);

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
      tools: resolvedTools,
      // stopWhen: 在 stepCountIs(N) 时触发停止，此时模型已没有新 step 可用，
      // 会完成当前 step 的文本生成（不会中断正在生成的文本）
      stopWhen: stepCountIs(resolvedMaxSteps),
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
          console.log(`[AI-SSE] start conv=${conversationId} toolNames=[${resolvedTools ? Object.keys(resolvedTools).join(",") : "none"}]`);
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

// ── LangGraph SSE handler ────────────────────────────────────────────────────

interface LangGraphRequestOptions {
  request: NextRequest;
  conversationId: string;
  message: string;
  conversationHistory?: Array<{ id: string; role: "user" | "assistant"; content: string }>;
  mode: "auto" | "search" | "chat" | "web";
  forceSearch: boolean;
  session: { user: { id: string; name?: string | null; email?: string | null } };
  conversation: { id: string; title: string };
  clientCity: string | null;
}

async function handleLangGraphRequest(
  opts: LangGraphRequestOptions
): Promise<Response> {
  const {
    request,
    conversationId,
    message,
    conversationHistory,
    mode,
    forceSearch,
    session,
    conversation,
    clientCity,
  } = opts;

  console.log(`[AI-LangGraph] start conv=${conversationId} message="${message.slice(0, 80)}" mode=${mode}`);

  // Build message history for LangGraph (BaseMessage array)
  const langgraphMessages: import("@langchain/core/messages").BaseMessage[] = [];

  if (conversationHistory?.length) {
    for (const msg of conversationHistory.slice(-10)) {
      if (msg.role === "user") {
        langgraphMessages.push(new HumanMessage(msg.content));
      } else {
        langgraphMessages.push(new AIMessage(msg.content));
      }
    }
  }
  langgraphMessages.push(new HumanMessage(message));

  // Inject viewer context into tool closures
  injectSearchKnowledgeContext(session.user.id, conversationId);
  injectSearchStructuredContext(session.user.id);

  // Override mode from API if forceSearch is set
  const resolvedMode = forceSearch ? "search" : mode;

  const responseStream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let isClosed = false;
      const closeStream = () => {
        if (isClosed) return;
        isClosed = true;
        try {
          controller.close();
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
        }
      };
      const enqueueData = (obj: object) => {
        if (isClosed || request.signal.aborted) return false;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)
          );
          return true;
        } catch (error) {
          if (error instanceof TypeError) {
            isClosed = true;
            return false;
          }
          throw error;
        }
      };

      try {
        await appendMessage(conversationId, "user", message);

        // Send conversation metadata (matches existing SSE format)
        enqueueData({
          type: "conversation",
          id: conversationId,
          title: conversation.title,
        });

        const graph = agentGraph;

        // Stream updates from the graph using the stream() method
        const graphStream = await graph.stream(
          {
            messages: langgraphMessages,
            mode: resolvedMode,
            userName: session.user.name ?? "用户",
            profile: null,
            clientCity,
          },
          {
            streamMode: "updates",
            signal: request.signal,
          }
        ) as AsyncIterable<Record<string, Record<string, unknown>>>;

        let lastResponse = "";
        let toolResultCount = 0;
        const toolResults: Array<{ toolName: string; output: unknown }> = [];

        for await (const chunk of graphStream) {
          for (const nodeOutput of Object.values(chunk)) {
            if (nodeOutput.toolResults && typeof nodeOutput.toolResults === "object") {
              const results = nodeOutput.toolResults as Record<string, unknown>;
              for (const [toolName, result] of Object.entries(results)) {
                // Announce the tool call first so the frontend shows "正在使用 xxx"
                enqueueData({
                  type: "tool_call",
                  toolCallId: `lg-${toolName}`,
                  toolName,
                  input: {},
                });
                // Then immediately send the result so the frontend transitions to "xxx 完成"
                enqueueData({
                  type: "tool_result",
                  toolCallId: `lg-${toolName}`,
                  toolName,
                  output: result,
                });
                toolResults.push({ toolName, output: result });
                toolResultCount++;
              }
            }
            // Capture the response (overwrite reducer — last value is final)
            if (
              nodeOutput.response &&
              typeof nodeOutput.response === "string"
            ) {
              lastResponse = nodeOutput.response;
            }
          }
        }

        // Extract sources from tool results (for inline action buttons)
        // Sources come from two places:
        // 1. searchKnowledge.results → via extractSourceReferences (RAG)
        // 2. searchStructured.sources → via _debug=structured_with_sources (DB)
        interface StructuredSource {
          index?: number;
          title: string;
          url: string;
          type: string;
        }
        const allSources: StructuredSource[] = [];

        // RAG sources from searchKnowledge
        const searchKnowledgeResult = toolResults.find(
          (tr) => tr.toolName === "searchKnowledge"
        );
        if (searchKnowledgeResult?.output && typeof searchKnowledgeResult.output === "object") {
          const skOutput = searchKnowledgeResult.output as Record<string, unknown>;
          if (Array.isArray(skOutput.results)) {
            const ragRefs = extractSourceReferences(
              skOutput.results as Parameters<typeof extractSourceReferences>[0]
            );
            for (const ref of ragRefs) {
              allSources.push({
                title: ref.title,
                url: ref.url,
                type: ref.type,
              });
            }
          }
        }

        // Structured DB sources from searchStructured
        for (const { toolName, output } of toolResults) {
          if (!output || typeof output !== "object") continue;
          const o = output as Record<string, unknown>;
          if (toolName === "searchStructured" && o._debug === "structured_with_sources" && Array.isArray(o.sources)) {
            for (const src of o.sources as StructuredSource[]) {
              allSources.push({ title: src.title, url: src.url, type: src.type });
            }
          }
        }
        if (allSources.length > 0) {
          console.log(`[AI-LangGraph] sending ${allSources.length} sources`);
          enqueueData({ type: "sources", sources: allSources });
        }

        console.log(
          `[AI-LangGraph] done. toolResults=${toolResultCount}, textLen=${lastResponse.length}`
        );

        // Final text response
        enqueueData({ type: "text", delta: lastResponse });

        // Append final message to conversation store
        await appendMessage(
          conversationId,
          "assistant",
          lastResponse,
          allSources.length > 0 ? allSources : undefined
        );
        enqueueData({ type: "done" });
        closeStream();
      } catch (err) {
        if (request.signal.aborted) {
          closeStream();
          return;
        }

        console.error(`[AI-LangGraph] stream error:`, err);
        const msg = err instanceof Error ? err.message : "Stream error";
        enqueueData({ type: "error", message: msg });
        closeStream();
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
