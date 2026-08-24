"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCopy } from "@/shared/ui/icons";

interface MessageCopyButtonProps {
  content: string;
}

const BUTTON_CLASSES = "text-ink-400 hover:bg-ink-100 hover:text-ink-700";

export function MessageCopyButton({ content }: MessageCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400/40 ${BUTTON_CLASSES}`}
      aria-label={copied ? "已复制消息" : "复制消息"}
      title={copied ? "已复制" : "复制消息"}
    >
      {copied ? <IconCheck className="h-3 w-3 text-emerald-500" /> : <IconCopy className="h-3 w-3" />}
      <span>{copied ? "已复制" : "复制"}</span>
    </button>
  );
}
