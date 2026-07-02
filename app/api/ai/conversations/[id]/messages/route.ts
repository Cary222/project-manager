import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { streamText, stepCountIs } from "ai";
import { requireSession } from "@/shared/lib/permissions";
import {
  appendMessage,
  getConversation,
  getOrCreateProfile,
} from "@/features/ai/lib/conversation-store";
import {
  retrieveContext,
  buildRagPrompt,
  extractSourceReferences,
} from "@/features/ai/lib/rag";
import { enqueueSummarizeConversation } from "@/features/ai/lib/background-jobs";
import { agnesFlash } from "@/features/ai/lib/agnes-provider";
import { toolsetForMode } from "@/features/ai/tools";

type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
};

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
  useRag: boolean,
  profile: unknown
): string {
  const baseIntro = `你叫"小星"，是恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。`;

  const ragDuty = `${baseIntro}你的职责是帮助用户：1. 了解项目工单状态和进度 2. 查找相关的提交记录 3. 回顾个人笔记和知识库内容 4. 解答项目管理相关问题。`;
  const chatDuty = `${baseIntro}你的职责是帮助用户进行日常对话和问题解答，擅长：项目管理相关问题的咨询和建议；技术讨论和方案设计；日常工作的沟通和协调；通用知识问题的解答。`;

  const duty = useRag ? ragDuty : chatDuty;
  const style = "回答特点：简洁、专业、友好；善用列表和结构化表达；主动提供相关链接和操作建议；遇到不确定的问题，诚实说明。";
  const userContext = `当前用户：${userName}`;

  const profileSummary = formatProfile(profile);
  const profileBlock = profileSummary
    ? `\n${profileSummary}`
    : "";

  return `${duty}\n${style}\n${userContext}${profileBlock}`;
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
    const session = await requireSession();
    const { id: conversationId } = await params;
    const body = await request.json();
    const { message, conversationHistory, mode, forceSearch } =
      messageSchema.parse(body);

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

    const systemPrompt = buildSystemPrompt(
      session.user.name || session.user.email,
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

    const result = streamText({
      model: agnesFlash,
      system: systemPrompt,
      messages: [...messages, { id: "current", role: "user", content: message }],
      tools,
      stopWhen: stepCountIs(2),
      toolsContext: { viewerUserId: session.user.id } as any,
      onFinish: async ({ text }) => {
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

        try {
          enqueueData({
            type: "conversation",
            id: conversationId,
            title: conversation.title,
          });

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "text-delta":
                enqueueData({ type: "text", delta: part.text });
                break;
              case "tool-call":
                enqueueData({
                  type: "tool_call",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input,
                });
                break;
              case "tool-result":
                enqueueData({
                  type: "tool_result",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  input: part.input,
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
                // step-start / step-finish / reasoning / source / finish 等事件暂不推送
                break;
            }
          }

          enqueueData({ type: "done" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`
            )
          );
        } finally {
          controller.close();
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
