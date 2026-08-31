import { prisma } from "@/shared/db/client";
import { callAgnes } from "./summarizer";

export interface MeetingActionItem {
  task: string;
  assignee?: string;
  dueDate?: string;
}

export interface MeetingSummaryData {
  summary: string;
  progress: string[];
  discussions: string[];
  decisions: string[];
  actionItems: MeetingActionItem[];
  risks: string[];
  nextPlans: string[];
}

/**
 * 获取周会所在周的项目成员周报信息作为参考上下文
 */
export async function getWeeklyReportsForMeeting(
  projectId: string,
  meetingDate: Date,
): Promise<{
  reports: Array<{ userName: string; title: string; content: string }>;
  reportIds: string[];
}> {
  // 计算会议所在周的周一 00:00:00 与周日 23:59:59 (以会议日期的本地时间或UTC计算)
  const d = new Date(meetingDate);
  const day = d.getDay(); // 0 是周日, 1-6 是周一到周六
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  // 查询该项目关联且时间在该周范围内的周报
  const weeklyReports = await prisma.weeklyReport.findMany({
    where: {
      projects: {
        some: {
          projectId,
        },
      },
      OR: [
        {
          weekStart: {
            lte: sunday,
          },
          weekEnd: {
            gte: monday,
          },
        },
        {
          createdAt: {
            gte: monday,
            lte: sunday,
          },
        },
      ],
    },
    include: {
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 20,
  });

  const reports = weeklyReports.map((r) => ({
    userName: r.user.name || r.user.email.split("@")[0],
    title: r.title,
    content: r.content,
  }));

  return {
    reports,
    reportIds: weeklyReports.map((r) => r.id),
  };
}

/**
 * 构造会议纪要生成 Prompt 并调用 LLM 提取 7 要素
 */
export async function generateMeetingSummaryFromTranscript(params: {
  userId: string;
  meetingTitle: string;
  meetingDate: Date;
  transcript: string;
  weeklyReports?: Array<{ userName: string; title: string; content: string }>;
}): Promise<MeetingSummaryData> {
  const {
    userId,
    meetingTitle,
    meetingDate,
    transcript,
    weeklyReports = [],
  } = params;

  let weeklyReportsSection = "";
  if (weeklyReports.length > 0) {
    const formattedReports = weeklyReports
      .map(
        (r, idx) =>
          `### 成员周报 ${idx + 1}：${r.userName}（${r.title}）\n${r.content}`,
      )
      .join("\n\n");
    weeklyReportsSection = `
【参考材料：本周项目成员周报】
以下是项目团队成员在本次周会所在周提交的周报记录，供辅助提炼背景、成员责任与具体任务：
${formattedReports}
`;
  }

  const systemPrompt = `你是一个资深的项目管理专家与会议纪要分析师。
你的任务是根据输入的周会原始语音转录文本（第一手会议现场讨论），结合提供的项目成员周报材料（背景辅助），生成一份高质量、条理清晰的结构化项目周会纪要。

请严格提取并包含以下 7 大核心要素：
1. summary (会议摘要): 总结本次会议核心背景、总体节奏与重大共识（150~300字）。
2. progress (本周进展): 梳理本周各模块/成员已完成的核心成果与里程碑（字符串数组）。
3. discussions (讨论事项): 记录会议期间探讨的关键议题、各方意见与分析（字符串数组）。
4. decisions (决策事项): 明确会议拍板定案的结论、技术方案选型或业务规则（字符串数组）。
5. actionItems (待办事项): 提取所有后续具体行动项，必须明确任务内容，并尽量标明负责人 (assignee) 与截止时间 (dueDate)（对象数组：[{ task, assignee, dueDate }]）。
6. risks (风险预警): 指出当前存在或潜在的阻塞点、技术风险、进度延期或协作难点（字符串数组）。
7. nextPlans (下周计划): 列出下周重点攻坚目标与关键排期（字符串数组）。

输出要求：
- 必须且只能输出严格的合法 JSON 格式，不要添加额外的 Markdown 代码块或解释说明文字。
- JSON 键名固定为：summary (string), progress (array of string), discussions (array of string), decisions (array of string), actionItems (array of { task: string, assignee?: string, dueDate?: string }), risks (array of string), nextPlans (array of string)。`;

  const userContent = `
【会议信息】
- 会议主题：${meetingTitle}
- 会议日期：${meetingDate.toISOString().slice(0, 10)}

${weeklyReportsSection}

【周会原始语音转写文本】
${transcript}
`;

  const { content } = await callAgnes(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    { userId },
  );

  return parseAndValidateSummaryJson(content, transcript);
}

/**
 * 解析并校验 LLM 输出的 JSON，支持容错与兜底补全
 */
export function parseAndValidateSummaryJson(
  rawText: string,
  fallbackTranscript?: string,
): MeetingSummaryData {
  let cleaned = rawText.trim();
  // 去除 markdown json 代码块包装
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/```$/, "")
      .trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```\s*/, "")
      .replace(/```$/, "")
      .trim();
  }

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : fallbackTranscript
          ? `本次会议针对项目推进进行了深入讨论与安排。`
          : "";

    const progress = Array.isArray(parsed.progress)
      ? parsed.progress.map((i) => String(i).trim()).filter(Boolean)
      : [];

    const discussions = Array.isArray(parsed.discussions)
      ? parsed.discussions.map((i) => String(i).trim()).filter(Boolean)
      : [];

    const decisions = Array.isArray(parsed.decisions)
      ? parsed.decisions.map((i) => String(i).trim()).filter(Boolean)
      : [];

    const actionItems: MeetingActionItem[] = Array.isArray(parsed.actionItems)
      ? parsed.actionItems
          .map((item: unknown) => {
            if (typeof item === "string") return { task: item.trim() };
            if (item && typeof item === "object") {
              const obj = item as Record<string, unknown>;
              return {
                task: String(obj.task || obj.title || obj.content || "").trim(),
                assignee: obj.assignee
                  ? String(obj.assignee).trim()
                  : undefined,
                dueDate: obj.dueDate ? String(obj.dueDate).trim() : undefined,
              };
            }
            return null;
          })
          .filter((item): item is MeetingActionItem =>
            Boolean(item && item.task),
          )
      : [];

    const risks = Array.isArray(parsed.risks)
      ? parsed.risks.map((i) => String(i).trim()).filter(Boolean)
      : [];

    const nextPlans = Array.isArray(parsed.nextPlans)
      ? parsed.nextPlans.map((i) => String(i).trim()).filter(Boolean)
      : [];

    return {
      summary,
      progress,
      discussions,
      decisions,
      actionItems,
      risks,
      nextPlans,
    };
  } catch (error) {
    console.warn(
      "[parseAndValidateSummaryJson] Failed to parse JSON, applying fallback parser:",
      error,
    );
    // 简单正则提取或兜底返回
    return {
      summary: rawText.slice(0, 300) || "会议讨论内容已记录。",
      progress: [],
      discussions: ["语音转录内容已解析，请在草稿区完善讨论细节。"],
      decisions: [],
      actionItems: [],
      risks: [],
      nextPlans: [],
    };
  }
}

/**
 * 将 7 要素渲染为优雅、规范的 Markdown 文档（供发布正式项目文档）
 */
export function renderMeetingSummaryMarkdown(
  title: string,
  meetingDate: Date | string,
  summary: MeetingSummaryData,
): string {
  const dateStr =
    typeof meetingDate === "string"
      ? meetingDate.slice(0, 10)
      : meetingDate.toISOString().slice(0, 10);

  const lines: string[] = [];
  lines.push(`# 📑 ${title}`);
  lines.push(`> **会议日期**：${dateStr}`);
  lines.push("");

  lines.push("## 📋 会议摘要");
  lines.push(summary.summary || "（无）");
  lines.push("");

  lines.push("## 🚀 本周进展");
  if (summary.progress && summary.progress.length > 0) {
    summary.progress.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push("- （暂无明确进展条目）");
  }
  lines.push("");

  lines.push("## 💬 讨论事项");
  if (summary.discussions && summary.discussions.length > 0) {
    summary.discussions.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push("- （暂无重点讨论条目）");
  }
  lines.push("");

  lines.push("## ⚖️ 决策事项");
  if (summary.decisions && summary.decisions.length > 0) {
    summary.decisions.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push("- （暂无重大决策变更）");
  }
  lines.push("");

  lines.push("## 📌 待办事项 (Action Items)");
  if (summary.actionItems && summary.actionItems.length > 0) {
    summary.actionItems.forEach((item) => {
      let meta = "";
      if (item.assignee) meta += ` @${item.assignee}`;
      if (item.dueDate) meta += ` (截止: ${item.dueDate})`;
      lines.push(`- [ ] **${item.task}**${meta}`);
    });
  } else {
    lines.push("- [ ] （无待分配行动项）");
  }
  lines.push("");

  lines.push("## ⚠️ 风险预警");
  if (summary.risks && summary.risks.length > 0) {
    summary.risks.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push("- （当前项目无高危风险记录）");
  }
  lines.push("");

  lines.push("## 🎯 下周计划");
  if (summary.nextPlans && summary.nextPlans.length > 0) {
    summary.nextPlans.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push("- （暂无下周排期）");
  }
  lines.push("");

  return lines.join("\n");
}
