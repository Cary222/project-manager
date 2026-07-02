import { NextRequest, NextResponse } from "next/server";
import { streamText, stepCountIs } from "ai";
import { requireSession } from "@/shared/lib/permissions";
import {
  appendMessage,
  getConversation,
  getConversationSummaries,
  getOrCreateProfile,
} from "@/features/ai/lib/conversation-store";
import { agnesFlash } from "@/features/ai/lib/agnes-provider";

interface ProfileLike {
  roles?: string[];
  interests?: string[];
  expertise?: string[];
  projects?: string[];
  recentTopics?: string[];
  preferences?: Record<string, unknown>;
}

function formatProfile(profile: ProfileLike): string {
  const sections: string[] = [];
  const push = (key: keyof ProfileLike, label: string) => {
    const v = profile[key];
    if (Array.isArray(v) && v.length > 0) {
      sections.push(`${label}：${(v as unknown[]).join("、")}`);
    }
  };
  push("roles", "角色");
  push("interests", "兴趣");
  push("expertise", "专长");
  push("projects", "参与项目");
  push("recentTopics", "近期话题");
  if (profile.preferences && typeof profile.preferences === "object") {
    const entries = Object.entries(profile.preferences);
    if (entries.length > 0) {
      sections.push(
        `偏好：${entries.map(([k, v]) => `${k}=${String(v)}`).join("、")}`
      );
    }
  }
  return sections.length > 0 ? sections.join("\n") : "（暂无画像数据）";
}

function buildGreetingSystemPrompt(profileText: string, recentTopics: string[]): string {
  const recentBlock = recentTopics.length
    ? `近期用户讨论过的话题：${recentTopics.join("、")}`
    : "";
  return [
    '你是"小星"，恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。',
    "",
    "你的任务：根据用户的画像信息，主动写一段**简短自然的中文问候语**，作为对话开场白。",
    "",
    "要求：",
    "1. 必须用**中文**，长度 80 字以内，1-3 句话",
    "2. 结合用户的角色、近期兴趣或最近讨论过的话题来打招呼，体现个性化",
    "3. 友好、自然、不要机械罗列画像信息，不要复述\"根据您的画像...\"这种元话语",
    "4. 末尾暗示可以怎么帮助用户（例如：'想聊点什么？'），但不强行推销功能",
    "5. 不要用 emoji，不要加粗或列表",
    "",
    "下面是用户的画像与近期话题：",
    "",
    profileText,
    recentBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id: conversationId } = await params;

    const conversation = await getConversation(conversationId, session.user.id);
    if (!conversation) {
      return NextResponse.json(
        { data: null, error: "Conversation not found" },
        { status: 404 }
      );
    }

    const profileRecord = await getOrCreateProfile(session.user.id);
    const profileText = formatProfile((profileRecord?.profile ?? {}) as ProfileLike);

    const recentTopics: string[] = [];
    try {
      const summaries = await getConversationSummaries(session.user.id, 3);
      for (const s of summaries) {
        const summary = s.summary as { recentQueries?: unknown[] } | null;
        const topics = summary?.recentQueries;
        if (Array.isArray(topics)) {
          for (const t of topics) {
            if (typeof t === "string" && t.trim()) recentTopics.push(t);
          }
        }
      }
    } catch {
      // ignore — recent topics are optional
    }

    const systemPrompt = buildGreetingSystemPrompt(
      profileText,
      recentTopics.slice(0, 5)
    );

    let fullContent = "";
    try {
      const result = streamText({
        model: agnesFlash,
        system: systemPrompt,
        messages: [{ role: "user", content: "请基于以上画像生成问候语。" }],
        stopWhen: stepCountIs(1),
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          fullContent += part.text;
        }
      }
    } catch (err) {
      console.error("[greeting] stream error:", err);
    }

    const finalContent = fullContent.trim() || "你好！我是小星，有什么可以帮你的吗？";
    try {
      await appendMessage(conversationId, "assistant", finalContent);
    } catch (err) {
      console.error("[greeting] persist failed:", err);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text", delta: finalContent })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    const status = msg === "UNAUTHORIZED" ? 401 : 500;
    return NextResponse.json({ data: null, error: msg }, { status });
  }
}
