"use client";

import { useState } from "react";
import { AssigneePicker } from "@/shared/ui/AssigneePicker";
import { composeImageMarkdown } from "@/shared/lib/pkm";
import { fileToDataUrl } from "@/shared/lib/upload";

export type PushConfirmModalProps = {
  mode: "program" | "bug";
  sourceTicket: {
    id: string;
    ticketNo: number;
    title: string;
    description?: string | null;
    moduleId?: string;
    moduleName?: string;
    assigneeIds?: string[];
  };
  programModules?: Array<{ id: string; name: string }>;
  responsibility: {
    id: string;
    kind: "PROGRAM" | "DESIGN" | "BUG";
    modules: Array<{ id: string; name: string }>;
  };
  users: Array<{ id: string; name: string | null; email: string; role: "ROOT" | "USER" }>;
  initialAssigneeIds?: string[];
  onPush: (options: {
    title: string;
    description: string;
    moduleId: string;
    newModuleName: string;
    assigneeIds: string[];
  }) => Promise<void>;
  onDone: () => Promise<void>;
  onCancel: () => void;
};

export function PushConfirmModal({
  mode,
  sourceTicket,
  programModules = [],
  responsibility,
  users,
  initialAssigneeIds = [],
  onPush,
  onDone,
  onCancel,
}: PushConfirmModalProps) {
  const [showForm, setShowForm] = useState(false);
  const [moduleId, setModuleId] = useState(sourceTicket.moduleId ?? "");
  const [newModuleName, setNewModuleName] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    sourceTicket.assigneeIds ?? initialAssigneeIds
  );
  const [title, setTitle] = useState(
    mode === "bug" ? `Bug: ${sourceTicket.title}` : sourceTicket.title
  );
  const [description, setDescription] = useState(sourceTicket.description ?? "");
  const [descriptionImages, setDescriptionImages] = useState<Array<{ src: string; name: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const modeLabel = mode === "bug" ? "Bug 单" : "程序单";

  // Bug 单时复用程序单模块，程序单时用当前职责模块
  const availableModules = mode === "bug" ? programModules : responsibility.modules;

  function insertImage(file: File) {
    fileToDataUrl(file).then((src) => {
      if (src) setDescriptionImages((prev) => [...prev, { src, name: file.name }]);
    });
  }

  function removeImage(index: number) {
    setDescriptionImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    setMessage("");

    try {
      const { content: fullDescription } = composeImageMarkdown(descriptionImages, description.trim());
      await onPush({
        title: title.trim(),
        description: fullDescription,
        moduleId,
        newModuleName: newModuleName.trim(),
        assigneeIds,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDone() {
    setSubmitting(true);
    setMessage("");
    try {
      await onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-elevated">
        <h3 className="text-lg font-medium">推送{modeLabel}</h3>
        <p className="mt-2 text-sm text-ink-600">
          来源：#{sourceTicket.ticketNo} {sourceTicket.title}
        </p>

        {message && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {message}
          </p>
        )}

        {!showForm ? (
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleDone}
              disabled={submitting}
              className="rounded-lg border border-ink-200 px-4 py-2 text-sm text-ink-700 hover:bg-ink-100 disabled:opacity-50"
            >
              保持当前状态
            </button>
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              推送{modeLabel}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="text-ink-700">
                  {mode === "bug" ? "程序单模块" : "选择模块"}
                </span>
                <select
                  value={moduleId}
                  onChange={(e) => setModuleId(e.target.value)}
                  className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="">不选择，使用新模块</option>
                  {availableModules.map((module) => (
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
              <span className="text-ink-700">指派人</span>
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
                  <div className="flex flex-wrap gap-2 border-b border-ink-200 p-3">
                    {descriptionImages.map((img, i) => (
                      <div key={i} className="group relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.src}
                          alt={img.name}
                          className="max-h-20 rounded-lg border border-ink-200"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(i)}
                          className="absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white group-hover:flex"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 font-mono text-sm outline-none focus:outline-none"
                  placeholder="输入描述（Markdown）..."
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

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
              >
                返回
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {submitting ? "推送中…" : `推送${modeLabel}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
