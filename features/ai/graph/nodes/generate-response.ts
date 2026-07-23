import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import type { AgentState } from "../agent";
import { generateText } from "ai";
import type { ModelMessage, UserModelMessage, AssistantModelMessage } from "ai";
import { agnesFlash } from "@/features/ai/lib/agnes-provider";

function buildSystemPrompt(
  userName: string,
  mode: string,
  profile: Record<string, unknown> | null
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
RULE 4：用户问“某人在做什么 / 最近在干什么 / 周报 / 工作近况”时，type 必须为 user 或 weekly_report，把人名作为 id 传入。`,
    auto: `【通用模式】先用 searchStructured 快速查询工单和周报；如果搜索结果不理想，再用 searchKnowledge 做深度语义检索。
用户问“某人在做什么 / 最近在干什么 / 周报 / 工作近况”时，type 必须为 user 或 weekly_report，把人名作为 id 传入。`,
    web: `【联网模式】先用 webSearch 联网搜索；必要时用 searchStructured 查项目内部数据。`,
    chat: ``,
  };
  const modeHint = modeHints[mode] ?? modeHints.auto ?? "";

  const toolRules =
    mode === "chat"
      ? ``
      : `
工具使用硬规则：
- 只能根据“检索结果”和“工具结果”陈述项目、工单、用户、提交和周报事实。
- 工具没有返回的标题、状态、人员、时间、处理过程、备注等字段一律不得推测或补全。
- 工具返回了结果（即 results 非空）时，必须引用至少 1 条检索结果或工具结果来回答。
- 禁止说“搜索失败 / 检索失败 / 向量搜索失败”：只要工具正常返回（即使 results 为空），就是正常结果，不是错误。
- 查询结果为空时，说“知识库中未找到相关内容”，而不是“搜索失败”。
- 只有工具结果明确包含 error 或失败信息时，才能说调用失败。
- 用户问“某人在做什么 / 最近开发 / 周报 / 工单”时，必须以 searchStructured 查询结果为准。
- 【人员活动归因硬规则】“被指派/负责工单”只代表关系，不代表该用户在窗口内做过操作，也不代表完成了该工单。
- 只有工具明确标注“该用户本人”或提供可靠 userId 归因的提交、状态变更、评论、笔记，才能说“该用户提交/更新/完成/正在做”。
- 如果工具写着“归因=未知”“禁止当作个人产出”“目标用户归因=未验证”，回答中绝不能把这些工单或 commit 说成目标用户的工作成果。
- 当【归因结论】明确没有个人证据时，必须直说“没有可可靠归因给该用户本人的近期产出证据”，不能用被指派工单推断其正在工作。`;

  const profileSummary = formatProfile(profile);
  const profileBlock = profileSummary ? `\n${profileSummary}` : "";

  return `${duty}\n${style}\n${userContext}${profileBlock}${toolRules}${modeHint}`;
}

interface UserActivityAttributionResult {
  kind: "user_activity";
  targetUserName: string;
  windowLabel: string;
  hasDirectEvidence: boolean;
  directNoteCount: number;
  relatedTicketCount: number;
  relatedCommitCount: number;
}

function getNoDirectActivityConclusion(
  toolResults: Record<string, unknown> | undefined,
): string | null {
  const structured = toolResults?.searchStructured;
  if (!structured || typeof structured !== "object") return null;
  const attribution = (structured as { attribution?: unknown }).attribution;
  if (!attribution || typeof attribution !== "object") return null;

  const result = attribution as Partial<UserActivityAttributionResult>;
  if (
    result.kind !== "user_activity" ||
    result.hasDirectEvidence !== false ||
    typeof result.targetUserName !== "string" ||
    typeof result.windowLabel !== "string"
  ) {
    return null;
  }

  const relatedTicketCount =
    typeof result.relatedTicketCount === "number" ? result.relatedTicketCount : 0;
  const relatedCommitCount =
    typeof result.relatedCommitCount === "number" ? result.relatedCommitCount : 0;

  return [
    `根据结构化数据，${result.windowLabel}没有可可靠归因给${result.targetUserName}本人的近期产出证据。`,
    "没有查到该用户本人可归因的工单操作、代码提交或笔记更新。",
    relatedTicketCount > 0
      ? `系统只查到 ${relatedTicketCount} 个与其负责关系相关、但更新者身份未知的工单，不能据此判断他本人正在处理。`
      : "没有查到与其负责关系相关的近期工单更新。",
    relatedCommitCount > 0
      ? "相关工单存在代码变更，但提交者与该用户的归因未验证，不能说是该用户提交。"
      : "相关工单也没有代码提交记录。",
  ].join("\n");
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
 */
export async function generateResponseNode(
  state: AgentState
): Promise<Partial<AgentState>> {
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

  const noDirectActivityConclusion = getNoDirectActivityConclusion(state.toolResults);
  if (noDirectActivityConclusion) {
    return { response: noDirectActivityConclusion };
  }

  const systemPrompt = buildSystemPrompt(userName, state.mode, profile);
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
    const result = await generateText({
      model: agnesFlash,
      system: systemPrompt,
      messages,
    });

    const responseText = result.text;

    return { response: responseText };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { response: `生成回答时出错：${msg}` };
  }
}
