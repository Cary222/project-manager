"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { CommitDiffModal, type CommitSummary } from "@/components/CommitDiffModal";
import { AssigneePicker } from "@/components/AssigneePicker";
import { formatAssigneeList } from "@/lib/ticket-assignees";
import { branchStyle, repoStyle } from "@/lib/repo-style";

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

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DONE";

const KIND_LABEL: Record<"PROGRAM" | "DESIGN", string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DONE: "已完成",
};

function userLabel(user: UserBrief | null) {
  if (!user) return "未指派";
  return `${user.name || user.email}（${user.role}）`;
}

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [users, setUsers] = useState<UserBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TicketStatus>("DEVELOPING");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [selectedCommit, setSelectedCommit] = useState<CommitSummary | null>(
    null
  );
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

  const isAssignee = ticket?.assignees.some(a => a.id === session?.user?.id) ?? false;
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

  const allModules = ticket?.project.responsibilities.flatMap(r => r.modules) ?? [];

  useEffect(() => {
    if (!ticket || !isRoot) return;
    const respKind = ticket.module.responsibility.kind;
    const respModules = allModules.filter(m => {
      const resp = ticket.project.responsibilities.find(r => r.kind === respKind);
      return resp?.modules.some(rm => rm.id === m.id);
    });
    setModules(allModules.length > 0 ? allModules : respModules);
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
    const module = modules.find(m => m.id === selectedModuleId);
    if (!module) return;
    if (module.id === ticket.module.id) return;
    const res = await fetch(`/api/tickets/${ticket.id}/module`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId: module.id }),
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
    const res = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setMessage("状态保存失败");
      return;
    }
    setMessage("状态已保存");
    await loadTicket();
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
    return <main className="p-6 text-sm text-zinc-500">加载中...</main>;
  }

  if (!ticket) {
    return (
      <main className="p-6">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
          返回项目
        </Link>
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center text-zinc-500">
          单子不存在
        </p>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <div>
          <Link
            href={`/projects/${ticket.project.id}`}
            className="text-sm text-zinc-500 hover:text-zinc-900"
          >
            返回 {ticket.project.name}
          </Link>
          <h1 className="mt-1 text-lg font-semibold">#{ticket.ticketNo}</h1>
          <p className="text-sm text-zinc-500">
            {KIND_LABEL[ticket.module.responsibility.kind]} / {ticket.module.name}
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
        >
          退出
        </button>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 p-6">
        {message ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}

        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            {isEditing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="flex-1 rounded-md border border-zinc-300 px-3 py-1 text-xl font-semibold"
              />
            ) : (
              <h2 className="text-xl font-semibold">{ticket.title}</h2>
            )}
            <div className="flex gap-2">
              {canEdit && !isEditing && (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
                >
                  编辑
                </button>
              )}
            </div>
          </div>
          <div className="mt-4">
            {isEditing ? (
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="添加描述..."
              />
            ) : ticket.description ? (
              <MarkdownContent content={ticket.description} />
            ) : (
              <p className="text-sm text-zinc-500">暂无描述</p>
            )}
          </div>
          {canEdit && isEditing && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={saveTicketDetails}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white"
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
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                取消
              </button>
            </div>
          )}
        </section>

        {isRoot && (
          <section className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="mb-3 font-medium">移动到其他模块</h2>
            <div className="flex items-center gap-3">
              <select
                value={selectedModuleId}
                onChange={(e) => setSelectedModuleId(e.target.value)}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
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
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
              >
                移动
              </button>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 font-medium">指派</h2>
          <p className="mb-3 text-sm text-zinc-600">
            当前指派：{formatAssigneeList(ticket.assignees)}
          </p>
          {isRoot ? (
            <div className="mb-4 space-y-3">
              <AssigneePicker
                users={users}
                value={assigneeIds}
                onChange={setAssigneeIds}
              />
              <button
                type="button"
                onClick={updateAssignee}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
              >
                保存
              </button>
            </div>
          ) : null}
          <h3 className="mb-2 text-sm font-medium text-zinc-500">指派历史</h3>
          {ticket.assigneeHistory.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
              暂无
            </p>
          ) : (
            <div className="space-y-2">
              {ticket.assigneeHistory.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-zinc-100 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{formatAssigneeList(item.assignees)}</span>
                    <span className="text-xs text-zinc-400">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    操作人：{userLabel(item.changedBy)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 font-medium">状态</h2>
          <p className="mb-3 text-sm text-zinc-600">
            当前状态：{STATUS_LABEL[ticket.status]}
          </p>
          <div className="mb-4 flex items-center gap-2">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as TicketStatus)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
            >
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={updateStatus}
              className="ml-auto rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
            >
              保存
            </button>
          </div>
          <h3 className="mb-2 text-sm font-medium text-zinc-500">状态历史</h3>
          {ticket.statusHistory.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
              暂无
            </p>
          ) : (
            <div className="space-y-2">
              {ticket.statusHistory.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-zinc-100 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span>{STATUS_LABEL[item.status]}</span>
                    <span className="text-xs text-zinc-400">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    操作人：{userLabel(item.changedBy)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 font-medium">历史提交</h2>
          {ticket.commits.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500">
              暂无
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
                  className={`w-full rounded-lg border border-zinc-100 border-l-4 ${repo.border} p-3 text-left text-sm transition hover:border-zinc-300 ${repo.card}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${repo.badge}`}>
                        {repo.name}
                      </span>
                      <span className="font-mono text-xs text-zinc-500">
                        {commit.commitSha.slice(0, 7)}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-zinc-400">
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
                  <p className="mt-2">{commit.subject}</p>
                  <p className="mt-1 text-xs text-zinc-500">{commit.author}</p>
                </button>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <CommitDiffModal
        commit={selectedCommit}
        onClose={() => setSelectedCommit(null)}
      />
    </div>
  );
}
