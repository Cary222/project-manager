"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MarkdownContent } from "@/components/MarkdownContent";
import { CommitDiffModal, type CommitSummary } from "@/components/CommitDiffModal";
import { AssigneePicker } from "@/components/AssigneePicker";
import { formatAssigneeList } from "@/lib/ticket-assignees";
import { branchStyle, repoStyle } from "@/lib/repo-style";
import { IconArrowLeft, IconClock, IconEdit } from "@/components/icons";

type UserBrief = {
  id: string;
  name: string | null;
  email: string;
  role: "ROOT" | "USER";
};

type Module = {
  id: string;
  name: string;
};

type Responsibility = {
  id: string;
  kind: "PROGRAM" | "DESIGN";
  modules: Module[];
};

type Ticket = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  progress: number;
  status: TicketStatus;
  project: { id: string; name: string; responsibilities: Responsibility[] };
  assignees: UserBrief[];
  module: {
    id: string;
    name: string;
    responsibility: { kind: "PROGRAM" | "DESIGN" };
  };
  commits: {
    id: string;
    commitSha: string;
    author: string;
    committedAt: string;
    subject: string;
    repoPath: string;
    branches: string[];
  }[];
  assigneeHistory: {
    id: string;
    createdAt: string;
    assignees: UserBrief[];
    changedBy: UserBrief;
  }[];
  statusHistory: {
    id: string;
    status: TicketStatus;
    createdAt: string;
    changedBy: UserBrief;
  }[];
};

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DELIVERED" | "DONE";

const KIND_LABEL: Record<"PROGRAM" | "DESIGN", string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DELIVERED: "已交付",
  DONE: "已完成",
};

const STATUS_STYLE: Record<TicketStatus, string> = {
  DEVELOPING: "bg-brand-50 text-brand-700",
  READY_FOR_TEST: "bg-amber-50 text-warning",
  DELIVERED: "bg-violet-50 text-purple",
  DONE: "bg-emerald-50 text-emerald-600",
};

function userLabel(user: UserBrief | null) {
  if (!user) return "未指派";
  return `${user.name || user.email}（${user.role}）`;
}

