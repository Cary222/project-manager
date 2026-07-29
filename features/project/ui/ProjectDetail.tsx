"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { IconSearch, IconSettings, IconTask, IconTeam, IconEdit, IconMenu, IconRepo, IconBook } from "@/shared/ui/icons";
import { BackLink, SimplePageHeader, HeaderSkeleton } from "@/shared/ui/headers";
import { type FileAttachment } from "@/features/knowledge/lib/pkm";
import { AttachmentItem, type PreviewableFile } from "@/shared/ui/AttachmentItem";
import { PriorityBadge } from "@/shared/ui/PriorityBadge";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";
import { uploadProjectFile } from "@/features/knowledge/lib/upload";
import { FileUploader } from "@/features/project/ui/FileUploader";
import { DispatchProjectDetail } from "@/features/dispatch/ui/DispatchProjectDetail";
import { useToast } from "@/shared/lib/use-toast";
import { useRecentVisits } from "@/shared/lib/visits-context";
import { ProjectMemberTab } from "@/features/project/ui/ProjectMemberTab";
import { type TicketStatus, type MyTicket } from "@/entities/ticket/model/types";
import { TicketColumnsGrid, TicketColumnsSkeleton } from "@/features/task/ui/TicketColumn";
import { isRoot } from "@/shared/lib/permissions-client";

// ---- Types ----

type TicketAttachmentForProject = {
  ticketId: string;
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

type ProjectTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
  priority: number;
  project: { id: string; name: string };
  module: { name: string; responsibility: { kind: "PROGRAM" | "DESIGN" } };
};

type Member = {
  id: string;
  role: string;
  joinedAt: Date;
  user: { id: string; name: string | null; email: string };
};

type PkmNoteForDocs = {
  id: string;
  title: string;
  updatedAt?: Date;
  attachments: unknown;
  user: { id: string; name: string | null };
};

type ProjectAttachmentForDocs = {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  uploader: string;
  createdAt: string;
};

export type ProjectWithStatus = {
  id: string;
  name: string;
  description: string | null;
  status?: string;
  createdAt?: Date;
  updatedAt?: Date;
  ownerId?: string | null;
  owner?: { id: string; name: string | null; email: string } | null;
  members?: Member[];
  pkmNotes?: PkmNoteForDocs[];
  responsibilities?: {
    modules?: {
      tickets?: MyTicket[];
    }[];
  }[];
  /** PR10: 单子附件数据 */
  ticketAttachments?: TicketAttachmentForProject[];
  /** 新路线：项目直接上传的附件（sourceType=PROJECT） */
  projectAttachments?: ProjectAttachmentForDocs[];
};

// ---- Kanban column config ----

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-brand-50 text-brand-700",
  MAINTENANCE: "bg-amber-50 text-amber-700",
  ARCHIVED: "bg-ink-100 text-ink-500",
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "进行中",
  MAINTENANCE: "维护中",
  ARCHIVED: "已归档",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return date.toLocaleDateString("zh-CN");
}

// ---- Progress bar ----


// ---- Skeletons ----

function KanbanSkeleton() {
  return <TicketColumnsSkeleton />;
}

// ---- Kanban columns ----

function KanbanColumns({ tickets, query, sortByPriority }: { tickets: ProjectTicket[]; query: string; sortByPriority?: boolean }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        String(t.ticketNo).includes(q) ||
        t.module.name.toLowerCase().includes(q),
    );
  }, [tickets, query]);

  const grouped = useMemo(() => {
    const map: Record<TicketStatus, ProjectTicket[]> = {
      DEVELOPING: [],
      READY_FOR_TEST: [],
      DELIVERED: [],
      DONE: [],
      OVERDUE: [],
      CLOSED: [],
    };
    for (const t of filtered) map[t.status].push(t);
    for (const k of Object.keys(map) as TicketStatus[]) {
      if (sortByPriority) {
        map[k].sort((a, b) => a.priority - b.priority || b.ticketNo - a.ticketNo);
      } else {
        map[k].sort((a, b) => b.ticketNo - a.ticketNo);
      }
    }
    return map;
  }, [filtered, sortByPriority]);

  return <TicketColumnsGrid grouped={grouped as Record<TicketStatus, import("@/features/task/ui/TicketColumn").TicketItem[]>} />;
}

