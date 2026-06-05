"use client";

import { ImageLightbox } from "@/components/ImageLightbox";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AssigneePicker, formatAssigneeNames } from "@/components/AssigneePicker";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconArrowLeft, IconEdit, IconPlus, IconTrash } from "@/components/icons";

type Ticket = {
  id: string;
  ticketNo: number;
  title: string;
  description: string | null;
  progress: number;
  status: TicketStatus;
  assignees: User[];
};

type TicketStatus = "DEVELOPING" | "READY_FOR_TEST" | "DONE";

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
  DONE: "已完成",
};

const STATUS_STYLE: Record<TicketStatus, string> = {
  DEVELOPING: "bg-brand-50 text-brand-700",
  READY_FOR_TEST: "bg-amber-50 text-warning",
  DONE: "bg-emerald-50 text-emerald-600",
};

export function ProjectDetail({ projectId }: { projectId: string }) {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResponsibilityId, setSelectedResponsibilityId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [newModuleName, setNewModuleName] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionImages, setDescriptionImages] = useState<{ src: string; name: string }[]>([]);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const isLightboxOpenRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
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

  function openPreview(img: { src: string; name: string }) {
    isLightboxOpenRef.current = true;
    setPreviewImage(img);
  }

  function closePreview() {
    setPreviewImage(null);
    setTimeout(() => {
      isLightboxOpenRef.current = false;
    }, 0);
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
    return selectedResponsibility.modules.flatMap((module) => module.tickets);
  }, [selectedResponsibility]);

  const stats = useMemo(() => {
    const all =
      project?.responsibilities.flatMap((r) =>
        r.modules.flatMap((m) => m.tickets)
      ) ?? [];
    const dev = all.filter((t) => t.status === "DEVELOPING").length;
    const test = all.filter((t) => t.status === "READY_FOR_TEST").length;
    const done = all.filter((t) => t.status === "DONE").length;
    const rate = all.length ? Math.round((done / all.length) * 100) : 0;
    return { total: all.length, dev, test, done, rate };
  }, [project]);

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedResponsibility || !title.trim()) return;

    setSubmitting(true);
    setMessage("");

    let targetModuleId = moduleId;
    if (!targetModuleId && newModuleName.trim()) {
      const moduleRes = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responsibilityId: selectedResponsibility.id,
          name: newModuleName.trim(),
        }),
      });
      if (!moduleRes.ok) {
        const err = await moduleRes.json().catch(() => ({}));
        setSubmitting(false);
        setMessage(`创建模块失败: ${err.error ?? moduleRes.status}`);
        return;
      }
      const data = (await moduleRes.json()) as { module: Module };
      targetModuleId = data.module.id;
    }

    if (!targetModuleId) {
      setSubmitting(false);
      setMessage("请选择模块或填写新模块名称");
      return;
    }

    const imageMarkdown = descriptionImages
      .map((img) => `![${img.name}](${img.src})`)
      .join("\n");
    const fullDescription = imageMarkdown
      ? `${imageMarkdown}\n\n${description.trim()}`
      : description.trim();

    const ticketRes = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        moduleId: targetModuleId,
        assigneeIds,
        title: title.trim(),
        description: fullDescription,
      }),
    });

    setSubmitting(false);
    if (!ticketRes.ok) {
      const err = await ticketRes.json().catch(() => ({}));
      setMessage(`创建单子失败: ${err.error ?? ticketRes.status}`);
      return;
    }

    setTitle("");
    setDescription("");
    setDescriptionImages([]);
    setNewModuleName("");
    setModuleId("");
    setAssigneeIds([]);
    setShowCreate(false);
    setMessage("单子已创建");
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

  function insertImage(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (!src) return;
      setDescriptionImages((prev) => [...prev, { src, name: file.name }]);
    };
    reader.readAsDataURL(file);
  }

  function removeImage(index: number) {
    if (isLightboxOpenRef.current) return;
    setDescriptionImages((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  if (loading) {
    return (
      <AppShell>
        <p className="py-12 text-center text-sm text-ink-400">加载中…</p>
      </AppShell>
    );
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
    >
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

      {/* 编辑模块弹窗 */}
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
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
                    setModuleId("");
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
              {isRoot && selectedResponsibility && showCreate ? (
                <form
                  onSubmit={createTicket}
                  className="mb-5 grid gap-3 rounded-xl border border-ink-100 bg-ink-100/40 p-4"
                >
                  <p className="text-sm font-medium">新建单子</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="text-ink-700">选择模块</span>
                      <select
                        value={moduleId}
                        onChange={(e) => setModuleId(e.target.value)}
                        className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      >
                        <option value="">不选择，使用新模块</option>
                        {selectedResponsibility.modules.map((module) => (
                          <option key={module.id} value={module.id}>
                            {module.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-ink-700">新模块名称</span>
                      <input
                        value={newModuleName}
                        onChange={(e) => setNewModuleName(e.target.value)}
                        placeholder="没有合适模块时填写"
                        className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      />
                    </label>
                  </div>
                  <div className="space-y-2 text-sm">
                    <span className="text-ink-700">指派给</span>
                    <AssigneePicker
                      users={users}
                      value={assigneeIds}
                      onChange={setAssigneeIds}
                    />
                  </div>
                  <label className="space-y-1 text-sm">
                    <span className="text-ink-700">标题</span>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                      required
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="text-ink-700">描述（Markdown）</span>
                    <div className="rounded-lg border border-ink-200 bg-white">
                      {descriptionImages.length > 0 && (
                        <div
                          className="flex flex-wrap gap-2 border-b border-ink-200 p-3"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
                        >
                          {descriptionImages.map((img, i) => (
                            <div
                              key={i}
                              className="group relative"
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.src}
                                alt={img.name}
                                className="max-h-28 cursor-pointer rounded-lg border border-ink-200 object-contain hover:ring-2 hover:ring-brand-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openPreview(img);
                                }}
                              />
                              <button
                                type="button"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  removeImage(i);
                                }}
                                className="absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:!bg-danger group-hover:flex"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        onPaste={(e) => {
                          const items = e.clipboardData.items;
                          for (const item of items) {
                            if (item.type.startsWith("image/")) {
                              e.preventDefault();
                              const file = item.getAsFile();
                              if (file) insertImage(file);
                              return;
                            }
                          }
                        }}
                        placeholder="输入描述（Markdown）..."
                        className="w-full px-3 py-2 font-mono text-sm placeholder:text-ink-400 focus:outline-none"
                        style={{ minHeight: "120px", resize: "none" }}
                      />
                    </div>
                  </label>
                  <label className="w-fit cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100">
                    插入图片
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) insertImage(file);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-fit rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {submitting ? "创建中…" : "创建单子"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="w-fit rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
                    >
                      取消
                    </button>
                  </div>
                </form>
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
                  {selectedResponsibility.modules.map((module) => (
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
                      {module.tickets.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-ink-200 px-3 py-2 text-sm text-ink-400">
                          暂无单子
                        </p>
                      ) : (
                        <div className="grid gap-2 md:grid-cols-2">
                          {module.tickets.map((ticket) => {
                            const isDone = ticket.status === "DONE";
                            return (
                              <div
                                key={ticket.id}
                                className={`rounded-lg border p-3 transition ${
                                  isDone
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
                                      isDone ? "text-ink-400 line-through" : ""
                                    }`}
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
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
