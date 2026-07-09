"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { WeeklyDraftPanel } from "./WeeklyDraftPanel";
import type { WeeklyDraftSummary } from "@/features/reports/weekly-reports/lib/draft-summary";
import type { WeeklyReportWithProjects } from "@/features/weekly-reports/lib/weekly-report-store";
import { AttachmentEditor } from "@/shared/ui/AttachmentEditor";
import type { FileAttachment } from "@/shared/lib/pkm";

type ProjectOption = { id: string; name: string };

function toLocalMidnight(dateStr: string): Date {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, day!, 0, 0, 0, 0);
}

interface WeeklyReportFormProps {
  mode?: "create" | "edit";
  initialReportId?: string;
  initialTitle?: string;
  initialWeekStart?: string;
  initialWeekEnd?: string;
  initialContent?: string;
  initialProjectIds?: string[];
  initialReport?: WeeklyReportWithProjects | null;
  /** 编辑模式保存成功后调用（用于切换回 view 模式），create 模式忽略 */
  onSaved?: () => void;
}

export function WeeklyReportForm({
  mode: propMode,
  initialReportId,
  initialTitle,
  initialWeekStart,
  initialWeekEnd,
  initialContent,
  initialProjectIds,
  initialReport,
  onSaved,
}: WeeklyReportFormProps) {
  const router = useRouter();

  const mode = propMode ?? "create";

  const [title, setTitle] = useState(initialTitle ?? "");
  const [weekStart, setWeekStart] = useState(initialWeekStart ?? "");
  const [weekEnd, setWeekEnd] = useState(initialWeekEnd ?? "");
  const [content, setContent] = useState(initialContent ?? "");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    new Set(initialProjectIds ?? [])
  );
  const [attachments, setAttachments] = useState<FileAttachment[]>(
    () => (initialReport?.attachments as FileAttachment[] | null | undefined) ?? []
  );
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // AI draft state
  const [draftSummary, setDraftSummary] = useState<WeeklyDraftSummary | null>(null);
  const [draftComputedAt, setDraftComputedAt] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: { projects?: ProjectOption[] }) => {
        setProjects(data.projects ?? []);
      })
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, []);

  // Populate project IDs from initialReport
  useEffect(() => {
    if (initialReport?.projects?.length) {
      setSelectedProjectIds(new Set(initialReport.projects.map((p) => p.id)));
    }
  }, [initialReport]);

  function toggleProject(id: string) {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAIGenerate() {
    if (!weekStart || !weekEnd) {
      toast.error("请先选择周范围");
      return;
    }

    setDraftLoading(true);
    setDraftError(null);
    setDraftSummary(null);

    try {
      const res = await fetch("/api/reports/weekly-reports/draft-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: toLocalMidnight(weekStart).toISOString(),
          weekEnd: toLocalMidnight(weekEnd).toISOString(),
          formDraft: {
            title: title.trim() || undefined,
            content: content.trim() || undefined,
            projectIds: Array.from(selectedProjectIds),
          },
        }),
      });

      if (res.status === 429) {
        toast.error("请求过于频繁，请 30 秒后再试");
        setDraftError("限流：30s 内只能请求 1 次");
        return;
      }

      if (res.status === 401) {
        toast.error("请先登录");
        router.push("/login");
        return;
      }

      if (!res.ok) {
        const errMsg = `AI 总结失败 (HTTP ${res.status})`;
        toast.error(errMsg);
        setDraftError(errMsg);
        return;
      }

      const data = await res.json();
      const draftError = data._error ?? null;
      setDraftSummary(data.draft);
      setDraftComputedAt(data.computedAt);
      setDraftError(draftError);
      toast.success("AI 总结已生成，请查看右侧面板");
    } catch (err) {
      // 网络异常 (DNS / 超时 / 断网) — fetch 抛 TypeError
      const isNetworkError = err instanceof TypeError;
      const msg = isNetworkError
        ? "网络异常，请检查连接后重试"
        : err instanceof Error
        ? `AI 总结失败: ${err.message}`
        : "AI 总结失败：未知错误";
      toast.error(msg);
      setDraftError(msg);
    } finally {
      setDraftLoading(false);
    }
  }

  function handleDraftRegenerate() {
    handleAIGenerate();
  }

  function handleInsert(markdown: string, mode: "append" | "replace") {
    if (mode === "replace") {
      setContent(markdown);
    } else {
      setContent((prev) => (prev.trim() ? prev + "\n\n---\n\n" + markdown : markdown));
    }
    toast.success(mode === "replace" ? "已覆盖正文" : "已插入到正文");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      toast.error("请填写周报标题");
      return;
    }
    if (!weekStart || !weekEnd) {
      toast.error("请选择周范围");
      return;
    }
    if (!content.trim()) {
      toast.error("请填写周报内容");
      return;
    }

    setLoading(true);
    try {
      const start = toLocalMidnight(weekStart);
      const end = toLocalMidnight(weekEnd);

      if (mode === "edit" && initialReportId) {
        // PATCH existing report
        const res = await fetch(`/api/reports/weekly-reports/${initialReportId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            content: content.trim(),
            weekStart: weekStart ? toLocalMidnight(weekStart).toISOString() : undefined,
            weekEnd: weekEnd ? toLocalMidnight(weekEnd).toISOString() : undefined,
            projectIds: Array.from(selectedProjectIds),
            attachments,
          }),
        });

        if (res.status === 401) {
          toast.error("请先登录");
          router.push("/login");
          return;
        }
        if (res.status === 404) {
          toast.error("周报不存在");
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        toast.success("周报已更新");
        if (onSaved) {
          onSaved();
        } else {
          router.push(`/reports/weekly-reports/${initialReportId}`);
        }
      } else {
        // POST new report
        const res = await fetch("/api/reports/weekly-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            weekStart: start.toISOString(),
            weekEnd: end.toISOString(),
            content: content.trim(),
            projectIds: Array.from(selectedProjectIds),
            attachments,
          }),
        });

        if (res.status === 409) {
          const data = await res.json();
          toast.error(data.error ?? "本周已存在周报");
          return;
        }
        if (res.status === 401) {
          toast.error("请先登录");
          router.push("/login");
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        toast.success("周报已创建，AI 总结生成中…");
        router.push("/reports/weekly-reports");
      }
    } catch {
      toast.error(mode === "edit" ? "更新周报失败，请重试" : "创建周报失败，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Main Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 标题 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            周报标题 <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：2025年第25周工作总结"
            maxLength={200}
            required
            className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
        </div>

        {/* 周范围 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              周开始 <span className="text-danger">*</span>
            </label>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              required
              className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-700">
              周结束 <span className="text-danger">*</span>
            </label>
            <input
              type="date"
              value={weekEnd}
              onChange={(e) => setWeekEnd(e.target.value)}
              required
              className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
        </div>

        {/* 项目关联 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            关联项目 <span className="text-xs font-normal text-ink-400">（可选）</span>
          </label>
          {projectsLoading ? (
            <p className="text-sm text-ink-400">加载项目中…</p>
          ) : projects.length === 0 ? (
            <p className="text-sm text-ink-400">暂无可关联项目</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {projects.map((p) => {
                const selected = selectedProjectIds.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProject(p.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                      selected
                        ? "border-brand-400 bg-brand-50 text-brand-700"
                        : "border-ink-200 bg-white text-ink-600 hover:border-brand-200 hover:bg-brand-50"
                    }`}
                  >
                    {selected && (
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 内容 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            周报内容 <span className="text-danger">*</span>
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="请详细描述本周的工作内容、成果、遇到的问题及下周计划…"
            rows={10}
            required
            className="w-full rounded-md border border-ink-300 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            style={{ minHeight: "200px", resize: "vertical" }}
          />
          <p className="mt-1.5 text-xs text-ink-400">
            支持多行文本，可粘贴代码块或任务列表。AI 将自动生成结构化总结。
          </p>
        </div>

        {/* 附件 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            附件
            <span className="ml-1.5 text-xs font-normal text-ink-400">（可选，最多 8 个，单个不超过 10 MB）</span>
          </label>
          <AttachmentEditor
            attachments={attachments}
            onChange={setAttachments}
            onError={(msg) => toast.error(msg)}
          />
        </div>

        {/* 操作 */}
        <div className="flex items-center justify-between gap-3 border-t border-ink-100 pt-5">
          <button
            type="button"
            onClick={() => router.back()}
              className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"
          >
            取消
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAIGenerate}
              disabled={draftLoading || !weekStart || !weekEnd}
              className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {draftLoading ? (
                <>
                  <svg className="mr-1.5 inline-block h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  AI 总结生成中…
                </>
              ) : (
                <>
                  <svg className="mr-1.5 inline-block h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  AI 总结
                </>
              )}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none disabled:opacity-50"
            >
              {loading ? "提交中…" : mode === "edit" ? "保存更新" : "提交周报"}
            </button>
          </div>
        </div>
      </form>

      {/* AI Draft Panel — right side (lg+) or below (mobile) */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <WeeklyDraftPanel
          draft={draftSummary}
          computedAt={draftComputedAt}
          onInsert={handleInsert}
          onRegenerate={handleDraftRegenerate}
          isRegenerating={draftLoading}
          error={draftError}
        />
      </div>
    </div>
  );
}
