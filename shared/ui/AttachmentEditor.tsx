"use client";

import { useRef } from "react";
import { AttachmentItem } from "@/shared/ui/AttachmentItem";
import { PKM_ATTACHMENT_MAX_COUNT, PKM_ATTACHMENT_MAX_SIZE, type PkmAttachment } from "@/shared/lib/pkm";
import { fileToDataUrl, formatBytes } from "@/shared/lib/upload";
import type { PreviewableFile } from "@/shared/ui/AttachmentItem";

export type { PreviewableFile };

export interface AttachmentEditorProps {
  attachments: PkmAttachment[];
  onChange: (next: PkmAttachment[]) => void;
  maxCount?: number;
  maxSize?: number;
  onError?: (msg: string) => void;
  renderPreview?: (file: PreviewableFile) => void;
  onImageSelect?: (file: File) => void;
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
  } = props;

  function appendAttachment(file: File) {
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

    fileToDataUrl(file).then((url) => {
      if (!url) return;
      onChange([
        ...attachments,
        {
          name: file.name,
          url,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        },
      ]);
    });
  }

  function removeAttachment(index: number) {
    onChange(attachments.filter((_, i) => i !== index));
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
                key={`${attachment.name}-${index}`}
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
