"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ImageLightbox } from "@/shared/ui/ImageLightbox";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { AssigneePicker } from "@/shared/ui/AssigneePicker";
import { DocumentPreviewModal, type PreviewableFile } from "@/shared/ui/DocumentPreviewModal";
import { formatAssigneeList } from "@/entities/ticket/lib/ticket-assignees";
import { composeImageMarkdown, extractInlineImages } from "@/shared/lib/pkm";
import { uploadFile } from "@/shared/lib/upload";
import { IconArrowLeft, IconClock, IconEdit, IconTrash, IconMenu } from "@/shared/ui/icons";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
import { getMyResponsibilitiesAction } from "@/features/admin/admin";
import { ModerationAction, ResponsibilityKind } from "@prisma/client";
import {
  type Ticket,
  type TicketStatus,
  type TicketCreateUser,
  type TicketCreateResponsibility,
  type ProgramPushDraft,
  type BugRelation,
  KIND_LABEL,
  STATUS_LABEL,
  STATUS_STYLE,
  PRIORITY_LABEL,
  PRIORITY_STYLE,
} from "@/entities/ticket/model/types";
import { DesignTicketDetail } from "./DesignTicketDetail";
import { ProgramTicketDetail } from "./ProgramTicketDetail";
import { BugTicketDetail } from "./BugTicketDetail";
import { TicketCommentsPanel } from "./TicketCommentsPanel";

type ModerationLogEntry = {
  id: string;
  action: string;
  reason: string | null;
  createdAt: Date;
  actor: { id: string; name: string | null; email: string };
};

type EnrichedHistoryEntry =
  | { type: "status"; status: TicketStatus; changedBy: { name: string | null; email: string }; createdAt: Date }
  | { type: "assignee"; assignees: { name: string | null; email: string }[]; changedBy: { name: string | null; email: string }; createdAt: Date }
  | { type: "priority"; priority: number; changedBy: { name: string | null; email: string }; createdAt: Date }
  | { type: "module"; from: string; to: string; changedBy: { name: string | null; email: string }; createdAt: Date }
  | { type: "created"; changedBy: { name: string | null; email: string }; createdAt: Date };

// ==================== Loading Skeleton ====================

export function TicketDetailHeaderSkeleton() {
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
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-ink-100" />
              ))}
            </div>
          </section>
          <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
            <div className="h-5 w-28 animate-pulse rounded bg-ink-200" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-ink-100" />
              ))}
            </div>
          </section>
        </div>
        <div className="space-y-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <section key={i} className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
              <div className="h-4 w-24 animate-pulse rounded bg-ink-200" />
              <div className="mt-4 space-y-3">
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

export function TicketDetailLoading() {
  return <TicketDetailContentSkeleton />;
}

// ==================== Avatar ====================

function Avatar({ name }: { name?: string | null }) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
      {initial}
    </span>
  );
}

// ==================== Main Component ====================

