"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconBook } from "@/shared/ui/icons";

export type SpaceItem = {
  id: string;
  name: string;
  noteCount: number;
  hotScore: number;
  combinedScore: number;
};

export function KnowledgeSpaces() {
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);

  useEffect(() => {
    fetch("/api/knowledge/spaces")
      .then((r) => (r.ok ? (r.json() as Promise<SpaceItem[]>) : []))
      .then(setSpaces)
      .catch(() => {});
  }, []);

  if (spaces.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-ink-500">知识空间</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {spaces.map((project, i) => {
          const colors = [
            "bg-brand-50 text-brand-600",
            "bg-emerald-50 text-emerald-600",
            "bg-amber-50 text-warning",
            "bg-violet-50 text-purple",
          ];
          return (
            <Link
              key={project.id}
              href={`/projects/${project.id}?tab=docs`}
              scroll={false}
              className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft transition hover:border-brand-200 hover:shadow-base"
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${colors[i % colors.length]}`}
              >
                <IconBook className="h-5 w-5" />
              </span>
              <p className="mt-3 font-medium">{project.name}</p>
              <p className="mt-1 text-xs text-ink-400">
                {project.noteCount} 篇文档
              </p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
