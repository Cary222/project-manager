"use server";

import { prisma } from "@/shared/db/client";
import { Prisma } from "@prisma/client";

const AGNES_API_URL = "https://apihub.agnes-ai.com/v1/chat/completions";
const MODEL = "agnes-2.0-flash";

/** Status codes that warrant a retry with exponential backoff */
const RETRYABLE_STATUS_CODES = new Set([404, 429, 500, 502, 503, 504]);

const MAX_RETRIES = 2;

export interface ConversationSummary {
  topics: string[];
  keyPoints: string[];
  actionItems: string[];
  recentQueries: string[];
}

export interface UserProfileData {
  roles: string[];
  interests: string[];
  expertise: string[];
  projects: string[];
  recentTopics: string[];
  preferences: Record<string, unknown>;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callAgnes(messages: ChatMessage[]): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const response = await fetch(AGNES_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          stream: false,
          temperature: 0.3,
          max_tokens: 2048,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content ?? "";
      }

      // 401/403 — auth problem, never retry
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Agnes API error: ${response.status}`);
      }

      lastError = new Error(`Agnes API error: ${response.status}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const statusMatch = lastError.message.match(/Agnes API error: (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      if (attempt < MAX_RETRIES && status > 0 && RETRYABLE_STATUS_CODES.has(status)) {
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("Agnes API error: unknown");
}

function extractJsonFromResponse(text: string): string {
  const match = text.match(/```json\n?([\s\S]*?)\n?```/);
  if (match) {
    return match[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

const SUMMARY_INSTRUCTION = [
  "你是一个对话摘要提取助手。请分析以下对话，提取关键信息并以严格 JSON 格式输出。",
  "",
  "## 输出要求",
  "请输出以下 JSON 结构（不要有任何其他文字）：",
  "{",
  '  "topics": ["主题1", "主题2", ...],  // 对话涉及的主要主题，最多5个',
  '  "keyPoints": ["要点1", "要点2", ...],  // 关键要点，最多5条',
  '  "actionItems": ["行动项1", "行动项2", ...],  // 明确的任务或行动项，最多3条',
  '  "recentQueries": ["问题1", "问题2", ...]  // 用户最近的问题或请求，最多5条',
  "}",
  "",
  "注意：",
  "- 必须输出严格合法的 JSON，不要有其他文字",
  "- topics/keyPoints/actionItems/recentQueries 至少返回空数组 []",
].join("\n");

function buildSummaryPrompt(
  messages: Array<{ role: string; content: string }>,
  previousSummary: unknown
): string {
  const messagesText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  const prevText = previousSummary
    ? `\n已有摘要:\n${JSON.stringify(previousSummary, null, 2)}`
    : "";

  return [
    SUMMARY_INSTRUCTION,
    "",
    "## 对话内容",
    messagesText,
    prevText,
  ].join("\n");
}

const PROFILE_INSTRUCTION = [
  "你是一个用户画像分析助手。请根据用户提供的内容片段，提取并更新用户画像。",
  "",
  "## 数据来源说明",
  "用户提供的内容可能来自：",
  "1. AI 对话摘要（type=对话）：多轮对话的摘要，包含主题、要点、行动项等",
  "2. 周报 AI 摘要（type=weekly_report）：用户提交的周报自动生成的摘要",
  "",
  "## 输出要求",
  "请输出以下 JSON 结构（不要有任何其他文字）：",
  "{",
  '  "roles": ["角色1", "角色2", ...],  // 用户的角色，如"前端工程师"',
  '  "interests": ["兴趣1", "兴趣2", ...],  // 用户的兴趣领域',
  '  "expertise": ["专长1", "专长2", ...],  // 用户擅长的技术或专业领域',
  '  "projects": ["项目1", "项目2", ...],  // 用户参与或关注的的项目名称',
  '  "recentTopics": ["话题1", "话题2", ...],  // 最近讨论的热门话题',
  '  "preferences": {}  // 用户的偏好设置，如沟通风格、技术栈偏好等',
  "}",
  "",
  "注意：",
  "- 必须输出严格合法的 JSON，不要有其他文字",
  "- 如果有 previousProfile，请参考并合并更新，而非完全重写",
  "- 周报摘要中提到的项目名应合并到 projects 字段",
].join("\n");

function buildProfilePrompt(
  summaries: Array<{ id: string; summary: unknown }>,
  previousProfile: unknown
): string {
  const summariesText = summaries
    .map((s, i) => {
      const type = typeof s.summary === "object" && s.summary !== null && "type" in s.summary
        ? (s.summary as { type: string }).type
        : "对话";
      return `[${type} ${i + 1}]\n${JSON.stringify(s.summary, null, 2)}`;
    })
    .join("\n\n");

  const prevText = previousProfile
    ? `\n当前已有画像:\n${JSON.stringify(previousProfile, null, 2)}`
    : "";

  return [
    PROFILE_INSTRUCTION,
    "",
    "## 内容片段",
    summariesText,
    prevText,
  ].join("\n");
}

export async function summarizeConversation(
  conversationId: string
): Promise<ConversationSummary | null> {
  const messages = await prisma.aiChatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  if (messages.length === 0) {
    return null;
  }

  const conversation = await prisma.aiConversation.findUnique({
    where: { id: conversationId },
    select: { summary: true },
  });

  const reversedMessages = messages.reverse();
  const promptUser = buildSummaryPrompt(reversedMessages, conversation?.summary ?? null);
  const promptMessages: ChatMessage[] = [
    { role: "system", content: SUMMARY_INSTRUCTION },
    // Agnes API rejects prompts that contain only a system message
    // ("No user query found in messages."), so we re-send the full prompt
    // (including the conversation to summarize) as a user message.
    { role: "user", content: promptUser },
  ];

  try {
    const responseText = await callAgnes(promptMessages);
    const jsonStr = extractJsonFromResponse(responseText);
    const summary: ConversationSummary = JSON.parse(jsonStr);

    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { summary: summary as unknown as Prisma.InputJsonValue },
    });

    return summary;
  } catch (error) {
    console.error("[summarizer] Failed to summarize conversation:", error);
    const fallback: ConversationSummary = { topics: [], keyPoints: [], actionItems: [], recentQueries: [] };
    try {
      await prisma.aiConversation.update({
        where: { id: conversationId },
        data: { summary: fallback as unknown as Prisma.InputJsonValue },
      });
    } catch {
      // ignore
    }
    return null;
  }
}

export async function updateUserProfile(
  userId: string
): Promise<UserProfileData | null> {
  const conversations = await prisma.aiConversation.findMany({
    where: {
      userId,
      summary: { not: Prisma.JsonNull },
    },
    select: { id: true, summary: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  // PR5: Also pull in weekly report AI summaries as a second data source
  const weeklyReports = await prisma.weeklyReport.findMany({
    where: {
      userId,
      aiSummary: { not: null },
      aiSummaryPartial: false,
    },
    select: { id: true, aiSummary: true, aiSummaryAt: true },
    orderBy: { weekStart: "desc" },
    take: 10,
  });

  // Only keep conversations whose summary has at least one meaningful field
  // populated. Otherwise we'd feed the LLM a list of empty arrays, which it
  // happily turns into an empty profile {} — corrupting the stored profile.
  const conversationSummaries = conversations
    .filter((c) => {
      if (!c.summary || typeof c.summary !== "object") return false;
      const s = c.summary as Record<string, unknown>;
      const topics = Array.isArray(s.topics) ? s.topics : [];
      const keyPoints = Array.isArray(s.keyPoints) ? s.keyPoints : [];
      const recentQueries = Array.isArray(s.recentQueries) ? s.recentQueries : [];
      return topics.length > 0 || keyPoints.length > 0 || recentQueries.length > 0;
    })
    .map((c) => ({ id: c.id, summary: c.summary }));

  // Filter out blank/missing aiSummary values from weekly reports
  const weeklySummaries = weeklyReports
    .filter((r) => r.aiSummary && r.aiSummary.trim() !== "")
    .map((r) => ({ id: r.id, summary: { type: "weekly_report", aiSummary: r.aiSummary } }));

  const summaries = [...conversationSummaries, ...weeklySummaries];

  if (summaries.length === 0) {
    // No meaningful summaries yet — if a stale/empty profile exists from a
    // previous failed run, wipe it so the UI shows "暂无画像" instead of {}.
    // Use deleteMany (which is a no-op when nothing matches) instead of
    // delete (which throws P2025 and spams Prisma's error logger).
    await prisma.aiUserProfile.deleteMany({ where: { userId } });
    return null;
  }

  const existingProfile = await prisma.aiUserProfile.findUnique({
    where: { userId },
  });

  const promptUser = buildProfilePrompt(
    summaries,
    existingProfile?.profile ?? null
  );
  const promptMessages: ChatMessage[] = [
    { role: "system", content: PROFILE_INSTRUCTION },
    // Agnes API requires at least one user message ("No user query found in
    // messages." → 400), so re-send the prompt as a user message.
    { role: "user", content: promptUser },
  ];

  try {
    const responseText = await callAgnes(promptMessages);
    const jsonStr = extractJsonFromResponse(responseText);
    const profile: UserProfileData = JSON.parse(jsonStr);

    await prisma.aiUserProfile.upsert({
      where: { userId },
      create: {
        userId,
        profile: profile as unknown as Prisma.InputJsonValue,
        sourceSummaryCount: summaries.length,
      },
      update: {
        profile: profile as unknown as Prisma.InputJsonValue,
        sourceSummaryCount: summaries.length,
      },
    });

    return profile;
  } catch (error) {
    console.error("[summarizer] Failed to update user profile:", error);
    return null;
  }
}
