"use client";

import { type FileAttachment } from "@/features/knowledge/lib/pkm";
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
  if (mimeType === "text/markdown" || mimeType === "text/x-markdown")
    return (
      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-600">
        MD
      </span>
    );
  if (mimeType.includes("spreadsheet") || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return (
      <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-bold text-green-600">
        XLSX
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
      "text/markdown",
      "text/x-markdown",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
  attachment: FileAttachment;
  onPreview?: (file: PreviewableFile) => void;
}

export function AttachmentItem({ attachment, onPreview }: Props) {
  const mimeType = attachment.mimeType ?? "application/octet-stream";
  const fileName = attachment.name ?? "未知文件";
  const size = attachment.size ?? 0;

  const downloadUrl = `/api/upload/${attachment.fileId}`;
  const previewUrl = downloadUrl;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2 text-sm hover:border-brand-200 hover:bg-brand-50/40">
      <div className="flex min-w-0 items-center gap-2">
        {getFileBadge(mimeType)}
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-700">
            {fileName}
          </p>
          <p className="text-xs text-ink-400">
            {mimeType} · {formatBytes(size)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {isPreviewable(mimeType) && (
          <button
            type="button"
            onClick={() =>
              onPreview?.({
                name: fileName,
                url: previewUrl,
                mimeType,
              })
            }
            className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:border-brand-300 hover:text-brand-700"
          >
            预览
          </button>
        )}
        <a
          href={downloadUrl}
          download={fileName}
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
