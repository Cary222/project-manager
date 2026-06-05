"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { IconPlus, IconSearch, IconTrash } from "@/components/icons";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-brand-50 text-brand-700",
  MAINTENANCE: "bg-amber-50 text-warning",
  ARCHIVED: "bg-ink-100 text-ink-500",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "进行中",
  MAINTENANCE: "维护中",
  ARCHIVED: "已归档",
};

export function ProjectsList() {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const data = (await res.json()) as { projects: Project[] };
    setProjects(data.projects);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects().finally(() => setLoading(false));
  }, [loadProjects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
    );
  }, [projects, query]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim()) return;
    setCreating(true);
    setMessage("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName.trim() }),
    });
    setCreating(false);
    if (!res.ok) {
      setMessage("创建失败");
      return;
    }
    setProjectName("");
    setShowForm(false);
    setMessage("项目已创建");
    await loadProjects();
  }

  async function deleteProject(project: Project) {
    if (
      !window.confirm(
        `确定删除项目「${project.name}」吗？项目下的单子也会一起删除。`
      )
    ) {
      return;
    }
    setMessage("");
    const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("删除项目失败");
      return;
    }
    setMessage("项目已删除");
    await loadProjects();
  }

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">项目</h1>
          <p className="text-xs text-ink-400">Projects · 管理和查看所有项目</p>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目名称、描述…"
              className="w-full rounded-lg border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          {isRoot ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
            >
              <IconPlus className="h-4 w-4" />
              新建项目
            </button>
          ) : null}
        </div>

        {message ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}

        {isRoot && showForm ? (
          <form
            onSubmit={createProject}
            className="flex gap-2 rounded-xl border border-ink-200 bg-white p-4 shadow-soft"
          >
            <input
              className="min-w-0 flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              placeholder="新项目名称"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              disabled={creating || !projectName.trim()}
              className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? "创建中…" : "创建"}
            </button>
          </form>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-soft">
          <div className="hidden grid-cols-12 gap-4 border-b border-ink-100 bg-ink-100/60 px-5 py-3 text-xs font-medium text-ink-500 md:grid">
            <div className="col-span-5">项目名称</div>
            <div className="col-span-3">描述</div>
            <div className="col-span-2">状态</div>
            <div className="col-span-2 text-right">操作</div>
          </div>
          {loading ? (
            <p className="px-5 py-12 text-center text-sm text-ink-400">加载中…</p>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-16 text-center text-sm text-ink-400">
              {query ? "没有匹配的项目" : "暂无项目"}
            </p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {filtered.map((p) => (
                <li
                  key={p.id}
                  className="grid grid-cols-1 gap-2 px-5 py-4 transition hover:bg-ink-100/40 md:grid-cols-12 md:items-center md:gap-4"
                >
                  <div className="col-span-5 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                      <IconSearch className="hidden" />
                      {p.name.charAt(0)}
                    </span>
                    <Link
                      href={`/projects/${p.id}`}
                      className="font-medium text-ink-900 hover:text-brand-700"
                    >
                      {p.name}
                    </Link>
                  </div>
                  <div className="col-span-3 truncate text-sm text-ink-500">
                    {p.description || "—"}
                  </div>
                  <div className="col-span-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        STATUS_STYLE[p.status] || "bg-ink-100 text-ink-500"
                      }`}
                    >
                      {STATUS_LABEL[p.status] || p.status}
                    </span>
                  </div>
                  <div className="col-span-2 flex items-center justify-start gap-3 md:justify-end">
                    <Link
                      href={`/projects/${p.id}`}
                      className="text-sm text-brand-600 hover:text-brand-700"
                    >
                      进入
                    </Link>
                    {isRoot ? (
                      <button
                        type="button"
                        onClick={() => deleteProject(p)}
                        className="text-ink-400 transition hover:text-danger"
                        aria-label="删除项目"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AppShell>
  );
}
