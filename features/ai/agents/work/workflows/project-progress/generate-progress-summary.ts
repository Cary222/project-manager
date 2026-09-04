import { prisma } from "@/shared/db/client";
import type { Prisma } from "@prisma/client";
import { callAgnes } from "@/features/ai/llm/summarizer";

export interface TicketSummaryItem {
  id: string;
  ticketNo: number;
  title: string;
  status: string;
  priority: number;
  projectName: string;
  moduleName: string;
  assignees: string[];
  updatedAt: string;
}

export interface CommitSummaryItem {
  id: string;
  commitSha: string;
  shortSha: string;
  author: string;
  subject: string;
  committedAt: string;
  ticketNo: number;
  ticketId?: string;
  ticketTitle?: string;
}

export interface ProgressSummaryMetadata {
  summary: string;
  ticketCount: number;
  inProgressCount: number;
  resolvedCount: number;
  overdueCount: number;
  commitCount: number;
  tickets: TicketSummaryItem[];
  commits: CommitSummaryItem[];
}

export async function generateProjectProgressSummary(
  workflowRunId: string,
  userId: string,
): Promise<ProgressSummaryMetadata> {
  // 1. 获取用户所属项目及关联的工单
  const tickets = await prisma.ticket.findMany({
    where: {
      project: { members: { some: { userId } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      priority: true,
      updatedAt: true,
      project: { select: { id: true, name: true } },
      module: { select: { id: true, name: true } },
      assignees: { select: { user: { select: { id: true, name: true } } } },
    },
  });

  // 2. 获取最近的代码提交记录
  const commits = await prisma.ticketCommit.findMany({
    where: {
      ticket: { project: { members: { some: { userId } } } },
    },
    orderBy: { committedAt: "desc" },
    take: 20,
    select: {
      id: true,
      commitSha: true,
      author: true,
      subject: true,
      committedAt: true,
      ticketNo: true,
      ticket: { select: { id: true, title: true } },
    },
  });

  // 3. 统计指标
  const inProgressTickets = tickets.filter(
    (t) => t.status === "DEVELOPING" || t.status === "READY_FOR_TEST",
  );
  const resolvedTickets = tickets.filter(
    (t) =>
      t.status === "DONE" || t.status === "DELIVERED" || t.status === "CLOSED",
  );
  const overdueTickets = tickets.filter((t) => t.status === "OVERDUE");

  const ticketItems: TicketSummaryItem[] = tickets.map((t) => ({
    id: t.id,
    ticketNo: t.ticketNo,
    title: t.title,
    status: t.status,
    priority: t.priority,
    projectName: t.project?.name || "未知项目",
    moduleName: t.module?.name || "通用模块",
    assignees: t.assignees.map((a) => a.user?.name).filter(Boolean) as string[],
    updatedAt: t.updatedAt.toISOString(),
  }));

  const commitItems: CommitSummaryItem[] = commits.map((c) => ({
    id: c.id,
    commitSha: c.commitSha,
    shortSha: c.commitSha.slice(0, 7),
    author: c.author,
    subject: c.subject,
    committedAt: c.committedAt.toISOString(),
    ticketNo: c.ticketNo,
    ticketId: c.ticket?.id,
    ticketTitle: c.ticket?.title,
  }));

  // 4. 调用 AI 生成深度进展综述
  let summary = "";
  try {
    const promptContext = `
【项目活跃工单 (${tickets.length} 个)】:
${tickets
  .slice(0, 15)
  .map(
    (t) =>
      `- [#${t.ticketNo}] ${t.title} (状态: ${t.status}, 优先级: P${t.priority}, 项目: ${t.project?.name}, 模块: ${t.module?.name}, 负责人: ${t.assignees.map((a) => a.user?.name).join(",") || "未指派"})`,
  )
  .join("\n")}

【最近代码提交 (${commits.length} 条)】:
${commits
  .slice(0, 15)
  .map(
    (c) =>
      `- [${c.commitSha.slice(0, 7)}] ${c.subject} (作者: ${c.author}, 关联工单: #${c.ticketNo} ${c.ticket?.title || ""})`,
  )
  .join("\n")}
`;

    const aiRes = await callAgnes(
      [
        {
          role: "system",
          content:
            "你是一位资深的项目管理专家与技术负责人。请基于提供的项目工单列表和最近代码提交记录，生成一份专业、结构严谨、内容详实的【项目进展汇总报告】。\n\n报告需采用清晰的 Markdown 排版，包含以下核心板块：\n1. **📊 阶段进展总览**：总结整体推进节奏与当前阶段研发动态。\n2. **🚀 重点交付与已完成工作**：具体列出近期完成或解决的关键工单，并说明其业务与技术价值。\n3. **🔄 进行中核心任务分析**：分析当前正在开发和测试的重点工单，指出进展与协同情况。\n4. **🛠️ 代码提交与技术动态**：根据提交记录概括最近代码层面的改动重点与模块变动。\n5. **💡 风险预警与下一步建议**：指出高优先级/待推进事项，给出建议。\n\n请直接输出格式规范的 Markdown 正文，语言简洁专业，不要输出多余的开场白。",
        },
        {
          role: "user",
          content: `请为以下项目数据生成详实的进展汇总报告：\n${promptContext}`,
        },
      ],
      { userId },
    );

    if (aiRes?.content?.trim()) {
      summary = aiRes.content.trim();
    }
  } catch (error) {
    console.warn(
      "[generateProjectProgressSummary] AI summary failed, using structured template fallback:",
      error,
    );
  }

  // 如果 AI 调用失败或未返回，使用高质量的确定性结构化 Markdown 模板兜底
  if (!summary) {
    summary = `## 📊 阶段进展总览

当前项目共追踪 **${tickets.length}** 个相关工单，包含 **${inProgressTickets.length}** 个正在开发/测试中的任务，近期累计完成 **${resolvedTickets.length}** 个工单，已记录 **${commits.length}** 次代码提交。整体项目研发节奏正常推进中。

---

## 🚀 重点交付与已解决工单
${
  resolvedTickets.length > 0
    ? resolvedTickets
        .slice(0, 6)
        .map(
          (t) =>
            `- **[#${t.ticketNo}] ${t.title}** · \`${t.module?.name || "模块"}\` (已交付/已完成)`,
        )
        .join("\n")
    : "- 暂无最近完成的工单记录"
}

---

## 🔄 正在进行中的核心任务
${
  inProgressTickets.length > 0
    ? inProgressTickets
        .slice(0, 8)
        .map(
          (t) =>
            `- **[#${t.ticketNo}] ${t.title}** · 状态: \`${t.status}\` · 优先级: \`P${t.priority}\` · 负责人: ${
              t.assignees.map((a) => a.user?.name).join("、") || "未指派"
            }`,
        )
        .join("\n")
    : "- 当前无进行中任务"
}

---

## 🛠️ 最近代码提交动态
${
  commits.length > 0
    ? commits
        .slice(0, 6)
        .map(
          (c) =>
            `- \`${c.commitSha.slice(0, 7)}\` **${c.subject}** (作者: ${c.author} · #${c.ticketNo})`,
        )
        .join("\n")
    : "- 暂无近期代码提交记录"
}

---

## 💡 风险预警与下一步建议
- 优先跟进进行中的高优先级工单，保持开发分支与代码提交规范关联。
- 建议及时更新已进入测试阶段的工单状态，确保协作进度实时透明。`;
  }

  const metadata: ProgressSummaryMetadata = {
    summary,
    ticketCount: tickets.length,
    inProgressCount: inProgressTickets.length,
    resolvedCount: resolvedTickets.length,
    overdueCount: overdueTickets.length,
    commitCount: commits.length,
    tickets: ticketItems,
    commits: commitItems,
  };

  // SAFETY: ProgressSummaryMetadata is a plain JSON-serializable object matching WorkflowRun.metadata JSON schema
  await prisma.workflowRun.update({
    where: { id: workflowRunId },
    data: {
      status: "completed",
      metadata: metadata as unknown as Prisma.InputJsonValue,
      history: [
        {
          timestamp: new Date().toISOString(),
          action: "completed",
          note: "项目进展汇总生成完成",
        },
      ],
    },
  });

  return metadata;
}
