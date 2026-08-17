import { webSearch } from "./web-search";
import { searchKnowledge } from "./search-knowledge";
import { searchStructured } from "./search-structured";
import { webScrape, webMap } from "./web-scrape";

export { webSearch, searchKnowledge, searchStructured, webScrape, webMap };

export type ToolMode = "auto" | "web" | "scrape" | "search" | "chat" | "image";

type WebToolSet = {
  webSearch: typeof webSearch;
  searchStructured: typeof searchStructured;
};
type ScrapeToolSet = {
  webScrape: typeof webScrape;
  webMap: typeof webMap;
};
type SearchToolSet = {
  searchKnowledge: typeof searchKnowledge;
  searchStructured: typeof searchStructured;
};
type AutoToolSet = {
  searchStructured: typeof searchStructured;
  searchKnowledge: typeof searchKnowledge;
};
type EmptyToolSet = Record<string, never>;

interface ModePolicy {
  // key order = LLM schema order (= priority in Vercel AI SDK)
  tools: WebToolSet | ScrapeToolSet | SearchToolSet | AutoToolSet | EmptyToolSet;
  maxSteps: number;
}

const POLICIES: Record<ToolMode, ModePolicy> = {
  // auto: 项目内数据为主，structured 优先（工单/用户/项目查询命中率更高）
  // maxSteps=20：给 AI 充足空间完成多轮工具调用 + 生成文本
  // stopWhen 在 stepCountIs(20) 触发时，模型已没有新 step 可用，text 会在 step 20 完成
  auto:   { tools: { searchStructured, searchKnowledge }, maxSteps: 20 },
  // search: 强制检索项目知识库，knowledge 优先（语义检索更精准）
  // maxSteps=25：留足空间让 LLM 完成多轮检索后再生成文本
  search: { tools: { searchKnowledge, searchStructured }, maxSteps: 25 },
  // chat: 无工具，纯对话。maxSteps=3 因为需要更多步生成完整回复
  chat:   { tools: {},                                    maxSteps: 3 },
  // web: 联网优先，项目数据兜底；knowledge 不挂（联网场景下笔记兜底反而带偏）
  web:    { tools: { webSearch, searchStructured },       maxSteps: 15 },
  // scrape: 深度爬取外部文档，用于抓取完整技术文档、面试题库等内容
  // AI 可以根据 URL 直接爬取完整页面内容，用于知识库补充或对话上下文
  scrape: { tools: { webScrape, webMap },                   maxSteps: 10 },
  // image: 前端直接调用 /api/ai/generate/image，不走 LLM
  image:  { tools: {},                                    maxSteps: 1 },
};

export function toolsetForMode(
  mode: ToolMode
): WebToolSet | ScrapeToolSet | SearchToolSet | AutoToolSet | EmptyToolSet | undefined {
  const policy = POLICIES[mode] ?? POLICIES.auto;
  if (Object.keys(policy.tools).length === 0) return undefined;
  return policy.tools;
}

export function maxStepsForMode(mode: ToolMode): number {
  return POLICIES[mode]?.maxSteps ?? 4;
}
