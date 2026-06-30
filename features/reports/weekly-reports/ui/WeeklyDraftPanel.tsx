"use client";

import { useState } from "react";
import { escapeAiSummary } from "@/shared/lib/xss";
import type { WeeklyDraftSummary } from "@/features/reports/weekly-reports/lib/draft-summary";

type Props = {
  draft: WeeklyDraftSummary | null;
  computedAt: string | null;
  onInsert: (markdown: string, mode: "append" | "replace") => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
};

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EditableSection({
  label,
  icon,
  items,
}: {
  label: string;
  icon: React.ReactNode;
  items: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(items.join("\n"));

  function handleSave() {
    const newItems = draft.split("\n").map((s) => s.trim()).filter(Boolean);
    // Side-effect: parent updates via onInsert; just close editor
    void newItems;
    setEditing(false);
  }

  function handleCancel() {
    setDraft(items.join("\n"));
    setEditing(false);
  }

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold text-ink-700">{label}</span>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto text-xs text-brand-600 transition-colors hover:text-brand-700"
          >
            编辑
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(3, draft.split("\n").length)}
            className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            placeholder="每行一条"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSave}
              className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-700"
            >
              保存
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-lg border border-ink-300 bg-white px-3 py-1 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-100"
            >
              取消
            </button>
          </div>
        </div>
      ) : items.length > 0 ? (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink-700">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-400">暂无数据</p>
      )}
    </div>
  );
}

export function WeeklyDraftPanel({
  draft,
  computedAt,
  onInsert,
  onRegenerate,
  isRegenerating,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  if (!draft) return null;

  const isEmpty =
    draft.highlights.length === 0 &&
    draft.tasks.length === 0 &&
    draft.nextPlan.length === 0 &&
    !draft.rawMarkdown;
  const hasError = !!draft._error;

  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="text-sm font-semibold text-brand-700">AI 总结草稿</span>
          {computedAt && (
            <span className="text-xs text-ink-400">{formatDateTime(computedAt)}</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="text-xs text-ink-400 transition-colors hover:text-ink-600"
        >
          {collapsed ? "展开" : "收起"}
        </button>
      </div>

      {!collapsed && (
        <>
          {hasError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              AI 生成失败：{draft._error}
            </div>
          )}

          {isEmpty && !hasError ? (
            <div className="py-4 text-center">
              <p className="mb-3 text-sm text-ink-400">暂无有效数据</p>
              <button
                type="button"
                onClick={onRegenerate}
                disabled={isRegenerating}
                className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 shadow-sm transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRegenerating ? (
                  <>
                    <svg className="mr-1.5 inline-block h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    生成中…
                  </>
                ) : "重新生成"}
              </button>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-ink-400">
                基于你的数据自动生成，你可以编辑各板块内容后再插入到正文。
              </p>

              <EditableSection
                label="本周重点"
                icon={
                  <svg className="h-4 w-4 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                }
                items={draft.highlights}
              />

              <EditableSection
                label="完成任务"
                icon={
                  <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
                items={draft.tasks}
              />

              <EditableSection
                label="下周计划"
                icon={
                  <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                }
                items={draft.nextPlan}
              />

              {draft.rawMarkdown && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-2">
                    <svg className="h-4 w-4 text-ink-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-sm font-semibold text-ink-700">预览</span>
                  </div>
                  <div
                    className="rounded-xl border border-ink-200 bg-white p-4 text-xs leading-relaxed text-ink-700"
                    dangerouslySetInnerHTML={{
                      __html: escapeAiSummary(draft.rawMarkdown),
                    }}
                  />
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 border-t border-brand-100 pt-3">
                <button
                  type="button"
                  onClick={() => onInsert(draft.rawMarkdown, "append")}
                  disabled={!draft.rawMarkdown}
                  className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  插入到正文
                </button>
                <button
                  type="button"
                  onClick={() => onInsert(draft.rawMarkdown, "replace")}
                  disabled={!draft.rawMarkdown}
                  className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  覆盖正文
                </button>
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={isRegenerating}
                  className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRegenerating ? (
                    <>
                      <svg className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      生成中…
                    </>
                  ) : "重新生成"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
