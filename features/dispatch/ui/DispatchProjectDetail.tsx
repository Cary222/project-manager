"use client";

import Link from "next/link";
import useSWR from "swr";
import { formatAssigneeNames } from "@/features/ticket/ui/AssigneePicker";
import { CreateTicketForm } from "@/features/ticket/create";
import type { TicketCreateResponsibility, TicketCreateUser } from "@/entities/ticket/model/types";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconArrowLeft, IconEdit, IconPlus, IconTrash, IconX } from "@/shared/ui/icons";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
import { KIND_LABEL, Module } from "@/entities/ticket/model/types";
import { getMyResponsibilitiesAction } from "@/features/admin/admin";
import { ResponsibilityKind } from "@prisma/client";
import { useRecentVisits } from "@/shared/lib/visits-context";
import { useToast } from "@/shared/lib/use-toast";
import { PriorityBadge } from "@/shared/ui/PriorityBadge";
import {
  type Ticket,
  type MyTicket,
  type Project,
  TicketStatus,
  STATUS_LABEL,
  STATUS_STYLE,
  STATUS_ORDER,
} from "@/entities/ticket/model/types";

function DispatchProjectDetailHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 animate-pulse rounded-lg bg-ink-200" />
      <div className="space-y-2">
        <div className="h-5 w-40 animate-pulse rounded bg-ink-200" />
        <div className="h-3 w-56 animate-pulse rounded bg-ink-100" />
      </div>
    </div>
  );
}

