"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { IconSearch, IconSettings, IconTask, IconTeam, IconEdit, IconMenu, IconRepo, IconBook } from "@/shared/ui/icons";
import { BackLink, SimplePageHeader, HeaderSkeleton } from "@/shared/ui/headers";
import { normalizePkmAttachments, type PkmAttachment } from "@/shared/lib/pkm";
import { AttachmentItem, type PreviewableFile } from "@/shared/ui/AttachmentItem";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";
import { uploadAttachmentAsNote } from "@/shared/lib/upload";
import { FileUploader } from "@/shared/ui/FileUploader";
import { DispatchProjectDetail } from "@/features/dispatch/ui/DispatchProjectDetail";
import { TaskStatsCards, type TaskStats } from "@/shared/ui/TaskStatsCards";
import { useToast } from "@/shared/lib/use-toast";
import { useRecentVisits } from "@/shared/lib/visits-context";
import {
  KIND_LABEL,
  type TicketStatus,
  type MyTicket,
} from "@/entities/ticket/model/types";

// ---- Types ----

type ProjectTicket = {
  id: string;
  ticketNo: number;
  title: string;
  status: TicketStatus;
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
};

// ---- Kanban column config ----

const COLUMNS: { key: TicketStatus; label: string; accent: string; head: string }[] = [
  { key: "DEVELOPING", label: "开发中", accent: "border-t-brand-500", head: "text-brand-700 bg-brand-50" },
  { key: "READY_FOR_TEST", label: "待测试", accent: "border-t-amber-500", head: "text-amber-700 bg-amber-50" },
  { key: "DELIVERED", label: "已交付", accent: "border-t-purple", head: "text-violet-700 bg-violet-50" },
  { key: "DONE", label: "已完成", accent: "border-t-emerald-500", head: "text-emerald-700 bg-emerald-50" },
];

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
  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {COLUMNS.map((col) => (
        <section
          key={col.key}
          className={`rounded-xl border border-ink-200 border-t-4 ${col.accent} bg-white p-3 shadow-soft`}
        >
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="h-5 w-16 rounded-full bg-ink-100" />
            <div className="h-4 w-6 rounded bg-ink-100" />
          </div>
          <div className="space-y-2">
            {[0, 1, 2].map((idx) => (
              <div
                key={`sk-${idx}`}
                className="rounded-lg border border-ink-100 bg-white p-3 shadow-soft"
              >
                <div className="flex items-center justify-between">
                  <div className="h-3 w-12 rounded bg-ink-100" />
                  <div className="h-5 w-10 rounded bg-ink-100" />
                </div>
                <div className="mt-2 h-4 w-4/5 rounded bg-ink-100" />
                <div className="mt-2 h-3 w-2/3 rounded bg-ink-100" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ---- Kanban columns ----

function KanbanColumns({ tickets, query }: { tickets: ProjectTicket[]; query: string }) {
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
    };
    for (const t of filtered) map[t.status].push(t);
    for (const k of Object.keys(map) as TicketStatus[]) {
      map[k].sort((a, b) => b.ticketNo - a.ticketNo);
    }
    return map;
  }, [filtered]);

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = grouped[col.key];
        return (
          <section
            key={col.key}
            className={`rounded-xl border border-ink-200 border-t-4 ${col.accent} bg-white p-3 shadow-soft`}
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${col.head}`}>
                {col.label}
              </span>
              <span className="text-sm text-ink-400">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink-200 py-8 text-center text-xs text-ink-400">
                  暂无任务
                </p>
              ) : (
                items.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="block rounded-lg border border-ink-100 bg-white p-3 shadow-soft transition hover:border-brand-200 hover:shadow-base"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-ink-400">#{t.ticketNo}</span>
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500">
                        {KIND_LABEL[t.module.responsibility.kind]}
                      </span>
                    </div>
                    <p
                      className={`mt-1.5 text-sm font-medium ${
                        t.status === "DONE" ? "text-ink-400 line-through" : "text-ink-900"
                      }`}
                    >
                      {t.title}
                    </p>
                    <p className="mt-2 truncate text-xs text-ink-400">
                      {t.project.name} · {t.module.name}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ---- Task tab content ----

type TaskTabProps = {
  tickets: ProjectTicket[];
  taskCounts: TaskCounts;
};

function TaskTab({ tickets, taskCounts }: TaskTabProps) {
  const [query, setQuery] = useState("");
  const stats: TaskStats = {
    total: taskCounts.total,
    dev: taskCounts.developing,
    test: taskCounts.test,
    delivered: taskCounts.delivered,
    done: taskCounts.done,
    rate: taskCounts.total === 0 ? 0 : Math.round((taskCounts.done / taskCounts.total) * 100),
  };

  return (
    <div className="space-y-5">
      <TaskStatsCards stats={stats} />

      <div className="relative w-full max-w-sm">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索任务标题、编号、模块…"
          className="w-full rounded-lg border border-ink-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      <KanbanColumns tickets={tickets} query={query} />
    </div>
  );
}

// ---- Overview tab ----

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-100 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-ink-400">{label}</span>
      <span className="text-sm font-medium text-ink-900">{value}</span>
    </div>
  );
}

function OverviewTab({ project }: { project: ProjectWithStatus }) {
  const createdAt = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString("zh-CN")
    : "—";
  const ownerName = project.owner?.name || "—";
  const memberCount = project.members?.length ?? 0;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <h2 className="mb-4 text-base font-semibold text-ink-900">项目基本信息</h2>
      <div className="space-y-4">
        <InfoRow label="项目名称" value={project.name} />
        <InfoRow label="描述" value={project.description || "暂无描述"} />
        <InfoRow label="负责人" value={ownerName} />
        <InfoRow label="成员数量" value={`${memberCount} 人`} />
        <InfoRow label="创建时间" value={createdAt} />
        <InfoRow label="状态" value={STATUS_LABEL[project.status ?? "ACTIVE"]} />
      </div>
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

function DocsTab({ project }: { project: ProjectWithStatus }) {
  const router = useRouter();
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  const allAttachments = useMemo(() => {
    const items: Array<{
      noteId: string;
      noteTitle: string;
      updatedAt?: Date;
      attachment: PkmAttachment;
      uploader: string;
    }> = [];
    for (const note of project.pkmNotes ?? []) {
      const atts = normalizePkmAttachments(note.attachments);
      for (const att of atts) {
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

  return (
    <>
      {previewFile && (
        <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      <div className="space-y-4">
        {/* Upload bar */}
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <FileUploader
            onUpload={(file) => uploadAttachmentAsNote(file, project.id, router)}
            label="上传项目文件"
            hint="支持 PDF、Word、PPT、TXT、Markdown（单个文件不超过 10 MB）"
            accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
          />
        </div>

        {/* Attachment list */}
        <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
          <h2 className="mb-4 text-base font-semibold text-ink-900">
            项目文档
            {allAttachments.length > 0 && (
              <span className="ml-2 text-sm font-normal text-ink-400">（{allAttachments.length} 个文件）</span>
            )}
          </h2>
          {allAttachments.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 py-12 text-center">
              <IconBook className="mb-3 h-10 w-10 text-ink-300" />
              <p className="text-sm text-ink-500">暂无文档</p>
              <p className="mt-1 text-xs text-ink-400">上传文件或关联笔记附件后在此展示</p>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </>
  );
}

// ---- Member tab ----

function MemberTab({ project }: { project: ProjectWithStatus }) {
  const members = project.members ?? [];

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <h2 className="mb-4 text-base font-semibold text-ink-900">项目成员</h2>
      {members.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-400">暂无成员</p>
      ) : (
        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-600 text-sm font-medium">
                {m.user.name?.charAt(0) ?? "?"}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">{m.user.name || "—"}</p>
                <p className="truncate text-xs text-ink-400">{m.user.email}</p>
              </div>
              <span
                className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  m.role === "OWNER"
                    ? "bg-brand-50 text-brand-700"
                    : "bg-ink-100 text-ink-500"
                }`}
              >
                {m.role === "OWNER" ? "负责人" : "成员"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") as TabKey | null;
  const { toast } = useToast();

  const validTabs: TabKey[] = ["overview", "tasks", "dispatch", "code", "docs", "members", "settings"];
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabParam && validTabs.includes(tabParam) ? tabParam : "overview"
  );

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
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 transition hover:border-brand-300 hover:bg-brand-50"
                  onClick={() => toast.info("编辑功能即将上线")}
                >
                  <IconEdit className="h-4 w-4" />
                  编辑项目
                </button>
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
      {activeTab === "overview"  && <OverviewTab project={project} />}
      {activeTab === "tasks"     && <TaskTab tickets={tickets} taskCounts={taskCounts} />}
      {activeTab === "dispatch"  && <DispatchTab projectId={project.id} />}
      {activeTab === "code"      && <CodeTab />}
      {activeTab === "docs"      && <DocsTab project={project} />}
      {activeTab === "members"   && <MemberTab project={project} />}
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