export function TicketDetail({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  // Data layer — all SWR
  const { data: ticketData, isLoading: ticketLoading, mutate: refreshTicket } = useSWR<{
    ticket: Ticket & { moderationLogs?: ModerationLogEntry[] };
  }>(
    `/api/tickets/${ticketId}`,
    fetchJson,
    STALE_SWR_OPTIONS,
  );
  const ticket = ticketData?.ticket ?? null;

  // Responsibilities state — declared early so SWR key can reference it
  const [userResps, setUserResps] = useState<ResponsibilityKind[]>([]);

  const { data: usersData } = useSWR<{ users: TicketCreateUser[] }>(
    ticket?.module.responsibility.kind
      ? (isRoot || userResps.includes(ticket.module.responsibility.kind as ResponsibilityKind))
          ? "/api/users"
          : null
      : null,
    fetchJson,
    STALE_SWR_OPTIONS,
  );

  // Derive kind flags from ticket
  const isDesignTicket = ticket?.module.responsibility.kind === "DESIGN";
  const isProgramTicket = ticket?.module.responsibility.kind === "PROGRAM";
  const isBugTicket = ticket?.module.responsibility.kind === "BUG";

  // Bug relations for program tickets (conditional SWR key)
  const { data: bugRelationsData, mutate: refreshBugRelations } = useSWR<{ bindings: BugRelation[] }>(
    isProgramTicket && ticket ? `/api/tickets/${ticket.ticketNo}/bug-relations` : null,
    fetchJson,
    STALE_SWR_OPTIONS,
  );

  // Sync commits on mount (fire-and-forget, then refresh ticket)
  useEffect(() => {
    if (!ticket) return;
    fetch("/api/sync-commits", { method: "POST" }).then(() => refreshTicket());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  // UI state — only these remain as useState
  const [message, setMessage] = useState("");
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const isLightboxOpenRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const ticketAttachmentInputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ fileId: string; name: string; mimeType: string; size: number; sourceType: string; sourceId: string }>>([]);
  const [kebabOpen, setKebabOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDescriptionImages, setEditDescriptionImages] = useState<{ src: string; name: string }[]>([]);
  const [localStatus, setLocalStatus] = useState<TicketStatus | null>(null);
  const [localAssigneeIds, setLocalAssigneeIds] = useState<string[]>([]);
  const [localModuleId, setLocalModuleId] = useState<string>("");
  const [localPriority, setLocalPriority] = useState<number>(2);
  const [programShowBugPushModal, setProgramShowBugPushModal] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  // Sync ticket-level attachments (sourceType: TICKET) into local state
  useEffect(() => {
    if (!ticket?.allAttachments) return;
    setAttachments([...ticket.allAttachments].filter((a) => a.sourceType === "TICKET"));
  }, [ticket?.allAttachments]);

  // Sync local edit state when ticket loads
  useEffect(() => {
    if (!ticket) return;
    setLocalStatus(ticket.status);
    setLocalAssigneeIds(ticket.assignees.map((a) => a.id));
    setLocalModuleId(ticket.module.id);
    setLocalPriority(ticket.priority ?? 2);
  }, [ticket]);

  // Load current user's responsibilities
  useEffect(() => {
    getMyResponsibilitiesAction()
      .then((r) => setUserResps(r.kinds))
      .catch(() => {});
  }, []);

  // Populate edit fields when entering edit mode
  useEffect(() => {
    if (!isEditing || !ticket) return;
    const { plainContent, images } = extractInlineImages(ticket.description || "");
    setEditTitle(ticket.title);
    setEditDescription(plainContent);
    setEditDescriptionImages(images);
  }, [isEditing, ticket]);

  const users = usersData?.users ?? [];
  const programBugRelations = bugRelationsData?.bindings ?? [];

  const allowedStatuses = useMemo((): TicketStatus[] => {
    if (!ticket) return [];
    const kind = ticket.module.responsibility.kind;
    if (kind === "DESIGN") {
      return isRoot ? ["DEVELOPING", "DELIVERED", "DONE"] : ["DEVELOPING", "DELIVERED"];
    }
    if (kind === "BUG") {
      return isRoot
        ? ["DEVELOPING", "READY_FOR_TEST", "DELIVERED", "DONE"]
        : ["DEVELOPING", "READY_FOR_TEST", "DELIVERED"];
    }
    return isRoot
      ? ["DEVELOPING", "READY_FOR_TEST", "DELIVERED", "DONE"]
      : ["DEVELOPING", "READY_FOR_TEST", "DELIVERED"];
  }, [ticket, isRoot]);

  const programResponsibility = useMemo((): TicketCreateResponsibility | null => {
    if (!ticket) return null;
    return (ticket.project.responsibilities.find((r) => r.kind === "PROGRAM") as TicketCreateResponsibility | undefined) ?? null;
  }, [ticket]);

  const programPushDraft = useMemo((): ProgramPushDraft | null => {
    if (!ticket) return null;
    return {
      title: ticket.title,
      description: ticket.description || "",
      designAssigneeIds: ticket.assignees.map((u) => u.id),
      programAssigneeIds: [],
      moduleId: ticket.module.id,
    };
  }, [ticket]);

  const modules = useMemo(() => {
    if (!ticket) return [];
    return ticket.project.responsibilities.flatMap((r) => r.modules);
  }, [ticket]);

  const isAssignee = ticket?.assignees.some((a) => a.id === session?.user?.id) ?? false;
  const canEdit = isRoot || isAssignee;

  // ---- Mutation helpers ----

  async function saveAll() {
    setMessage("");
    if (!ticket) return;
    const { content } = composeImageMarkdown(editDescriptionImages, editDescription);
    const body: Record<string, unknown> = {};
    if (editTitle !== ticket.title) body.title = editTitle;
    if (content !== (ticket.description ?? "")) body.description = content;
    if (localStatus !== ticket.status) body.status = localStatus;
    if (localPriority !== ticket.priority) body.priority = localPriority;
    if (localModuleId !== ticket.module.id) body.moduleId = localModuleId;
    const currentAssigneeIds = ticket.assignees.map((a) => a.id).sort();
    const nextAssigneeIds = [...localAssigneeIds].sort();
    if (JSON.stringify(currentAssigneeIds) !== JSON.stringify(nextAssigneeIds)) {
      body.assigneeIds = localAssigneeIds;
    }

    if (Object.keys(body).length === 0) {
      setIsEditing(false);
      return;
    }

    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      setMessage(data.error ?? "保存失败");
      return;
    }
    setMessage("已保存");
    setIsEditing(false);
    await refreshTicket();
  }

  function cancelEdit() {
    setIsEditing(false);
    if (!ticket) return;
    setLocalStatus(ticket.status);
    setLocalAssigneeIds(ticket.assignees.map((a) => a.id));
    setLocalModuleId(ticket.module.id);
    setLocalPriority(ticket.priority ?? 2);
    const { plainContent, images } = extractInlineImages(ticket.description || "");
    setEditTitle(ticket.title);
    setEditDescription(plainContent);
    setEditDescriptionImages(images);
  }

  async function deleteTicket() {
    if (!ticket) return;
    if (!window.confirm(`确定删除单子 #${ticket.ticketNo} 吗？`)) return;
    setMessage("");
    const res = await fetch(`/api/tickets/${ticket.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMessage("删除失败");
      return;
    }
    router.push("/tasks");
  }

  function openPreview(img: { src: string; name: string }) {
    isLightboxOpenRef.current = true;
    setPreviewImage(img);
  }

  function closePreview() {
    setPreviewImage(null);
    setTimeout(() => { isLightboxOpenRef.current = false; }, 0);
  }

  async function insertDescriptionImage(file: File) {
    try {
      const { url: relUrl } = await uploadFile(file);
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const absoluteUrl = origin ? `${origin}${relUrl}` : relUrl;
      setEditDescriptionImages((prev) => [...prev, { src: absoluteUrl, name: file.name }]);
    } catch {
      // 静默失败：编辑面板暂不弹错，避免干扰主流程
    }
  }

  function removeDescriptionImage(index: number) {
    setEditDescriptionImages((prev) => prev.filter((_, i) => i !== index));
  }

  // Upload a file as a ticket-level attachment (sourceType: TICKET)
  async function uploadTicketAttachment(file: File) {
    try {
      const result = await uploadFile(file);
      const att = {
        fileId: result.fileId,
        name: result.name,
        mimeType: result.mimeType,
        size: result.size,
        sourceType: "TICKET" as const,
        sourceId: ticket?.id ?? "",
      };
      setAttachments((prev) => [...prev, att]);
      // Persist to backend
      await fetch(`/api/tickets/${ticketId}/attachments`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "add", attachment: att }),
      });
    } catch (err) {
      console.error("Failed to upload ticket attachment:", err);
    }
  }

  // Build merged activity log (time-descending)
  const activityLog = useMemo<EnrichedHistoryEntry[]>(() => {
    if (!ticket) return [];
    const entries: EnrichedHistoryEntry[] = [];

    // Creation — use actual ticket.createdAt and creator, not current time or session user
    const creatorName = ticket.creator?.name ?? ticket.creator?.email?.split("@")[0] ?? null;
    const creatorEmail = ticket.creator?.email ?? "";
    entries.push({
      type: "created",
      changedBy: { name: creatorName, email: creatorEmail },
      createdAt: new Date(ticket.createdAt),
    });

    // Status history
    for (const item of ticket.statusHistory ?? []) {
      entries.push({
        type: "status",
        status: item.status,
        changedBy: item.changedBy,
        createdAt: new Date(item.createdAt),
      });
    }

    // Assignee history
    for (const item of ticket.assigneeHistory ?? []) {
      entries.push({
        type: "assignee",
        assignees: item.assignees,
        changedBy: item.changedBy,
        createdAt: new Date(item.createdAt),
      });
    }

    // Moderation logs: priority + module changes
    const logs = (ticket as Ticket & { moderationLogs?: ModerationLogEntry[] }).moderationLogs ?? [];
    for (const log of logs) {
      if (log.action === ModerationAction.EDIT_TICKET && log.reason?.startsWith("优先级变更为 P")) {
        const p = parseInt(log.reason.replace("优先级变更为 P", ""), 10);
        if (!isNaN(p)) {
          entries.push({
            type: "priority",
            priority: p,
            changedBy: log.actor,
            createdAt: new Date(log.createdAt),
          });
        }
      } else if (log.action === ModerationAction.CHANGE_TICKET_MODULE) {
        const match = log.reason?.match(/从模块 (.+?) 到 (.+)/);
        if (match) {
          entries.push({
            type: "module",
            from: match[1],
            to: match[2],
            changedBy: log.actor,
            createdAt: new Date(log.createdAt),
          });
        }
      }
    }

    return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [ticket]);

  if (ticketLoading) return <TicketDetailLoading />;

  if (!ticket) {
    return (
      <div className="pm-fade-in p-6">
        <Link href="/tasks" className="inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900">
          <IconArrowLeft className="h-4 w-4" /> 返回任务列表
        </Link>
        <p className="mt-6 rounded-xl border border-dashed border-ink-200 bg-white p-12 text-center text-ink-400">
          单子不存在
        </p>
      </div>
    );
  }

  return (
    <>
      {previewImage && (
        <ImageLightbox
          image={previewImage}
          onClose={closePreview}
          onDownload={() => {
            const a = document.createElement("a");
            a.href = previewImage.src;
            a.download = previewImage.name || "image";
            a.click();
          }}
        />
      )}
      {previewFile && (
        <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      <div className="space-y-5 pm-fade-in">
          {message && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
          )}

          <div className="grid gap-5 lg:grid-cols-3">
            {/* Main area */}
            <div className="space-y-5 lg:col-span-2">
              <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                      {/* 优先级 */}
                      <span className="inline-flex items-center gap-1 text-ink-500">
                        <span className={`rounded px-1.5 py-0.5 font-semibold ${
                          ticket.priority === 0 ? "bg-red-100 text-red-700" :
                          ticket.priority === 1 ? "bg-amber-100 text-amber-700" :
                          ticket.priority === 2 ? "bg-brand-50 text-brand-700" :
                          "bg-ink-100 text-ink-600"
                        }`}>
                          {PRIORITY_LABEL[ticket.priority as 0 | 1 | 2 | 3]}
                        </span>
                      </span>
                      {/* 状态 */}
                      <span className="inline-flex items-center gap-1">
                        <span className={`rounded-full px-2.5 py-0.5 font-medium ${STATUS_STYLE[ticket.status]}`}>
                          {STATUS_LABEL[ticket.status]}
                        </span>
                      </span>
                      {/* 指派人 */}
                      {ticket.assignees.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-ink-500">
                          {ticket.assignees.length > 3 ? (
                            <span className="text-ink-400">+{ticket.assignees.length - 3}</span>
                          ) : (
                            <span className="text-ink-700">{ticket.assignees.map((a) => a.name || a.email.split("@")[0]).join("、")}</span>
                          )}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-ink-400">
                          <span>指派</span>
                          <span>未指派</span>
                        </span>
                      )}
                      {/* 模块 */}
                      <span className="inline-flex items-center gap-1 text-ink-500">
                        <span className="text-ink-700">{ticket.module.name}</span>
                      </span>
                    </div>
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
                  <div className="flex shrink-0 items-center gap-2">
                    {isEditing ? (
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
                      >
                        取消
                      </button>
                    ) : (
                      <>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setIsEditing(true)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
                          >
                            <IconEdit className="h-4 w-4" /> 编辑
                          </button>
                        )}
                        {isRoot && !isEditing && (
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setKebabOpen((v) => !v)}
                              className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 text-ink-500 hover:bg-ink-100"
                            >
                              <IconMenu className="h-4 w-4" />
                            </button>
                            {kebabOpen && (
                              <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
                                <button
                                  type="button"
                                  onClick={() => { setKebabOpen(false); deleteTicket(); }}
                                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger hover:bg-ink-50"
                                >
                                  <IconTrash className="h-4 w-4" /> 删除单子
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  {isEditing ? (
                    <div className="rounded-lg border border-ink-200 bg-white">
                      {editDescriptionImages.length > 0 && (
                        <div className="flex flex-wrap gap-2 border-b border-ink-200 p-3">
                          {editDescriptionImages.map((img, index) => (
                            <div key={index} className="group relative">
                              <img
                                src={img.src}
                                alt={img.name}
                                className="max-h-28 cursor-pointer rounded-lg border border-ink-200 object-contain hover:ring-2 hover:ring-brand-400"
                                onClick={() => openPreview(img)}
                              />
                              <button
                                type="button"
                                onClick={() => removeDescriptionImage(index)}
                                className="absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-danger group-hover:flex"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 px-3 pt-2">
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" /></svg>
                          上传图片
                        </button>
                      </div>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = e.target.files;
                          if (!files) return;
                          for (const file of files) {
                            insertDescriptionImage(file);
                          }
                          e.target.value = "";
                        }}
                      />
                      <textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        onPaste={(e) => {
                          for (const item of e.clipboardData.items) {
                            if (item.type.startsWith("image/")) {
                              e.preventDefault();
                              const file = item.getAsFile();
                              if (file) insertDescriptionImage(file);
                              return;
                            }
                          }
                        }}
                        rows={6}
                        className="w-full px-3 py-2 font-mono text-sm outline-none placeholder:text-ink-400"
                        placeholder="添加描述（Markdown）..."
                        style={{ minHeight: "140px", resize: "vertical" }}
                      />
                    </div>
                  ) : ticket.description ? (
                    <MarkdownContent content={ticket.description} collapsible collapsedHeight={240} />
                  ) : (
                    <p className="text-sm text-ink-400">暂无描述</p>
                  )}
                </div>

                {/* Editing fields — priority / status / assignee / module */}
                {isEditing && (
                  <div className="mt-5 space-y-4 rounded-lg border border-ink-100 bg-ink-50 p-4">
                    {/* Priority */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-600">优先级</label>
                      <div className="flex gap-1">
                        {([0, 1, 2, 3] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setLocalPriority(p)}
                            className={`rounded border px-2.5 py-1 text-xs font-semibold transition-colors ${
                              localPriority === p
                                ? p === 0
                                  ? "border-red-300 bg-red-100 text-red-700"
                                  : p === 1
                                    ? "border-amber-300 bg-amber-100 text-amber-700"
                                    : p === 2
                                      ? "border-brand-300 bg-brand-50 text-brand-700"
                                      : "border-ink-300 bg-ink-100 text-ink-600"
                                : "border-ink-200 bg-white text-ink-500 hover:bg-ink-50"
                            }`}
                          >
                            {PRIORITY_LABEL[p]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Status */}
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-ink-600">状态</label>
                      <select
                        value={localStatus ?? ticket.status}
                        onChange={(e) => setLocalStatus(e.target.value as TicketStatus)}
                        className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      >
                        {allowedStatuses.map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </div>

                    {/* Assignees */}
                    {(isRoot || userResps.includes(ticket.module.responsibility.kind as ResponsibilityKind)) && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-ink-600">参与人员</label>
                        <AssigneePicker users={users} value={localAssigneeIds} onChange={setLocalAssigneeIds} />
                      </div>
                    )}

                    {/* Module (ROOT only) */}
                    {isRoot && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-ink-600">模块</label>
                        <select
                          value={localModuleId}
                          onChange={(e) => setLocalModuleId(e.target.value)}
                          className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                        >
                          {modules.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {canEdit && isEditing && (
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={saveAll} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
                    >
                      取消
                    </button>
                  </div>
                )}

                {/* Attachments section — ticket + comment attachments, with inline upload */}
                <div className="mt-5 border-t border-ink-100 pt-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-medium text-ink-700">
                      附件 <span className="font-normal text-ink-400">
                        ({attachments.length})
                      </span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => ticketAttachmentInputRef.current?.click()}
                      className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                    >
                      + 上传附件
                    </button>
                    <input
                      ref={ticketAttachmentInputRef}
                      type="file"
                      accept="*/*"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = e.target.files;
                        if (!files) return;
                        for (const file of Array.from(files)) {
                          await uploadTicketAttachment(file);
                        }
                        e.currentTarget.value = "";
                      }}
                    />
                  </div>
                  {attachments.length === 0 ? (
                    <p className="text-xs text-ink-400">暂无附件</p>
                  ) : (
                    <ul className="space-y-2">
                      {attachments.map((att) => {
                        const mimeType = att.mimeType ?? "application/octet-stream";
                        const isImage = mimeType.startsWith("image/");
                        const canPreview = isImage || mimeType === "application/pdf" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "text/markdown";
                        const fileUrl = `/api/upload/${att.fileId}`;
                        const attSize = att.size ?? 0;
                        const sizeLabel =
                          attSize < 1024
                            ? `${attSize} B`
                            : attSize < 1024 * 1024
                            ? `${(attSize / 1024).toFixed(1)} KB`
                            : `${(attSize / 1024 / 1024).toFixed(1)} MB`;
                        const sourceLabel =
                          att.sourceType === "TICKET" ? "工单附件" : "评论附件";
                        return (
                          <li
                            key={att.fileId}
                            className="flex items-center gap-3 rounded-lg border border-ink-100 bg-ink-50 px-3 py-2"
                          >
                            {isImage ? (
                              <button
                                type="button"
                                onClick={() => setPreviewImage({ src: fileUrl, name: att.name || "image" })}
                                className="shrink-0"
                              >
                                <img
                                  src={fileUrl}
                                  alt={att.name}
                                  className="h-8 w-8 shrink-0 rounded object-cover hover:ring-2 hover:ring-brand-400"
                                />
                              </button>
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-ink-200">
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  className="text-ink-500"
                                >
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14,2 14,8 20,8" />
                                </svg>
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink-800">{att.name}</p>
                              <p className="text-xs text-ink-400">
                                {sizeLabel} · {sourceLabel}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {canPreview && (
                                <button
                                  type="button"
                                  onClick={() => setPreviewFile({ name: att.name || "document", url: fileUrl, mimeType })}
                                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-xs text-ink-600 hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700"
                                >
                                  预览
                                </button>
                              )}
                              <a
                                href={fileUrl}
                                download={att.name}
                                className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-100"
                              >
                                下载
                              </a>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </section>

              {/* Kind-specific detail cards */}
              {isDesignTicket && (
                <DesignTicketDetail
                  ticket={ticket}
                  users={users}
                  isRoot={!!isRoot}
                  programResponsibility={programResponsibility}
                  programPushDraft={programPushDraft}
                  onMessage={setMessage}
                />
              )}
              {isProgramTicket && (
                <ProgramTicketDetail
                  ticket={ticket}
                  users={users}
                  programResponsibility={programResponsibility}
                  onMessage={setMessage}
                  showBugPushModal={programShowBugPushModal}
                  onDismissBugPushModal={() => setProgramShowBugPushModal(false)}
                  onBugPushSuccess={refreshTicket}
                />
              )}
              {isBugTicket && (
                <BugTicketDetail
                  ticketId={ticketId}
                  ticket={ticket}
                  onMessage={setMessage}
                />
              )}
            </div>

            {/* Right sidebar — Activity log */}
            <div className="space-y-5">
              <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                <h2 className="mb-3 flex items-center gap-1.5 font-medium">
                  <IconClock className="h-4 w-4 text-ink-400" />
                  操作记录
                </h2>
                <div className="space-y-3">
                  {activityLog.length === 0 ? (
                    <p className="text-xs text-ink-400">暂无操作记录</p>
                  ) : (
                    activityLog.map((entry, idx) => {
                      const actorName = entry.changedBy.name || entry.changedBy.email || "系统";
                      const timeStr = entry.createdAt.toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      let summary = "";
                      if (entry.type === "created") {
                        summary = "创建单子";
                      } else if (entry.type === "status") {
                        summary = `变更状态为「${STATUS_LABEL[entry.status]}」`;
                      } else if (entry.type === "assignee") {
                        summary = `变更指派为「${formatAssigneeList(entry.assignees.map(a => ({ ...a, role: "USER" })))}」`;
                      } else if (entry.type === "priority") {
                        summary = `变更优先级为 P${entry.priority}`;
                      } else if (entry.type === "module") {
                        summary = `移动模块从「${entry.from}」到「${entry.to}」`;
                      }
                      return (
                        <div key={idx} className="flex items-start gap-2 text-xs text-ink-500">
                          <IconClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" />
                          <div>
                            <p className="text-ink-700">{summary}</p>
                            <p className="text-ink-400">{actorName} · {timeStr}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
              <TicketCommentsPanel
                ticketId={ticket.id}
                ticketNumericId={ticket.ticketNo.toString()}
              />
            </div>
          </div>
        </div>
      </>
  );
}
