"use client";

import { useRef } from "react";
import { AttachmentItem } from "@/shared/ui/AttachmentItem";
import { PKM_ATTACHMENT_MAX_COUNT, PKM_ATTACHMENT_MAX_SIZE, type FileAttachment } from "@/features/knowledge/lib/pkm";
import { uploadFile, formatBytes } from "@/features/knowledge/lib/upload";
import type { PreviewableFile } from "@/shared/ui/DocumentPreviewModal";

export type { PreviewableFile };

export interface AttachmentEditorProps {
  attachments: FileAttachment[];
  onChange: (next: FileAttachment[]) => void;
  maxCount?: number;
  maxSize?: number;
  onError?: (msg: string) => void;
  renderPreview?: (file: PreviewableFile) => void;
  onImageSelect?: (file: File) => void;
  compact?: boolean;
}

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

export function AttachmentEditor(props: AttachmentEditorProps) {
  const {
    attachments,
    maxCount = PKM_ATTACHMENT_MAX_COUNT,
    maxSize = PKM_ATTACHMENT_MAX_SIZE,
    onError,
    onChange,
    renderPreview,
    onImageSelect,
    compact = false,
  } = props;

  async function appendAttachment(file: File) {
    if (attachments.length >= maxCount) {
      onError?.(`最多上传 ${maxCount} 个附件`);
      return;
    }

    if (file.size > maxSize) {
      onError?.(`附件 ${file.name} 超过 ${formatBytes(maxSize)} 限制`);
      return;
    }

    if (isImageFile(file) && onImageSelect) {
      onImageSelect(file);
      return;
    }

    try {
      const result = await uploadFile(file);
      onChange([
        ...attachments,
        { fileId: result.fileId, name: result.name, mimeType: result.mimeType, size: result.size },
      ]);
    } catch {
      onError?.(`上传失败：${file.name}`);
    }
  }

  function removeAttachment(index: number) {
    onChange(attachments.filter((_, i) => i !== index));
  }

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2">
        <label className="w-fit cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100">
          上传附件
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) appendAttachment(file);
              e.currentTarget.value = "";
            }}
          />
        </label>

        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {attachments.map((att, i) => (
              <div
                key={`${att.fileId}-${i}`}
                className="group flex items-center gap-1.5 rounded border border-ink-200 bg-ink-50 px-2 py-1 text-xs text-ink-700"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 3 14 8 19 8" />
                </svg>
                <span className="truncate max-w-[120px]" title={att.name}>
                  {att.name || att.fileId.slice(0, 8)}
                </span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-ink-300 text-white hover:bg-danger"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <label className="w-fit cursor-pointer rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100">
        上传附件
        <input
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) appendAttachment(file);
            e.currentTarget.value = "";
          }}
        />
      </label>

      {attachments.length > 0 ? (
        <div className="w-full rounded-lg border border-ink-200 bg-ink-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink-700">附件</p>
            <p className="text-xs text-ink-400">
              最多 {maxCount} 个，单个不超过 {formatBytes(maxSize)}
            </p>
          </div>
          <div className="space-y-2">
            {attachments.map((attachment, index) => (
              <AttachmentItem
                key={`${attachment.fileId}-${index}`}
                attachment={attachment}
                onPreview={renderPreview}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((_, index) => (
              <button
                key={`remove-${index}`}
                type="button"
                onClick={() => removeAttachment(index)}
                className="rounded-lg border border-ink-200 px-2 py-1 text-xs text-danger hover:bg-rose-50"
              >
                删除
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
