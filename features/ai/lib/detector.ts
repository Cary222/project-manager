/**
 * 智能检测函数 - 判断用户问题是否需要使用 RAG 检索
 *
 * 设计原则：
 * - searchStructured（DB 查询）用于浅层、精确的查询（工单号、项目名、用户统计等）
 * - searchKnowledge（RAG 向量检索）用于深层、语义化的查询（文档内容、笔记详情、设计细节等）
 * - 优先使用 searchStructured；涉及"详细内容/文档/笔记"时才触发 searchKnowledge
 */

const SEARCH_KEYWORDS: { pattern: RegExp; category: string }[] = [
  // 需要查项目数据的强意图
  { pattern: /(?:工单|ticket|tickets?|issue|issues?)\s*[#：:]\s*\d+/i, category: "project_id" },
  { pattern: /(?:项目|模块|组件|功能)\s*(?:名|名称|是|叫)?\s*[的:]?\s*\S+/i, category: "project_name" },

  // 明确检索动作
  { pattern: /(?:帮我)?(?:找|查|搜|检索|调出|列出|查看|了解|想了解|看看|翻翻)/i, category: "search_action" },

  // 进度 / 统计类
  { pattern: /(?:进度|完成率|统计|汇总|总计|排名|排行|未完成|进行中|逾期)/i, category: "statistics" },

  // 提交 / 分支 / 代码相关
  { pattern: /(?:提交|commit|分支|branch|代码审查|pr|pull.request|review)/i, category: "vcs" },

  // 工作流 / 指派
  { pattern: /(?:指派|分配|负责人|owner|审批|审核|task|todo|待办)/i, category: "workflow" },
];

// 深层内容查询 — 触发 RAG (searchKnowledge)
const DEEP_CONTENT_KEYWORDS: { pattern: RegExp }[] = [
  { pattern: /(?:了解|想了解|想知道|详情|详细内容|具体内容)/i },
  { pattern: /(?:文档|需求文档|设计文档|技术文档|需求说明|PRD)/i },
  { pattern: /(?:笔记|记录|说明|资料|需求内容)/i },
  { pattern: /(?:光污染|传感器|硬件|功能设计|接口设计|算法)/i },
];

/**
 * 检测消息中是否包含需要检索的关键词
 */
function containsSearchKeywords(message: string): boolean {
  return SEARCH_KEYWORDS.some(({ pattern }) => pattern.test(message));
}

/**
 * 检测是否为深层内容查询（需要 RAG）
 */
function isDeepContentQuery(message: string): boolean {
  return DEEP_CONTENT_KEYWORDS.some(({ pattern }) => pattern.test(message));
}

/**
 * 判断是否应该使用 RAG 检索（searchKnowledge）
 *
 * @param message - 用户输入的消息
 * @param forceMode - 强制模式，覆盖自动检测
 * @returns 是否使用 RAG 检索
 */
export function shouldUseRag(
  message: string,
  forceMode?: "search" | "chat"
): boolean {
  // 强制模式直接返回
  if (forceMode === "search") return true;
  if (forceMode === "chat") return false;

  // 自动检测模式：深层内容查询才走 RAG
  return isDeepContentQuery(message);
}

/**
 * 获取匹配的关键词类别（用于调试/分析）
 */
export function getMatchedCategories(message: string): string[] {
  return SEARCH_KEYWORDS
    .filter(({ pattern }) => pattern.test(message))
    .map(({ category }) => category);
}

// 联网搜索意图关键词 — 与 RAG / DB 无关，独立模式
const WEB_SEARCH_KEYWORDS: { pattern: RegExp }[] = [
  // 天气（必须带天气相关词）
  { pattern: /(?:天气|气温|温度|空气质量|空气指数)/i },
  // 明确要求的联网动作
  { pattern: /(?:联网搜索?|搜一下网|上网查)/i },
  // 明确的时间+外部事件
  { pattern: /(?:latest|实时新闻|今日新闻|最近新闻)/i },
  // 通用世界/全球事件（不带具体项目/人员上下文的）
  { pattern: /(?:世界上发生了什么|全球最近|国际动态)/i },
  // 特定实时信息类
  { pattern: /(?:股票[市价]|实时股价|今日汇率|比赛结果|体育新闻|开奖公告)/i },
];

/**
 * 判断是否应该使用联网搜索
 * auto 模式下：消息包含天气、新闻、实时数据等关键词时返回 true
 */
export function shouldUseWebSearch(message: string): boolean {
  return WEB_SEARCH_KEYWORDS.some(({ pattern }) => pattern.test(message));
}
