import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import type { AgentState } from "../agent";
import { generateText } from "ai";
import type { ModelMessage, UserModelMessage, AssistantModelMessage } from "ai";
import { createModel } from "@/features/ai/llm/providers/registry";
import { ensureSystemProvider } from "@/features/ai/llm/providers/init";
import { selectModel } from "@/features/ai/llm/model-routing";
import { isUserActivityQuery } from "./detect-intent";

/**
 * Call generateText with a dynamically selected model based on modelContext.
 * All models (SYSTEM Agnes + user-imported) now go through the unified
 * resolveCredential() → createModel() pipeline.
 */
async function callWithDynamicModel(
  modelContext: AgentState["modelContext"],
  systemPrompt: string,
  messages: ModelMessage[],
  userId: string
): Promise<string> {
  const taskType = modelContext?.taskType ?? "chat";
  const manualOverride = modelContext?.userConfig?.manualOverride;
  const userConfig = { manualOverride };

  // Ensure SYSTEM providers (Agnes) exist in DB
  await ensureSystemProvider();

  try {
    const { providerId, modelName } = selectModel(taskType, userConfig);
    const modelRef = `${providerId}:${modelName}`;
    console.log(`[generateResponseNode] calling model: providerId=${providerId} modelName=${modelName} modelRef=${modelRef}`);

    const model = await createModel({ userId, modelRef });
    console.log(`[generateResponseNode] using model instance for "${modelRef}", calling generateText...`);
    const result = await generateText({ model, system: systemPrompt, messages });
    console.log(`[generateResponseNode] generateText success, textLen=${result.text.length}`);
    return result.text;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const apiError = err as any;
    const responseBody = apiError.response
      ? JSON.stringify(apiError.response).slice(0, 300)
      : undefined;
    console.error(`[generateResponseNode] model failed:`, {
      message: err.message,
      name: err.name,
      statusCode: apiError.statusCode,
      responseBody,
      cause: err.cause,
    });
    const msg = err.message || `Unknown error (${err.name || typeof error})`;
    return `生成回答时出错：${msg}`;
  }
}

function buildSystemPrompt(
  userName: string,
  mode: string,
  profile: Record<string, unknown> | null,
  lastMentionedUser?: { id: string; name: string } | null
): string {
  const baseIntro = `你叫"小星"，是恒星研公司内部项目管理系统的 AI 助手，由 cary 开发。`;

  const ragDuty = `${baseIntro}你的职责是帮助用户：1. 了解项目工单状态和进度 2. 查找相关的提交记录 3. 回顾个人笔记和知识库内容 4. 解答项目管理相关问题。`;
  const chatDuty = `${baseIntro}你的职责是帮助用户进行日常对话和问题解答，擅长：项目管理相关问题的咨询和建议；技术讨论和方案设计；日常工作的沟通和协调；通用知识问题的解答。`;

  const duty = mode === "chat" ? chatDuty : ragDuty;
  const style = "回答特点：简洁、专业、友好；善用列表和结构化表达；主动提供相关链接和操作建议；遇到不确定的问题，诚实说明。";
  const userContext = `当前用户：${userName}`;

  const modeHints: Record<string, string> = {
    search: `【知识检索模式必须遵守以下规则】
RULE 1（最高优先级）：先用 searchStructured 快速查询工单、项目、用户等结构化数据。
RULE 2：如果 searchStructured 结果不够满意，再用 searchKnowledge 做深度语义检索。
RULE 3：综合所有检索结果回答用户问题。
RULE 4：用户问"某人在做什么 / 最近在干什么 / 周报 / 工作近况"时，type 必须为 user 或 weekly_report，把人名作为 id 传入。`,
    auto: `【通用模式】先用 searchStructured 快速查询工单和周报；如果搜索结果不理想，再用 searchKnowledge 做深度语义检索。
用户问"某人在做什么 / 最近在干什么 / 周报 / 工作近况"时，type 必须为 user 或 weekly_report，把人名作为 id 传入。`,
    web: `【联网模式】先用 webSearch 联网搜索；必要时用 searchStructured 查项目内部数据。`,
    chat: ``,
  };
  const modeHint = modeHints[mode] ?? modeHints.auto ?? "";

  const toolRules =
    mode === "chat"
      ? ``
      : `
工具使用硬规则：
- 只能根据"检索结果"和"工具结果"陈述项目、工单、用户、提交和周报事实。
- 工具没有返回的标题、状态、人员、时间、处理过程、备注等字段一律不得推测或补全。
- 工具返回了结果（即 results 非空）时，必须引用至少 1 条检索结果或工具结果来回答。
- 禁止说"搜索失败 / 检索失败 / 向量搜索失败"：只要工具正常返回（即使 results 为空），就是正常结果，不是错误。
- 查询结果为空时，说"知识库中未找到相关内容"，而不是"搜索失败"。
- 只有工具结果明确包含 error 或失败信息时，才能说调用失败。
- 用户问"某人在做什么 / 最近开发 / 周报 / 工单"时，必须以 searchStructured 查询结果为准。
- 【人员活动归因硬规则】"被指派/负责工单"只代表关系，不代表该用户在窗口内做过操作，也不代表完成了该工单。
- 只有工具明确标注"该用户本人"或提供可靠 userId 归因的提交、状态变更、评论、笔记，才能说"该用户提交/更新/完成/正在做"。
- 如果工具写着"归因=未知""禁止当作个人产出""目标用户归因=未验证"，回答中绝不能把这些工单或 commit 说成目标用户的工作成果。
- 当【归因结论】明确没有个人证据时，必须直说"没有可可靠归因给该用户本人的近期产出证据"，不能用被指派工单推断其正在工作。`;

  const profileSummary = formatProfile(profile);
  const profileBlock = profileSummary ? `\n${profileSummary}` : "";

  // 明确的当前用户信息，让 LLM 知道是谁在对话
  const currentUserBlock = `\n【当前对话用户】\n姓名：${userName}${profile?.email ? `\n邮箱：${profile.email}` : ""}${profile?.role ? `\n角色：${profile.role}` : ""}${profile?.bio ? `\n个人简介：${profile.bio}` : ""}`;

  // 最近讨论的用户（用于"他/她"等代词指代）
  const lastMentionedBlock = lastMentionedUser
    ? `\n【最近讨论的用户】\n当前对话中你正在讨论的用户是"${lastMentionedUser.name}"。当用户说"他/她/这个人/该用户"等代词时，指的就是这个用户。`
    : "";

  return `${duty}\n${style}${currentUserBlock}${lastMentionedBlock}${profileBlock}${toolRules}${modeHint}`;
}

