/**
 * Work Agent — Template Matcher
 *
 * 职责：
 * - 加载所有 workflow 模板
 * - 根据用户输入匹配最佳模板
 * - 返回匹配结果和置信度
 */

import type { WorkflowTemplate } from "../workflows/registry";
import type { RouterContext } from "./router";
import { callAgnes } from "@/features/ai/llm/summarizer";

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

// ─── LLM-based Matcher ───────────────────────────────────────────────────────

/**
 * LLM-based matcher for ambiguous inputs.
 *
 * 构造候选清单 → 调 callAgnes → 解析 JSON → 白名单校验 workflowId → 兜底 null。
 * 任何异常静默降级，不抛。
 */
export async function matchByLLM(
  input: string,
  templates: WorkflowTemplate[],
  context?: RouterContext
): Promise<MatchResult> {
  if (templates.length === 0) {
    return { workflowId: null, confidence: 0 };
  }

  // 构造候选清单（白名单）
  const candidates = templates.map((t) => ({
    id: t.type,
    name: t.name,
    description: t.description,
  }));
  const validIds = new Set(templates.map((t) => t.type));

  try {
    const res = await callAgnes(
      [
        {
          role: "system",
          content: `你是一个任务意图分类器。根据用户输入判断最匹配的工作流。
只能从以下候选中选择，无法确定时 workflowId 输出 null。
候选清单：
${candidates.map((c) => `- ${c.id}: ${c.name} — ${c.description}`).join("\n")}

直接输出 JSON（不要 markdown 代码块）：
{"workflowId": "候选id 或 null", "confidence": 0.0到1.0, "reason": "判断理由"}`,
        },
        { role: "user", content: input },
      ],
      { userId: context?.userId },
    );

    // 清洗 markdown 围栏
    const cleaned = res.content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as {
      workflowId?: string | null;
      confidence?: number;
      reason?: string;
    };

    // 校验 workflowId 必须在白名单内（防 LLM 幻觉）
    const wfId = parsed.workflowId ?? null;
    if (wfId && !validIds.has(wfId)) {
      return { workflowId: null, confidence: 0, matchedBy: "llm", reason: `LLM 返回了未知 workflowId: ${wfId}` };
    }

    // 归一化 confidence 到 [0,1]
    const raw = Number(parsed.confidence) || 0;
    const confidence = Math.max(0, Math.min(1, raw));

    return {
      workflowId: wfId,
      confidence,
      matchedBy: "llm",
      reason: parsed.reason,
    };
  } catch {
    // 任何异常静默兜底
    return { workflowId: null, confidence: 0 };
  }
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
