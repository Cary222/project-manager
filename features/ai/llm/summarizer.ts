"use server";

import { prisma } from "@/shared/db/client";
import { Prisma } from "@prisma/client";
import { resolveCredentialWithFallback } from "./credentials/api-key-store";
import { getProxyFetch, AGNES_API_BASE_URL } from "./proxy";

const MODEL = "agnes-2.0-flash";
const AGNES_PROVIDER = "agnes";

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
  recentTopics: string[];
  preferences: Record<string, unknown>;
  // NOTE: projects 字段已移除 — 项目信息通过真实数据库获取，不通过 AI 总结
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callAgnes(messages: ChatMessage[]): Promise<string> {
  // Three-level credential fallback: SYSTEM → USER → ENV
  const envFallback = {
    apiKey: process.env.AGNES_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseURL: process.env.AGNES_API_URL ?? AGNES_API_BASE_URL,
  };
  const cred = await resolveCredentialWithFallback("__system__", AGNES_PROVIDER, envFallback);
  if (!cred) {
    throw new Error("Agnes API key not configured. Please ask ROOT to configure Agnes in system settings.");
  }

  const apiKey = cred.apiKey;
  const baseURL = cred.baseURL;
  const fetchFn = cred.transport === "proxy" ? (getProxyFetch() ?? globalThis.fetch) : globalThis.fetch;
  const chatURL = `${baseURL.replace(/\/$/, "")}/chat/completions`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      const response = await fetchFn(chatURL, {
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
  '  "recentTopics": ["话题1", "话题2", ...],  // 最近讨论的话题',
  '  "preferences": {}  // 用户的偏好设置',
  "}",
  "",
  "## 合并规则",
  "- 如果有 previousProfile，请参考并合并更新，而非完全重写",
  "- 保留已有的核心内容，同时添加新的发现",
  "- 相似或重复的条目请合并去重",
  // NOTE: projects 字段已移除 — 项目信息通过真实数据库获取，不通过 AI 总结
].join("\n");

const PROFILE_CLEANUP_INSTRUCTION = [
  "你是一个用户画像精简助手。请对现有画像进行清扫，去除冗余和重复内容。",
  "",
  "## 字段数量限制",
  "- roles: 最多 3 个，保留最核心的角色",
  "- interests: 最多 5 个，保留最相关的兴趣",
  "- expertise: 最多 5 个，保留最重要的专业领域",
  "- recentTopics: 最多 5 个，优先保留最新的话题",
  "",
  "## 输出要求",
  "请输出以下 JSON 结构（不要有任何其他文字）：",
  "{",
  '  "roles": ["角色1", "角色2"],  // 用户角色，最多3个',
  '  "interests": ["兴趣1", "兴趣2", "兴趣3"],  // 兴趣领域，最多5个',
  '  "expertise": ["专长1", "专长2", "专长3"],  // 专业领域，最多5个',
  '  "recentTopics": ["话题1", "话题2", "话题3"],  // 最近话题，最多5个',
  '  "preferences": {}',
  "}",
  "",
  "## 清扫规则",
  "- 相似或重复的条目请合并",
  "- recentTopics 优先保留最新的话题",
  "- 如果条目超出限制，保留最重要/最相关的",
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

    // 获取当前周的周一
    const now = new Date();
    const weekStart = getWeekStart(now);
    const currentVersion = (existingProfile as { version?: number })?.version ?? 0;
    const newVersion = currentVersion + 1;

    // 使用 $queryRaw 插入/更新，避免 Prisma 类型缓存问题
    await prisma.$executeRaw`
      INSERT INTO "pm"."AiUserProfile" ("userId", profile, "sourceSummaryCount", version, "weekStart", "updatedAt", "createdAt")
      VALUES (
        ${userId},
        ${profile as unknown as Prisma.InputJsonValue},
        ${summaries.length},
        ${newVersion},
        ${weekStart},
        NOW(),
        NOW()
      )
      ON CONFLICT ("userId") DO UPDATE SET
        profile = EXCLUDED.profile,
        "sourceSummaryCount" = EXCLUDED."sourceSummaryCount",
        version = EXCLUDED.version,
        "weekStart" = EXCLUDED."weekStart",
        "updatedAt" = NOW()
    `;

    return profile;
  } catch (error) {
    console.error("[summarizer] Failed to update user profile:", error);
    return null;
  }
}

/**
 * 获取给定日期所在周的周一（00:00:00）
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? -6 : 1 - day; // 如果是周日则回到上周一
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 每周画像清扫：限制字段数量，去除冗余
 * 仅在每周清扫时调用，日常对话更新使用 updateUserProfile
 * 
 * @param userId 用户ID
 * @returns 清扫后的画像
 */
export async function cleanupUserProfile(
  userId: string
): Promise<UserProfileData | null> {
  const existingProfile = await prisma.aiUserProfile.findUnique({
    where: { userId },
  });

  if (!existingProfile) {
    return null;
  }

  const currentProfile = existingProfile.profile as unknown as UserProfileData;
  if (!currentProfile) {
    return null;
  }

  // 检查是否有有效字段
  if (!currentProfile.roles && !currentProfile.interests && !currentProfile.expertise && !currentProfile.recentTopics) {
    return null;
  }

  const promptUser = [
    PROFILE_CLEANUP_INSTRUCTION,
    "",
    "## 当前画像",
    JSON.stringify(currentProfile, null, 2),
  ].join("\n");

  const promptMessages: ChatMessage[] = [
    { role: "system", content: PROFILE_CLEANUP_INSTRUCTION },
    { role: "user", content: promptUser },
  ];

  try {
    const responseText = await callAgnes(promptMessages);
    const jsonStr = extractJsonFromResponse(responseText);
    const profile: UserProfileData = JSON.parse(jsonStr);

    // 更新画像，设置新的 weekStart
    const now = new Date();
    const weekStart = getWeekStart(now);
    const currentVersion = (existingProfile as { version?: number })?.version ?? 0;
    const newVersion = currentVersion + 1;

    // 使用 $executeRaw 更新，避免 Prisma 类型缓存问题
    // 注意：PostgreSQL 列名是 case-sensitive 的，需要用双引号包裹
    await prisma.$executeRaw`
      UPDATE "pm"."AiUserProfile"
      SET "profile" = ${profile as unknown as Prisma.InputJsonValue},
          "version" = ${newVersion},
          "weekStart" = ${weekStart},
          "updatedAt" = NOW()
      WHERE "userId" = ${userId}
    `;

    console.log(`[cleanupUserProfile] Cleaned profile for user ${userId}: v${currentVersion} -> v${newVersion}`);
    return profile;
  } catch (error) {
    console.error("[summarizer] Failed to cleanup user profile:", error);
    return null;
  }
}
