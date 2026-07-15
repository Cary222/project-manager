"use client";

import { useRef, useState } from "react";
import { IconPlus } from "@/shared/ui/icons";

interface Props {
  /** 上传处理函数，抛出 Error 表示失败。 */
  onUpload: (file: File) => Promise<void>;
  label?: string;
  hint?: string;
  accept?: string;
  disabled?: boolean;
}

export function FileUploader({
  onUpload,
  label = "上传文件",
  hint,
  accept = "*/*",
  disabled,
}: Props) {
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setFlash(null);
    try {
      await onUpload(file);
      setFlash({ type: "success", message: "上传成功" });
    } catch (err) {
      setFlash({ type: "error", message: err instanceof Error ? err.message : "上传失败" });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      {flash && (
        <div
          className={`mb-3 rounded-lg px-3 py-2 text-sm ${
            flash.type === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {flash.message}
        </div>
      )}
      <div className="flex items-center gap-3">
        <label
          className={`flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-dashed border-ink-300 px-4 py-2 text-sm text-ink-500 transition-colors ${
            disabled || uploading
              ? "cursor-not-allowed opacity-50"
              : "hover:border-brand-300 hover:text-brand-600"
          }`}
        >
          {uploading ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-600" />
              上传中…
            </span>
          ) : (
            <>
              <IconPlus className="h-4 w-4" />
              {label}
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={accept}
            disabled={disabled || uploading}
            onChange={handleChange}
          />
        </label>
        {hint && <span className="text-xs text-ink-400">{hint}</span>}
      </div>
    </div>
  );
}