function getUserActivityContext(
  toolResults: Record<string, unknown> | undefined,
): string | null {
  const structured = toolResults?.searchStructured;
  if (!structured || typeof structured !== "object") return null;
  const result = structured as { summary?: unknown; attribution?: unknown };
  if (
    typeof result.summary !== "string" ||
    !result.attribution ||
    typeof result.attribution !== "object"
  ) {
    return null;
  }

  const attr = result.attribution as Record<string, unknown>;
  // 必须有明确的 attribution kind 才算有效
  if (attr.kind !== "user_activity") return null;

  const hasDirectEvidence = attr.hasDirectEvidence === true;
  const hasReports = (attr.relatedReportCount as number) > 0;
  const hasTickets = (attr.relatedTicketCount as number) > 0;
  const hasCommits = (attr.relatedCommitCount as number) > 0;

  // 当没有直接证据、也没有周报/工单/提交时，返回 null（走通用回复）
  if (!hasDirectEvidence && !hasReports && !hasTickets && !hasCommits) {
    return null;
  }

  // 有数据（直接证据或周报/工单/提交），返回 summary
  return result.summary;
}

/**
 * 系统提示追加：用户活动/周报二次排版规则。
 * 由 generateResponseNode 在 user_activity context 命中时拼接到 system prompt 末尾。
 *
 * 约束：
 * - 原文 aiSummary 是连续段落；这里强制 LLM 重新组织成 bullet list
 * - 每周报用小标题 + 3-4 个 bullet，便于 ReactMarkdown 渲染为结构化列表
 * - 不能改写事实，只能换排版（避免幻觉）
 * - 根据用户意图决定输出内容：汇总意图输出所有信息，具体意图只输出对应内容
 */
const activityReportHint = `

【用户活动信息汇总】
你拿到的输入是 searchStructured 工具返回的用户活动原始数据，包含多种类型的信息。
请按以下规则重新排版后再输出给用户：

1. 判断用户意图：
   - "最近在干嘛/在干什么/在干嘛/做什么/干了什么" → 汇总意图
   - "周报" → 周报详情
   - "工单/任务" → 工单列表
   - "提交/commit" → 提交记录

2. 汇总意图（默认）：
   - 输出完整的 Markdown 格式报告
   - 结构顺序：用户画像 → 本周项目更新（工单列表）→ 本周提交 → 周报详情
   - 每个部分用小标题分隔
   - 周报部分：每条周报用 ### 标题 + 2-4 个 bullet（本周完成/涉及项目/下周计划）
   - 工单部分：简单列表即可
   - 提交部分：sha + 主题 + 日期

3. 具体意图（周报/工单/提交）：
   - 只输出对应类型的信息
   - 保持 Markdown 格式

4. 通用规则：
   - 严格忠于原文事实，不得补充原文没有的信息
   - 不输出无关的寒暄、解释、工具调用结果
   - 末尾可加"点击右侧参考来源可跳转至详情"（仅当有 sources 时）`;

