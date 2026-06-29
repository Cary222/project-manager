/**
 * 智能检测函数 - 判断用户问题是否需要使用 RAG 检索
 */

const SEARCH_KEYWORDS: { pattern: RegExp; category: string }[] = [
  // 项目相关
  { pattern: /项目|工单|ticket|模块|提交|commit|分支|branch|issue|bug|feature/i, category: "project" },

  // 检索动作
  { pattern: /查找|搜索|查询|看看|查看|展示|显示|列出|罗列|获取|找到|有无|有哪些|多少|几个|什么/i, category: "search" },

  // 文档/代码相关
  { pattern: /代码|函数|接口|api|文档|说明|注释|注释|readme|wiki|规范|规则/i, category: "technical" },

  // 技术文档与需求类
  { pattern: /需求|设计|指标|参数|规格|要求|视场角|FOV|灵敏度|精度|分辨率|采样率|功耗|续航|防护|接口|协议/i, category: "spec" },

  // 统计相关
  { pattern: /统计|汇总|合计|总共|总计|总数|排名|排行|进度|状态|完成|未完成|进行中/i, category: "statistics" },

  // 工作流相关
  { pattern: /任务|task|todo|待办|指派|分配|负责人|owner|review|审批|审核|approve/i, category: "workflow" },
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
