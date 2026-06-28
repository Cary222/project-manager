import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSession } from "@/shared/lib/permissions";
import { retrieveContext, buildRagPrompt, extractSourceReferences } from "@/features/ai/lib/rag";

const AGNES_API_URL = "https://apihub.agnes-ai.com/v1/chat/completions";

type Message = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
};

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationHistory: z.array(
    z.object({
      id: z.string(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })
  ).optional(),
  mode: z.enum(["auto", "search", "chat"]).optional().default("auto"),
  forceSearch: z.boolean().optional().default(false),
});

/**
 * @deprecated 请使用 /api/ai/conversations/[id]/messages 替代。
 * 此路由保留作为兼容层，未来版本将移除。
 */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const { message, conversationHistory, mode, forceSearch } = chatSchema.parse(body);

    let useRag = false;
    if (mode === "search" || (mode === "auto" && forceSearch)) {
      useRag = true;
    } else if (mode === "chat") {
      useRag = false;
    }

    const context = useRag
      ? await retrieveContext(message, { limit: 5, userId: session.user.id })
      : { results: [], contextText: "" };

    const systemPrompt = useRag
      ? "你叫\"小星\"，是恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。你的职责是帮助用户：1. 了解项目工单状态和进度 2. 查找相关的提交记录 3. 回顾个人笔记和知识库内容 4. 解答项目管理相关问题。回答特点：简洁、专业、友好；善用列表和结构化表达；主动提供相关链接和操作建议；遇到不确定的问题，诚实说明。当前用户：" + (session.user.name || session.user.email)
      : "你叫\"小星\"，是恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。你的职责是帮助用户进行日常对话和问题解答，擅长：项目管理相关问题的咨询和建议；技术讨论和方案设计；日常工作的沟通和协调；通用知识问题的解答。回答特点：简洁、专业、友好；善用列表和结构化表达；遇到不确定的问题，诚实说明。当前用户：" + (session.user.name || session.user.email);

    const prompt = useRag ? buildRagPrompt(message, context) : message;

    const messages: Message[] = [
      { id: "system", role: "system", content: systemPrompt },
    ];

    if (conversationHistory?.length) {
      for (const msg of conversationHistory.slice(-10)) {
        messages.push({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ id: "current", role: "user", content: prompt });

    const sources = useRag ? extractSourceReferences(context.results) : [];

    const responseStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        try {
          const apiResponse = await fetch(AGNES_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
            },
            body: JSON.stringify({
              model: "agnes-2.0-flash",
              messages: messages.map(function(m) { return { role: m.role, content: m.content }; }),
              stream: true,
              temperature: 0.7,
              max_tokens: 2048,
            }),
          });

          if (!apiResponse.ok) {
            void apiResponse.text(); // consume body
            controller.enqueue(
              encoder.encode("data: " + JSON.stringify({ type: "error", message: "API error: " + apiResponse.status }) + "\n\n")
            );
            controller.close();
            return;
          }

          if (!apiResponse.body) {
            controller.enqueue(
              encoder.encode("data: " + JSON.stringify({ type: "error", message: "No response body" }) + "\n\n")
            );
            controller.close();
            return;
          }

          const reader = apiResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  continue;
                }
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                    const delta = parsed.choices[0].delta.content;
                    controller.enqueue(
                      encoder.encode("data: " + JSON.stringify({ type: "text", delta: delta }) + "\n\n")
                    );
                  }
                } catch {
                  // Skip invalid JSON
                }
              }
            }
          }

          if (sources.length > 0) {
            controller.enqueue(
              encoder.encode("data: " + JSON.stringify({ type: "sources", sources: sources }) + "\n\n")
            );
          }

          controller.enqueue(encoder.encode("data: " + JSON.stringify({ type: "done" }) + "\n\n"));
        } catch {
          controller.enqueue(
            encoder.encode("data: " + JSON.stringify({ type: "error", message: "Stream error" }) + "\n\n")
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
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: error.issues },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "unknown";
    const status = errorMessage === "UNAUTHORIZED" ? 401 : 500;

    return NextResponse.json({ error: errorMessage }, { status });
  }
}
