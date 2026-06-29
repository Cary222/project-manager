import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AppShell } from "@/shared/ui/AppShell";
import Link from "next/link";
import { WeeklyReportRegenerateButton } from "@/features/reports/weekly-reports/ui/WeeklyReportRegenerateButton";
import { getWeeklyReport } from "@/features/weekly-reports/lib/weekly-report-store";

type Props = { params: Promise<{ id: string }> };

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

/**
 * 把 LLM 输出的 aiSummary 转成安全 HTML。
 *
 * 风险：Agnes LLM 是外部 API，理论上可被 prompt injection 污染输出。
 * 如果直接 `dangerouslySetInnerHTML` 原文，`<img onerror=alert('XSS')>`
 * 这种内容会被浏览器执行 → Stored XSS。
 *
 * 策略：先转义危险字符（& < > " ' /），再还原 markdown 标记（**bold** / *italic*）。
 * 这样 LLM 输出的 `<script>` 会被显示成文本，而不是被执行。
 */
function escapeAiSummary(aiSummary: string | null | undefined): string {
  if (!aiSummary) return "";
  return aiSummary
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}

/** AI 总结展示区块（始终展开，PR5 设计：用户期望直接看到结果） */
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

export default async function WeeklyReportDetailPage({ params }: Props) {
  const { id } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const report = await getWeeklyReport(id, session.user.id);

  if (!report) {
    notFound();
  }

  const attachments = Array.isArray(report.attachments)
    ? (report.attachments as Array<{ name?: string; url?: string }>)
    : [];

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">周报详情</h1>
          <p className="text-xs text-ink-400">Weekly Report · Detail</p>
        </div>
      }
    >
      <main className="mx-auto max-w-4xl px-6 py-10">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <Link
            href="/reports/weekly-reports"
            className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 shadow-sm transition hover:bg-ink-50 hover:border-ink-300"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            返回
          </Link>
          <WeeklyReportRegenerateButton reportId={id} />
        </div>

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
          <div className="mb-6">
            <h3 className="mb-3 text-sm font-semibold text-ink-700">附件</h3>
            <ul className="space-y-2">
              {attachments.map((att, i) => (
                <li key={i}>
                  <a
                    href={att.url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-brand-600 transition hover:text-brand-700 hover:underline"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                    {att.name ?? `附件 ${i + 1}`}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AI Summary */}
        <AiSummaryPanel
          aiSummary={report.aiSummary}
          aiSummaryPartial={report.aiSummaryPartial}
          aiSummaryAt={report.aiSummaryAt}
        />
      </main>
    </AppShell>
  );
}
