/**
 * Meeting query for search-structured.
 */

import { prisma } from "@/shared/db/client";
import type {
  StructuredResult,
  SourceReference,
} from "@/features/ai/types/structured";
import {
  getWindowStart,
  formatWindowLabel,
  truncateForSummary,
} from "@/features/ai/core/formatters";

export interface MeetingQueryInput {
  id?: string;
  filters?: {
    projectId?: string;
    activityWindow?:
      | "today"
      | "yesterday"
      | "this_week"
      | "this_month"
      | "recent";
    keyword?: string;
  };
  limit?: number;
}

export async function queryMeeting(
  input: MeetingQueryInput,
  _viewerUserId?: string,
): Promise<StructuredResult> {
  const { id, filters, limit = 5 } = input;

  if (id) {
    const meeting = await prisma.projectMeeting.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true, email: true } },
      },
    });

    if (meeting) {
      const summaryText =
        meeting.publishedSummary ||
        (typeof meeting.aiSummary === "object" && meeting.aiSummary !== null
          ? ((meeting.aiSummary as { summary?: string }).summary ?? "")
          : "");
      const dateStr = meeting.meetingDate
        ? new Date(meeting.meetingDate).toLocaleDateString("zh-CN")
        : "未知日期";
      const lines = [
        `会议：${meeting.title}`,
        `日期：${dateStr}`,
        `项目：${meeting.project?.name ?? "未关联项目"}`,
        `组织者：${meeting.creator?.name || meeting.creator?.email || "未知"}`,
        `状态：${meeting.status}`,
        summaryText ? `\n纪要摘要：\n${summaryText}` : "",
        `链接：/projects/${meeting.projectId}?tab=meetings`,
      ].filter(Boolean);

      return {
        summary: lines.join("\n"),
        sources: [
          {
            index: 1,
            title: meeting.title,
            url: `/projects/${meeting.projectId}?tab=meetings`,
            type: "meeting",
          },
        ],
      };
    }
    return { summary: `未找到指定会议纪要（ID: ${id}）`, sources: [] };
  }

  // Query recent published meetings
  const windowStart = getWindowStart(filters?.activityWindow);
  const meetings = await prisma.projectMeeting.findMany({
    where: {
      status: "PUBLISHED",
      ...(filters?.projectId ? { projectId: filters.projectId } : {}),
      ...(windowStart ? { meetingDate: { gte: windowStart } } : {}),
    },
    orderBy: { meetingDate: "desc" },
    take: limit,
    include: {
      project: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true, email: true } },
    },
  });

  if (meetings.length === 0) {
    const windowLabel = formatWindowLabel(filters?.activityWindow);
    return {
      summary: `未找到${windowLabel ? `「${windowLabel}」内` : "近期"}已发布的会议纪要。系统当前暂无相关会议记录。`,
      sources: [],
    };
  }

  const windowLabel = formatWindowLabel(filters?.activityWindow);
  const lines: string[] = [`近期会议纪要（共 ${meetings.length} 篇已发布）：`];

  const sources: SourceReference[] = meetings.map((m, i) => {
    const dateStr = m.meetingDate
      ? new Date(m.meetingDate).toLocaleDateString("zh-CN")
      : "";
    let brief = "";
    if (m.aiSummary && typeof m.aiSummary === "object") {
      const s = m.aiSummary as { summary?: string; decisions?: string[] };
      if (s.summary) brief = truncateForSummary(s.summary, 120);
      else if (Array.isArray(s.decisions) && s.decisions.length > 0)
        brief = s.decisions.slice(0, 2).join("；");
    } else if (m.publishedSummary) {
      brief = truncateForSummary(
        m.publishedSummary.replace(/^#+.*$/gm, "").trim(),
        120,
      );
    }

    lines.push(
      `\n${i + 1}. 【${m.title}】（${dateStr}）· 项目：${m.project?.name ?? "未关联"}`,
    );
    if (brief) {
      lines.push(`   摘要：${brief}`);
    }
    lines.push(`   查看：/projects/${m.projectId}?tab=meetings`);

    return {
      index: i + 1,
      title: m.title,
      url: `/projects/${m.projectId}?tab=meetings`,
      type: "meeting",
    };
  });

  return {
    summary: lines.join("\n"),
    sources,
  };
}
