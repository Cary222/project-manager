"use client";

import { useState, useEffect, useCallback } from "react";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
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
    <section className="flex h-full flex-col rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
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
        <div className="flex flex-1 flex-col justify-center space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-ink-100" />
          ))}
        </div>
      ) : summary ? (
        <div className="flex-1 overflow-y-auto">
          <MarkdownContent content={summary.summary} />
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