// ---- Task tab content ----

type TaskTabProps = {
  tickets: ProjectTicket[];
  taskCounts: TaskCounts;
};

function TaskTab({ tickets, taskCounts }: TaskTabProps) {
  const [query, setQuery] = useState("");
  const [sortByPriority, setSortByPriority] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索任务标题、编号、模块…"
            className="w-full rounded-lg border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-ink-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setSortByPriority(false)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
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
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              sortByPriority
                ? "bg-brand-50 text-brand-700"
                : "text-ink-500 hover:bg-ink-50"
            }`}
          >
            按优先级
          </button>
        </div>
      </div>

      <KanbanColumns tickets={tickets} query={query} sortByPriority={sortByPriority} />
    </div>
  );
}

// ---- InfoRow ----

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-100 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-ink-400">{label}</span>
      <span className="text-sm font-medium text-ink-900">{value}</span>
    </div>
  );
}

// ---- Overview tab ----

type OwnerOption = { id: string; name: string | null; email: string };

function OverviewTab({
  project,
  editing,
  onEdit,
  onCancel,
  onSaved,
  canEdit,
}: {
  project: ProjectWithStatus;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSaved: () => void;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [status, setStatus] = useState(project.status ?? "ACTIVE");
  const [ownerId, setOwnerId] = useState(project.ownerId ?? "");
  const [owners, setOwners] = useState<OwnerOption[]>([]);

  // 当进入编辑模式时同步表单值，并拉负责人候选
  useEffect(() => {
    if (!editing) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setStatus(project.status ?? "ACTIVE");
    setOwnerId(project.ownerId ?? "");
    let cancelled = false;
    fetch("/api/users")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled && data.users) setOwners(data.users);
      })
      .catch(() => {
        if (!cancelled) toast.error("负责人列表加载失败");
      });
    return () => { cancelled = true; };
  }, [editing, project, toast]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          status,
          ownerId: ownerId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`保存失败: ${data.error}`);
        return;
      }
      toast.success("保存成功");
      onSaved();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSaving(false);
    }
  }

  const createdAt = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString("zh-CN")
    : "—";
  const memberCount = project.members?.length ?? 0;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink-900">项目基本信息</h2>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 transition hover:border-brand-300 hover:bg-brand-50"
          >
            <IconEdit className="h-4 w-4" />
            编辑
          </button>
        )}
        {canEdit && editing && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="rounded-lg border border-ink-300 bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition hover:bg-ink-100 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-500">项目名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-500">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-500">状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              >
                <option value="ACTIVE">进行中</option>
                <option value="MAINTENANCE">维护中</option>
                <option value="ARCHIVED">已归档</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-ink-500">负责人</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              >
                <option value="">无负责人</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name || o.email}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-500">成员数量</label>
            <p className="py-2 text-sm text-ink-700">{memberCount} 人</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-ink-500">创建时间</label>
            <p className="py-2 text-sm text-ink-700">{createdAt}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <InfoRow label="项目名称" value={project.name} />
          <InfoRow label="描述" value={project.description || "暂无描述"} />
          <InfoRow label="负责人" value={project.owner?.name || "—"} />
          <InfoRow label="成员数量" value={`${memberCount} 人`} />
          <InfoRow label="创建时间" value={createdAt} />
          <InfoRow label="状态" value={STATUS_LABEL[project.status ?? "ACTIVE"]} />
        </div>
      )}
    </div>
  );
}

// ---- Code tab placeholder ----

function CodeTab() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 py-20 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <IconRepo className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium text-ink-500">代码关联</p>
      <p className="mt-1 text-xs text-ink-400">即将上线</p>
    </div>
  );
}

// ---- Docs tab ----

type FileReferenceResponse = {
  fileAssetId: string;
  total: number;
  bySourceType: Record<string, Array<{ sourceId: string; createdAt: string }>>;
};

type SourceRef = { sourceId: string; createdAt: string };

function SourceRefChip({
  sourceType,
  ref,
}: {
  sourceType: string;
  ref: SourceRef;
}) {
  const href =
    sourceType === "TICKET"
      ? `/tickets/${ref.sourceId}`
      : sourceType === "TICKET_COMMENT"
        ? `/tickets/${ref.sourceId}`
        : sourceType === "PKM_NOTE"
          ? `/pkm/notes/${ref.sourceId}`
          : sourceType === "PROJECT"
            ? `/projects/${ref.sourceId}`
            : "#";

  const label =
    sourceType === "TICKET"
      ? `工单 ${ref.sourceId.slice(0, 8)}…`
      : sourceType === "TICKET_COMMENT"
        ? `评论 ${ref.sourceId.slice(0, 8)}…`
        : sourceType === "PKM_NOTE"
          ? `笔记 ${ref.sourceId.slice(0, 8)}…`
          : sourceType === "PROJECT"
            ? `项目 ${ref.sourceId.slice(0, 8)}…`
            : ref.sourceId.slice(0, 8);

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 rounded border border-ink-200 bg-white px-2 py-1 text-xs text-ink-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
    >
      <span className="font-medium">{sourceType.replace("_", " ")}</span>
      <span className="max-w-[120px] truncate">{label}</span>
    </Link>
  );
}

function DocsTab({ project }: { project: ProjectWithStatus }) {
  const router = useRouter();
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  const allAttachments = useMemo(() => {
    const items: Array<{
      noteId: string;
      noteTitle: string;
      updatedAt?: Date;
      attachment: FileAttachment;
      uploader: string;
    }> = [];
    for (const note of project.pkmNotes ?? []) {
      const atts = (note.attachments as FileAttachment[] | null | undefined) ?? [];
      for (const att of atts) {
        if (!att.fileId) continue;
        items.push({
          noteId: note.id,
          noteTitle: note.title,
          updatedAt: note.updatedAt ? new Date(note.updatedAt) : undefined,
          attachment: att,
          uploader: note.user.name || "—",
        });
      }
    }
    return items;
  }, [project.pkmNotes]);

  // PR10: 单子来源附件（直接从 project.ticketAttachments 获取）
  const ticketAttachments = useMemo(() => {
    const items: Array<{
      ticketId: string;
      attachment: FileAttachment;
      createdAt?: Date;
    }> = [];
    for (const att of project.ticketAttachments ?? []) {
      items.push({
        ticketId: att.ticketId,
        attachment: {
          fileId: att.fileId,
          name: att.name,
          mimeType: att.mimeType,
          size: att.size,
        },
        createdAt: att.createdAt ? new Date(att.createdAt) : undefined,
      });
    }
    return items;
  }, [project.ticketAttachments]);

  // 按 fileId 缓存引用数据（来自 FileReference）
  const [refsByFileId, setRefsByFileId] = useState<
    Record<string, Record<string, SourceRef[]>>
  >({});
  const [refsLoading, setRefsLoading] = useState<Set<string>>(new Set());

  // 当 allAttachments 变化时，批量拉取引用数据
  useEffect(() => {
    const fileIds = allAttachments
      .map((item) => item.attachment.fileId)
      .filter((id): id is string => id !== null);

    // 去重 + 过滤掉已有数据的
    const newIds = fileIds.filter((id) => !refsByFileId[id] && !refsLoading.has(id));
    if (newIds.length === 0) return;

    setRefsLoading((prev) => new Set([...prev, ...newIds]));

    Promise.all(
      newIds.map(async (fileId) => {
        try {
          const res = await fetch(`/api/file-assets/${fileId}/references`);
          if (!res.ok) return { fileId, refs: {} };
          const data: FileReferenceResponse = await res.json();
          return { fileId, refs: data.bySourceType };
        } catch {
          return { fileId, refs: {} };
        }
      }),
    ).then((results) => {
      setRefsByFileId((prev) => {
        const next = { ...prev };
        for (const { fileId, refs } of results) {
          next[fileId] = refs;
        }
        return next;
      });
      setRefsLoading((prev) => {
        const next = new Set(prev);
        for (const { fileId } of results) {
          next.delete(fileId);
        }
        return next;
      });
    });
  }, [allAttachments, refsByFileId, refsLoading]);

  // 聚合所有 fileId 对应的 TICKET / TICKET_COMMENT 引用（来源单子）
  const ticketRefs = useMemo(() => {
    const result: Array<{ fileId: string; fileName: string | undefined; sourceType: string; sourceId: string; createdAt: string }> = [];
    for (const item of allAttachments) {
      const fileId = item.attachment.fileId;
      if (!fileId) continue;
      const refs = refsByFileId[fileId];
      if (!refs) continue;
      for (const [st, items] of Object.entries(refs)) {
        if (st === "TICKET" || st === "TICKET_COMMENT") {
          for (const ref of items) {
            result.push({ fileId, fileName: item.attachment.name, sourceType: st, ...ref });
          }
        }
      }
    }
    return result;
  }, [allAttachments, refsByFileId]);

  // 构建 fileId -> ticketInfo 映射（用于显示单子来源）
  const ticketInfoMap = useMemo(() => {
    const map: Record<string, { ticketNo: string; title: string }> = {};
    for (const resp of project.responsibilities ?? []) {
      for (const mod of resp.modules ?? []) {
        for (const t of mod.tickets ?? []) {
          map[t.id] = { ticketNo: String(t.ticketNo), title: t.title };
        }
      }
    }
    return map;
  }, [project.responsibilities]);

  return (
    <>
      {previewFile && (
        <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      <div className="space-y-4">
        {/* Upload bar */}
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <FileUploader
            onUpload={(file) => uploadProjectFile(file, project.id, router)}
            label="上传项目文件"
            hint="支持 PDF、Word、PPT、Excel、TXT、Markdown（单个文件不超过 10 MB）"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.xlsx,.xls,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/markdown,text/plain"
          />
        </div>

        {/* 来源单子（新：FileReference 路径） */}
        {ticketRefs.length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-3 text-base font-semibold text-ink-900">
              来源单子
              <span className="ml-2 text-sm font-normal text-ink-400">（{ticketRefs.length} 条）</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {ticketRefs.map((ref, i) => (
                <SourceRefChip
                  key={`${ref.fileId}-${ref.sourceType}-${ref.sourceId}-${i}`}
                  sourceType={ref.sourceType}
                  ref={ref}
                />
              ))}
            </div>
          </div>
        )}

        {/* 单子文档（新：PR10 单子附件） */}
        {ticketAttachments.length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 text-base font-semibold text-ink-900">
              单子文档
              <span className="ml-2 text-sm font-normal text-ink-400">（{ticketAttachments.length} 个文件）</span>
            </h2>
            <ul className="space-y-2">
              {ticketAttachments.map((item, i) => {
                const ticketInfo = ticketInfoMap[item.ticketId];
                const att = item.attachment;
                const mimeType = att.mimeType ?? "application/octet-stream";
                const isImage = mimeType.startsWith("image/");
                const canPreview = isImage || mimeType === "application/pdf" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType === "text/markdown" || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                const fileUrl = `/api/upload/${att.fileId}`;
                const size = att.size ?? 0;
                const sizeLabel =
                  size < 1024
                    ? `${size} B`
                    : size < 1024 * 1024
                      ? `${(size / 1024).toFixed(1)} KB`
                      : `${(size / 1024 / 1024).toFixed(1)} MB`;

                return (
                  <li key={`${item.ticketId}-${att.fileId}-${i}`} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-xs text-ink-400">
                      来源单子：
                      {ticketInfo ? (
                        <Link
                          href={`/tickets/${item.ticketId}`}
                          className="font-medium text-ink-600 transition hover:text-brand-600 hover:underline"
                        >
                          #{ticketInfo.ticketNo} {ticketInfo.title}
                        </Link>
                      ) : (
                        <span className="truncate">{item.ticketId.slice(0, 8)}…</span>
                      )}
                      {item.createdAt && (
                        <> · {item.createdAt.toLocaleDateString("zh-CN")}</>
                      )}
                    </div>
                    <div className="flex items-center gap-3 rounded-lg border border-ink-100 bg-ink-50 px-3 py-2">
                      {isImage ? (
                        <img
                          src={fileUrl}
                          alt={att.name}
                          className="h-8 w-8 shrink-0 rounded object-cover"
                        />
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
                        <p className="text-xs text-ink-400">{sizeLabel}</p>
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
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 项目直接上传文档（新路线：sourceType=PROJECT） */}
        {(project.projectAttachments ?? []).length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 text-base font-semibold text-ink-900">
              项目直接上传
              <span className="ml-2 text-sm font-normal text-ink-400">
                （{(project.projectAttachments ?? []).length} 个文件）
              </span>
            </h2>
            <ul className="space-y-2">
              {(project.projectAttachments ?? []).map((att, i) => {
                const mimeType = att.mimeType ?? "application/octet-stream";
                const isImage = mimeType.startsWith("image/");
                const canPreview =
                  isImage ||
                  mimeType === "application/pdf" ||
                  mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
                  mimeType === "text/markdown" ||
                  mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                const fileUrl = `/api/upload/${att.fileId}`;
                const size = att.size ?? 0;
                const sizeLabel =
                  size < 1024
                    ? `${size} B`
                    : size < 1024 * 1024
                      ? `${(size / 1024).toFixed(1)} KB`
                      : `${(size / 1024 / 1024).toFixed(1)} MB`;

                return (
                  <li key={`${att.fileId}-${i}`} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-xs text-ink-400">
                      <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-600">项目文档</span>
                      <span>上传者：{att.uploader}</span>
                      {att.createdAt && <> · {new Date(att.createdAt).toLocaleDateString("zh-CN")}</>}
                    </div>
                    <div className="flex items-center gap-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2">
                      {isImage ? (
                        <img src={fileUrl} alt={att.name} className="h-8 w-8 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-200">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-600">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14,2 14,8 20,8" />
                          </svg>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-800">{att.name}</p>
                        <p className="text-xs text-ink-400">{sizeLabel}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {canPreview && (
                          <button
                            type="button"
                            onClick={() => setPreviewFile({ name: att.name || "document", url: fileUrl, mimeType })}
                            className="rounded-lg border border-brand-200 bg-white px-2 py-1 text-xs text-brand-600 hover:bg-brand-50"
                          >
                            预览
                          </button>
                        )}
                        <a href={fileUrl} download={att.name} className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-100">
                          下载
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* 来源笔记（PKM 笔记附件路线） */}
        {allAttachments.length > 0 && (
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
            <h2 className="mb-4 text-base font-semibold text-ink-900">
              来源笔记
              <span className="ml-2 text-sm font-normal text-ink-400">（{allAttachments.length} 个文件）</span>
            </h2>
            <ul className="space-y-2">
              {allAttachments.map((item, i) => (
                <li key={`${item.noteId}-${item.attachment.name}-${i}`} className="flex flex-col gap-1">
                  <div className="text-xs text-ink-400">
                    来源笔记：
                    <Link
                      href={`/pkm/notes/${item.noteId}`}
                      className="font-medium text-ink-600 transition hover:text-brand-600 hover:underline"
                    >
                      {item.noteTitle}
                    </Link>
                    {item.updatedAt && (
                      <> · {item.updatedAt.toLocaleDateString("zh-CN")}</>
                    )}
                  </div>
                  <AttachmentItem
                    attachment={item.attachment}
                    onPreview={setPreviewFile}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {allAttachments.length === 0 && (project.projectAttachments ?? []).length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 py-12 text-center">
            <IconBook className="mb-3 h-10 w-10 text-ink-300" />
            <p className="text-sm text-ink-500">暂无文档</p>
            <p className="mt-1 text-xs text-ink-400">上传文件或关联笔记附件后在此展示</p>
          </div>
        )}
      </div>
    </>
  );
}

// ---- Member tab placeholder (replaced by ProjectMemberTab) ----

// ---- Dispatch tab ----

function DispatchTab({ projectId }: { projectId: string }) {
  return <DispatchProjectDetail projectId={projectId} />;
}

// ---- Settings tab placeholder ----

function SettingsTab() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 py-20 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <IconSettings className="h-6 w-6" />
      </span>
      <p className="text-sm font-medium text-ink-500">项目设置</p>
      <p className="mt-1 text-xs text-ink-400">即将上线</p>
    </div>
  );
}

// ---- Tab navigation ----

type TabKey = "overview" | "tasks" | "dispatch" | "code" | "docs" | "members" | "settings";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "overview",  label: "概览",   icon: <IconTask className="h-4 w-4" /> },
  { key: "tasks",    label: "任务",   icon: <IconTask className="h-4 w-4" /> },
  { key: "dispatch", label: "派单",   icon: <IconTask className="h-4 w-4" /> },
  { key: "code",     label: "代码",   icon: <IconRepo className="h-4 w-4" /> },
  { key: "docs",     label: "文档",   icon: <IconBook className="h-4 w-4" /> },
  { key: "members",  label: "成员",   icon: <IconTeam className="h-4 w-4" /> },
  { key: "settings", label: "设置",   icon: <IconSettings className="h-4 w-4" /> },
];

function TabNav({
  active,
  onChange,
  taskCount,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
  taskCount: number;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              isActive
                ? "bg-brand-50 text-brand-700"
                : "text-ink-500 hover:bg-ink-50 hover:text-ink-700"
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.key === "tasks" && taskCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] ${
                  isActive ? "bg-brand-100 text-brand-600" : "bg-ink-100 text-ink-500"
                }`}
              >
                {taskCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---- Task counts ----

type TaskCounts = { total: number; developing: number; test: number; delivered: number; done: number };

function computeTaskCounts(data: { project: ProjectWithStatus } | undefined): TaskCounts {
  const resp = (data?.project as ProjectWithStatus | undefined)?.responsibilities ?? [];
  const tickets = resp.flatMap((r) => r.modules ?? []).flatMap((m) => m.tickets ?? []);
  return {
    total: tickets.length,
    developing: tickets.filter((t: MyTicket) => t.status === "DEVELOPING").length,
    test: tickets.filter((t: MyTicket) => t.status === "READY_FOR_TEST").length,
    delivered: tickets.filter((t: MyTicket) => t.status === "DELIVERED").length,
    done: tickets.filter((t: MyTicket) => t.status === "DONE").length,
  };
}

// ---- Page header (exported for AppShell) ----

export function PageHeader({ projectName }: { projectName: string }) {
  return (
    <div className="flex items-center gap-3">
      <BackLink href="/projects" label="返回项目列表" />
      <SimplePageHeader title={projectName} />
    </div>
  );
}

export function PageHeaderSkeleton() {
  return <HeaderSkeleton titleW={8} subtitleW={12} />;
}

// ---- Main component ----

export function ProjectDetail({ project }: { project: ProjectWithStatus }) {
  const { scheduleRecord } = useRecentVisits();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { toast } = useToast();

  const [mounted, setMounted] = useState(false);
  const tabParam = searchParams.get("tab") as TabKey | null;
  const validTabs: TabKey[] = ["overview", "tasks", "dispatch", "code", "docs", "members", "settings"];
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabParam && validTabs.includes(tabParam) ? tabParam : "overview"
  );
  const [overviewEditing, setOverviewEditing] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const currentUserId = session?.user?.id ?? "";
  const userIsRoot = isRoot(session?.user?.role);
  const isOwner = project.members?.some(
    (m) => m.user.id === currentUserId && m.role === "OWNER"
  ) ?? false;
  const canEditProject = mounted && (userIsRoot || isOwner);

  const taskCounts = useMemo(() => computeTaskCounts({ project }), [project]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    scheduleRecord({ projectId: project.id, projectName: project.name, tabKey: tab, tabLabel: TABS.find((t) => t.key === tab)?.label ?? tab });
  };

  useEffect(() => {
    const tabLabel = TABS.find((t) => t.key === activeTab)?.label ?? activeTab;
    scheduleRecord({ projectId: project.id, projectName: project.name, tabKey: activeTab, tabLabel });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tickets = useMemo<ProjectTicket[]>(() => {
    return (
      project.responsibilities
        ?.flatMap((r) => r.modules ?? [])
        .flatMap((m) => m.tickets ?? [])
        .map((t) => ({
          id: t.id,
          ticketNo: t.ticketNo,
          title: t.title,
          status: t.status as TicketStatus,
          priority: t.priority ?? 2,
          project: { id: project.id, name: project.name },
          module: {
            name: t.module?.name ?? "",
            responsibility: { kind: t.module?.responsibility?.kind ?? "PROGRAM" },
          },
        })) ?? []
    );
  }, [project]);

  const status = project.status ?? "ACTIVE";
  const ownerName = project.owner?.name || "—";
  const memberCount = project.members?.length ?? 0;
  const createdAt = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString("zh-CN")
    : "—";
  const updatedAt = project.updatedAt
    ? formatRelativeTime(new Date(project.updatedAt))
    : "—";

  return (
    <div className="space-y-4 pm-fade-in">
      {/* Card: project info + tabs */}
      <div className="rounded-xl border border-ink-200 bg-white shadow-soft">
        {/* Header: icon left, content right */}
        <div className="flex items-start gap-4 p-5">
          {/* Left: large icon */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <IconTeam className="h-7 w-7" />
          </div>

          {/* Right: name + meta */}
          <div className="min-w-0 flex-1">
            {/* Row 1: name + status + actions */}
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-ink-900 truncate">{project.name}</h1>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  STATUS_STYLE[status] ?? "bg-ink-100 text-ink-500"
                }`}
              >
                {STATUS_LABEL[status]}
              </span>
              <div className="ml-auto flex items-center gap-2">
              {canEditProject && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 transition hover:border-brand-300 hover:bg-brand-50"
                  onClick={() => {
                    if (activeTab !== "overview") {
                      setActiveTab("overview");
                    }
                    setOverviewEditing(true);
                  }}
                >
                  <IconEdit className="h-4 w-4" />
                  编辑项目
                </button>
              )}
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-700 transition hover:border-brand-300 hover:bg-brand-50"
                  aria-label="更多操作"
                  onClick={() => toast.info("更多操作即将上线")}
                >
                  <IconMenu className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Row 2: meta info */}
            <p className="mt-2 text-sm text-ink-500">
              <span>
                负责人：<span className="font-medium text-ink-700">{ownerName}</span>
              </span>
              <span className="mx-2 text-ink-300">·</span>
              <span>
                成员：<span className="font-medium text-ink-700">{memberCount}</span>
              </span>
              <span className="mx-2 text-ink-300">·</span>
              <span>
                创建时间：<span className="font-medium text-ink-700">{createdAt}</span>
              </span>
              <span className="mx-2 text-ink-300">·</span>
              <span>
                更新时间：<span className="font-medium text-ink-700">{updatedAt}</span>
              </span>
            </p>
          </div>
        </div>

        {/* Tab navigation */}
        <div className="border-t border-ink-100 px-5 pb-4">
          <TabNav
            active={activeTab}
            onChange={handleTabChange}
            taskCount={taskCounts.total}
          />
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "overview"  && (
        <OverviewTab
          project={project}
          editing={overviewEditing}
          onEdit={() => setOverviewEditing(true)}
          onCancel={() => setOverviewEditing(false)}
          onSaved={() => {
            setOverviewEditing(false);
            router.refresh();
          }}
          canEdit={canEditProject}
        />
      )}
      {activeTab === "tasks"     && <TaskTab tickets={tickets} taskCounts={taskCounts} />}
      {activeTab === "dispatch"  && <DispatchTab projectId={project.id} />}
      {activeTab === "code"      && <CodeTab />}
      {activeTab === "docs"      && <DocsTab project={project} />}
      {activeTab === "members"   && (
        <ProjectMemberTab
          projectId={project.id}
          members={project.members ?? []}
          currentUserId={currentUserId}
          isRoot={userIsRoot}
          isOwner={isOwner}
        />
      )}
      {activeTab === "settings"   && <SettingsTab />}
    </div>
  );
}

// ---- Loading skeleton ----

export function ProjectDetailLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="rounded-xl border border-ink-200 bg-white shadow-soft">
        <div className="flex items-start gap-4 p-5">
          <div className="h-14 w-14 shrink-0 rounded-xl bg-ink-100" />
          <div className="flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-6 w-40 rounded bg-ink-100" />
              <div className="h-5 w-16 rounded-full bg-ink-100" />
              <div className="ml-auto h-8 w-24 rounded-lg bg-ink-100" />
              <div className="h-9 w-9 rounded-lg bg-ink-100" />
            </div>
            <div className="flex gap-4">
              {[120, 60, 100, 80].map((w, i) => (
                <div key={i} className={`h-4 rounded bg-ink-100`} style={{ width: w }} />
              ))}
            </div>
          </div>
        </div>
        <div className="border-t border-ink-100 px-5 pb-4 pt-4">
          <div className="flex gap-1 rounded-lg border border-ink-200 bg-white p-1">
            {["概览", "任务", "代码", "文档", "成员", "设置"].map((t) => (
              <div key={t} className="h-8 w-16 rounded-md bg-ink-100" />
            ))}
          </div>
        </div>
      </div>
      <KanbanSkeleton />
    </div>
  );
}
