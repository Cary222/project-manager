"use client";

import { useState } from "react";
import { AttachmentItem, type PreviewableFile } from "@/shared/ui/AttachmentItem";
import type { FileAttachment } from "@/features/knowledge/lib/pkm";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";

type NoteAttachmentsProps = {
  attachments: FileAttachment[];
  onPreview?: (file: PreviewableFile) => void;
};

export function NoteAttachments({ attachments, onPreview }: NoteAttachmentsProps) {
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  const handlePreview = (file: PreviewableFile) => {
    setPreviewFile(file);
    onPreview?.(file);
  };

  return (
    <>
      {previewFile && (
        <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      <div className="mt-5 rounded-lg border border-ink-200 bg-ink-50/60 p-4">
        <p className="mb-3 text-sm font-medium text-ink-700">附件</p>
        <ul className="space-y-2">
          {attachments.map((att, i) => (
            <AttachmentItem key={`${att.fileId}-${i}`} attachment={att} onPreview={handlePreview} />
          ))}
        </ul>
      </div>
    </>
  );
}
