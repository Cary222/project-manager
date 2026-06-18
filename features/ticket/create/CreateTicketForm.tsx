"use client";

import { useRef, useState } from "react";
import { AssigneePicker } from "@/shared/ui/AssigneePicker";
import { ImageLightbox } from "@/shared/ui/ImageLightbox";
import { composeImageMarkdown, extractInlineImages } from "@/shared/lib/pkm";
import {
  createTicketAction,
  createModuleAction,
  type CreateTicketInput,
} from "./action";
import type { TicketCreateUser, TicketCreateResponsibility } from "@/entities/ticket/model/types";

export type TicketCreateInitialValues = {
  moduleId?: string;
  newModuleName?: string;
  programAssigneeIds?: string[];
  designAssigneeIds?: string[];
  title?: string;
  description?: string;
};

type CreatedTicketPayload = {
  ticket: { id: string; ticketNo: number; title: string };
  programAssigneeIds: string[];
  designAssigneeIds: string[];
  title: string;
  description: string;
  moduleId: string;
  newModuleName: string;
};

type CreateTicketFormProps = {
  projectId: string;
  responsibility: TicketCreateResponsibility;
  users: TicketCreateUser[];
  initialValues?: TicketCreateInitialValues;
  submitLabel?: string;
  submitMode?: "create" | "edit";
  onCreated?: (payload: CreatedTicketPayload) => Promise<void> | void;
  onCreateFailed?: (draft: TicketCreateInitialValues, errorMessage: string) => Promise<void> | void;
  onCancel?: () => void;
  onMessage?: (message: string) => void;
  className?: string;
  showDesignAssignees?: boolean;
  editableDesignAssignees?: boolean;
  currentUserId?: string;
  bugTicketMode?: boolean;
  sourceTicketNo?: number;
  /** All modules from this project (across all responsibilities) for the dropdown */
  allProjectModules?: { id: string; name: string }[];
};

