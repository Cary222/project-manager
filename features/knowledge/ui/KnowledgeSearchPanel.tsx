"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IconArrowRight, IconSearch } from "@/shared/ui/icons";
import { KnowledgeSearchResults } from "@/features/knowledge/ui/KnowledgeSearchResults";
import type { SearchResponse } from "@/shared/lib/search-types";

const EMPTY_RESULTS: SearchResponse = {
  mode: "search",
  query: "",
  tookMs: 0,
  total: 0,
  results: [],
  grouped: { ticket: [], commit: [], note: [] },
};

type KnowledgeSearchPanelProps = {
  initialQuery?: string;
  compact?: boolean;
};

export function KnowledgeSearchPanel({
  initialQuery = "",
  compact = false,
}: KnowledgeSearchPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [data, setData] = useState<SearchResponse>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUrlQueryRef = useRef(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
    lastUrlQueryRef.current = initialQuery;
  }, [initialQuery]);

  const runSearch = useCallback((q: string) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=10`, { signal: abortRef.current.signal })
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<SearchResponse>;
      })
      .then((next) => {
        if (next) setData(next);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      setData(EMPTY_RESULTS);
      setLoading(false);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runSearch(keyword), 400);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch]);

  const hint = `可输入问题描述、项目名、单号、提交主题、笔记标题或标签关键词。`;

  function updateUrl(next: string) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next.trim()) {
      params.set("q", next.trim());
    } else {
      params.delete("q");
    }
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    lastUrlQueryRef.current = next.trim();
    window.history.replaceState(null, "", newUrl);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setQuery(next);
    updateUrl(next);
  }

  const searching = query.trim().length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className={`relative w-full ${compact ? "max-w-md" : "max-w-2xl"}`}>
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={handleInputChange}
            placeholder={compact ? "全局搜索工单、提交、笔记…" : "搜索工单、提交记录、个人笔记、规范线索…"}
            className="w-full rounded-xl border border-ink-200 bg-white py-3 pl-10 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <p className="text-xs text-ink-400">{searching ? hint : "已支持工单、提交记录与个人笔记检索，后续可继续接入知识文档与项目规范。"}</p>
      </div>

      {compact && searching ? (
        <div className="rounded-xl border border-ink-200 bg-white p-2 shadow-elevated">
          <div className="max-h-[420px] space-y-2 overflow-y-auto p-2">
            {loading ? (
              <div className="space-y-2 px-2 py-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="rounded-lg border border-ink-100 p-3">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-ink-100" />
                    <div className="mt-2 h-3 w-full animate-pulse rounded bg-ink-100" />
                  </div>
                ))}
              </div>
            ) : data.results.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-ink-400">未找到相关结果</p>
            ) : (
              <>
                {data.results.slice(0, 5).map((item) => (
                  <Link
                    key={item.id}
                    href={item.url}
                    className="block rounded-lg border border-ink-100 px-3 py-3 transition hover:border-brand-200 hover:bg-brand-50/40"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-ink-900">{item.title}</p>
                      <IconArrowRight className="h-4 w-4 shrink-0 text-ink-300" />
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-400">
                      {item.project?.name || item.metadata.projectName || "未分组项目"}
                    </p>
                  </Link>
                ))}
                <Link
                  href={`/knowledge?q=${encodeURIComponent(query.trim())}`}
                  className="flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-brand-600 transition hover:bg-brand-50"
                >
                  查看全部结果
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}

      {!compact && searching ? <KnowledgeSearchResults data={{ ...data, query: query.trim() }} loading={loading} /> : null}
    </div>
  );
}
