"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useSession } from "next-auth/react";
import { ImageLightbox } from "@/shared/ui/ImageLightbox";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
import { AssigneePicker } from "@/shared/ui/AssigneePicker";
import { formatAssigneeList } from "@/entities/ticket/lib/ticket-assignees";
import { composeImageMarkdown, extractInlineImages } from "@/shared/lib/pkm";
import { IconArrowLeft, IconClock, IconEdit } from "@/shared/ui/icons";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";
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
} from "@/entities/ticket/model/types";
import { DesignTicketDetail } from "./DesignTicketDetail";
import { ProgramTicketDetail } from "./ProgramTicketDetail";
import { BugTicketDetail } from "./BugTicketDetail";

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
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  // Data layer — all SWR
  const { data: ticketData, isLoading: ticketLoading, mutate: refreshTicket } = useSWR<{ ticket: Ticket }>(
    `/api/tickets/${ticketId}`,
    fetchJson,
    STALE_SWR_OPTIONS,
  );
  const { data: usersData } = useSWR<{ users: TicketCreateUser[] }>(
    isRoot ? "/api/users" : null,
    fetchJson,
    STALE_SWR_OPTIONS,
  );
  const ticket = ticketData?.ticket ?? null;

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
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDescriptionImages, setEditDescriptionImages] = useState<{ src: string; name: string }[]>([]);
  const [localStatus, setLocalStatus] = useState<TicketStatus | null>(null);
  const [localAssigneeIds, setLocalAssigneeIds] = useState<string[]>([]);
  const [localModuleId, setLocalModuleId] = useState<string>("");
  const [programShowBugPushModal, setProgramShowBugPushModal] = useState(false);

  // Sync local edit state when ticket loads
  useEffect(() => {
    if (!ticket) return;
    setLocalStatus(ticket.status);
    setLocalAssigneeIds(ticket.assignees.map((a) => a.id));
    setLocalModuleId(ticket.module.id);
  }, [ticket]);

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

  async function saveTicketDetails() {
    setMessage("");
    if (!ticket) return;
    const { content } = composeImageMarkdown(editDescriptionImages, editDescription);
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle, description: content }),
    });
    if (!res.ok) {
      setMessage("保存失败");
      return;
    }
    setMessage("详情已保存");
    setIsEditing(false);
    await refreshTicket();
  }

  async function updateModule() {
    setMessage("");
    if (!ticket) return;
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleId: localModuleId }),
    });
    if (!res.ok) {
      setMessage("移动模块失败");
      return;
    }
    setMessage("模块已移动");
    await refreshTicket();
  }

  async function updateAssignee() {
    setMessage("");
    if (!ticket) return;
    const res = await fetch(`/api/tickets/${ticket.id}/assignee`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeIds: localAssigneeIds }),
    });
    if (!res.ok) {
      setMessage("指派人保存失败");
      return;
    }
    setMessage("指派人已更新");
    await refreshTicket();
  }

  async function updateStatus() {
    setMessage("");
    if (!ticket || !localStatus) return;

    if (isProgramTicket && localStatus === "DELIVERED" && programBugRelations.length === 0) {
      setProgramShowBugPushModal(true);
      return;
    }

    const res = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: localStatus }),
    });
    if (!res.ok) {
      setMessage("状态保存失败");
      return;
    }
    setMessage("状态已保存");
    await refreshTicket();
  }

  function openPreview(img: { src: string; name: string }) {
    isLightboxOpenRef.current = true;
    setPreviewImage(img);
  }

  function closePreview() {
    setPreviewImage(null);
    setTimeout(() => { isLightboxOpenRef.current = false; }, 0);
  }

  function insertDescriptionImage(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (src) setEditDescriptionImages((prev) => [...prev, { src, name: file.name }]);
    };
    reader.readAsDataURL(file);
  }

  function removeDescriptionImage(index: number) {
    setEditDescriptionImages((prev) => prev.filter((_, i) => i !== index));
  }

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
                    <span className={`mb-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[ticket.status]}`}>
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

                {canEdit && isEditing && (
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={saveTicketDetails} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
                    >
                      取消
                    </button>
                  </div>
                )}
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

            {/* Right sidebar */}
            <div className="space-y-5">
              <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                <h2 className="mb-3 font-medium">状态</h2>
                <div className="mb-3 flex items-center gap-2">
                  <select
                    value={localStatus ?? ticket.status}
                    onChange={(e) => setLocalStatus(e.target.value as TicketStatus)}
                    className="flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                  >
                    {allowedStatuses.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                  <button type="button" onClick={updateStatus} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    保存
                  </button>
                </div>
                <div className="space-y-2">
                  {ticket.statusHistory.length === 0 ? (
                    <p className="text-xs text-ink-400">暂无状态变更记录</p>
                  ) : (
                    ticket.statusHistory.slice(0, 5).map((item) => (
                      <div key={item.id} className="flex items-start gap-2 text-xs text-ink-500">
                        <IconClock className="mt-0.5 h-3.5 w-3.5 text-ink-300" />
                        <div>
                          <p><span className="font-medium text-ink-700">{STATUS_LABEL[item.status]}</span> · {item.changedBy.name || item.changedBy.email}</p>
                          <p className="text-ink-400">{new Date(item.createdAt).toLocaleString()}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                <h2 className="mb-3 font-medium">参与人员</h2>
                <div className="mb-3 flex flex-wrap gap-2">
                  {ticket.assignees.length === 0 ? (
                    <span className="text-sm text-ink-400">未指派</span>
                  ) : (
                    ticket.assignees.map((u) => (
                      <span key={u.id} className="flex items-center gap-1.5 rounded-full bg-ink-100 py-1 pl-1 pr-2.5 text-xs">
                        <Avatar name={u.name} />
                        {u.name || u.email}
                      </span>
                    ))
                  )}
                </div>
                {isRoot && (
                  <div className="space-y-3">
                    <AssigneePicker users={users} value={localAssigneeIds} onChange={setLocalAssigneeIds} />
                    <button type="button" onClick={updateAssignee} className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                      保存指派
                    </button>
                  </div>
                )}
                {ticket.assigneeHistory.length > 0 && (
                  <div className="mt-4 border-t border-ink-100 pt-3">
                    <h3 className="mb-2 text-xs font-medium text-ink-500">指派历史</h3>
                    <div className="space-y-2">
                      {ticket.assigneeHistory.slice(0, 4).map((item) => (
                        <div key={item.id} className="text-xs text-ink-500">
                          <p className="text-ink-700">{formatAssigneeList(item.assignees)}</p>
                          <p className="text-ink-400">{item.changedBy.name || item.changedBy.email} · {new Date(item.createdAt).toLocaleString()}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {isRoot && (
                <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
                  <h2 className="mb-3 font-medium">移动到其他模块</h2>
                  <div className="flex items-center gap-2">
                    <select
                      value={localModuleId}
                      onChange={(e) => setLocalModuleId(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                    >
                      {modules.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={updateModule} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                      移动
                    </button>
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </>
  );
}
