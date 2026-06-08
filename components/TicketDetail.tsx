"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MarkdownContent } from "@/components/MarkdownContent";
import { CommitDiffModal, type CommitSummary } from "@/components/CommitDiffModal";
import { AssigneePicker } from "@/components/AssigneePicker";
import {
  TicketCreateForm,
  type TicketCreateResponsibility,
  type TicketCreateUser,
} from "@/components/TicketCreateForm";
import { formatAssigneeList } from "@/lib/ticket-assignees";
import { branchStyle, repoStyle } from "@/lib/repo-style";
import { IconArrowLeft, IconClock, IconEdit } from "@/components/icons";

function TicketDetailHeaderSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-8 w-8 animate-pulse rounded-lg bg-ink-200" />
      <div className="space-y-2">
        <div className="h-5 w-24 animate-pulse rounded bg-ink-200" />
        <div className="h-3 w-56 animate-pulse rounded bg-ink-100" />
      </div>
    </div>
  );
}

function TicketDetailContentSkeleton() {
  return (
    <div className="space-y-5 pm-fade-in">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-6 w-20 animate-pulse rounded-full bg-ink-100" />
                <div className="h-7 w-3/4 animate-pulse rounded bg-ink-200" />
              </div>
              <div className="h-9 w-20 animate-pulse rounded-lg bg-ink-100" />
            </div>
            <div className="mt-5 space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-4 animate-pulse rounded bg-ink-100" />
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
            <div className="h-5 w-28 animate-pulse rounded bg-ink-200" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-20 animate-pulse rounded-xl bg-ink-100" />
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <section
              key={index}
              className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft"
            >
              <div className="h-4 w-24 animate-pulse rounded bg-ink-200" />
              <div className="mt-4 space-y-3">
                <div className="h-10 animate-pulse rounded bg-ink-100" />
                <div className="h-10 animate-pulse rounded bg-ink-100" />
                <div className="h-10 animate-pulse rounded bg-ink-100" />
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  creatorId: string;
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

export function TicketDetailLoading() {
  return (
    <AppShell header={<TicketDetailHeaderSkeleton />}>
      <TicketDetailContentSkeleton />
    </AppShell>
  );
}

type ProgramPushDraft = {
  title: string;
  description: string;
  designAssigneeIds: string[];
  programAssigneeIds: string[];
  moduleId?: string;
  newModuleName?: string;
};

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [users, setUsers] = useState<TicketCreateUser[]>([]);
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
  const [pendingDoneConfirm, setPendingDoneConfirm] = useState(false);
  const [showProgramTicketForm, setShowProgramTicketForm] = useState(false);
  const [pushState, setPushState] = useState<"idle" | "submitting" | "failed" | "succeeded">("idle");
  const [pushErrorMessage, setPushErrorMessage] = useState("");
  const [retryDraft, setRetryDraft] = useState<ProgramPushDraft | null>(null);
  const [pushedProgramTicket, setPushedProgramTicket] = useState<{
    id: string;
    ticketNo: number;
    title: string;
  } | null>(null);

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
  const isDesignTicket = ticket?.module.responsibility.kind === "DESIGN";
  const allowedStatuses = useMemo(() => {
    if (!ticket) return [] as TicketStatus[];
    if (ticket.module.responsibility.kind === "DESIGN") {
      return isRoot
        ? (["DEVELOPING", "DELIVERED", "DONE"] as TicketStatus[])
        : (["DEVELOPING", "DELIVERED"] as TicketStatus[]);
    }
    return isRoot
      ? (["DEVELOPING", "READY_FOR_TEST", "DELIVERED", "DONE"] as TicketStatus[])
      : (["DEVELOPING", "READY_FOR_TEST", "DELIVERED"] as TicketStatus[]);
  }, [ticket, isRoot]);
  const programResponsibility = useMemo(() => {
    return (
      (ticket?.project.responsibilities.find(
        (responsibility) => responsibility.kind === "PROGRAM"
      ) as TicketCreateResponsibility | undefined) ?? null
    );
  }, [ticket]);
  const programPushDraft = useMemo((): ProgramPushDraft | null => {
    if (!ticket) return null;
    return {
      title: ticket.title,
      description: ticket.description || "",
      designAssigneeIds: ticket.assignees.map((user) => user.id),
      programAssigneeIds: [],
    };
  }, [ticket]);

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
    if (!ticket) return;
    if (ticket.creatorId !== session?.user?.id) return;
    if (!isDesignTicket) {
      setPushState("idle");
      setPushErrorMessage("");
      setRetryDraft(null);
      setPushedProgramTicket(null);
      return;
    }

    fetch(`/api/tickets/${ticket.id}/push-record`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: {
        record?: {
          status: "FAILED" | "SUCCEEDED" | "PENDING";
          errorMessage: string | null;
          draftTitle: string;
          draftDescription: string | null;
          programAssigneeIds: string[];
          designAssigneeIds: string[];
          targetTicket?: { id: string; ticketNo: number; title: string } | null;
        } | null;
      } | null) => {
        const record = data?.record;
        if (!record) {
          setPushState("idle");
          setPushErrorMessage("");
          setRetryDraft(null);
          setPushedProgramTicket(null);
          return;
        }
        if (record.status === "SUCCEEDED" && record.targetTicket) {
          setPushState("succeeded");
          setPushedProgramTicket(record.targetTicket);
          setRetryDraft(null);
          setPushErrorMessage("");
          setShowProgramTicketForm(false);
          return;
        }
        if (record.status === "FAILED") {
          setPushState("failed");
          setPushErrorMessage(record.errorMessage || "推单失败");
          setRetryDraft({
            title: record.draftTitle,
            description: record.draftDescription || "",
            designAssigneeIds: record.designAssigneeIds,
            programAssigneeIds: record.programAssigneeIds,
          });
          return;
        }
        setPushState("idle");
      })
      .catch(() => {
        setPushState("idle");
      });
  }, [ticket, session?.user?.id, isDesignTicket]);

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

  async function persistStatus(nextStatus: TicketStatus) {
    if (!ticket) return false;

    const res = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ? `状态保存失败：${data.error}` : "状态保存失败");
      return false;
    }

    setMessage("状态已保存");
    await loadTicket();
    return true;
  }

  async function updateStatus() {
    setMessage("");
    if (!ticket) return;

    if (isDesignTicket && isRoot && status === "DONE") {
      setPendingDoneConfirm(true);
      return;
    }

    try {
      await persistStatus(status);
    } catch (error) {
      setMessage(error instanceof Error ? `状态保存失败：${error.message}` : "状态保存失败");
    }
  }

  async function confirmDoneWithoutPush() {
    setPendingDoneConfirm(false);
    try {
      await persistStatus("DONE");
    } catch (error) {
      setMessage(error instanceof Error ? `状态保存失败：${error.message}` : "状态保存失败");
    }
  }

  async function openProgramPushForm() {
    if (!ticket) return;
    setPendingDoneConfirm(false);
    setPushErrorMessage("");
    setMessage("");

    const completed = await persistStatus("DONE");
    if (!completed) return;

    setPushState("idle");
    setRetryDraft((current) =>
      current ?? {
        title: ticket.title,
        description: ticket.description || "",
        designAssigneeIds: ticket.assignees.map((user) => user.id),
        programAssigneeIds: [],
      }
    );
    setShowProgramTicketForm(true);
  }

  async function handleProgramTicketCreated(payload: {
    ticket: { id: string; ticketNo: number; title: string };
    programAssigneeIds: string[];
    designAssigneeIds: string[];
    title: string;
    description: string;
  }) {
    if (!ticket) return;

    await fetch(`/api/tickets/${ticket.id}/push-record/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "SUCCEEDED",
        errorMessage: null,
        draftTitle: payload.title,
        draftDescription: payload.description,
        programAssigneeIds: payload.programAssigneeIds,
        designAssigneeIds: payload.designAssigneeIds,
        targetTicketId: payload.ticket.id,
      }),
    });

    setPushedProgramTicket(payload.ticket);
    setPushState("succeeded");
    setPushErrorMessage("");
    setRetryDraft(null);
    setShowProgramTicketForm(false);
    setMessage(`程序新单 #${payload.ticket.ticketNo} 已创建`);
  }

  async function handleProgramTicketCreateFailed(
    draft: {
      moduleId?: string;
      newModuleName?: string;
      programAssigneeIds?: string[];
      designAssigneeIds?: string[];
      title?: string;
      description?: string;
    },
    errorMessage: string
  ) {
    if (!ticket) return;

    const safeDraft: ProgramPushDraft = {
      title: draft.title ?? ticket.title,
      description: draft.description ?? ticket.description ?? "",
      designAssigneeIds: draft.designAssigneeIds ?? ticket.assignees.map((user) => user.id),
      programAssigneeIds: draft.programAssigneeIds ?? [],
      moduleId: draft.moduleId,
      newModuleName: draft.newModuleName,
    };

    await fetch(`/api/tickets/${ticket.id}/push-record/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "FAILED",
        errorMessage,
        draftTitle: safeDraft.title,
        draftDescription: safeDraft.description,
        programAssigneeIds: safeDraft.programAssigneeIds,
        designAssigneeIds: safeDraft.designAssigneeIds,
        targetTicketId: null,
      }),
    });

    setRetryDraft(safeDraft);
    setPushState("failed");
    setPushErrorMessage(errorMessage);
    setShowProgramTicketForm(false);
    setMessage(errorMessage);
  }

  function reopenProgramPushForm() {
    if (pushState === "succeeded") return;
    setShowProgramTicketForm(true);
    setPushErrorMessage("");
    setMessage("");
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

  const renderPushStatusCard = () => {
    if (!ticket || ticket.creatorId !== session?.user?.id) return null;

    return (
      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">推单状态 / 重试入口</h2>
            <p className="mt-1 text-sm text-ink-400">
              设计单完成后，可在这里推送程序新单。
            </p>
          </div>
          {pushState === "succeeded" && pushedProgramTicket ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
              已推送
            </span>
          ) : null}
        </div>

        {pushState === "succeeded" && pushedProgramTicket ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-600">
              已推送程序新单 #{pushedProgramTicket.ticketNo}
            </p>
            <Link
              href={`/${pushedProgramTicket.ticketNo}`}
              className="text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              查看程序新单
            </Link>
            <button
              type="button"
              disabled
              className="w-full rounded-lg bg-ink-200 px-3 py-2 text-sm font-medium text-ink-500"
            >
              已推送
            </button>
          </div>
        ) : showProgramTicketForm && programResponsibility && (retryDraft ?? programPushDraft) ? (
          <TicketCreateForm
            projectId={ticket.project.id}
            responsibility={programResponsibility}
            users={users}
            currentUserId={session?.user?.id}
            showDesignAssignees
            editableDesignAssignees
            initialValues={retryDraft ?? programPushDraft ?? undefined}
            submitLabel="创建程序新单"
            onMessage={setMessage}
            onCreated={handleProgramTicketCreated}
            onCancel={() => setShowProgramTicketForm(false)}
            onCreateFailed={handleProgramTicketCreateFailed}
            className="grid gap-3 rounded-xl border border-ink-100 bg-ink-100/40 p-4"
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-500">
              {pushState === "failed"
                ? `上次推单失败：${pushErrorMessage || "请重试"}`
                : "设计单完成后，可在这里推送程序新单。"}
            </p>
            <button
              type="button"
              onClick={reopenProgramPushForm}
              disabled={pushState === "submitting" || pushState === "succeeded"}
              className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pushState === "failed" ? "重新推单" : "推送程序新单"}
            </button>
          </div>
        )}
      </section>
    );
  };

  if (loading) {
    return <TicketDetailLoading />;
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

            {isDesignTicket ? (
              renderPushStatusCard()
            ) : (
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
            )}
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
                  {allowedStatuses.map((value) => (
                    <option key={value} value={value}>
                      {STATUS_LABEL[value]}
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

            {isRoot ? (
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
            ) : null}
          </div>
        </div>
      </div>

      {pendingDoneConfirm && ticket ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-elevated">
            <h3 className="text-lg font-medium">确认完成设计单</h3>
            <p className="mt-3 text-sm text-ink-600">
              确认将设计单 #{ticket.ticketNo}「{ticket.title}」标记为已完成？
            </p>
            <p className="mt-2 text-sm text-ink-500">
              你也可以先推送一个程序新单，创建成功后系统会自动完成当前设计单。
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDoneConfirm(false)}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmDoneWithoutPush}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm text-ink-700 hover:bg-ink-100"
              >
                仅完成设计单
              </button>
              <button
                type="button"
                onClick={openProgramPushForm}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                推送程序新单
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CommitDiffModal
        commit={selectedCommit}
        onClose={() => setSelectedCommit(null)}
      />
    </AppShell>
  );
}
