import type { AgentState } from "../agent";
import { searchStructured } from "@/features/ai/tools/search-structured";
import { setSearchStructuredViewer } from "@/features/ai/tools/search-structured";

/**
 * Inject runtime context into module-scoped closures.
 * Must be called before the tool executes.
 */
export function injectSearchStructuredContext(viewerUserId: string) {
  setSearchStructuredViewer(viewerUserId);
}

/**
 * Wraps the existing searchStructured tool as a graph node.
 * Executes structured DB queries (tickets, projects, users, commits, reports).
 */
export async function searchStructuredNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage) return {};

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : "";

  try {
    const queryType = parseQueryType(content);
    const extractedId = extractId(content);
    const extractedUser = queryType === "user" || queryType === "weekly_report"
      ? extractUserIdentifier(content) || extractedId
      : extractedId;
    const activityWindow = queryType === "user"
      ? detectActivityWindow(content)
      : undefined;

    console.log(`[AI-LangGraph] searchStructured type=${queryType} id=${extractedId} user=${extractedUser ?? "none"} window=${activityWindow ?? "none"} content="${content.slice(0, 50)}"`);

    const result = await searchStructured.execute(
      {
        type: queryType,
        id: extractedUser,
        filters: queryType === "user"
          ? { ...(extractedUser ? { userId: extractedUser } : {}), activityWindow }
          : undefined,
        limit: 5,
      },
      { context: {}, messages: [], toolCallId: "lg-search-structured" }
    );

    const resultText =
      typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);

    console.log(`[AI-LangGraph] searchStructured result length=${resultText.length}, content=${resultText.slice(0, 200)}`);

    return {
      searchResults: [resultText],
      toolResults: { searchStructured: result },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[AI-LangGraph] searchStructured error: ${msg}`);
    return {
      searchResults: [`[searchStructured error] ${msg}`],
      toolResults: { searchStructured: { error: msg } },
    };
  }
}

/**
 * Extract a user identifier from the user message so we can resolve names
 * like "cary" / "刘屹鹏" / "许敏捷" to a real user record.
 *
 * Strips activity keywords ("最近在干什么"), punctuation, and stopwords so
 * the remaining token is more likely to be a real user name or email prefix.
 */
function extractUserIdentifier(content: string): string {
  // 1. 先剥掉所有时间词和动作词，避免“今天干了什么”剩下“今天”。
  const timeAdverbs = [
    "最近", "近期", "这周", "本周", "本周内", "近几天", "这几天", "这阵子",
    "今天", "今天内", "今天呢", "今日", "昨天", "昨日", "前天", "前天呢",
    "上周", "上礼拜", "本周初", "本周末", "这几天", "前几周",
  ];
  const activityVerbs = [
    "在做什么", "在干什么", "在干嘛", "做了什么", "干了什么", "做了啥",
    "干什么", "干嘛", "做什么", "开发什么", "工作近况", "工作内容",
    "工作时间", "工作动态", "进展", "进度", "最近动态", "干了啥",
  ];
  const stopPhrases = [
    "这位", "这位同事", "一下", "问下", "帮我", "请", "谢谢", "请问",
    "调出", "列出", "查看", "了解", "想了解", "看看", "翻翻",
  ];
  const stopRegex = new RegExp(
    `(${timeAdverbs.concat(activityVerbs, stopPhrases).join("|")})`,
    "g",
  );
  const cleaned = content
    .replace(stopRegex, " ")
    // 单独剥掉常见的“工作/事情/任务/项目”泛指词，避免"cary 今天 工作"留下“工作”
    .replace(/(?:工作|事情|任务|项目|业务|开发)(?=$|\s)/g, " ")
    .replace(/[，。！？、,.!?:\s]+/g, " ")
    .trim();

  // 2. 优先挑中文姓名片段（>=2 字）
  const chinese = cleaned.match(/[\u4e00-\u9fa5]{2,}/g);
  if (chinese && chinese.length > 0) {
    return chinese.sort((a, b) => b.length - a.length)[0];
  }

  // 3. 否则找第一个看起来像用户名的 token（字母/数字/. / _ / - / @）
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (/[A-Za-z0-9_.\-@]/.test(token)) {
      return token;
    }
  }

  // 4. 兜底：返回 cleaned 第一个非空片段
  return tokens[0] ?? cleaned;
}

/**
 * Extract ID from user content.
 * Handles patterns like "#10156", "工单 10156", "ticket #10156"
 */
function extractId(content: string): string | undefined {
  // Match # followed by digits
  const ticketMatch = content.match(/#(\d+)/);
  if (ticketMatch) return ticketMatch[1];

  // Match 工单号/工单 followed by digits
  const gongdanMatch = content.match(/工单[号]?\s*[:：]?\s*(\d+)/i);
  if (gongdanMatch) return gongdanMatch[1];

  // Match "ticket #123" pattern
  const ticketWordMatch = content.match(/ticket\s*#?(\d+)/i);
  if (ticketWordMatch) return ticketWordMatch[1];

  return undefined;
}

/**
 * Simple heuristic to pick the initial query type.
 * The LLM in generateResponse can refine this.
 */
function parseQueryType(content: string): "ticket" | "project" | "user" | "commit" | "weekly_report" {
  if (/工单|ticket|tickets?|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  return "user";
}

/**
 * Detect the activity time window implied by the user message.
 * Returns one of: "today" | "yesterday" | "this_week" | "this_month" | "recent".
 * Returning undefined means "no time filter — show all recent activity".
 */
function detectActivityWindow(content: string): "today" | "yesterday" | "this_week" | "this_month" | "recent" | undefined {
  if (/(今天|今日|今早|今晩)/.test(content)) return "today";
  if (/(昨天|昨日)/.test(content)) return "yesterday";
  if (/(前天)/.test(content)) return "yesterday";
  if (/(本周|这周|这礼拜)/.test(content)) return "this_week";
  if (/(本月|这个月)/.test(content)) return "this_month";
  if (/(最近|近期|近来|这阵子|近几天|前几天)/.test(content)) return "recent";
  return undefined;
}
