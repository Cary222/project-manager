/**
 * 智能检测函数 - 判断用户问题是否需要使用 RAG 检索
 */

const SEARCH_KEYWORDS: { pattern: RegExp; category: string }[] = [
  // 需要查项目数据的强意图
  { pattern: /(?:工单|ticket|tickets?|issue|issues?)\s*[#：:]\s*\d+/i, category: "project_id" },
  { pattern: /(?:项目|模块|组件|功能)\s*(?:名|名称|是|叫)?\s*[的:]?\s*\S+/i, category: "project_name" },

  // 明确检索动作
  { pattern: /(?:帮我)?(?:找|查|搜|检索|调出|列出|查看)\b/i, category: "search_action" },

  // 进度 / 统计类
  { pattern: /(?:进度|完成率|统计|汇总|总计|排名|排行|未完成|进行中|逾期)/i, category: "statistics" },

  // 提交 / 分支 / 代码相关
  { pattern: /(?:提交|commit|分支|branch|代码审查|pr|pull.request|review)/i, category: "vcs" },

  // 工作流 / 指派
  { pattern: /(?:指派|分配|负责人|owner|审批|审核|task|todo|待办)/i, category: "workflow" },
];

/**
 * 检测消息中是否包含需要检索的关键词
 */
function containsSearchKeywords(message: string): boolean {
  return SEARCH_KEYWORDS.some(({ pattern }) => pattern.test(message));
}

/**
 * 判断是否应该使用 RAG 检索
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

  // 自动检测模式
  return containsSearchKeywords(message);
}

/**
 * 获取匹配的关键词类别（用于调试/分析）
 */
export function getMatchedCategories(message: string): string[] {
  return SEARCH_KEYWORDS
    .filter(({ pattern }) => pattern.test(message))
    .map(({ category }) => category);
}