function formatProfile(profile: unknown): string | null {
  if (!profile || typeof profile !== "object") return null;
  const p = profile as Record<string, unknown>;

  // 新版 UserProfile 结构（来自 getUserProfileAction）
  if (p.stats && typeof p.stats === "object") {
    const stats = p.stats as Record<string, unknown>;
    const sections: string[] = [];
    if (typeof stats.totalTickets === "number") sections.push(`累计工单：${stats.totalTickets}`);
    if (typeof stats.completedTickets === "number") sections.push(`已完成：${stats.completedTickets}`);
    if (typeof stats.activeProjects === "number") sections.push(`参与项目：${stats.activeProjects}`);
    if (typeof stats.totalReports === "number") sections.push(`累计周报：${stats.totalReports}`);
    if (sections.length > 0) {
      return `用户画像统计：\n${sections.join("\n")}`;
    }
  }

  // 旧版通用格式（备用）
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

/**
 * Appends search context to the messages sent to the LLM.
 */
function buildMessages(
  history: BaseMessage[],
  userContent: string,
  searchResults: string[] | undefined,
  toolResults: Record<string, unknown> | undefined
): ModelMessage[] {
  const msgs: ModelMessage[] = [];

  for (const m of history) {
    if (m instanceof HumanMessage) {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      msgs.push({ role: "user", content: c } satisfies UserModelMessage);
    } else {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      msgs.push({ role: "assistant", content: c } satisfies AssistantModelMessage);
    }
  }

  // Build context from tool results
  const contextParts: string[] = [];
  if (searchResults && searchResults.length > 0) {
    contextParts.push("=== 检索结果 ===\n" + searchResults.join("\n\n"));
  }
  if (toolResults) {
    const toolLines = Object.entries(toolResults).map(
      ([name, result]) =>
        `[${name}]\n${typeof result === "string" ? result : JSON.stringify(result)}`
    );
    contextParts.push("=== 工具结果 ===\n" + toolLines.join("\n\n"));
  }

  if (contextParts.length > 0) {
    const enrichedContent =
      userContent + "\n\n" + contextParts.join("\n\n");
    msgs.push({ role: "user", content: enrichedContent } satisfies UserModelMessage);
  } else {
    msgs.push({ role: "user", content: userContent } satisfies UserModelMessage);
  }

  return msgs;
}

/**
 * Generate response node.
 *
 * Reads the current messages + search results, calls the LLM via generateText,
 * and returns { response } with the generated text.
 *
 * userName and profile are read from the graph state.
 *
 * Workflow match handling: when workflowMatch is detected, returns a special
 * response that triggers the frontend to show a workflow launch dialog.
 *
 * NOTE: Human-in-Loop disambiguation is handled by disambiguateIntentNode.
 * This node should NOT contain any pendingConfirmation / pendingHumanAction logic.
 */
export async function generateResponseNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  // Guard: never generate a response while waiting for human confirmation.
  // The graph should be at humanConfirmation, not here. This guards against
  // edge cases where the router doesn't catch waitingForConfirmation=true.
  if (state.waitingForConfirmation) {
    console.log(`[generateResponseNode] SKIP: waitingForConfirmation=true, no response generated`);
    return {};
  }

  // ── Workflow Match: Return special response to trigger frontend dialog ──
  if (state.workflowMatch) {
    const { workflow } = state.workflowMatch;
    console.log(`[generateResponseNode] workflow match detected: ${workflow.type}`);
    return {
      response: `[WORKFLOW_MATCH:${workflow.type}]:检测到你可能想要执行「${workflow.name}」工作流。它可以帮你${workflow.description}。是否现在启动？`,
      pendingHumanAction: null,
    };
  }

  const userName = state.userName || "用户";
  const profile = state.profile ?? {};

  const lastMessage = state.messages[state.messages.length - 1];
  const userContent =
    typeof lastMessage?.content === "string"
      ? lastMessage.content
      : lastMessage
        ? JSON.stringify(lastMessage.content)
        : "";

  console.log(`[generateResponseNode] searchResults=${state.searchResults?.length} toolResults=${state.toolResults ? Object.keys(state.toolResults).join(',') : 'none'} mode=${state.mode}`);

  // 保留 lastMentionedUser：如果 resolvedEntities 中有用户信息，优先使用
  const lastMentionedUser = state.lastMentionedUser ?? (state.resolvedEntities?.user ? {
    id: state.resolvedEntities.user.id,
    name: state.resolvedEntities.user.name,
  } : null);

  // Handle user activity queries with summary results from searchStructured
  // 周报和个人活动查询的结果在 searchResults[0] 中（JSON 格式）
  const userActivityContext = getUserActivityContext(state.toolResults);
  if (userActivityContext) {
    // 根据用户意图决定输出格式：汇总意图 vs 具体意图
    const systemPrompt = buildSystemPrompt(userName, state.mode, profile, lastMentionedUser) + activityReportHint;
    const activityMsgs: ModelMessage[] = [
      {
        role: "user",
        content: `${userContent}\n\n=== 用户活动检索结果（来自 searchStructured，需要你根据用户意图进行汇总或筛选） ===\n${userActivityContext}`,
      } satisfies UserModelMessage,
    ];

    try {
      const resultText = await callWithDynamicModel(
        state.modelContext,
        systemPrompt,
        activityMsgs,
        state.userId
      );
      return { response: resultText, lastMentionedUser };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // 失败时降级返回原文，保证前端至少能看到内容
      console.warn(`[generateResponseNode] activity二次排版失败，降级返回原文: ${msg}`);
      return { response: userActivityContext, lastMentionedUser };
    }
  }

  // Fallback: 如果有 searchResults 且包含 summary，使用 searchResults
  if (state.searchResults && state.searchResults.length > 0) {
    const firstResult = state.searchResults[0];
    try {
      const parsed = JSON.parse(firstResult);
      if (parsed?.summary && typeof parsed.summary === "string") {
        return { response: parsed.summary, lastMentionedUser };
      }
    } catch {
      // 不是 JSON 格式，继续使用 LLM 生成
    }
  }

  // 如果是用户活动查询但没有有效结果，返回提示
  if (isUserActivityQuery(userContent)) {
    return {
      response: "暂未查询到该用户的结构化活动记录，请确认用户名或邮箱是否准确后重试。",
      lastMentionedUser,
    };
  }

  const systemPrompt = buildSystemPrompt(userName, state.mode, profile, lastMentionedUser);
  const messages = buildMessages(
    state.messages.slice(0, -1),
    userContent,
    state.searchResults,
    state.toolResults
  );

  // Log what context the LLM will see (first user message after history)
  const ctxMsg = messages[messages.length - 1];
  if (ctxMsg && ctxMsg.role === "user") {
    console.log(`[generateResponseNode] ctxMsg content preview="${String(ctxMsg.content).slice(0, 200)}"`);
  }

  try {
    const resultText = await callWithDynamicModel(
      state.modelContext,
      systemPrompt,
      messages,
      state.userId
    );

    // Fallback: if data retrieval failed and the model produced nothing useful,
    //    retry once with chat-mode (no tool-result context) so the user still
    //    gets a friendly answer instead of an empty bubble.
    if (!resultText.trim() && isDataRetrievalFailed(state.toolResults)) {
      console.log(`[generateResponseNode] fallback to chat mode (data retrieval failed, empty response)`);
      const chatResult = await callWithDynamicModel(
        state.modelContext,
        buildSystemPrompt(userName, "chat", profile, lastMentionedUser),
        [{ role: "user", content: userContent } satisfies UserModelMessage],
        state.userId
      );
      return {
        response: chatResult || resultText || "抱歉，我没能理解这个问题，请换个说法试试。",
        lastMentionedUser,
        // Belt-and-suspenders: clear any stale pending action so a fresh user message
        // is not hijacked by an abandoned HIL session from a previous request.
        pendingHumanAction: null,
      };
    }

    return {
      response: resultText,
      lastMentionedUser,
      // Belt-and-suspenders: clear any stale pending action so a fresh user message
      // is not hijacked by an abandoned HIL session from a previous request.
      pendingHumanAction: null,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { response: `生成回答时出错：${msg}`, lastMentionedUser };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Detect whether any tool result signals a hard failure (e.g. unsupported
 * query type, DB error, zero results). When data retrieval fails, the
 * generated response is unreliable and we should fall back to chat mode.
 */
function isDataRetrievalFailed(
  toolResults: Record<string, unknown> | undefined
): boolean {
  if (!toolResults || typeof toolResults !== "object") return false;

  for (const [toolName, raw] of Object.entries(toolResults)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    // Explicit error field
    if (typeof r.error === "string" && r.error.trim()) return true;

    // searchStructured returns a "summary" — flag if it contains failure phrases
    if (toolName === "searchStructured" && typeof r.summary === "string") {
      const s = r.summary;
      if (s.includes("不支持的查询类型") || s.includes("查询失败") || s.includes("系统错误")) {
        return true;
      }
    }
  }
  return false;
}