function DispatchProjectDetailContentSkeleton() {
  return (
    <div className="space-y-5 pm-fade-in">
      <section className="grid gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft"
          >
            <div className="h-3 w-16 animate-pulse rounded bg-ink-100" />
            <div className="mt-3 h-8 w-20 animate-pulse rounded bg-ink-200" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-ink-100" />
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="space-y-2">
                <div className="h-5 w-32 animate-pulse rounded bg-ink-200" />
                <div className="h-3 w-48 animate-pulse rounded bg-ink-100" />
              </div>
              <div className="h-10 w-24 animate-pulse rounded-lg bg-ink-100" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-4 animate-pulse rounded bg-ink-100" />
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
            <div className="h-5 w-28 animate-pulse rounded bg-ink-200" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-16 animate-pulse rounded-xl bg-ink-100" />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft"
            >
              <div className="h-4 w-24 animate-pulse rounded bg-ink-200" />
              <div className="mt-4 space-y-3">
                <div className="h-10 animate-pulse rounded bg-ink-100" />
                <div className="h-10 animate-pulse rounded bg-ink-100" />
                <div className="h-10 animate-pulse rounded bg-ink-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DispatchProjectDetailLoading() {
  return <DispatchProjectDetailContentSkeleton />;
}

export function DispatchProjectDetail({ projectId }: { projectId: string }) {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const { toast } = useToast();

  const { data: projectData, error: projectError, isLoading, mutate: refreshProject } = useSWR<{ project: Project }>(
    `/api/projects/${projectId}`,
    fetchJson,
    STALE_SWR_OPTIONS,
  );

  const project = projectData?.project ?? null;
  const { scheduleRecord } = useRecentVisits();

  useEffect(() => {
    if (project) {
      scheduleRecord({
        projectId: project.id,
        projectName: project.name,
        tabKey: "dispatch",
        tabLabel: "派单",
      });
    }
  }, [project, scheduleRecord]);

  const [selectedResponsibilityId, setSelectedResponsibilityId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [userResps, setUserResps] = useState<ResponsibilityKind[]>([]);
  const [sortByPriority, setSortByPriority] = useState(false);

  // Load current user's responsibilities
  useEffect(() => {
    getMyResponsibilitiesAction()
      .then((r) => setUserResps(r.kinds))
      .catch(() => {});
  }, []);

  const { data: usersData } = useSWR<{ users: TicketCreateUser[] }>(
    isRoot || userResps.length > 0 ? "/api/users" : null,
    fetchJson,
    STALE_SWR_OPTIONS,
  );
  const users = usersData?.users ?? [];
  const [message, setMessage] = useState("");

  const loadProject = useCallback(async () => {
    await refreshProject();
  }, [refreshProject]);

  // Module editing state
  const [editingModule, setEditingModule] = useState<Module | null>(null);
  const [editModuleName, setEditModuleName] = useState("");
  const [editModuleDesc, setEditModuleDesc] = useState("");
  const [editingModuleSubmitting, setEditingModuleSubmitting] = useState(false);

  // Module merge confirmation state
  const [mergeConfirm, setMergeConfirm] = useState<{
    sourceModule: Module;
    targetModule: {
      id: string;
      name: string;
      ticketCount: number;
    };
    targetTicketCount: number;
  } | null>(null);

  function openEditModule(module: Module) {
    setEditingModule(module);
    setEditModuleName(module.name);
    setEditModuleDesc(module.description || "");
  }

  function closeEditModule() {
    setEditingModule(null);
    setEditModuleName("");
    setEditModuleDesc("");
  }

  async function saveModule() {
    if (!editingModule) return;
    setEditingModuleSubmitting(true);
    const res = await fetch(`/api/modules/${editingModule.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editModuleName.trim(),
        description: editModuleDesc.trim(),
      }),
    });
    setEditingModuleSubmitting(false);
    if (res.ok) {
      closeEditModule();
      await loadProject();
    } else {
      const err = await res.json().catch(() => ({}));
      if (err.error === "MODULE_CONFLICT" && err.targetModule) {
        setMergeConfirm({
          sourceModule: editingModule,
          targetModule: err.targetModule,
          targetTicketCount: err.sourceModule?.ticketCount ?? 0,
        });
      } else {
        toast.error(`保存模块失败: ${err.error ?? res.status}`);
      }
    }
  }

  async function confirmMerge() {
    if (!mergeConfirm) return;
    setEditingModuleSubmitting(true);
    const res = await fetch(`/api/modules/${mergeConfirm.sourceModule.id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetModuleId: mergeConfirm.targetModule.id,
        description: editModuleDesc.trim(),
      }),
    });
    setEditingModuleSubmitting(false);
    if (res.ok) {
      setMergeConfirm(null);
      closeEditModule();
      await loadProject();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(`合并失败: ${err.error ?? res.status}`);
    }
  }

  async function deleteModule(module: Module) {
    if (!window.confirm(`确定删除模块 "${module.name}" 吗？该模块下的所有单子也会被删除。`)) {
      return;
    }
    setMessage("");
    const res = await fetch(`/api/modules/${module.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("删除模块失败");
      return;
    }
    toast.success("模块已删除");
    await loadProject();
  }

  // 默认选中第一个职能（派生，避免 effect 内 setState）
  const selectedResponsibility = useMemo(() => {
    if (!project) return null;
    return (
      project.responsibilities.find(
        (item) => item.id === selectedResponsibilityId
      ) ??
      project.responsibilities[0] ??
      null
    );
  }, [project, selectedResponsibilityId]);

  const tickets = useMemo(() => {
    if (!selectedResponsibility) return [];
    return selectedResponsibility.modules
      .flatMap((module) => module.tickets)
      .sort((a, b) => {
        const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (statusDiff !== 0) return statusDiff;
        return b.ticketNo - a.ticketNo;
      });
  }, [selectedResponsibility]);

  const stats = useMemo(() => {
    const all =
      project?.responsibilities.flatMap((r) =>
        r.modules.flatMap((m) => m.tickets)
      ) ?? [];
    const dev = all.filter((t) => t.status === "DEVELOPING").length;
    const test = all.filter((t) => t.status === "READY_FOR_TEST").length;
    const delivered = all.filter((t) => t.status === "DELIVERED").length;
    const done = all.filter((t) => t.status === "DONE").length;
    const rate = all.length ? Math.round((done / all.length) * 100) : 0;
    return { total: all.length, dev, test, delivered, done, rate };
  }, [project]);

  const selectedResponsibilityForCreate = selectedResponsibility as TicketCreateResponsibility | null;

  const allProjectModules = useMemo(
    () => project?.responsibilities.flatMap((r) => r.modules) ?? [],
    [project],
  );

  async function handleTicketCreated() {
    setShowCreate(false);
    await loadProject();
  }

  async function deleteTicket(ticket: MyTicket) {
    if (!window.confirm(`确定删除单子 #${ticket.ticketNo} 吗？`)) {
      return;
    }
    setMessage("");
    const res = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("删除单子失败");
      return;
    }
    toast.success("单子已删除");
    await loadProject();
  }

  async function handleTicketStatus(ticket: MyTicket) {
    const isClosed = ticket.status === "CLOSED";
    const action = isClosed ? "取消关闭" : "关闭";
    const newStatus: TicketStatus = isClosed ? "DEVELOPING" : "CLOSED";
    const confirmMsg = isClosed
      ? `确定取消关闭单子 #${ticket.ticketNo} 吗？状态将恢复为开发中。`
      : `确定关闭单子 #${ticket.ticketNo} 吗？`;

    if (!window.confirm(confirmMsg)) {
      return;
    }
    setMessage("");
    const res = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) {
      toast.error(`${action}单子失败`);
      return;
    }
    toast.success(`单子已${action}`);
    await loadProject();
  }

  if (isLoading) {
    return <DispatchProjectDetailLoading />;
  }

  if (!project) {
    return (
      <div className="pm-fade-in p-6">
        <Link
          href="/dispatchTicket"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
        >
          <IconArrowLeft className="h-4 w-4" /> 返回派单
        </Link>
        <p className="mt-6 rounded-xl border border-dashed border-ink-200 bg-white p-12 text-center text-ink-400">
          项目不存在
        </p>
      </div>
    );
  }

  return (
    <>
      {editingModule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-elevated">
            <h3 className="mb-4 text-lg font-medium">编辑模块</h3>
            <div className="space-y-4">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-ink-700">模块名称</span>
                <input
                  type="text"
                  value={editModuleName}
                  onChange={(e) => setEditModuleName(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  required
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-ink-700">描述</span>
                <textarea
                  value={editModuleDesc}
                  onChange={(e) => setEditModuleDesc(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  style={{ minHeight: "80px", resize: "vertical" }}
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditModule}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveModule}
                disabled={editingModuleSubmitting || !editModuleName.trim()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {editingModuleSubmitting ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 合并模块弹窗 */}
      {mergeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-elevated">
            <h3 className="mb-4 text-lg font-medium">合并模块</h3>
            <div className="mb-4 space-y-2 text-sm">
              <p className="text-ink-600">
                模块「<span className="font-medium">{mergeConfirm.sourceModule.name}</span>」
                将合并到「<span className="font-medium">{mergeConfirm.targetModule.name}</span>」
              </p>
              <p className="text-ink-600">
                {mergeConfirm.sourceModule.tickets?.length ?? 0} + {mergeConfirm.targetTicketCount} 个单子
                将全部归到「{mergeConfirm.targetModule.name}」
              </p>
              <p className="font-medium text-warning">此操作不可撤销，是否继续？</p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMergeConfirm(null)}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmMerge}
                disabled={editingModuleSubmitting}
                className="rounded-lg bg-warning px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
              >
                {editingModuleSubmitting ? "合并中…" : "确认合并"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6 pm-fade-in">
        {/* 概览统计 */}
        {message ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {message}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-12">
          {/* 职能侧栏 */}
          <section className="space-y-3 lg:col-span-3">
            <h2 className="px-1 text-sm font-medium text-ink-500">职能</h2>
            {project.responsibilities.map((responsibility) => {
              const active = selectedResponsibility?.id === responsibility.id;
              const count = responsibility.modules.reduce(
                (sum, m) => sum + m.tickets.length,
                0
              );
              return (
                <button
                  key={responsibility.id}
                  type="button"
                  onClick={() => {
                    setSelectedResponsibilityId(responsibility.id);
                    setMessage("");
                  }}
                  className={`w-full rounded-xl border bg-white p-4 text-left shadow-soft transition ${
                    active
                      ? "border-brand-400 ring-2 ring-brand-100"
                      : "border-ink-200 hover:border-brand-200"
                  }`}
                >
                  <p className="font-medium">{KIND_LABEL[responsibility.kind]}</p>
                  <p className="mt-1 text-sm text-ink-400">{count} 个单子</p>
                </button>
              );
            })}
            {!project.responsibilities.some((r) => r.kind === "BUG") && isRoot && (
              <button
                type="button"
                onClick={async () => {
                  const res = await fetch(`/api/projects/${projectId}/responsibilities`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ kind: "BUG" }),
                  });
                  if (res.ok) {
                    await loadProject();
                  } else {
                    const err = await res.json().catch(() => ({}));
                    toast.error(`创建Bug职能失败: ${err.error}`);
                  }
                }}
                className="w-full rounded-xl border border-dashed border-rose-300 bg-rose-50/50 p-4 text-left text-sm text-rose-600 transition hover:border-rose-400 hover:bg-rose-50"
              >
                + 添加 Bug 职能
              </button>
            )}
          </section>

          {/* 单子区 */}
          <section className="rounded-xl border border-ink-200 bg-white shadow-soft lg:col-span-9">
            <div className="flex items-center justify-between gap-4 border-b border-ink-100 px-5 py-4">
              <div>
                <h2 className="font-medium">单子</h2>
                <p className="mt-0.5 text-sm text-ink-400">
                  {selectedResponsibility
                    ? `${KIND_LABEL[selectedResponsibility.kind]}职能`
                    : "请选择职能"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 rounded-lg border border-ink-200 bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setSortByPriority(false)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      !sortByPriority
                        ? "bg-brand-50 text-brand-700"
                        : "text-ink-500 hover:bg-ink-50"
                    }`}
                  >
                    按模块
                  </button>
                  <button
                    type="button"
                    onClick={() => setSortByPriority(true)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                      sortByPriority
                        ? "bg-brand-50 text-brand-700"
                        : "text-ink-500 hover:bg-ink-50"
                    }`}
                  >
                    按优先级
                  </button>
                </div>
                {!!selectedResponsibility ? (
                  <button
                    type="button"
                    onClick={() => setShowCreate((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    <IconPlus className="h-4 w-4" /> 新建单子
                  </button>
                ) : null}
              </div>
            </div>

            <div className="p-5">
              {!!selectedResponsibilityForCreate && showCreate ? (
                <CreateTicketForm
                  projectId={projectId}
                  responsibility={selectedResponsibilityForCreate}
                  users={users}
                  onMessage={setMessage}
                  onCreated={handleTicketCreated}
                  onCancel={() => setShowCreate(false)}
                  allProjectModules={allProjectModules}
                />
              ) : null}

              {!selectedResponsibility ? (
                <p className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
                  请选择职能
                </p>
              ) : tickets.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
                  暂无单子
                </p>
              ) : sortByPriority ? (
                (() => {
                  const moduleMap = new Map(
                    selectedResponsibility.modules.flatMap((m) =>
                      (m.tickets ?? []).map((t) => [t.id, m.name])
                    )
                  );
                  const prioritySorted = [...tickets].sort((a, b) => a.priority - b.priority);
                  return (
                    <div className="grid gap-2 md:grid-cols-2">
                      {prioritySorted.map((ticket) => {
                        const isDelivered = ticket.status === "DELIVERED";
                        const isDone = ticket.status === "DONE";
                        const isClosed = ticket.status === "CLOSED";
                        const isTerminal = isDelivered || isDone || isClosed;
                        return (
                          <div
                            key={ticket.id}
                            className={`rounded-lg border p-3 transition ${
                              isTerminal
                                ? "border-ink-100 bg-ink-100/40"
                                : "border-ink-200 hover:border-brand-200 hover:shadow-soft"
                            }`}
                          >
                            <Link href={`/dispatchTicket/tickets/${ticket.id}`} className="block">
                              <div className="flex items-center justify-between gap-3 text-xs">
                                <div className="flex items-center gap-2 text-ink-400">
                                  <PriorityBadge priority={ticket.priority ?? 2} />
                                  <span className="font-mono">#{ticket.ticketNo}</span>
                                  <span className="text-ink-300">·</span>
                                  <span className="text-ink-500">{moduleMap.get(ticket.id)}</span>
                                </div>
                                <span
                                  className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[ticket.status]}`}
                                >
                                  {STATUS_LABEL[ticket.status]}
                                </span>
                              </div>
                              <p
                                className={`mt-1.5 text-sm font-medium ${
                                  isClosed ? "text-ink-400" : ""
                                } ${isDone ? "line-through" : ""}${
                                  ticket.status === "OVERDUE" && !isClosed ? " text-red-600" : ""
                                }`}
                              >
                                {ticket.title}
                              </p>
                              <p className="mt-1 text-xs text-ink-400">
                                指派：{formatAssigneeNames(ticket.assignees)}
                              </p>
                              {ticket.deadline && ticket.status !== "CLOSED" && (
                                <p className={`mt-0.5 text-xs ${
                                  ticket.status === "OVERDUE"
                                    ? "text-red-600 font-medium"
                                    : "text-ink-400"
                                }`}>
                                  截止：{new Date(ticket.deadline).toLocaleDateString("zh-CN")}
                                  {ticket.status === "OVERDUE" ? " (已逾期)" : ""}
                                </p>
                              )}
                            </Link>
                            {isRoot ? (
                              <div className="mt-2 flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => handleTicketStatus(ticket)}
                                  className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-emerald-600"
                                >
                                  {ticket.status === "CLOSED" ? (
                                    <>
                                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> 取消关闭
                                    </>
                                  ) : (
                                    <>
                                      <IconX className="h-3.5 w-3.5" /> 关闭单子
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteTicket(ticket)}
                                  className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-danger"
                                >
                                  <IconTrash className="h-3.5 w-3.5" /> 删除单子
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()
              ) : (
                <div className="space-y-6">
                  {selectedResponsibility.modules.map((module) => {
                    const moduleTickets = [...module.tickets].sort((a, b) => {
                      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
                      if (statusDiff !== 0) return statusDiff;
                      return b.ticketNo - a.ticketNo;
                    });

                    return (
                    <div key={module.id}>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="flex items-center gap-2 text-xs font-medium text-ink-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                          {module.name}
                          <span className="text-ink-300">·</span>
                          <span className="text-ink-400">
                            {module.tickets.length}
                          </span>
                        </p>
                        {isRoot && (
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() => openEditModule(module)}
                              className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-ink-700"
                            >
                              <IconEdit className="h-3.5 w-3.5" /> 编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteModule(module)}
                              className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-danger"
                            >
                              <IconTrash className="h-3.5 w-3.5" /> 删除
                            </button>
                          </div>
                        )}
                      </div>
                      {moduleTickets.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-ink-200 px-3 py-2 text-sm text-ink-400">
                          暂无单子
                        </p>
                      ) : (
                        <div className="grid gap-2 md:grid-cols-2">
                          {moduleTickets.map((ticket) => {
                            const isDelivered = ticket.status === "DELIVERED";
                            const isDone = ticket.status === "DONE";
                            const isClosed = ticket.status === "CLOSED";
                            const isTerminal = isDelivered || isDone || isClosed;
                            return (
                              <div
                                key={ticket.id}
                                className={`rounded-lg border p-3 transition ${
                                  isTerminal
                                    ? "border-ink-100 bg-ink-100/40"
                                    : "border-ink-200 hover:border-brand-200 hover:shadow-soft"
                                }`}
                              >
                                <Link href={`/dispatchTicket/tickets/${ticket.id}`} className="block">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-1.5">
                                      <PriorityBadge priority={ticket.priority ?? 2} />
                                      <span className="font-mono text-xs text-ink-400">
                                        #{ticket.ticketNo}
                                      </span>
                                    </div>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[ticket.status]}`}
                                    >
                                      {STATUS_LABEL[ticket.status]}
                                    </span>
                                  </div>
                                  <p
                                    className={`mt-1.5 text-sm font-medium ${
                                      isClosed ? "text-ink-400" : ""
                                    } ${isDone ? "line-through" : ""}${
                                      ticket.status === "OVERDUE" && !isClosed ? " text-red-600" : ""
                                    }`}
                                  >
                                    {ticket.title}
                                  </p>
                                  <p className="mt-1 text-xs text-ink-400">
                                    指派：{formatAssigneeNames(ticket.assignees)}
                                  </p>
                                  {ticket.deadline && ticket.status !== "CLOSED" && (
                                    <p className={`mt-0.5 text-xs ${
                                      ticket.status === "OVERDUE"
                                        ? "text-red-600 font-medium"
                                        : "text-ink-400"
                                    }`}>
                                      截止：{new Date(ticket.deadline).toLocaleDateString("zh-CN")}
                                      {ticket.status === "OVERDUE" ? " (已逾期)" : ""}
                                    </p>
                                  )}
                                </Link>
                                {isRoot ? (
                                  <div className="mt-2 flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => handleTicketStatus(ticket)}
                                      className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-emerald-600"
                                    >
                                      {ticket.status === "CLOSED" ? (
                                        <>
                                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> 取消关闭
                                        </>
                                      ) : (
                                        <>
                                          <IconX className="h-3.5 w-3.5" /> 关闭单子
                                        </>
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteTicket(ticket)}
                                      className="inline-flex items-center gap-1 text-xs text-ink-400 hover:text-danger"
                                    >
                                      <IconTrash className="h-3.5 w-3.5" /> 删除单子
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

export { DispatchProjectDetailHeaderSkeleton };
