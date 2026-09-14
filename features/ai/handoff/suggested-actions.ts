/**
 * Suggested Actions Generator — 基于结构化决策、检索结果与回复内容生成下一步建议动作（Next Best Action）。
 *
 * 核心原则：
 * 1. 闭环协同：与 Global Mode Router 与 Chat Decision 产生闭环，传递工作流意图与能力提示；
 * 2. 结构化直出 + Agent 语义感知：综合查询意图、工具结果、实体以及模型产出的文本内容自主推导；
 * 3. 双端流转：target 可以指向 "chat"（继续深入追问/提供细节）或 "work"（平滑切入工作台执行）；
 * 4. 严格克制：每次回答最多推荐 2~3 个高价值动作，不制造信息噪音。
 */

export interface SuggestedAction {
  id: string;
  label: string;
  target: "chat" | "work";
  capability?: string;
  workflowHint?: string;
  payload?: Record<string, unknown>;
}

export interface SuggestedActionContext {
  query: string;
  queryType?: string;
  intent?: string;
  toolResults?: Record<string, unknown>;
  resolvedEntities?: {
    ticket?: { id?: string; ticketNo?: number; title?: string; name?: string };
    project?: { id?: string; name?: string };
    user?: { id?: string; name?: string };
  } | null;
  workflowMatch?: {
    type: string;
    workflow: { name: string; description: string };
  } | null;
  workSuggestion?: {
    workflowHint?: string;
    capability?: string;
    reason?: string;
  } | null;
  answerContent?: string;
}

export function generateSuggestedActions(
  context: SuggestedActionContext,
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const {
    query,
    queryType,
    resolvedEntities,
    toolResults,
    workflowMatch,
    workSuggestion,
    answerContent = "",
  } = context;
  const text = query.toLowerCase();
  const answer = answerContent.toLowerCase();

  // ── 0. 闭环优先：如果上游 Global Router 或 detectIntent 已明确判定了 Workflow ──
  const activeWorkflow = workflowMatch?.type || workSuggestion?.workflowHint;

  if (activeWorkflow) {
    const workflowNames: Record<string, string> = {
      weekly_report: "周报生成",
      project_progress: "项目进展大盘",
      meeting_minutes: "会议纪要整理",
      coding: "Coding 开发任务",
    };
    const workflowIcons: Record<string, string> = {
      weekly_report: "⚡",
      project_progress: "📊",
      meeting_minutes: "🎙️",
      coding: "💻",
    };
    const name =
      workflowMatch?.workflow?.name ||
      workflowNames[activeWorkflow] ||
      activeWorkflow;
    const icon = workflowIcons[activeWorkflow] || "⚡";

    actions.push({
      id: `action_handoff_${activeWorkflow}`,
      label: `${icon} 进入 Work 模式：${name}`,
      target: "work",
      workflowHint: activeWorkflow,
      payload: { goalPrompt: query },
    });
  }

  // ── 1. 会议纪要建议：当用户提及会议、纪要、录音转写或生成中提到纪要模板时 ──
  const isMeetingIntent =
    queryType === "meeting" ||
    activeWorkflow === "meeting_minutes" ||
    /(?:会议|纪要|周会|例会|站会|录音|转写).*(?:记录|整理|生成|做|写|录入|总结|上传)/i.test(
      text,
    ) ||
    /(?:记录|整理|生成|做|写|转写).*(?:会议|纪要|录音)/i.test(text) ||
    /会议纪要/i.test(text) ||
    answer.includes("会议纪要") ||
    answer.includes("纪要模板");

  if (
    isMeetingIntent &&
    !actions.some((a) => a.workflowHint === "meeting_minutes")
  ) {
    actions.push({
      id: "action_meeting_minutes",
      label: "🎙️ 进入 Work 模式：会议纪要整理",
      target: "work",
      workflowHint: "meeting_minutes",
      payload: { goalPrompt: query },
    });
  }

  // ── 2. 周报建议：当用户查询个人活动、本周进展、周报或工单完成情况时 ──
  const isWorkReview =
    queryType === "user" ||
    queryType === "weekly_report" ||
    activeWorkflow === "weekly_report" ||
    /(?:周报|工作总结|本周工作|上周工作|写周报|交周报|提交周报|生成周报)/i.test(
      text,
    ) ||
    /(?:这周|本周|上周|最近).*(?:干了|做了|完成|工单|进展|情况|总结)/i.test(
      text,
    );

  if (
    isWorkReview &&
    !actions.some((a) => a.workflowHint === "weekly_report")
  ) {
    actions.push({
      id: "action_weekly_report",
      label: "⚡ 进入 Work 模式：周报生成",
      target: "work",
      workflowHint: "weekly_report",
      payload: { goalPrompt: query },
    });
  }

  // ── 3. 项目大盘建议：当查询项目、模块或团队总体进度时 ──
  const isProjectOverview =
    queryType === "project" ||
    activeWorkflow === "project_progress" ||
    /(?:项目|模块|大盘|概况|统计).*(?:进展|进度|如何|状态|汇总)/i.test(text);

  if (
    isProjectOverview &&
    !actions.some((a) => a.workflowHint === "project_progress")
  ) {
    actions.push({
      id: "action_project_progress",
      label: "📊 进入 Work 模式：项目进展大盘",
      target: "work",
      workflowHint: "project_progress",
      payload: { goalPrompt: query },
    });
  }

  // ── 4. 代码修复与开发建议：当讨论具体 Bug、工单开发或包含代码修改诉求时 ──
  const isBugOrCode =
    resolvedEntities?.ticket ||
    activeWorkflow === "coding" ||
    /(?:bug|缺陷|报错|异常|崩溃|修复|代码|实现|开发)/i.test(text);

  if (
    isBugOrCode &&
    !actions.some((a) => a.capability === "coding.execute") &&
    actions.length < 2
  ) {
    const ticketNo = resolvedEntities?.ticket?.ticketNo;
    actions.push({
      id: "action_coding_fix",
      label: ticketNo
        ? `💻 进入 Work 修复 #${ticketNo} 代码`
        : "💻 进入 Work 开展代码开发",
      target: "work",
      capability: "coding.execute",
      workflowHint: "coding",
      payload: ticketNo ? { ticketNo } : undefined,
    });
  }

  // ── 5. 深入归因追问建议：当结果包含延期或阻碍时，提供 Chat 深入交互 ──
  const hasDelaySignal =
    /(?:延期|超期|阻塞|卡点|风险|瓶颈)/i.test(text) ||
    JSON.stringify(toolResults || {}).includes("OVERDUE") ||
    answer.includes("延期") ||
    answer.includes("风险");

  if (hasDelaySignal && actions.length < 3) {
    actions.push({
      id: "action_analyze_delays",
      label: "🔍 深入分析延期阻碍原因",
      target: "chat",
      payload: { query: "深入分析当前相关工单与任务的延期原因与核心阻碍" },
    });
  }

  // ── 6. 对话内继续补充要点（对会议纪要场景的 Chat 交互选项） ──
  if (isMeetingIntent && actions.length < 3) {
    actions.push({
      id: "action_chat_meeting_draft",
      label: "📝 在对话中直接补充会议要点",
      target: "chat",
      payload: { query: "我来提供本次会议的核心要点与决议事项：" },
    });
  }

  return actions.slice(0, 3);
}