export function CreateTicketForm({
  projectId,
  responsibility,
  users,
  initialValues,
  submitLabel = "创建单子",
  submitMode = "create",
  onCreated,
  onCreateFailed,
  onCancel,
  onMessage,
  className = "mb-5 grid gap-3 rounded-xl border border-ink-100 bg-ink-100/40 p-4",
  showDesignAssignees = responsibility.kind === "DESIGN",
  editableDesignAssignees = responsibility.kind === "DESIGN",
  currentUserId,
  bugTicketMode = false,
  sourceTicketNo,
  allProjectModules,
}: CreateTicketFormProps) {
  const [moduleId, setModuleId] = useState(initialValues?.moduleId ?? "");
  const [newModuleName, setNewModuleName] = useState(initialValues?.newModuleName ?? "");
  const [programAssigneeIds, setProgramAssigneeIds] = useState(
    initialValues?.programAssigneeIds ?? []
  );
  const [designAssigneeIds, setDesignAssigneeIds] = useState(
    initialValues?.designAssigneeIds ?? []
  );
  const initialDescriptionState = extractInlineImages(initialValues?.description ?? "");
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [description, setDescription] = useState(initialDescriptionState.plainContent);
  const [descriptionImages, setDescriptionImages] = useState<{ src: string; name: string }[]>(
    initialDescriptionState.images
  );
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const isLightboxOpenRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  const designAssigneeNames = designAssigneeIds
    .map((id) => users.find((user) => user.id === id))
    .filter((user): user is TicketCreateUser => Boolean(user))
    .map((user) => user.name || user.email);

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

  function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * ratio));
          const h = Math.max(1, Math.round(img.height * ratio));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            resolve(URL.createObjectURL(file));
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("read failed"));
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  }

  async function insertImage(file: File) {
    try {
      const compressed = await compressImage(file);
      setDescriptionImages((prev) => [...prev, { src: compressed, name: file.name }]);
    } catch (err) {
      onMessage?.(`图片处理失败: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  function removeImage(index: number) {
    if (isLightboxOpenRef.current) return;
    setDescriptionImages((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setSubmitting(true);
    onMessage?.("");

    try {
      let targetModuleId = moduleId;
      if (!targetModuleId && newModuleName.trim()) {
        const moduleResult = await createModuleAction({
          responsibilityId: responsibility.id,
          name: newModuleName.trim(),
        });
        if (!moduleResult.ok) {
          onMessage?.(`创建模块失败: ${moduleResult.error}`);
          return;
        }
        targetModuleId = moduleResult.module.id;
      }

      if (!targetModuleId) {
        onMessage?.("请选择模块或填写新模块名称");
        return;
      }

      const effectiveProgramAssigneeIds =
        programAssigneeIds.length > 0
          ? programAssigneeIds
          : currentUserId
            ? [currentUserId]
            : [];

      const { content: fullDescription } = composeImageMarkdown(descriptionImages, description.trim());

      if (submitMode === "edit") {
        await onCreated?.({
          ticket: { id: "", ticketNo: 0, title: title.trim() },
          programAssigneeIds: effectiveProgramAssigneeIds,
          designAssigneeIds,
          title: title.trim(),
          description: fullDescription,
          moduleId: targetModuleId,
          newModuleName: newModuleName.trim(),
        });
        return;
      }

      const input: CreateTicketInput = {
        projectId,
        moduleId: targetModuleId,
        title: title.trim(),
        description: fullDescription,
        assigneeIds: effectiveProgramAssigneeIds,
      };

      let result;
      try {
        result = await createTicketAction(input);
      } catch (err) {
        const errorMessage = `创建单子失败: ${err instanceof Error ? err.message : "网络错误或请求过大，请减少图片数量"}`;
        onMessage?.(errorMessage);
        await onCreateFailed?.(
          {
            moduleId: targetModuleId,
            newModuleName: newModuleName.trim(),
            programAssigneeIds: effectiveProgramAssigneeIds,
            designAssigneeIds,
            title: title.trim(),
            description: description.trim(),
          },
          errorMessage
        );
        return;
      }

      if (!result.ok) {
        const errorMessage = `创建单子失败: ${result.error}`;
        onMessage?.(errorMessage);
        await onCreateFailed?.(
          {
            moduleId: targetModuleId,
            newModuleName: newModuleName.trim(),
            programAssigneeIds: effectiveProgramAssigneeIds,
            designAssigneeIds,
            title: title.trim(),
            description: description.trim(),
          },
          errorMessage
        );
        return;
      }

      setModuleId("");
      setNewModuleName("");
      setProgramAssigneeIds([]);
      setDesignAssigneeIds([]);
      setTitle("");
      setDescription("");
      setDescriptionImages([]);
      onMessage?.("单子已创建");
      await onCreated?.({
        ticket: result.ticket,
        programAssigneeIds: effectiveProgramAssigneeIds,
        designAssigneeIds,
        title: title.trim(),
        description: description.trim(),
        moduleId: targetModuleId,
        newModuleName: newModuleName.trim(),
      });
    } finally {
      setSubmitting(false);
    }
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

      <form onSubmit={handleSubmit} className={className}>
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
              {(() => {
                const seen = new Set<string>();
                const items: { id: string; name: string }[] = [];

                for (const m of responsibility.modules) {
                  if (!seen.has(m.name)) {
                    seen.add(m.name);
                    items.push(m);
                  }
                }

                for (const m of allProjectModules ?? []) {
                  if (!seen.has(m.name)) {
                    seen.add(m.name);
                    items.push(m);
                  }
                }

                if (initialValues?.moduleId) {
                  const initialModule = (allProjectModules ?? []).find((m) => m.id === initialValues.moduleId);
                  if (initialModule) {
                    const existingIdx = items.findIndex((m) => m.id === initialModule.id);
                    if (existingIdx === -1) {
                      const seenNameIdx = items.findIndex((m) => m.name === initialModule.name);
                      if (seenNameIdx !== -1) {
                        items[seenNameIdx] = initialModule;
                      } else {
                        items.push(initialModule);
                      }
                    }
                  }
                }

                return items.map((module) => (
                  <option key={module.id} value={module.id}>
                    {module.name}
                  </option>
                ));
              })()}
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

        {showDesignAssignees ? (
          <div className="space-y-2 text-sm">
            <span className="text-ink-700">设计指派人</span>
            {editableDesignAssignees ? (
              <AssigneePicker
                users={users}
                value={designAssigneeIds}
                onChange={setDesignAssigneeIds}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-ink-200 bg-white/70 px-3 py-2 text-sm text-ink-600">
                {designAssigneeNames.length > 0 ? designAssigneeNames.join("、") : "未选择"}
              </div>
            )}
          </div>
        ) : null}

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink-700">程序指派人</span>
            {showDesignAssignees && currentUserId ? (
              <button
                type="button"
                onClick={() => {
                  const inherited = (initialValues?.programAssigneeIds ?? []).filter((id) =>
                    users.some((user) => user.id === id)
                  );
                  setProgramAssigneeIds(inherited.length > 0 ? inherited : [currentUserId]);
                }}
                className="text-xs text-brand-600 hover:text-brand-700"
              >
                继承程序指派人
              </button>
            ) : null}
          </div>
          <AssigneePicker
            users={users}
            value={programAssigneeIds}
            onChange={setProgramAssigneeIds}
          />
          {showDesignAssignees ? (
            <p className="text-xs text-ink-400">
              若未选择程序指派人，创建时将默认使用当前管理员。
            </p>
          ) : null}
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
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
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
            {submitting ? "创建中…" : submitLabel}
          </button>
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="w-fit rounded-lg border border-ink-200 px-4 py-2 text-sm hover:bg-ink-100"
            >
              取消
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}
