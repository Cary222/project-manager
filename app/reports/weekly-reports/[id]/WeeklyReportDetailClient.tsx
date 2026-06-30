"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WeeklyReportForm } from "@/features/reports/weekly-reports/ui/WeeklyReportForm";
import { WeeklyReportRegenerateButton } from "@/features/reports/weekly-reports/ui/WeeklyReportRegenerateButton";
import { escapeAiSummary } from "@/shared/lib/xss";
import type { WeeklyReportWithProjects } from "@/features/weekly-reports/lib/weekly-report-store";
import { AttachmentItem, type PreviewableFile } from "@/shared/ui/AttachmentItem";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";

type Props = { initialReport: WeeklyReportWithProjects; reportId: string };

type Mode = "view" | "edit";

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AiSummaryPanel({
  aiSummary,
  aiSummaryPartial,
  aiSummaryAt,
}: {
  aiSummary: string | null;
  aiSummaryPartial: boolean;
  aiSummaryAt: Date | string | null;
}) {
  if (aiSummary === null && !aiSummaryPartial) {
    return null;
  }

  const isGenerating = aiSummary === null && aiSummaryPartial;

  return (
    <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <svg
          className="h-4 w-4 text-brand-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
          />
        </svg>
        <span className="text-sm font-semibold text-brand-700">AI 总结</span>
        {aiSummaryAt && (
          <span className="text-xs text-ink-400">
            基于 {formatDateTime(aiSummaryAt)} 自动生成
          </span>
        )}
      </div>

      {isGenerating ? (
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-ink-200 animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-ink-200 animate-pulse" />
          <div className="h-3 w-4/6 rounded bg-ink-200 animate-pulse" />
        </div>
      ) : (
        <div
          className="prose prose-sm prose-ink max-w-none whitespace-pre-wrap text-sm leading-relaxed text-ink-700"
          dangerouslySetInnerHTML={{
            __html: escapeAiSummary(aiSummary),
          }}
        />
      )}
    </div>
  );
}

export function WeeklyReportDetailClient({ initialReport, reportId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [report, setReport] = useState(initialReport);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  useEffect(() => {
    if (mode === "view") {
      setReport(initialReport);
    }
  }, [mode, initialReport]);

  const attachments = Array.isArray(report.attachments)
    ? (report.attachments as Array<{ name?: string; url?: string; mimeType?: string; size?: number }>)
    : [];

  return (
    <>
      {previewFile && (
        <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      {/* Header — 右侧模式相关按钮，返回由 BackPageHeader 承担 */}
      <div className="mb-6 flex items-start justify-end gap-2">
        {mode === "view" ? (
          <>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
            >
              编辑
            </button>
            <WeeklyReportRegenerateButton reportId={reportId} />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setMode("view")}
            className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
          >
            取消编辑
          </button>
        )}
      </div>

      {mode === "view" ? (
        <>
          {/* Title */}
          <div className="mb-4">
            <h2 className="text-2xl font-semibold text-ink-900">{report.title}</h2>
          </div>

          {/* Metadata */}
          <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatDate(report.weekStart)} — {formatDate(report.weekEnd)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              提交于 {formatDateTime(report.createdAt)}
            </span>
            {report.updatedAt && (
              <span className="inline-flex items-center gap-1.5">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                更新于 {formatDateTime(report.updatedAt)}
              </span>
            )}
          </div>

          {/* Project chips */}
          {report.projects.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {report.projects.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
                >
                  {p.name}
                </span>
              ))}
            </div>
          )}

          {/* Divider */}
          <hr className="mb-6 border-ink-200" />

          {/* Content */}
          <div className="mb-6">
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
              {report.content}
            </pre>
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="mb-6 rounded-xl border border-ink-200 bg-ink-50/50 p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-700">附件</h3>
              <div className="space-y-2">
                {attachments.map((att, i) => (
                  <AttachmentItem
                    key={i}
                    attachment={{
                      name: att.name ?? `附件 ${i + 1}`,
                      url: att.url ?? "#",
                      mimeType: att.mimeType ?? "application/octet-stream",
                      size: att.size ?? 0,
                    }}
                    onPreview={setPreviewFile}
                  />
                ))}
              </div>
            </div>
          )}

          {/* AI Summary (PR5) */}
          <AiSummaryPanel
            aiSummary={report.aiSummary}
            aiSummaryPartial={report.aiSummaryPartial}
            aiSummaryAt={report.aiSummaryAt}
          />
        </>
      ) : (
        <>
          {/* Title */}
          <div className="mb-4">
            <h2 className="text-2xl font-semibold text-ink-900">编辑周报</h2>
          </div>

          <WeeklyReportForm
            mode="edit"
            initialReportId={report.id}
            initialReport={report}
            initialTitle={report.title}
            initialWeekStart={new Date(report.weekStart).toISOString().split("T")[0]}
            initialWeekEnd={new Date(report.weekEnd).toISOString().split("T")[0]}
            initialContent={report.content}
            initialProjectIds={report.projects.map((p) => p.id)}
            onSaved={() => {
              router.refresh();
              setMode("view");
            }}
          />
        </>
      )}
    </>
  );
}
