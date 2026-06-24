"use client";

import { useState } from "react";
import { type PkmAttachment } from "@/shared/lib/pkm";
import { AttachmentItem, type PreviewableFile } from "@/shared/ui/AttachmentItem";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";

interface Props {
  attachments: PkmAttachment[];
}

export function NoteAttachments({ attachments }: Props) {
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);

  return (
    <>
      {previewFile && (
        <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
      {attachments.length > 0 && (
        <div className="mt-6 border-t border-ink-100 pt-4">
          <h2 className="text-sm font-medium text-ink-800">附件</h2>
          <div className="mt-3 space-y-2">
            {attachments.map((attachment, index) => (
              <AttachmentItem
                key={`${attachment.name}-${index}`}
                attachment={attachment}
                onPreview={setPreviewFile}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
