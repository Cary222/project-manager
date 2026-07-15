"use client";

import { useRef, useState } from "react";
import { AssigneePicker } from "@/features/ticket/ui/AssigneePicker";
import { ImageLightbox } from "@/shared/ui/ImageLightbox";
import { AttachmentEditor, type PreviewableFile } from "@/shared/ui/AttachmentEditor";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";
import { composeImageMarkdown, extractInlineImages, type FileAttachment } from "@/shared/lib/pkm";
import { uploadImage } from "@/shared/lib/upload";
import { computeDefaultDeadline } from "@/features/ticket/lib/ticket-deadline";
import {
  createTicketAction,
  createBugTicketAction,
  createModuleAction,
  type CreateTicketInput,
} from "./action";
import type { TicketCreateUser, TicketCreateResponsibility } from "@/entities/ticket/model/types";
import { PRIORITY_LABEL } from "@/entities/ticket/model/types";

export type TicketCreateInitialValues = {
  moduleId?: string;
  newModuleName?: string;
  /** Bug-mode only: prefill the "new module name" input with the source program ticket's
   *  module name. Submitting then creates that module under the bug responsibility. */
  sourceModuleName?: string;
  programAssigneeIds?: string[];
  designAssigneeIds?: string[];
  title?: string;
  description?: string;
  priority?: number;
};

