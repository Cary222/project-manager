"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type ProjectOption = { id: string; name: string };

function toLocalMidnight(dateStr: string): Date {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, day!, 0, 0, 0, 0);
}

interface WeeklyReportFormProps {
  initialWeekStart?: string;
  initialWeekEnd?: string;
}

export function WeeklyReportForm({ initialWeekStart, initialWeekEnd }: WeeklyReportFormProps) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [weekStart, setWeekStart] = useState(initialWeekStart ?? "");
  const [weekEnd, setWeekEnd] = useState(initialWeekEnd ?? "");
  const [content, setContent] = useState("");
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: { projects?: ProjectOption[] }) => {
        setProjects(data.projects ?? []);
      })
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, []);

  function toggleProject(id: string) {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      const res = await fetch("/api/reports/weekly-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          weekStart: start.toISOString(),
          weekEnd: end.toISOString(),
          content: content.trim(),
          projectIds: Array.from(selectedProjectIds),
        }),
      });

      if (res.status === 201) {
        toast.success("周报已创建，AI 总结生成中…");
        router.refresh();
        router.push("/reports/weekly-reports");
      } else if (res.status === 409) {
        const data = await res.json();
        toast.error(data.error ?? "本周已存在周报");
      } else if (res.status === 401) {
        toast.error("请先登录");
        router.push("/login");
      } else {
        toast.error("创建周报失败，请重试");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
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
          className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
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
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
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
            className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
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
          className="w-full rounded-lg border border-ink-200 px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          style={{ minHeight: "200px", resize: "vertical" }}
        />
        <p className="mt-1.5 text-xs text-ink-400">
          支持多行文本，可粘贴代码块或任务列表。AI 将自动生成结构化总结。
        </p>
      </div>

      {/* 操作 */}
      <div className="flex items-center justify-end gap-3 border-t border-ink-100 pt-5">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-ink-200 px-4 py-2 text-sm text-ink-600 transition hover:bg-ink-50"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "提交中…" : "提交周报"}
        </button>
      </div>
    </form>
  );
}
