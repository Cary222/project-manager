/**
 * features/reports/weekly-reports/lib/draft-summary.ts
 *
 * PR7 新增：周报编辑页 AI 总结生成器。
 *
 * 复用 callAgnes from features/ai/lib/summarizer。
 * 生成结构化 JSON：highlights / tasks / nextPlan / rawMarkdown。
 */

import { callAgnes } from "@/features/ai/llm/summarizer";
import type { WeeklyContext } from "./context-aggregator";

// ============================================================
// Types
// ============================================================

export interface WeeklyDraftSummary {
  highlights: string[];
  tasks: string[];
  nextPlan: string[];
  rawMarkdown: string;
  _error?: string;
}

export interface FormDraft {
  title?: string;
  content?: string;
  projectIds?: string[];
}

// ============================================================
// Constants
// ============================================================

const MAX_CONTEXT_CHARS = 6000;

const DRAFT_INSTRUCTION = [
  "你是一个工作周报助手。用户需要你根据以下数据生成一份结构化的工作周报草稿。",
  "",
  "请严格输出以下 JSON 格式，不要有其他文字：",
  "{",
  '  "highlights": ["本周重点 1", "本周重点 2", "本周重点 3"],',
  '  "tasks": ["完成任务 1", "完成任务 2", ...],',
  '  "nextPlan": ["下周计划 1", "下周计划 2", "下周计划 3"],',
  '  "rawMarkdown": "## 本周重点\\n...\\n## 完成任务\\n...\\n## 下周计划\\n..."',
  "}",
  "",
  "注意：",
  "- highlights：本周最重要的 1-3 件事，简洁有力",
  "- tasks：本周完成的具体任务，尽量具体（如「完成了 XX 模块的 XX 功能」），最多 5 条",
  "- nextPlan：下周计划，最多 3 条",
  "- rawMarkdown：完整的 Markdown 格式周报草稿，包含上述三个章节",
  "- 如果某项数据不足，返回空数组即可",
  "- 必须输出严格合法的 JSON",
].join("\n");

// ============================================================
// Context serializer
// ============================================================

function summarizeTicketList(
  ctx: WeeklyContext
): string {
  if (ctx.tickets.length === 0) return "本周无工单记录。";
  return ctx.tickets
    .slice(0, 10)
    .map(
      (t) =>
        `- #${t.ticketNo} ${t.title} [${t.status}] @${t.projectName}`
    )
    .join("\n");
}

function summarizeNotes(ctx: WeeklyContext): string {
  if (ctx.notes.length === 0) return "本周无笔记记录。";
  return ctx.notes
    .slice(0, 8)
    .map((n) => `- ${n.title}: ${n.snippet}`)
    .join("\n");
}

function summarizeConversations(ctx: WeeklyContext): string {
  if (ctx.conversations.length === 0) return "本周无 AI 对话记录。";
  return ctx.conversations
    .slice(0, 5)
    .map((c) => {
      const meta = [c.messageCount + " 条消息"].filter(Boolean).join("，");
      const s = c.summary ? `（${c.summary}）` : "";
      return `- ${c.title} ${s} [${meta}]`;
    })
    .join("\n");
}

function summarizeVisits(ctx: WeeklyContext): string {
  const { topProjects, validViews, totalDwellMs, recentDetails } = ctx.visits;
  const parts: string[] = [];

  if (topProjects.length > 0) {
    parts.push(
      `访问最多的页面：${topProjects
        .map((p) => `${p.name}(${p.visits}次)`)
        .join("、")}`
    );
  }

  parts.push(
    `有效访问：${validViews} 次，总停留：${Math.round(totalDwellMs / 1000)} 秒`
  );

  if (recentDetails.length > 0) {
    parts.push(
      "最近访问：\n" +
        recentDetails
          .slice(0, 3)
          .map((v) => `  - ${v.targetName} (${Math.round(v.dwellMs / 1000)}s)`)
          .join("\n")
    );
  }

  return parts.join("\n");
}

export function serializeWeeklyContext(
  ctx: WeeklyContext,
  formDraft?: FormDraft
): string {
  const sections: string[] = [];

  sections.push("## 用户已填写的周报内容");
  if (formDraft?.title) {
    sections.push(`标题：${formDraft.title}`);
  }
  if (formDraft?.content) {
    sections.push(`正文：\n${formDraft.content}`);
  }
  if (formDraft?.projectIds && formDraft.projectIds.length > 0) {
    sections.push(`关联项目 ID：${formDraft.projectIds.join("、")}`);
  }
  sections.push("");

  sections.push("## 本周工单情况");
  sections.push(summarizeTicketList(ctx));
  sections.push("");

  sections.push("## 本周笔记");
  sections.push(summarizeNotes(ctx));
  sections.push("");

  sections.push("## 本周 AI 对话");
  sections.push(summarizeConversations(ctx));
  sections.push("");

  sections.push("## 本周站点访问");
  sections.push(summarizeVisits(ctx));

  let serialized = sections.join("\n");

  // Truncate to token limit
  if (serialized.length > MAX_CONTEXT_CHARS) {
    serialized = serialized.slice(0, MAX_CONTEXT_CHARS) + "\n…（内容已截断）";
  }

  return serialized;
}

// ============================================================
// LLM call
// ============================================================

function extractJsonFromResponse(text: string): string {
  const match = text.match(/```json\n?([\s\S]*?)\n?```/);
  if (match) {
    return match[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

// ============================================================
// Main export
// ============================================================

export async function generateWeeklyDraftSummary(
  _userId: string,
  _weekStart: Date,
  _weekEnd: Date,
  formDraft?: FormDraft,
  ctx?: WeeklyContext
): Promise<WeeklyDraftSummary> {
  // If context provided directly, use it; otherwise compute it (for backwards compatibility)
  const context = ctx;

  if (!context) {
    return {
      highlights: [],
      tasks: [],
      nextPlan: [],
      rawMarkdown: "",
      _error: "No context provided",
    };
  }

  const serialized = serializeWeeklyContext(context, formDraft);

  const promptUser = [
    DRAFT_INSTRUCTION,
    "",
    "## 数据",
    serialized,
  ].join("\n");

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: DRAFT_INSTRUCTION },
    { role: "user", content: promptUser },
  ];

  try {
    const responseText = await callAgnes(messages);
    const jsonStr = extractJsonFromResponse(responseText);
    const result = JSON.parse(jsonStr) as WeeklyDraftSummary;

    return {
      highlights: Array.isArray(result.highlights) ? result.highlights : [],
      tasks: Array.isArray(result.tasks) ? result.tasks : [],
      nextPlan: Array.isArray(result.nextPlan) ? result.nextPlan : [],
      rawMarkdown: typeof result.rawMarkdown === "string" ? result.rawMarkdown : "",
    };
  } catch (err) {
    console.warn("[draft-summary] LLM call failed:", err);
    return {
      highlights: [],
      tasks: [],
      nextPlan: [],
      rawMarkdown: "",
      _error: err instanceof Error ? err.message : "LLM 调用失败",
    };
  }
}
