/**
 * Work Agent — Template Matcher
 *
 * 职责：
 * - 加载所有 workflow 模板
 * - 根据用户输入匹配最佳模板
 * - 返回匹配结果和置信度
 */

import type { WorkflowTemplate } from "../workflows/registry";
import type { RouterContext, RouterResult } from "./router";

export interface MatchResult {
  workflowId: string | null;
  confidence: number;
  matchedBy?: "keyword" | "llm" | "explicit";
  reason?: string;
}

// ─── Keyword-based Matcher ────────────────────────────────────────────────────

const WORKFLOW_KEYWORDS: Record<string, string[]> = {
  weekly_report: ["周报", "周工作总结", "生成周报", "提交周报", "weekly report"],
  ticket_analysis: ["工单分析", "ticket analysis", "工单统计"],
  project_summary: ["项目摘要", "项目总结", "project summary"],
};

/**
 * Simple keyword-based matcher for quick template detection.
 */
export function matchByKeyword(
  input: string,
  templates: WorkflowTemplate[]
): MatchResult {
  const lowerInput = input.toLowerCase();

  for (const template of templates) {
    const keywords = WORKFLOW_KEYWORDS[template.type] ?? [];
    for (const keyword of keywords) {
      if (lowerInput.includes(keyword.toLowerCase())) {
        return {
          workflowId: template.type,
          confidence: 0.95,
          matchedBy: "keyword",
          reason: `关键词匹配: "${keyword}"`,
        };
      }
    }
  }

  return { workflowId: null, confidence: 0 };
}

// ─── LLM-based Matcher (Future) ──────────────────────────────────────────────

/**
 * LLM-based matcher for ambiguous inputs.
 * TODO: Implement with LLM call to determine intent.
 */
export async function matchByLLM(
  input: string,
  templates: WorkflowTemplate[],
  _context?: RouterContext
): Promise<MatchResult> {
  // TODO: Call LLM to classify intent
  void templates;

  if (input.includes("分析") || input.includes("report")) {
    return { workflowId: null, confidence: 0 };
  }

  return { workflowId: null, confidence: 0 };
}

// ─── Composite Matcher ───────────────────────────────────────────────────────

export interface MatcherConfig {
  keywordThreshold?: number;
  llmThreshold?: number;
}

const DEFAULT_CONFIG: Required<MatcherConfig> = {
  keywordThreshold: 0.8,
  llmThreshold: 0.6,
};

/**
 * Composite matcher that tries keyword first, then LLM.
 */
export class TemplateMatcher {
  private templates: WorkflowTemplate[];
  private config: Required<MatcherConfig>;

  constructor(templates: WorkflowTemplate[], config?: MatcherConfig) {
    this.templates = templates;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Try to match user input against available templates.
   */
  async match(input: string, context?: RouterContext): Promise<MatchResult> {
    // Step 1: Keyword matching (fast path)
    const keywordResult = matchByKeyword(input, this.templates);
    if (keywordResult.workflowId && keywordResult.confidence >= this.config.keywordThreshold) {
      return keywordResult;
    }

    // Step 2: LLM matching (for ambiguous inputs)
    const llmResult = await matchByLLM(input, this.templates, context);
    if (llmResult.workflowId && llmResult.confidence >= this.config.llmThreshold) {
      return llmResult;
    }

    // No match found
    return { workflowId: null, confidence: 0 };
  }

  /**
   * Get template by type ID.
   */
  getTemplate(workflowId: string): WorkflowTemplate | undefined {
    return this.templates.find((t) => t.type === workflowId);
  }
}
