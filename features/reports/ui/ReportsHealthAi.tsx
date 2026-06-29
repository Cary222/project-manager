"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/shared/lib/use-toast";

type HealthSummary = {
  summary:     string;
  generatedAt: string;
  fromCache:   boolean;
};

export function ReportsHealthAi() {
  const [summary, setSummary] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const { toast } = useToast();

  const fetchSummary = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = forceRefresh ? "?refresh=1" : "";
      const res = await fetch(`/api/reports/health-summary${url}`, {
        credentials: "include",
      });
      if (res.status === 403 || res.status === 401) {
        setError("无权限查看健康度总结");
        toast.error("无权限查看健康度总结");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setSummary(json.data ?? null);
    } catch {
      setError("加载失败，请稍后重试");
      toast.error("加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount pattern
    void fetchSummary();
  }, [fetchSummary]);

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium flex items-center gap-2">
          <span>AI 健康度总结</span>
          {summary?.fromCache && (
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-400">缓存</span>
          )}
        </h2>
        <button
          onClick={() => fetchSummary(true)}
          disabled={loading}
          className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-600 transition-colors hover:bg-violet-200 disabled:opacity-50"
        >
          {loading ? "生成中…" : "重新生成"}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : loading && !summary ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-ink-100" />
          ))}
        </div>
      ) : summary ? (
        <div className="prose prose-sm max-w-none text-ink-600">
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(summary.summary) }} />
          {summary.generatedAt && (
            <p className="mt-3 text-xs text-ink-400">
              生成于 {new Date(summary.generatedAt).toLocaleString("zh-CN")}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/** Minimal markdown-to-HTML (bold + newline, no deps needed) */
function renderMarkdown(text: string): string {
  return text
    .replace(/## (.+)/g, "<h2 class='text-base font-semibold mt-3 mb-1'>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^> (.+)/gm, "<blockquote class='border-l-2 border-ink-200 pl-3 italic text-ink-400'>$1</blockquote>")
    .replace(/\n\n/g, "<br/>")
    .replace(/\n/g, " ");
}
