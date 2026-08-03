/**
 * Weekly report query for search-structured.
 */

import { prisma } from "@/shared/db/client";
import type { StructuredResult, SourceReference, ExtractedUser } from "@/features/ai/types/structured";
import { DISAMBIGUATION_THRESHOLDS } from "@/features/ai/types/structured";
import { resolveUser } from "@/features/ai/core/resolvers/user-resolver";
import { getWindowStart, formatWindowLabel, formatReportDate, formatReportPeriod, truncateForSummary } from "@/features/ai/core/formatters";

export interface WeeklyReportQueryInput {
  id?: string;
  filters?: {
    userId?: string;
    activityWindow?: "today" | "yesterday" | "this_week" | "this_month" | "recent";
    extractedUser?: ExtractedUser;
  };
  limit?: number;
}

/**
 * Execute a weekly report query.
 * Supports filtering by user, specific report ID, or time window.
 */
export async function queryWeeklyReport(
  input: WeeklyReportQueryInput,
  viewerUserId?: string
): Promise<StructuredResult> {
  const { id, filters } = input;

  // 优先使用 extractedUser（包含 raw + normalized），其次使用 userId
  const extractedUser = filters?.extractedUser;
  const targetId = filters?.userId ?? id;

  // 构建 resolveUser 需要的 identifier
  const identifier = extractedUser ?? (targetId ? { raw: targetId, normalized: targetId } : undefined);
  let resolved = identifier ? await resolveUser(identifier, viewerUserId) : null;

  // 如果 extractUserIdentifier 没解析出名字（如 "最近周报提交怎么样" 被误识别成 "提交怎么样"），
  // 或者 confidence=0，回退到 viewer（用户自己）。
  const hasNoResolvedUser = !resolved?.user;
  const hasZeroConfidence = resolved?.confidence === 0;
  if (hasNoResolvedUser || hasZeroConfidence) {
    if (viewerUserId) {
      console.log(
        `[queryWeeklyReport] falling back to viewer ${viewerUserId} (was: extractedUser=${extractedUser?.raw ?? "none"} confidence=${resolved?.confidence ?? "n/a"})`
      );
      resolved = await resolveUser({ raw: viewerUserId, normalized: viewerUserId }, viewerUserId);
    }
  }

  console.log(`[queryWeeklyReport] extractedUser=${extractedUser ? JSON.stringify(extractedUser) : "none"} resolved=${JSON.stringify(resolved)}`);

  if (resolved?.user) {
    // Build time window filter from activityWindow
    const windowStart = getWindowStart(filters?.activityWindow);
    const reports = await prisma.weeklyReport.findMany({
      where: {
        userId: resolved.user.id,
        ...(windowStart ? { weekStart: { gte: windowStart } } : {}),
      },
      orderBy: { weekStart: "desc" },
      take: 5,
      include: {
        projects: { include: { project: { select: { name: true } } } },
      },
    });

    if (reports.length === 0) {
      const windowLabel = formatWindowLabel(filters?.activityWindow);
      const prefix = windowLabel ? `在「${windowLabel}」内 ` : "";
      return {
        summary: `${prefix}${resolved.user.name} 暂无周报记录`,
        sources: [],
        attribution: {
          kind: "user_activity",
          targetUserName: resolved.user.name,
          windowLabel: windowLabel ?? "最近",
          hasDirectEvidence: false,
          directEvidenceCount: 0,
          directNoteCount: 0,
          directTicketActionCount: 0,
          directCommentCount: 0,
          relatedTicketCount: 0,
          relatedCommitCount: 0,
          relatedReportCount: 0,
          matchType: resolved.matchType,
        }
      };
    }

    const windowLabel = formatWindowLabel(filters?.activityWindow);
    const lines = [`${resolved.user.name}${windowLabel ? ` ${windowLabel}内 ` : " "}的周报（最近 ${reports.length} 份）：`];
    const sources: SourceReference[] = reports.map((r, i) => {
      const projectNames = r.projects.map((p) => p.project.name).join("、") || "无项目";
      const baseLine = `- ${r.title}｜${formatReportPeriod(r.weekStart, r.weekEnd)}｜${projectNames} → /reports/weekly-reports/${r.id}`;
      const summarySnippet = r.aiSummary
        ? `\n  AI 摘要：${truncateForSummary(r.aiSummary, 400)}`
        : "";
      lines.push(`${baseLine}${summarySnippet}`);
      return {
        index: i + 1,
        title: r.title,
        url: `/reports/weekly-reports/${r.id}`,
        type: "weekly_report" as const
      };
    });

    // 多份周报时触发 HIL
    if (reports.length >= DISAMBIGUATION_THRESHOLDS.weekly_report) {
      const weeklyCandidates = reports.map((r) => ({
        id: r.id,
        label: `${r.title}｜${formatReportPeriod(r.weekStart, r.weekEnd)}`,
        summary: r.aiSummary ? truncateForSummary(r.aiSummary, 100) : "",
      }));
      return {
        summary: `找到 ${resolved.user.name} 的 ${reports.length} 份周报，请选择想要了解的具体周报：`,
        sources,
        attribution: {
          kind: "disambiguation" as const,
          entityType: "weekly_report" as const,
          candidates: weeklyCandidates,
          count: reports.length,
        },
        decision: {
          type: "human" as const,
          reason: `找到 ${reports.length} 份周报，需要人工选择`,
          entityType: "weekly_report",
          candidates: weeklyCandidates,
        },
      };
    }

    return {
      summary: lines.join("\n"),
      sources,
      attribution: {
        kind: "user_activity",
        targetUserName: resolved.user.name,
        windowLabel: windowLabel ?? "最近",
        hasDirectEvidence: false,
        directEvidenceCount: 0,
        directNoteCount: 0,
        directTicketActionCount: 0,
        directCommentCount: 0,
        relatedTicketCount: 0,
        relatedCommitCount: 0,
        relatedReportCount: 0,
        matchType: resolved.matchType,
      }
    };
  }

  // Handle ambiguous user candidates (multiple matches)
  if (resolved?.candidates && resolved.candidates.length > 0) {
    const queryText = extractedUser?.raw ?? targetId ?? "(未指定)";
    const userCandidates = resolved.candidates.map((u) => ({
      id: u.id,
      label: `${u.name ?? u.id}（${u.email}）`,
      summary: "",
    }));
    return {
      summary: `找到多个与"${queryText}"相关的用户，请确认目标用户：\n${
        resolved.candidates.map((u, i) => `${i + 1}. ${u.name}（${u.email}）`).join("\n")
      }\n\n请输入数字或姓名确认。`,
      sources: [],
      attribution: {
        kind: "disambiguation" as const,
        entityType: "user" as const,
        candidates: userCandidates,
        count: resolved.candidates.length,
      },
      decision: {
        type: "human" as const,
        reason: `找到 ${resolved.candidates.length} 个匹配用户，需要人工确认`,
        entityType: "user",
        candidates: userCandidates,
      },
    };
  }

  // Try by report ID
  if (id) {
    const report = await prisma.weeklyReport.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
        projects: { include: { project: { select: { name: true } } } },
      },
    });

    if (report) {
      const projectNames = report.projects.map((p) => p.project.name).join("、") || "无项目";
      const summary = report.aiSummary ? `\nAI 摘要：${report.aiSummary}` : "";
      return {
        summary: `${report.title}
用户：${report.user.name}（${report.user.email}）
周期：${formatReportPeriod(report.weekStart, report.weekEnd)}
项目：${projectNames}${summary}
链接：/reports/weekly-reports/${report.id}`,
        sources: [{
          index: 1,
          title: report.title,
          url: `/reports/weekly-reports/${report.id}`,
          type: "weekly_report" as const
        }]
      };
    }
  }

  return { summary: `未找到周报：${id ?? "(未指定)"}`, sources: [] };
}
