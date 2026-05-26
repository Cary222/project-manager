"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";

type UserBrief = {
  id: string;
  name: string | null;
  email: string;
  role: "ROOT" | "USER";
};

type Ticket = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  progress: number;
  status: TicketStatus;
  project: { id: string; name: string };
  assignee: UserBrief | null;
  module: {
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
  }[];
  assigneeHistory: {
    id: string;
    createdAt: string;
    assignee: UserBrief | null;
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
  const [assigneeId, setAssigneeId] = useState("");
  const [message, setMessage] = useState("");

  const loadTicket = useCallback(async () => {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) {
      setTicket(null);
      return;
    }
    const data = (await res.json()) as { ticket: Ticket };
    setTicket(data.ticket);
    setStatus(data.ticket.status);
    setAssigneeId(data.ticket.assignee?.id ?? "");
  }, [ticketId]);

  useEffect(() => {
    loadTicket().finally(() => setLoading(false));
  }, [loadTicket]);

  useEffect(() => {
    if (!isRoot) return;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data: { users: UserBrief[] }) => setUsers(data.users));
  }, [isRoot]);

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
      body: JSON.stringify({ assigneeId: assigneeId || null }),
    });
    if (!res.ok) {
      setMessage("指派人保存失败");
      return;
    }
    setMessage("指派人已更新");
    await loadTicket();
  }

  async function deleteTicket() {
    if (!ticket) return;
    if (!window.confirm(`确定删除单子 #${ticket.ticketNo} 吗？`)) return;
    const res = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("删除单子失败");
      return;
    }
    router.push(`/projects/${ticket.project.id}`);
    router.refresh();
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
            <h2 className="text-xl font-semibold">{ticket.title}</h2>
            {isRoot ? (
              <button
                type="button"
                onClick={deleteTicket}
                className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                删除单子
              </button>
            ) : null}
          </div>
          <div className="mt-4">
            {ticket.description ? (
              <MarkdownContent content={ticket.description} />
            ) : (
              <p className="text-sm text-zinc-500">暂无描述</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="mb-3 font-medium">指派</h2>
          <p className="mb-3 text-sm text-zinc-600">
            当前指派：{userLabel(ticket.assignee)}
          </p>
          {isRoot ? (
            <div className="mb-4 flex items-center gap-2">
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">未指派</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name || user.email}（{user.role}）
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={updateAssignee}
                className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white"
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
                    <span>{userLabel(item.assignee)}</span>
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
              {ticket.commits.map((commit) => (
                <div
                  key={commit.id}
                  className="rounded-lg border border-zinc-100 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-zinc-500">
                      {commit.commitSha.slice(0, 7)}
                    </span>
                    <span className="text-xs text-zinc-400">
                      {new Date(commit.committedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1">{commit.subject}</p>
                  <p className="mt-1 text-xs text-zinc-500">{commit.author}</p>
                  <p className="mt-1 truncate text-xs text-zinc-400">
                    {commit.repoPath}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
