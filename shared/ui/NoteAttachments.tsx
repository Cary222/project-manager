"use client";

import { AttachmentItem } from "@/shared/ui/AttachmentItem";
import type { FileAttachment } from "@/shared/lib/pkm";

type NoteAttachmentsProps = {
  attachments: FileAttachment[];
};

export function NoteAttachments({ attachments }: NoteAttachmentsProps) {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-5 rounded-lg border border-ink-200 bg-ink-50/60 p-4">
      <p className="mb-3 text-sm font-medium text-ink-700">附件</p>
      <ul className="space-y-2">
        {attachments.map((att, i) => (
          <AttachmentItem key={`${att.fileId}-${i}`} attachment={att} />
        ))}
      </ul>
    </div>
  );
}