type CreatedTicketPayload = {
  ticket: { id: string; ticketNo: number; title: string };
  programAssigneeIds: string[];
  designAssigneeIds: string[];
  title: string;
  description: string;
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
  /** Required when bugTicketMode=true. The source program ticket id. */
  sourceTicketId?: string;
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
  sourceTicketId,
  allProjectModules,
}: CreateTicketFormProps) {
  const [moduleId, setModuleId] = useState(() => {
    if (bugTicketMode && initialValues?.sourceModuleName) {
      // Bug mode: default to the same-named module under the bug responsibility if it
      // exists. Otherwise leave the <select> empty and rely on the prefilled
      // "new module name" field to create a matching module on submit.
      const sameNameMatch = responsibility.modules.find(
        (m) => m.name === initialValues.sourceModuleName
      );
      if (sameNameMatch) return sameNameMatch.id;
    }
    if (initialValues?.moduleId) {
      // Only keep the initial module if it lives under the current responsibility,
      // otherwise the <select> wouldn't show it.
      const match = responsibility.modules.find((m) => m.id === initialValues.moduleId);
      if (match) return match.id;
    }
    return "";
  });
  // View-state for the <select>. Tracks which option the user sees as selected,
  // including the "__create_source_name__" sentinel that maps to "no module yet
  // but newModuleName is prefilled". The real `moduleId` stays "" in that case
  // so the submit path still creates a module from `newModuleName`.
  const [selectedOption, setSelectedOption] = useState<string>(() => {
    if (bugTicketMode && initialValues?.sourceModuleName) {
      const sameNameMatch = responsibility.modules.find(
        (m) => m.name === initialValues.sourceModuleName
      );
      if (sameNameMatch) return sameNameMatch.id;
      return "__create_source_name__";
    }
    if (initialValues?.moduleId) {
      const match = responsibility.modules.find((m) => m.id === initialValues.moduleId);
      if (match) return match.id;
    }
    return "";
  });
  const [newModuleName, setNewModuleName] = useState(() => {
    if (initialValues?.newModuleName) return initialValues.newModuleName;
    if (initialValues?.sourceModuleName) {
      // Only seed the "new module name" input when the bug responsibility has no
      // module with the same name — otherwise the existing module in the <select>
      // should be picked instead and the input left empty.
      const sameNameExists = responsibility.modules.some(
        (m) => m.name === initialValues.sourceModuleName
      );
      if (!sameNameExists) return initialValues.sourceModuleName;
    }
    return "";
  });
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
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  // Deadline state
  const [deadline, setDeadline] = useState(() => {
    const defaultDeadline = computeDefaultDeadline(new Date());
    return formatDateForInput(defaultDeadline);
  });

  // Priority state (default to P2 = 2)
  const [priority, setPriority] = useState(initialValues?.priority ?? 2);

  function formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }
  const isLightboxOpenRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Synchronous re-entrancy guard. `submitting` (useState) only blocks clicks after
  // React re-renders, but a fast double-click can fire `handleSubmit` twice in
  // the same event loop. This ref flips synchronously on the first call so the
  // second call returns immediately, preventing duplicate ticket creation.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  // New-module-name input: autocomplete-style dropdown listing every module name
  // from every responsibility in this project. Lets the user reuse a name that
  // already exists in a different responsibility instead of typing one from scratch.
  const [showModuleSuggestions, setShowModuleSuggestions] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);

  // Filter suggestions against the current input. Show all names when the input
  // is empty so the user can browse, then narrow as they type.
  const suggestions = (allProjectModules ?? [])
    .filter((m) => {
      const q = newModuleName.trim().toLowerCase();
      if (!q) return true;
      return m.name.toLowerCase().includes(q);
    })
    .slice(0, 50);

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

  function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
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
            resolve(file);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              URL.revokeObjectURL(url);
              if (!blob) {
                resolve(file);
                return;
              }
              resolve(blob);
            },
            "image/jpeg",
            quality,
          );
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  async function insertImage(file: File) {
    try {
      const compressed = await compressImage(file);
      const compressedFile =
        compressed instanceof File
          ? compressed
          : new File([compressed], file.name.replace(/\.(png|webp|gif)$/i, ".jpg"), {
              type: "image/jpeg",
            });
      const { url } = await uploadImage(compressedFile);
      setDescriptionImages((prev) => [...prev, { src: url, name: file.name }]);
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

  function handleAttachmentChange(next: FileAttachment[]) {
    setAttachments(next);
  }

  function handleImageSelect(file: File) {
    insertImage(file);
  }

  function handleAttachmentError(msg: string) {
    onMessage?.(msg);
  }

  function handleAttachmentPreview(file: PreviewableFile) {
    setPreviewFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (submittingRef.current) return;
    submittingRef.current = true;

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
        });
        return;
      }

      // ---- Bug ticket creation: route through createBugTicketAction ----
      if (bugTicketMode) {
        if (!sourceTicketId) {
          onMessage?.("缺少源单 ID");
          return;
        }
        const bugResult = await createBugTicketAction({
          sourceTicketId,
          title: title.trim(),
          description: fullDescription,
          moduleId: targetModuleId,
          assigneeIds: effectiveProgramAssigneeIds,
        });
        if (!bugResult.ok) {
          onMessage?.(`创建 Bug 单失败: ${bugResult.error}`);
          return;
        }
        onMessage?.("单子已创建");
        await onCreated?.({
          ticket: {
            id: bugResult.bugTicket.id,
            ticketNo: bugResult.bugTicket.ticketNo,
            title: bugResult.bugTicket.title,
          },
          programAssigneeIds: effectiveProgramAssigneeIds,
          designAssigneeIds,
          title: title.trim(),
          description: fullDescription,
        });
        return;
      }

      // ---- Regular ticket creation ----
      const input: CreateTicketInput = {
        projectId,
        moduleId: targetModuleId,
        title: title.trim(),
        description: fullDescription,
        assigneeIds: effectiveProgramAssigneeIds,
        deadline: deadline || null,
        priority,
        attachments,
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
      setAttachments([]);
      setDeadline(formatDateForInput(computeDefaultDeadline(new Date())));
      setPriority(2);
      onMessage?.("单子已创建");
      await onCreated?.({
        ticket: result.ticket,
        programAssigneeIds: effectiveProgramAssigneeIds,
        designAssigneeIds,
        title: title.trim(),
        description: fullDescription,
      });
    } finally {
      submittingRef.current = false;
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
      {previewFile && (
        <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}

      <form onSubmit={handleSubmit} className={className}>
        <p className="text-sm font-medium">新建单子</p>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="text-ink-700">选择模块</span>
            <select
              value={selectedOption}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedOption(v);
                if (v === "__create_source_name__") {
                  // Real `moduleId` stays "" so submission falls through to the
                  // "create from newModuleName" path, but the input is prefilled
                  // with the source-program's module name.
                  setModuleId("");
                  setNewModuleName(initialValues?.sourceModuleName ?? "");
                  return;
                }
                setModuleId(v);
                // Mutex: selecting a real module disables the "new module name" input,
                // and any previously typed value would cause a duplicate on submit.
                if (v) setNewModuleName("");
              }}
              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">不选择，使用新模块</option>
              {bugTicketMode &&
                initialValues?.sourceModuleName &&
                !responsibility.modules.some((m) => m.name === initialValues.sourceModuleName) && (
                  <option value="__create_source_name__">
                    新建「{initialValues.sourceModuleName}」（预填）
                  </option>
                )}
              {(() => {
                const seen = new Set<string>();
                const items: { id: string; name: string }[] = [];
                for (const m of responsibility.modules) {
                  if (!seen.has(m.name)) {
                    seen.add(m.name);
                    items.push(m);
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
            <div className="relative">
              <input
                value={newModuleName}
                disabled={Boolean(moduleId)}
                onChange={(e) => {
                  setNewModuleName(e.target.value);
                  setShowModuleSuggestions(true);
                  setActiveSuggestionIndex(0);
                }}
                onFocus={() => !moduleId && setShowModuleSuggestions(true)}
                onBlur={() => {
                  // Defer closing so a mousedown on a suggestion can fire onClick first.
                  setTimeout(() => setShowModuleSuggestions(false), 120);
                }}
                onKeyDown={(e) => {
                  if (!suggestions.length) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1));
                    setShowModuleSuggestions(true);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveSuggestionIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && showModuleSuggestions) {
                    e.preventDefault();
                    const pick = suggestions[activeSuggestionIndex];
                    if (pick) {
                      setNewModuleName(pick.name);
                      // If the picked module already lives in this responsibility,
                      // also select it in the <select> so submission uses it directly
                      // instead of creating a duplicate.
                      const local = responsibility.modules.find((m) => m.name === pick.name);
                      if (local) {
                        setModuleId(local.id);
                        setSelectedOption(local.id);
                      }
                      setShowModuleSuggestions(false);
                    }
                  } else if (e.key === "Escape") {
                    setShowModuleSuggestions(false);
                  }
                }}
                placeholder={moduleId ? "已选择模块，无需新建" : "没有合适模块时填写"}
                autoComplete="off"
                className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400"
              />
              {showModuleSuggestions && !moduleId && suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-ink-200 bg-white shadow-elevated">
                  {suggestions.map((m, idx) => (
                    <li
                      key={`${m.id}-${idx}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setNewModuleName(m.name);
                        const local = responsibility.modules.find((mm) => mm.name === m.name);
                        if (local) {
                          setModuleId(local.id);
                          setSelectedOption(local.id);
                        }
                        setShowModuleSuggestions(false);
                      }}
                      onMouseEnter={() => setActiveSuggestionIndex(idx)}
                      className={`cursor-pointer px-3 py-2 text-sm ${
                        idx === activeSuggestionIndex ? "bg-brand-50 text-brand-700" : "hover:bg-ink-50"
                      }`}
                    >
                      {m.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {bugTicketMode && initialValues?.sourceModuleName && (() => {
              const sameNameExists = responsibility.modules.some(
                (m) => m.name === initialValues.sourceModuleName
              );
              if (sameNameExists) {
                return (
                  <span className="block text-xs text-ink-500">
                    bug 职能下已有同名模块「{initialValues.sourceModuleName}」，请从下拉中选择。
                  </span>
                );
              }
              return (
                <span className="block text-xs text-amber-700">
                  已预填源单模块名「{initialValues.sourceModuleName}」，提交将在 bug 职能下创建该模块后绑定本 Bug 单。
                </span>
              );
            })()}
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
          <span className="text-ink-700">截止日期（可选）</span>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full rounded-lg border border-ink-200 px-3 py-2 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-ink-700">优先级</span>
          <div className="flex gap-2">
            {([0, 1, 2, 3] as const).map((p) => (
              <label
                key={p}
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  priority === p
                    ? p === 0
                      ? "bg-red-100 text-red-700 border-red-300"
                      : p === 1
                        ? "bg-amber-100 text-amber-700 border-amber-300"
                        : p === 2
                          ? "bg-brand-50 text-brand-700 border-brand-300"
                          : "bg-ink-100 text-ink-600 border-ink-300"
                    : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                }`}
              >
                <input
                  type="radio"
                  name="priority"
                  value={p}
                  checked={priority === p}
                  onChange={() => setPriority(p)}
                  className="sr-only"
                />
                {PRIORITY_LABEL[p]}
              </label>
            ))}
          </div>
        </label>

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
            <div className="flex items-center gap-2 px-3 pt-2">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:bg-ink-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21,15 16,10 5,21" /></svg>
                上传图片
              </button>

              <AttachmentEditor
                attachments={attachments}
                onChange={handleAttachmentChange}
                onImageSelect={handleImageSelect}
                onError={handleAttachmentError}
                renderPreview={handleAttachmentPreview}
                compact
              />
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
                for (const file of files) insertImage(file);
                e.target.value = "";
              }}
            />
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
