"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TicketStatus, UserRole } from "@prisma/client";
import { getUserByIdAction, getUserTicketsAction, UserTicket } from "@/features/admin/admin";

type Props = { params: Promise<{ userId: string }> };

const STATUS_ORDER: Record<TicketStatus, number> = {
  DEVELOPING: 0,
  READY_FOR_TEST: 1,
  DELIVERED: 2,
  OVERDUE: 3,
  DONE: 4,
  CLOSED: 5,
};

const STATUS_LABEL: Record<TicketStatus, string> = {
  DEVELOPING: "开发中",
  READY_FOR_TEST: "待测试",
  DELIVERED: "已交付",
  DONE: "已完成",
  OVERDUE: "已逾期",
  CLOSED: "已关闭",
};

const KIND_LABEL: Record<string, string> = {
  PROGRAM: "程序",
  DESIGN: "设计",
  BUG: "Bug",
};

export default function UserDetailPage({ params }: Props) {
  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<{
    id: string;
    name: string | null;
    email: string;
    role: UserRole;
    bannedAt: Date | null;
    createdAt: Date;
  } | null>(null);
  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    params.then((p) => setUserId(p.userId));
  }, [params]);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    Promise.all([getUserByIdAction(userId), getUserTicketsAction(userId, statusFilter || undefined)]).then(
      ([u, t]) => {
        if (!u) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setUser(u);
        setTickets(t);
        setLoading(false);
      }
    );
  }, [userId, statusFilter]);

  const ticketsByProject = tickets.reduce<{ project: { id: string; name: string }; tickets: UserTicket[] }[]>(
    (acc, ticket) => {
      const existing = acc.find((g) => g.project.id === ticket.project.id);
      if (existing) {
        existing.tickets.push(ticket);
      } else {
        acc.push({ project: { id: ticket.project.id, name: ticket.project.name }, tickets: [ticket] });
      }
      return acc;
    },
    []
  );

  ticketsByProject.forEach((group) => {
    group.tickets.sort((a, b) => {
      const diff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (diff !== 0) return diff;
      return b.ticketNo - a.ticketNo;
    });
  });

  if (notFound) {
    return (
      <div className="py-16 text-center text-zinc-500">
        <p className="text-lg">用户不存在</p>
        <Link href="/admin/users" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
          返回用户列表
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-2 text-sm text-zinc-400">
        <Link href="/admin/users" className="hover:text-zinc-700">
          用户列表
        </Link>
        <span>/</span>
        <span className="text-zinc-700">
          {loading ? "…" : user?.name || user?.email || "详情"}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-400">加载中…</p>
      ) : user ? (
        <>
          <div className="mb-6 rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-xl font-semibold">{user.name || <span className="text-zinc-400">未命名</span>}</h1>
                <p className="mt-1 text-sm text-zinc-500">{user.email}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span
                  className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                    user.role === "ROOT" ? "bg-amber-100 text-amber-700" : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {user.role}
                </span>
                {user.bannedAt ? (
                  <span className="inline-flex items-center rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                    已封禁
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                    正常
                  </span>
                )}
              </div>
            </div>
            <p className="mt-3 text-xs text-zinc-400">
              注册于 {new Date(user.createdAt).toLocaleDateString("zh-CN")}
            </p>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold">
              单子
              <span className="ml-2 text-sm font-normal text-zinc-400">（共 {tickets.length} 个）</span>
            </h2>
            <select
              className="rounded-md border border-zinc-300 px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TicketStatus | "")}
            >
              <option value="">全部状态</option>
              <option value="DEVELOPING">开发中</option>
              <option value="READY_FOR_TEST">待测试</option>
              <option value="DELIVERED">已交付</option>
              <option value="DONE">已完成</option>
            </select>
          </div>

          {ticketsByProject.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-sm text-zinc-500">
              暂无单子
            </div>
          ) : (
            <div className="space-y-5">
              {ticketsByProject.map(({ project, tickets }) => (
                <section key={project.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="font-medium">{project.name}</h3>
                    <Link
                      href={`/projects/${project.id}`}
                      target="_blank"
                      className="text-sm text-zinc-400 hover:text-zinc-900"
                    >
                      进入项目 →
                    </Link>
                  </div>
                  <ul className="space-y-2">
                    {tickets.map((ticket) => {
                      const isDone = ticket.status === "DONE";
                      return (
                        <li key={ticket.id}>
                          <Link
                            href={`/tickets/${ticket.id}`}
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
                              {KIND_LABEL[ticket.module.responsibility.kind]} / {ticket.module.name}
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
        </>
      ) : null}
    </div>
  );
}
