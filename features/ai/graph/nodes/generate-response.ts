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
RULE 3：综合所有检索结果回答用户问题。`,
    auto: `【通用模式】先用 searchStructured 快速查询工单和周报；如果搜索结果不理想，再用 searchKnowledge 做深度语义检索。`,
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
- 查询结果为“未找到”或查询失败时，原样说明未找到或失败，不得生成示例数据。
- 用户问“某人在做什么 / 最近开发 / 周报 / 工单”时，必须以 searchStructured 查询结果为准。`;

  const profileSummary = formatProfile(profile);
  const profileBlock = profileSummary ? `\n${profileSummary}` : "";

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

  const systemPrompt = buildSystemPrompt(userName, state.mode, profile);
  const messages = buildMessages(
    state.messages.slice(0, -1),
    userContent,
    state.searchResults,
    state.toolResults
  );

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
