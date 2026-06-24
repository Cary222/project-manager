"use client";

import { type PkmAttachment } from "@/shared/lib/pkm";
import { type PreviewableFile } from "@/shared/ui/DocumentPreviewModal";

export type { PreviewableFile };

function getFileBadge(mimeType: string) {
  if (mimeType === "application/pdf")
    return (
      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-600">
        PDF
      </span>
    );
  if (mimeType.includes("word"))
    return (
      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-bold text-blue-600">
        DOC
      </span>
    );
  if (mimeType.includes("presentation"))
    return (
      <span className="rounded bg-orange-50 px-1.5 py-0.5 text-xs font-bold text-orange-600">
        PPT
      </span>
    );
  if (mimeType.startsWith("image/"))
    return (
      <span className="rounded bg-purple-50 px-1.5 py-0.5 text-xs font-bold text-purple-600">
        IMG
      </span>
    );
  return (
    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs font-medium text-ink-500">
      文件
    </span>
  );
}

function isPreviewable(mimeType: string) {
  return (
    [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ].includes(mimeType) ||
    mimeType.startsWith("image/")
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  attachment: PkmAttachment;
  onPreview?: (file: PreviewableFile) => void;
}

export function AttachmentItem({ attachment, onPreview }: Props) {
  const canPreview = isPreviewable(attachment.mimeType);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-sm hover:border-brand-200 hover:bg-brand-50/40">
      <div className="flex min-w-0 items-center gap-2">
        {getFileBadge(attachment.mimeType)}
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-700">
            {attachment.name}
          </p>
          <p className="text-xs text-ink-400">
            {attachment.mimeType} · {formatBytes(attachment.size)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {canPreview && (
          <button
            type="button"
            onClick={() =>
              onPreview?.({
                name: attachment.name,
                url: attachment.url,
                mimeType: attachment.mimeType,
              })
            }
            className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:border-brand-300 hover:text-brand-700"
          >
            预览
          </button>
        )}
        <a
          href={attachment.url}
          download={attachment.name}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100"
        >
          下载
        </a>
      </div>
    </div>
  );
}
