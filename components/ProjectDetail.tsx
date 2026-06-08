"use client";

import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { formatAssigneeNames } from "@/components/AssigneePicker";
import {
  TicketCreateForm,
  type TicketCreateResponsibility,
  type TicketCreateUser,
} from "@/components/TicketCreateForm";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IconArrowLeft, IconEdit, IconPlus, IconTrash } from "@/components/icons";

function ProjectDetailHeaderSkeleton() {
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

function ProjectDetailContentSkeleton() {
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

type Ticket = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  progress: number;
  status: TicketStatus;
  assignees: User[];
};

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DELIVERED" | "DONE";

type User = {
  id: string;
  name: string | null;
  email: string;
  role: "ROOT" | "USER";
};

type Module = {
  id: string;
  name: string;
  description: string | null;
  tickets: Ticket[];
};

type Responsibility = {
  id: string;
  kind: "PROGRAM" | "DESIGN";
  modules: Module[];
};

type Project = {
  id: string;
  name: string;
  description: string | null;
  responsibilities: Responsibility[];
};

const KIND_LABEL: Record<Responsibility["kind"], string> = {
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
  DELIVERED: "bg-violet-50 text-violet-700",
  DONE: "bg-emerald-50 text-emerald-600",
};

const STATUS_ORDER: Record<TicketStatus, number> = {
  DEVELOPING: 0,
  READY_FOR_TEST: 1,
  DELIVERED: 2,
  DONE: 3,
};

export function ProjectDetailLoading() {
  return (
    <AppShell header={<ProjectDetailHeaderSkeleton />}>
      <ProjectDetailContentSkeleton />
    </AppShell>
  );
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<TicketCreateUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResponsibilityId, setSelectedResponsibilityId] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [message, setMessage] = useState("");

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
        setMessage(`保存模块失败: ${err.error ?? res.status}`);
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
      setMessage(`合并失败: ${err.error ?? res.status}`);
    }
  }

  async function deleteModule(module: Module) {
    if (!window.confirm(`确定删除模块 "${module.name}" 吗？该模块下的所有单子也会被删除。`)) {
      return;
    }
    setMessage("");
    const res = await fetch(`/api/modules/${module.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("删除模块失败");
      return;
    }
    setMessage("模块已删除");
    await loadProject();
  }
  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) {
      setProject(null);
      return;
    }
    const data = (await res.json()) as { project: Project };
    setProject(data.project);
  }, [projectId]);

  useEffect(() => {
    loadProject().finally(() => setLoading(false));
  }, [loadProject]);

  useEffect(() => {
    if (!isRoot) return;
    fetch("/api/users")
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data: { users: User[] }) => setUsers(data.users));
  }, [isRoot]);

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


  async function handleTicketCreated() {
    setShowCreate(false);
    await loadProject();
  }

  async function deleteTicket(ticket: Ticket) {
    if (!window.confirm(`确定删除单子 #${ticket.ticketNo} 吗？`)) {
      return;
    }
    setMessage("");
    const res = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("删除单子失败");
      return;
    }
    setMessage("单子已删除");
    await loadProject();
  }
  if (loading) {
    return <ProjectDetailLoading />;
  }

  if (!project) {
    return (
      <AppShell>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900"
        >
          <IconArrowLeft className="h-4 w-4" /> 返回项目列表
        </Link>
        <p className="mt-6 rounded-xl border border-dashed border-ink-200 bg-white p-12 text-center text-ink-400">
          项目不存在
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell
      header={
        <div className="flex items-center gap-3">
          <Link
            href="/projects"
            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            aria-label="返回项目列表"
          >
            <IconArrowLeft />
          </Link>
          <div>
            <h1 className="text-lg font-semibold leading-tight">{project.name}</h1>
            <p className="text-xs text-ink-400">
              {project.description || "项目详情 · Project Detail"}
            </p>
          </div>
        </div>
      }
    >      {/* 编辑模块弹窗 */}
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
                {mergeConfirm.sourceModule.tickets.length} + {mergeConfirm.targetTicketCount} 个单子
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
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <p className="text-sm text-ink-500">任务完成率</p>
            <p className="mt-2 text-3xl font-semibold text-brand-600">{stats.rate}%</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-brand-500"
                style={{ width: `${stats.rate}%` }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <p className="text-sm text-ink-500">进行中任务</p>
            <p className="mt-2 text-3xl font-semibold">{stats.dev}</p>
            <p className="mt-1 text-xs text-ink-400">开发中</p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <p className="text-sm text-ink-500">待测试任务</p>
            <p className="mt-2 text-3xl font-semibold text-warning">{stats.test}</p>
            <p className="mt-1 text-xs text-ink-400">等待验收</p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <p className="text-sm text-ink-500">已交付任务</p>
            <p className="mt-2 text-3xl font-semibold text-violet-700">{stats.delivered}</p>
            <p className="mt-1 text-xs text-ink-400">等待确认完成</p>
          </div>
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <p className="text-sm text-ink-500">已完成任务</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-600">{stats.done}</p>
            <p className="mt-1 text-xs text-ink-400">累计完成</p>
          </div>
        </section>

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
              {isRoot && selectedResponsibility ? (
                <button
                  type="button"
                  onClick={() => setShowCreate((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  <IconPlus className="h-4 w-4" /> 新建单子
                </button>
              ) : null}
            </div>

            <div className="p-5">
              {isRoot && selectedResponsibilityForCreate && showCreate ? (
                <TicketCreateForm
                  projectId={projectId}
                  responsibility={selectedResponsibilityForCreate}
                  users={users}
                  onMessage={setMessage}
                  onCreated={handleTicketCreated}
                  onCancel={() => setShowCreate(false)}
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
                            const isClosed = isDelivered || isDone;
                            return (
                              <div
                                key={ticket.id}
                                className={`rounded-lg border p-3 transition ${
                                  isClosed
                                    ? "border-ink-100 bg-ink-100/40"
                                    : "border-ink-200 hover:border-brand-200 hover:shadow-soft"
                                }`}
                              >
                                <Link href={`/${ticket.ticketNo}`} className="block">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="font-mono text-xs text-ink-400">
                                      #{ticket.ticketNo}
                                    </span>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[ticket.status]}`}
                                    >
                                      {STATUS_LABEL[ticket.status]}
                                    </span>
                                  </div>
                                  <p
                                    className={`mt-1.5 text-sm font-medium ${
                                      isClosed ? "text-ink-400" : ""
                                    } ${isDone ? "line-through" : ""}`}
                                  >
                                    {ticket.title}
                                  </p>
                                  <p className="mt-1 text-xs text-ink-400">
                                    指派：{formatAssigneeNames(ticket.assignees)}
                                  </p>
                                </Link>
                                {isRoot ? (
                                  <button
                                    type="button"
                                    onClick={() => deleteTicket(ticket)}
                                    className="mt-2 inline-flex items-center gap-1 text-xs text-ink-400 hover:text-danger"
                                  >
                                    <IconTrash className="h-3.5 w-3.5" /> 删除单子
                                  </button>
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
    </AppShell>
  );
}
