"use client";

import { useEffect, useState } from "react";
import { IconTag } from "@/shared/ui/icons";

export function KnowledgePublicTags() {
  const [tags, setTags] = useState<[string, number][]>([]);

  useEffect(() => {
    fetch("/api/knowledge/tags")
      .then((r) => (r.ok ? (r.json() as Promise<[string, number][]>) : []))
      .then(setTags)
      .catch(() => {});
  }, []);

  return (
    <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-ink-500">公开热门标签</h2>
        <span className="text-xs text-ink-400">团队共享笔记聚合</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <span className="text-xs text-ink-400">暂无公开标签，先公开第一篇笔记。</span>
        ) : (
          tags.map(([tag, count]) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-600"
            >
              <IconTag className="h-3 w-3 text-ink-400" />
              {tag}
              <span className="text-ink-400">{count}</span>
            </span>
          ))
        )}
      </div>
    </section>
  );
}
