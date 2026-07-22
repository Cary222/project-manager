import type { AgentMode } from "../state";
import type { AgentState } from "../agent";

const SEARCH_KEYWORDS: { pattern: RegExp; category: string }[] = [
  // 需要查项目数据的强意图
  {
    pattern: /(?:工单|ticket|tickets?|issue|issues?)\s*[#：:]\s*\d+/i,
    category: "project_id",
  },
  {
    pattern: /(?:项目|模块|组件|功能)\s*(?:名|名称|是|叫)?\s*[的:]?\s*\S+/i,
    category: "project_name",
  },
  // 明确检索动作 — 扩展动词覆盖"了解/查看/详情"等
  {
    pattern: /(?:帮我)?(?:找|查|搜|检索|调出|列出|查看|了解|想了解|想知道|看看|翻翻)/i,
    category: "search_action",
  },
  // 内容/文档/需求类 — 隐含检索意图
  {
    pattern: /(?:详情|详细内容|具体内容|文档|需求文档|设计文档|技术文档|需求说明|PRD|需求内容)/i,
    category: "search_action",
  },
  // 进度 / 统计类
  {
    pattern: /(?:进度|完成率|统计|汇总|总计|排名|排行|未完成|进行中|逾期)/i,
    category: "statistics",
  },
  // 提交 / 分支 / 代码相关
  {
    pattern: /(?:提交|commit|分支|branch|代码审查|pr|pull.request|review)/i,
    category: "vcs",
  },
  // 工作流 / 指派
  {
    pattern: /(?:指派|分配|负责人|owner|审批|审核|task|todo|待办)/i,
    category: "workflow",
  },
  // 联网搜索模式 — 明确要求联网
  {
    pattern: /(?:联网|搜索|搜一下|latest|实时|今天新闻|最近新闻)/i,
    category: "web",
  },
  // 天气模式 — 触发 webSearch 并附城市
  {
    pattern: /(?:天气|气温|温度|下雨|晴|阴|雨|雪|风|空气|污染|PM)/i,
    category: "weather",
  },
];

function containsSearchKeywords(message: string): boolean {
  return SEARCH_KEYWORDS.some(({ pattern }) => pattern.test(message));
}

function detectMode(message: string): AgentMode {
  // Check for weather intent first
  const hasWeatherIntent = SEARCH_KEYWORDS.some(
    ({ pattern, category }) => category === "weather" && pattern.test(message)
  );
  if (hasWeatherIntent) return "web";

  // Check for explicit web search intent
  const hasWebIntent = SEARCH_KEYWORDS.some(
    ({ pattern, category }) => category === "web" && pattern.test(message)
  );
  if (hasWebIntent) return "web";

  // Check for search/retrieval intent
  if (containsSearchKeywords(message)) return "search";

  // Default to chat
  return "chat";
}

/**
 * Detect intent node — migrates logic from features/ai/lib/detector.ts.
 *
 * Reads the last user message, determines the agent mode,
 * and returns a partial state update with the mode.
 */
export async function detectIntent(
  state: AgentState
): Promise<Partial<AgentState>> {
  if (state.mode !== "auto") {
    console.log(`[detectIntent] early return: mode=${state.mode} !== auto`);
    return { mode: state.mode };
  }

  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage.getType() !== "human") {
    console.log(`[detectIntent] early return: lastMessage missing or not human`);
    return { mode: "chat" };
  }

  const content =
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

  console.log(`[detectIntent] content="${content}"`);

  const mode = detectMode(content);
  console.log(`[detectIntent] detectMode result=${mode}`);

  return { mode };
}
