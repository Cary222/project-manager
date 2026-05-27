"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Project = {
  id: string;
  name: string;
  description: string | null;
  status: string;
};

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DONE";

type MyTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
  project: { id: string; name: string };
  module: {
    name: string;
    responsibility: { kind: "PROGRAM" | "DESIGN" };
  };
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DONE: "已完成",
};

const STATUS_ORDER: Record<TicketStatus, number> = {
  DEVELOPING: 0,
  READY_FOR_TEST: 1,
  DONE: 2,
};

function sortMyTickets(tickets: MyTicket[]) {
  return [...tickets].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.ticketNo - a.ticketNo;
  });
}

const KIND_LABEL: Record<"PROGRAM" | "DESIGN", string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
};

type Tab = "projects" | "my-tickets";

export function Dashboard() {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [myTickets, setMyTickets] = useState<MyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const data = (await res.json()) as { projects: Project[] };
    setProjects(data.projects);
  }, []);

  const loadMyTickets = useCallback(async () => {
    const res = await fetch("/api/tickets/mine");
    if (!res.ok) return;
    const data = (await res.json()) as { tickets: MyTicket[] };
    setMyTickets(data.tickets);
  }, []);

  useEffect(() => {
    Promise.all([loadProjects(), loadMyTickets()]).finally(() =>
      setLoading(false)
    );
  }, [loadProjects, loadMyTickets]);

  const ticketsByProject = useMemo(() => {
    const map = new Map<
      string,
      { project: MyTicket["project"]; tickets: MyTicket[] }
    >();
    for (const ticket of myTickets) {
      const key = ticket.project.id;
      const existing = map.get(key);
      if (existing) {
        existing.tickets.push(ticket);
      } else {
        map.set(key, { project: ticket.project, tickets: [ticket] });
      }
    }
    for (const group of map.values()) {
      group.tickets = sortMyTickets(group.tickets);
    }
    return [...map.values()];
  }, [myTickets]);

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
    setMessage("项目已创建");
    await loadProjects();
  }

  async function deleteProject(project: Project) {
    if (!window.confirm(`确定删除项目「${project.name}」吗？项目下的单子也会一起删除。`)) {
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
    await loadMyTickets();
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold">项目管理</h1>
        <div className="flex items-center gap-3 text-sm text-zinc-500">
          <span>
            {session?.user?.name} · {session?.user?.role}
          </span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-100"
          >
            退出
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-6">
        <div className="mb-6 grid grid-cols-2 rounded-lg bg-zinc-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => setTab("projects")}
            className={`rounded-md px-3 py-2 ${
              tab === "projects" ? "bg-white shadow-sm" : "text-zinc-500"
            }`}
          >
            项目
          </button>
          <button
            type="button"
            onClick={() => setTab("my-tickets")}
            className={`rounded-md px-3 py-2 ${
              tab === "my-tickets" ? "bg-white shadow-sm" : "text-zinc-500"
            }`}
          >
            我的单子
          </button>
        </div>

        {message ? (
          <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-zinc-500">加载中…</p>
        ) : tab === "projects" ? (
          <>
            {isRoot ? (
              <form onSubmit={createProject} className="mb-6 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                  placeholder="新项目名称"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={creating || !projectName.trim()}
                  className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  {creating ? "创建中…" : "新建项目"}
                </button>
              </form>
            ) : null}

            {projects.length === 0 ? (
              <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-zinc-500">
                暂无
              </p>
            ) : (
              <ul className="space-y-2">
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="rounded-xl border border-zinc-200 bg-white transition hover:border-zinc-300 hover:shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-4 px-4 py-3">
                      <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
                        <div>
                          <p className="font-medium">{project.name}</p>
                          {project.description ? (
                            <p className="mt-1 text-sm text-zinc-500">
                              {project.description}
                            </p>
                          ) : null}
                        </div>
                      </Link>
                      <div className="flex shrink-0 items-center gap-3">
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-sm text-zinc-400 hover:text-zinc-900"
                        >
                          进入
                        </Link>
                        {isRoot ? (
                          <button
                            type="button"
                            onClick={() => deleteProject(project)}
                            className="text-sm text-red-600 hover:text-red-700"
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : ticketsByProject.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-zinc-500">
            暂无指派给你的单子
          </p>
        ) : (
          <div className="space-y-5">
            {ticketsByProject.map(({ project, tickets }) => (
              <section
                key={project.id}
                className="rounded-xl border border-zinc-200 bg-white p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-medium">{project.name}</h2>
                  <Link
                    href={`/projects/${project.id}`}
                    className="text-sm text-zinc-400 hover:text-zinc-900"
                  >
                    进入项目
                  </Link>
                </div>
                <ul className="space-y-2">
                  {tickets.map((ticket) => {
                    const isDone = ticket.status === "DONE";
                    return (
                    <li key={ticket.id}>
                      <Link
                        href={`/${ticket.ticketNo}`}
                        className={`block rounded-lg border px-3 py-2 transition ${
                          isDone
                            ? "border-zinc-100 bg-zinc-50 text-zinc-400 hover:border-zinc-200 hover:bg-zinc-100"
                            : "border-zinc-100 hover:border-zinc-300 hover:bg-zinc-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">#{ticket.ticketNo}</span>
                          <span className={`text-sm ${isDone ? "text-zinc-400" : "text-zinc-500"}`}>
                            {STATUS_LABEL[ticket.status]}
                          </span>
                        </div>
                        <p className="mt-1 text-sm">{ticket.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {KIND_LABEL[ticket.module.responsibility.kind]} /{" "}
                          {ticket.module.name}
                        </p>
                      </Link>
                    </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
