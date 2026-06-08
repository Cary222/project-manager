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
  type TicketCreateInitialValues,
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

type PushRecordStatus = "FAILED" | "SUCCEEDED" | "PENDING";

type PushRecordTargetTicket = {
  id: string;
  ticketNo: number;
  title: string;
};

type PushRecordSnapshot = {
  status: PushRecordStatus;
  errorMessage: string | null;
  draftTitle: string;
  draftDescription: string | null;
  programAssigneeIds: string[];
  designAssigneeIds: string[];
  targetTicket?: PushRecordTargetTicket | null;
};

type PushResolveMode = "bound" | "candidate" | "unbound";

type PushResolveResponse = {
  mode: PushResolveMode;
  record?: PushRecordSnapshot | null;
  targetTicket?: PushRecordTargetTicket | null;
  candidateTicket?: PushRecordTargetTicket | null;
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
  const [retryDraft, setRetryDraft] = useState<ProgramPushDraft | null>(null);
  const [pushRecord, setPushRecord] = useState<PushRecordSnapshot | null>(null);
  const [pushResolveMode, setPushResolveMode] = useState<PushResolveMode>("unbound");
  const [candidateProgramTicket, setCandidateProgramTicket] =
    useState<PushRecordTargetTicket | null>(null);
  const [editingBoundProgramTicket, setEditingBoundProgramTicket] = useState(false);
  const [pushedProgramTicket, setPushedProgramTicket] = useState<PushRecordTargetTicket | null>(null);

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
    if (ticket.creatorId !== session?.user?.id && !isRoot) return;
    if (!isDesignTicket) {
      setRetryDraft(null);
      setPushRecord(null);
      setPushResolveMode("unbound");
      setCandidateProgramTicket(null);
      setPushedProgramTicket(null);
      return;
    }

    fetch(`/api/tickets/${ticket.ticketNo}/push-record`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { record?: PushRecordSnapshot | null } | null) => {
        const record = data?.record;
        setPushRecord(record ?? null);
        if (!record?.targetTicket) {
          setRetryDraft(record
            ? {
                title: record.draftTitle,
                description: record.draftDescription || "",
                designAssigneeIds: record.designAssigneeIds,
                programAssigneeIds: record.programAssigneeIds,
              }
            : null);
          setPushResolveMode("unbound");
          setCandidateProgramTicket(null);
          setPushedProgramTicket(null);
          setShowProgramTicketForm(false);
          return;
        }

        setPushResolveMode("bound");
        setCandidateProgramTicket(null);
        setPushedProgramTicket(record.targetTicket);
        setRetryDraft({
          title: record.draftTitle,
          description: record.draftDescription || "",
          designAssigneeIds: record.designAssigneeIds,
          programAssigneeIds: record.programAssigneeIds,
        });
        setShowProgramTicketForm(false);
      })
      .catch(() => {
        setPushRecord(null);
        setPushResolveMode("unbound");
        setCandidateProgramTicket(null);
        setPushedProgramTicket(null);
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

  async function resolveProgramPush() {
    if (!ticket) return null;

    const response = await fetch(`/api/tickets/${ticket.ticketNo}/push-record/resolve`);
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error || "推单记录查询失败");
    }

    return (await response.json()) as PushResolveResponse;
  }

  async function openProgramPushForm() {
    if (!ticket) return;
    setPendingDoneConfirm(false);
    setMessage("");

    const completed = await persistStatus("DONE");
    if (!completed) return;

    const nextDraft =
      retryDraft ?? {
        title: ticket.title,
        description: ticket.description || "",
        designAssigneeIds: ticket.assignees.map((user) => user.id),
        programAssigneeIds: [],
      };

    setRetryDraft(nextDraft);

    try {
      const resolved = await resolveProgramPush();
      if (!resolved) return;

      setPushRecord(resolved.record ?? null);
      setPushedProgramTicket(resolved.targetTicket ?? resolved.record?.targetTicket ?? null);
      setCandidateProgramTicket(resolved.candidateTicket ?? null);
      setEditingBoundProgramTicket(false);

      if (resolved.mode === "bound") {
        setPushResolveMode("bound");
        setShowProgramTicketForm(false);
        return;
      }

      if (resolved.mode === "candidate") {
        setPushResolveMode("candidate");
        setShowProgramTicketForm(false);
        return;
      }

      setPushResolveMode("unbound");
      setCandidateProgramTicket(null);
      setShowProgramTicketForm(true);
    } catch (error) {
      setPushResolveMode("unbound");
      setCandidateProgramTicket(null);
      setShowProgramTicketForm(true);
      setMessage(error instanceof Error ? error.message : "推单记录查询失败");
    }
  }

  async function handleBindExistingProgramTicket(targetTicket: PushRecordTargetTicket) {
    if (!ticket) return;

    const draft =
      retryDraft ?? {
        title: ticket.title,
        description: ticket.description || "",
        designAssigneeIds: ticket.assignees.map((user) => user.id),
        programAssigneeIds: [],
      };

    const response = await fetch(`/api/tickets/${ticket.ticketNo}/push-record/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetTicketId: targetTicket.id,
        draftTitle: draft.title,
        draftDescription: draft.description,
        programAssigneeIds: draft.programAssigneeIds,
        designAssigneeIds: draft.designAssigneeIds,
        errorMessage: null,
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ? `绑定程序单失败：${data.error}` : "绑定程序单失败");
      return;
    }

    const data = (await response.json()) as { record: PushRecordSnapshot };
    setPushRecord(data.record);
    setPushResolveMode("bound");
    setCandidateProgramTicket(null);
    setEditingBoundProgramTicket(false);
    setPushedProgramTicket(targetTicket);
    setShowProgramTicketForm(false);
    setMessage(`已绑定程序单 #${targetTicket.ticketNo}`);
  }

  async function handleUpdateBoundProgramTicket(draft: TicketCreateInitialValues) {
    if (!ticket || !pushedProgramTicket) return;

    const title = draft.title?.trim();
    if (!title) {
      setMessage("标题不能为空");
      return;
    }

    const description = draft.description?.trim() ?? "";
    const programAssigneeIds = draft.programAssigneeIds ?? [];
    const designAssigneeIds = draft.designAssigneeIds ?? ticket.assignees.map((user) => user.id);

    const detailResponse = await fetch(`/api/tickets/${pushedProgramTicket.ticketNo}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description,
      }),
    });

    if (!detailResponse.ok) {
      const data = (await detailResponse.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ? `更新程序单失败：${data.error}` : "更新程序单失败");
      return;
    }

    const assigneeResponse = await fetch(`/api/tickets/${pushedProgramTicket.ticketNo}/assignee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeIds: programAssigneeIds }),
    });

    if (!assigneeResponse.ok) {
      const data = (await assigneeResponse.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ? `更新程序指派失败：${data.error}` : "更新程序指派失败");
      return;
    }

    const recordResponse = await fetch(`/api/tickets/${ticket.ticketNo}/push-record/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "SUCCEEDED",
        errorMessage: null,
        draftTitle: title,
        draftDescription: description,
        programAssigneeIds,
        designAssigneeIds,
        targetTicketId: pushedProgramTicket.id,
      }),
    });

    if (!recordResponse.ok) {
      const data = (await recordResponse.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ? `推单记录保存失败：${data.error}` : "推单记录保存失败");
      return;
    }

    const data = (await recordResponse.json()) as { record: PushRecordSnapshot };
    setPushRecord(data.record);
    setRetryDraft({
      title,
      description,
      designAssigneeIds,
      programAssigneeIds,
      moduleId: draft.moduleId,
      newModuleName: draft.newModuleName,
    });
    setPushResolveMode("bound");
    setEditingBoundProgramTicket(false);
    setShowProgramTicketForm(false);
    setMessage(`程序单 #${pushedProgramTicket.ticketNo} 已更新`);
    await loadTicket();
  }

  async function handleProgramTicketCreated(payload: {
    ticket: { id: string; ticketNo: number; title: string };
    programAssigneeIds: string[];
    designAssigneeIds: string[];
    title: string;
    description: string;
    moduleId?: string;
    newModuleName?: string;
  }) {
    if (!ticket) return;

    const response = await fetch(`/api/tickets/${ticket.ticketNo}/push-record/update`, {
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

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setMessage(data?.error ? `绑定程序单失败：${data.error}` : "绑定程序单失败");
      return;
    }

    const nextRecord: PushRecordSnapshot = {
      status: "SUCCEEDED",
      errorMessage: null,
      draftTitle: payload.title,
      draftDescription: payload.description,
      programAssigneeIds: payload.programAssigneeIds,
      designAssigneeIds: payload.designAssigneeIds,
      targetTicket: payload.ticket,
    };

    setPushRecord(nextRecord);
    setPushedProgramTicket(payload.ticket);
    setPushResolveMode("bound");
    setRetryDraft({
      title: payload.title,
      description: payload.description,
      designAssigneeIds: payload.designAssigneeIds,
      programAssigneeIds: payload.programAssigneeIds,
      moduleId: payload.moduleId,
      newModuleName: payload.newModuleName,
    });
    setShowProgramTicketForm(false);
    setMessage(`程序新单 #${payload.ticket.ticketNo} 已创建并绑定`);
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

    await fetch(`/api/tickets/${ticket.ticketNo}/push-record/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "PENDING",
        errorMessage: null,
        draftTitle: safeDraft.title,
        draftDescription: safeDraft.description,
        programAssigneeIds: safeDraft.programAssigneeIds,
        designAssigneeIds: safeDraft.designAssigneeIds,
        targetTicketId: null,
      }),
    });

    setRetryDraft(safeDraft);
    setPushRecord({
      status: "PENDING",
      errorMessage: null,
      draftTitle: safeDraft.title,
      draftDescription: safeDraft.description,
      programAssigneeIds: safeDraft.programAssigneeIds,
      designAssigneeIds: safeDraft.designAssigneeIds,
      targetTicket: null,
    });
    setPushResolveMode("unbound");
    setShowProgramTicketForm(false);
    setMessage(errorMessage);
  }

  function reopenProgramPushForm() {
    if (pushResolveMode === "candidate") return;
    if (pushedProgramTicket) {
      setEditingBoundProgramTicket(true);
    }
    setShowProgramTicketForm(true);
    setPushResolveMode(pushedProgramTicket ? "bound" : "unbound");
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
    if (!ticket || (ticket.creatorId !== session?.user?.id && !isRoot) || ticket.status !== "DONE") return null;

    const draft = retryDraft ?? programPushDraft;
    if (!draft) return null;

    const summaryDescription = pushedProgramTicket
      ? `已绑定程序单 #${pushedProgramTicket.ticketNo}，后续推单操作都将在这张单上继续。`
      : candidateProgramTicket
        ? `程序目录下已找到程序单 #${candidateProgramTicket.ticketNo}，可直接绑定。`
        : "当前还没有绑定程序单，可创建并绑定到该设计单。";

    return (
      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">推单绑定</h2>
            <p className="mt-1 text-sm text-ink-400">{summaryDescription}</p>
          </div>
          {pushedProgramTicket ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-600">
              已绑定 #{pushedProgramTicket.ticketNo}
            </span>
          ) : candidateProgramTicket ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-warning">
              待绑定
            </span>
          ) : null}
        </div>

        {pushResolveMode === "candidate" && candidateProgramTicket ? (
          <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <p className="text-sm text-ink-700">
              检索到程序目录下已有单子 #{candidateProgramTicket.ticketNo}，可直接绑定到当前设计单。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleBindExistingProgramTicket(candidateProgramTicket)}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                绑定 #${candidateProgramTicket.ticketNo}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCandidateProgramTicket(null);
                  setPushResolveMode("unbound");
                  setShowProgramTicketForm(true);
                }}
                className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:bg-ink-100"
              >
                创建新程序单
              </button>
            </div>
          </div>
        ) : showProgramTicketForm && programResponsibility ? (
          <div className="space-y-4">
            {pushedProgramTicket ? (
              <div className="rounded-xl border border-brand-100 bg-brand-50/50 px-4 py-3 text-sm text-ink-700">
                当前正在更新已绑定程序单 #{pushedProgramTicket.ticketNo}。
              </div>
            ) : null}
            <TicketCreateForm
              projectId={ticket.project.id}
              responsibility={programResponsibility}
              users={users}
              currentUserId={session?.user?.id}
              showDesignAssignees
              editableDesignAssignees
              initialValues={draft}
              submitLabel={pushedProgramTicket ? "更新程序单" : "创建并绑定程序单"}
              submitMode={pushedProgramTicket ? "edit" : "create"}
              onMessage={setMessage}
              onCreated={pushedProgramTicket ? handleUpdateBoundProgramTicket : handleProgramTicketCreated}
              onCancel={() => {
                setShowProgramTicketForm(false);
                setEditingBoundProgramTicket(false);
              }}
              onCreateFailed={handleProgramTicketCreateFailed}
              className="grid gap-3 rounded-xl border border-ink-100 bg-ink-100/40 p-4"
            />
          </div>
        ) : pushedProgramTicket ? (
          <div className="space-y-4 rounded-xl border border-ink-100 bg-ink-50 p-4">
            <div className="space-y-2 text-sm text-ink-600">
              <p>
                <span className="font-medium text-ink-800">已绑定程序单：</span>#
                {pushedProgramTicket.ticketNo}
              </p>
              <p>
                <span className="font-medium text-ink-800">标题：</span>
                {pushRecord?.draftTitle || pushedProgramTicket.title}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/${pushedProgramTicket.ticketNo}`}
                className="inline-flex rounded-lg px-3 py-2 text-sm font-medium text-brand-600 hover:text-brand-700"
              >
                查看程序单
              </Link>
              <button
                type="button"
                onClick={reopenProgramPushForm}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                在原单上继续推单
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openProgramPushForm}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              检索或创建推单
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