function Avatar({ name }: { name?: string | null }) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
      {initial}
    </span>
  );
}

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TicketStatus>("DEVELOPING");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<CommitSummary | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [modules, setModules] = useState<{ id: string; name: string }[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState("");

  const loadTicket = useCallback(async () => {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) {
      setTicket(null);
      return;
    }
    const data = (await res.json()) as { ticket: Ticket };
    setTicket(data.ticket);
    setStatus(data.ticket.status);
    setAssigneeIds(data.ticket.assignees.map((user) => user.id));
    setEditTitle(data.ticket.title);
    setEditDescription(data.ticket.description || "");
    setSelectedModuleId(data.ticket.module.id);
  }, [ticketId]);

  const isAssignee =
    ticket?.assignees.some((a) => a.id === session?.user?.id) ?? false;
  const canEdit = isRoot || isAssignee;

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      await fetch("/api/sync-commits", { method: "POST" });
      if (cancelled) return;
      await loadTicket();
      if (!cancelled) setLoading(false);
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [ticketId, loadTicket]);

  useEffect(() => {
    if (!isRoot) return;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data: { users: UserBrief[] }) => setUsers(data.users));
  }, [isRoot]);

  const allModules = ticket?.project.responsibilities.flatMap((r) => r.modules) ?? [];

  useEffect(() => {
    if (!ticket || !isRoot) return;
    const respKind = ticket.module.responsibility.kind;
    const respModules = allModules.filter((m) => {
      const resp = ticket.project.responsibilities.find((r) => r.kind === respKind);
      return resp?.modules.some((rm) => rm.id === m.id);
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModules(allModules.length > 0 ? allModules : respModules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.project, isRoot]);

  async function saveTicketDetails() {
    setMessage("");
    if (!ticket) return;
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, description: editDescription }),
    });
    if (!res.ok) {
      setMessage("保存失败");
      return;
    }
    setMessage("详情已保存");
    setIsEditing(false);
    await loadTicket();
  }

  async function updateModule() {
    setMessage("");
    if (!ticket || !selectedModuleId) return;
    const targetModule = modules.find((m) => m.id === selectedModuleId);
    if (!targetModule) return;
    if (targetModule.id === ticket.module.id) return;
    const res = await fetch(`/api/tickets/${ticket.id}/module`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId: targetModule.id }),
    });
    if (!res.ok) {
      setMessage("移动模块失败");
      return;
    }
    setMessage("模块已移动");
    await loadTicket();
  }

  async function updateStatus() {
    setMessage("");
    if (!ticket) return;

    try {
      const res = await fetch(`/api/tickets/${ticket.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setMessage(data?.error ? `状态保存失败：${data.error}` : "状态保存失败");
        return;
      }

      setMessage("状态已保存");
      await loadTicket();
    } catch (error) {
      setMessage(error instanceof Error ? `状态保存失败：${error.message}` : "状态保存失败");
    }
  }

  async function updateAssignee() {
    setMessage("");
    if (!ticket) return;
    const res = await fetch(`/api/tickets/${ticket.id}/assignee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeIds }),
    });
    if (!res.ok) {
      setMessage("指派人保存失败");
      return;
    }
    setMessage("指派人已更新");
    await loadTicket();
  }

  if (loading) {
    return (
      <AppShell>
        <p className="py-12 text-center text-sm text-ink-400">加载中…</p>
      </AppShell>
    );
  }

  if (!ticket) {
    return (
      <AppShell>
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
        >
          <IconArrowLeft className="h-4 w-4" /> 返回任务列表
        </Link>
        <p className="mt-6 rounded-xl border border-dashed border-ink-200 bg-white p-12 text-center text-ink-400">
          单子不存在
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      header={
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${ticket.project.id}`}
            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="返回项目"
          >
            <IconArrowLeft />
          </Link>
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              #{ticket.ticketNo}
            </h1>
            <p className="text-xs text-ink-400">
              {ticket.project.name} · {KIND_LABEL[ticket.module.responsibility.kind]} /{" "}
              {ticket.module.name}
            </p>
          </div>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        {message ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-3">
          {/* 主区 */}
          <div className="space-y-5 lg:col-span-2">
            <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <span
                    className={`mb-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[ticket.status]}`}
                  >
                    {STATUS_LABEL[ticket.status]}
                  </span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-xl font-semibold outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    />
                  ) : (
                    <h2 className="text-xl font-semibold">{ticket.title}</h2>
                  )}
                </div>
                {canEdit && !isEditing && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
                  >
                    <IconEdit className="h-4 w-4" /> 编辑
                  </button>
                )}
              </div>

              <div className="mt-4">
                {isEditing ? (
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={6}
                    className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    placeholder="添加描述（Markdown）..."
                  />
                ) : ticket.description ? (
                  <MarkdownContent content={ticket.description} />
                ) : (
                  <p className="text-sm text-ink-400">暂无描述</p>
                )}
              </div>

              {canEdit && isEditing && (
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={saveTicketDetails}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setEditTitle(ticket.title);
                      setEditDescription(ticket.description || "");
                    }}
                    className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
                  >
                    取消
                  </button>
                </div>
              )}
            </section>

            {/* 历史提交 */}
            <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-medium">历史提交</h2>
                <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-500">
                  {ticket.commits.length}
                </span>
              </div>
              {ticket.commits.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
                  暂无关联提交
                </p>
              ) : (
                <div className="space-y-2">
                  {ticket.commits.map((commit) => {
                    const repo = repoStyle(commit.repoPath);
                    return (
                      <button
                        key={commit.id}
                        type="button"
                        onClick={() => setSelectedCommit(commit)}
                        className={`w-full rounded-lg border border-ink-100 border-l-4 ${repo.border} p-3 text-left text-sm transition hover:border-ink-300 ${repo.card}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${repo.badge}`}
                            >
                              {repo.name}
                            </span>
                            <span className="font-mono text-xs text-ink-500">
                              {commit.commitSha.slice(0, 7)}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs text-ink-400">
                            {new Date(commit.committedAt).toLocaleString()}
                          </span>
                        </div>
                        {commit.branches.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {commit.branches.map((branch) => (
                              <span
                                key={branch}
                                className={`rounded px-2 py-0.5 text-xs ${branchStyle(branch)}`}
                              >
                                {branch}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <p className="mt-2 text-ink-700">{commit.subject}</p>
                        <p className="mt-1 text-xs text-ink-400">{commit.author}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* 右侧栏 */}
          <div className="space-y-5">
            {/* 状态 */}
            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <h2 className="mb-3 font-medium">状态</h2>
              <div className="mb-3 flex items-center gap-2">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TicketStatus)}
                  className="flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                >
                  {(isRoot
                    ? Object.entries(STATUS_LABEL)
                    : Object.entries(STATUS_LABEL).filter(([value]) => value !== "DONE")
                  ).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={updateStatus}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  保存
                </button>
              </div>
              <div className="space-y-2">
                {ticket.statusHistory.length === 0 ? (
                  <p className="text-xs text-ink-400">暂无状态变更记录</p>
                ) : (
                  ticket.statusHistory.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2 text-xs text-ink-500"
                    >
                      <IconClock className="mt-0.5 h-3.5 w-3.5 text-ink-300" />
                      <div>
                        <p>
                          <span className="font-medium text-ink-700">
                            {STATUS_LABEL[item.status]}
                          </span>{" "}
                          · {userLabel(item.changedBy)}
                        </p>
                        <p className="text-ink-400">
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* 指派 */}
            <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <h2 className="mb-3 font-medium">参与人员</h2>
              <div className="mb-3 flex flex-wrap gap-2">
                {ticket.assignees.length === 0 ? (
                  <span className="text-sm text-ink-400">未指派</span>
                ) : (
                  ticket.assignees.map((u) => (
                    <span
                      key={u.id}
                      className="flex items-center gap-1.5 rounded-full bg-ink-100 py-1 pl-1 pr-2.5 text-xs"
                    >
                      <Avatar name={u.name} />
                      {u.name || u.email}
                    </span>
                  ))
                )}
              </div>
              {isRoot ? (
                <div className="space-y-3">
                  <AssigneePicker
                    users={users}
                    value={assigneeIds}
                    onChange={setAssigneeIds}
                  />
                  <button
                    type="button"
                    onClick={updateAssignee}
                    className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    保存指派
                  </button>
                </div>
              ) : null}

              {ticket.assigneeHistory.length > 0 ? (
                <div className="mt-4 border-t border-ink-100 pt-3">
                  <h3 className="mb-2 text-xs font-medium text-ink-500">指派历史</h3>
                  <div className="space-y-2">
                    {ticket.assigneeHistory.slice(0, 4).map((item) => (
                      <div key={item.id} className="text-xs text-ink-500">
                        <p className="text-ink-700">
                          {formatAssigneeList(item.assignees)}
                        </p>
                        <p className="text-ink-400">
                          {userLabel(item.changedBy)} ·{" "}
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>

            {/* 移动模块 */}
            {isRoot && (
              <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                <h2 className="mb-3 font-medium">移动到其他模块</h2>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedModuleId}
                    onChange={(e) => setSelectedModuleId(e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  >
                    {modules.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={updateModule}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    移动
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      <CommitDiffModal
        commit={selectedCommit}
        onClose={() => setSelectedCommit(null)}
      />
    </AppShell>
  );
}
