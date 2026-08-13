"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { IconMic, IconMicWave, IconPause, IconSend, IconX, IconImage, IconUpload } from "@/shared/ui/icons";
import { useSpeechInput } from "./hooks/use-speech-input";
import { useVoiceSession } from "./hooks/use-voice-session";
import { uploadImage } from "@/features/knowledge/lib/upload";
import { toast } from "sonner";
import { compressImage, ImageCompressionError } from "@/features/ai/lib/image-compressor";

interface AiChatInputProps {
  onSend: (
    message: string,
    images?: { src: string; name: string }[],
    inputFileIds?: { id: string; url: string; name: string }[]
  ) => void;
  onStop?: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 当前任务类别，用于控制参考图上传 UI 的显示 */
  taskCategory?: "chat" | "image" | "video";
  /** Image 模式专用：参考图上传完成回调 */
  onReferenceImagesChange?: (images: { id: string; url: string; name: string }[]) => void;
  /** 外部传入的参考图（用于重连等场景） */
  initialReferenceImages?: { id: string; url: string; name: string }[];
}

export function AiChatInput({
  onSend,
  onStop,
  isGenerating = false,
  disabled,
  placeholder = "输入消息...",
  taskCategory,
  onReferenceImagesChange,
  initialReferenceImages,
}: AiChatInputProps) {
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<{ src: string; name: string }[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Image 模式参考图上传 state（用于 I2I）
  const [referenceImages, setReferenceImages] = useState<{ id: string; url: string; name: string }[]>(
    initialReferenceImages ?? []
  );
  const [uploadingReference, setUploadingReference] = useState(false);

  // 语音输入（STT）状态
  const [isVoiceInputRecording, setIsVoiceInputRecording] = useState(false);

  // 语音对话（Realtime）状态
  const [isVoiceChatActive, setIsVoiceChatActive] = useState(false);
  const [voiceChatTranscript, setVoiceChatTranscript] = useState("");

  // ── STT Hook ────────────────────────────────────────────────────────────────
  const {
    status: speechStatus,
    duration: speechDuration,
    startRecording: startSpeechRecording,
    stopRecording: stopSpeechRecording,
    reset: resetSpeechInput,
  } = useSpeechInput({
    timeoutMs: 60_000,
    onTranscribe: (text) => {
      setMessage((prev) => prev + text);
      setIsVoiceInputRecording(false);
      textareaRef.current?.focus();
    },
    onError: (error) => {
      console.error("[AiChatInput] STT error:", error);
      setIsVoiceInputRecording(false);
    },
  });

  // ── Voice Chat Hook ───────────────────────────────────────────────────────
  const {
    startSession: startVoiceChat,
    stopSession: stopVoiceChat,
    status: voiceChatStatus,
    transcript: voiceTranscript,
    aiResponse: voiceAiResponse,
  } = useVoiceSession({
    onTranscript: (text) => {
      setVoiceChatTranscript((prev) => prev + (prev ? " " : "") + text);
    },
    onAiResponse: (text) => {
      // AI 回复完成后自动发送
      if (text.trim()) {
        onSend(text);
        setVoiceChatTranscript("");
      }
    },
    onError: (error) => {
      console.error("[AiChatInput] Voice chat error:", error);
      setIsVoiceChatActive(false);
    },
  });

  // 同步语音对话 transcript 到输入框
  useEffect(() => {
    if (voiceChatTranscript) {
      setMessage(voiceChatTranscript);
    }
  }, [voiceChatTranscript]);

  // 语音对话连接成功后的处理
  useEffect(() => {
    if (voiceChatStatus === "connected") {
      setIsVoiceChatActive(true);
    } else if (voiceChatStatus === "idle" || voiceChatStatus === "disconnected") {
      setIsVoiceChatActive(false);
    }
  }, [voiceChatStatus]);

  // ── 语音输入处理 ──────────────────────────────────────────────────────────
  const handleVoiceInput = useCallback(async () => {
    if (isVoiceInputRecording || speechStatus === "recording") {
      await stopSpeechRecording();
      setIsVoiceInputRecording(false);
    } else {
      setIsVoiceInputRecording(true);
      await startSpeechRecording();
    }
  }, [isVoiceInputRecording, speechStatus, startSpeechRecording, stopSpeechRecording]);

  // ── 语音对话处理 ──────────────────────────────────────────────────────────
  const handleVoiceChat = useCallback(async () => {
    if (isVoiceChatActive || voiceChatStatus === "connecting" || voiceChatStatus === "connected") {
      stopVoiceChat();
      setIsVoiceChatActive(false);
    } else {
      await startVoiceChat();
    }
  }, [isVoiceChatActive, voiceChatStatus, startVoiceChat, stopVoiceChat]);

  // ── 图片处理 ──────────────────────────────────────────────────────────────
  const compressImageBlob = useCallback((file: File, maxDim = 1600, quality = 0.82): Promise<Blob> => {
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
            quality
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
  }, []);

  const handleImageUpload = useCallback(
    async (file: File) => {
      if (uploadingImage) return;
      setUploadingImage(true);
      try {
        const compressed = await compressImageBlob(file);
        const compressedFile =
          compressed instanceof File
            ? compressed
            : new File([compressed], file.name.replace(/\.(png|webp|gif)$/i, ".jpg"), {
                type: "image/jpeg",
              });
        const { url } = await uploadImage(compressedFile);
        setImages((prev) => [...prev, { src: url, name: file.name }]);
      } catch (err) {
        console.error("[AiChatInput] 图片上传失败:", err);
      } finally {
        setUploadingImage(false);
      }
    },
    [compressImageBlob, uploadingImage]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      // 只在 Chat 模式处理粘贴图片，Image 模式不支持粘贴
      if (taskCategory !== "chat") return;

      const items = e.clipboardData.items;
      let hasImage = false;
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          hasImage = true;
          const file = item.getAsFile();
          if (file) {
            void handleImageUpload(file);
          }
        }
      }
      
      // 如果粘贴的是图片，阻止默认行为（不插入文本）
      if (hasImage) {
        e.preventDefault();
      }
    },
    [handleImageUpload]
  );

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── Image 模式参考图上传（I2I）────────────────────────────────────────────
  const handleReferenceImageUpload = useCallback(
    async (file: File) => {
      // 第一版限制：最多 1 张图片
      if (referenceImages.length >= 1) {
        toast.error("第一版最多支持 1 张参考图");
        return;
      }

      if (!file.type.startsWith("image/")) {
        toast.error("只支持图片文件");
        return;
      }

      setUploadingReference(true);
      try {
        // 使用压缩工具处理图片（resize + JPEG 80% + 大小保护），返回完整 data URI
        const dataUri = await compressImage(file);

        // BASE64 模式使用 JSON 而非 FormData（避免大文件 FormData 解析失败）
        const res = await fetch("/api/ai/file-assets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: "image/jpeg",
            fileSize: dataUri.length,
            source: "user_upload",
            storageType: "BASE64",
            storageKey: dataUri,
          }),
        });

        if (!res.ok) {
          const errorData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errorData.error ?? "上传失败");
        }

        const data = (await res.json()) as { id: string; url: string };

        const newImage = { id: data.id, url: dataUri, name: file.name };
        const updated = [...referenceImages, newImage];
        setReferenceImages(updated);
        onReferenceImagesChange?.(updated);
        toast.success("参考图上传成功");
      } catch (err) {
        console.error("[AiChatInput] 参考图上传失败:", err);
        if (err instanceof ImageCompressionError) {
          toast.error(err.message);
        } else {
          toast.error(`参考图上传失败: ${err instanceof Error ? err.message : "未知错误"}`);
        }
      } finally {
        setUploadingReference(false);
      }
    },
    [referenceImages, onReferenceImagesChange]
  );

  const removeReferenceImage = useCallback(
    (id: string) => {
      const updated = referenceImages.filter((img) => img.id !== id);
      setReferenceImages(updated);
      onReferenceImagesChange?.(updated);
    },
    [referenceImages, onReferenceImagesChange]
  );

  // ── 发送逻辑 ──────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = message.trim();
      if ((!trimmed && images.length === 0) || disabled) return;

      // 传递参考图给 onSend（用于 I2I）
      const inputFileIds =
        taskCategory === "image" && referenceImages.length > 0 ? referenceImages : undefined;
      onSend(trimmed, images.length > 0 ? images : undefined, inputFileIds);
      setMessage("");
      setImages([]);
      // 清空参考图（I2I 模式）
      if (taskCategory === "image") {
        setReferenceImages([]);
        onReferenceImagesChange?.([]);
      }

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    },
    [message, images, disabled, onSend, taskCategory, referenceImages, onReferenceImagesChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);

    const textarea = e.target;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  const handleImageButtonClick = useCallback(() => {
    imageInputRef.current?.click();
  }, []);

  const handleStop = useCallback(() => {
    onStop?.();
  }, [onStop]);

  // 格式化时长 MM:SS
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const hasContent = message.trim().length > 0 || images.length > 0;
  const isRecording = speechStatus === "recording";
  const isTranscribing = speechStatus === "transcribing";
  const isVoiceChatConnecting = voiceChatStatus === "connecting";

  // 计算语音输入按钮的 className
  const getVoiceInputButtonClass = (): string => {
    if (isGenerating) {
      return "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-300 transition disabled:cursor-not-allowed";
    }
    if (isRecording) {
      return "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-danger bg-red-50 text-danger transition hover:border-danger hover:bg-red-100 animate-pulse";
    }
    if (isTranscribing) {
      return "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-300 bg-brand-50 text-brand-600 transition";
    }
    return "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600";
  };

  // 计算语音对话按钮的 className
  const getVoiceChatButtonClass = (): string => {
    if (isGenerating) {
      return "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-300 transition disabled:cursor-not-allowed";
    }
    if (isVoiceChatActive || isVoiceChatConnecting) {
      return "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-brand-300 bg-brand-50 text-brand-600 transition hover:border-brand-300 hover:bg-brand-100 animate-pulse";
    }
    return "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600";
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        {/* Image 模式参考图上传区域（I2I） */}
        {taskCategory === "image" && (
          <div className="mb-2 flex items-center gap-2">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              id="reference-image-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleReferenceImageUpload(file);
                e.target.value = "";
              }}
            />
            <label
              htmlFor="reference-image-input"
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-1.5 text-xs font-medium text-brand-600 transition hover:border-brand-400 hover:bg-brand-50 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                opacity: uploadingReference || referenceImages.length >= 1 ? 0.5 : 1,
                pointerEvents: uploadingReference || referenceImages.length >= 1 ? "none" : "auto",
              }}
            >
              <IconUpload className="h-3.5 w-3.5" />
              {uploadingReference ? "上传中..." : "上传参考图"}
            </label>

            {/* 参考图预览 */}
            {referenceImages.map((img) => (
              <div key={img.id} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.name}
                  className="h-12 w-12 rounded-lg border border-ink-200 object-cover shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => removeReferenceImage(img.id)}
                  className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow transition-all hover:bg-red-600 group-hover:flex"
                  aria-label="删除参考图"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            ))}

            {referenceImages.length === 0 && !uploadingReference && (
              <span className="text-xs text-ink-400">可选：上传参考图进行图生图</span>
            )}
          </div>
        )}

        {/* 聊天图片上传预览（仅 Chat 模式） */}
        {taskCategory === "chat" && images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 rounded-xl border border-ink-200 bg-white p-2">
            {images.map((img, i) => (
              <div key={i} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.src}
                  alt={img.name}
                  className="h-16 w-16 rounded-lg border border-ink-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-danger group-hover:flex"
                  aria-label="删除图片"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled || isVoiceChatActive}
            rows={1}
            className="w-full resize-none rounded-2xl border border-ink-200 bg-white px-4 py-2.5 pr-12 text-sm text-ink-900 placeholder-ink-400 transition focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400"
            style={{ minHeight: "42px", maxHeight: "120px" }}
          />

          {/* 录音状态指示器 */}
          {isRecording && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <span className="flex h-2 w-2 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-medium text-red-500 tabular-nums">
                {formatDuration(speechDuration)}
              </span>
              <button
                type="button"
                onClick={() => {
                  void stopSpeechRecording();
                  setIsVoiceInputRecording(false);
                }}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-500 hover:bg-red-200"
                aria-label="停止录音"
              >
                <IconX className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* 语音对话状态指示器 */}
          {(isVoiceChatActive || isVoiceChatConnecting) && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              <span className="flex h-2 w-2 animate-pulse rounded-full bg-brand-500" />
              <span className="text-xs font-medium text-brand-600">
                {isVoiceChatConnecting ? "连接中..." : "语音对话中"}
              </span>
            </div>
          )}
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
            for (const file of files) {
              handleImageUpload(file);
            }
            e.target.value = "";
          }}
        />
      </div>

      {/* Chat 模式：图片上传按钮（Image 模式用上传参考图按钮） */}
      {taskCategory === "chat" && (
        <>
          <button
            type="button"
            onClick={handleImageButtonClick}
            disabled={disabled || isVoiceChatActive || uploadingImage}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            title="上传图片"
            aria-label="上传图片"
          >
            <IconImage className={uploadingImage ? "animate-pulse" : ""} />
          </button>
        </>
      )}

      {isGenerating ? (
        <>
          <button
            type="button"
            disabled
            className={getVoiceInputButtonClass()}
            title="语音输入（生成中不可用）"
            aria-label="语音输入（生成中不可用）"
          >
            <IconMic />
          </button>
          <button
            type="button"
            disabled
            className={getVoiceChatButtonClass()}
            title="语音对话（生成中不可用）"
            aria-label="语音对话（生成中不可用）"
          >
            <IconMicWave />
          </button>
          <button
            type="button"
            onClick={handleStop}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger text-white shadow-sm transition hover:bg-red-600"
            title="停止对话"
            aria-label="停止对话"
          >
            <IconPause />
          </button>
        </>
      ) : hasContent ? (
        <>
          <button
            type="submit"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700"
            title="发送"
            aria-label="发送消息"
          >
            <IconSend />
          </button>
          <button
            type="button"
            onClick={handleVoiceChat}
            disabled={isVoiceChatActive || isVoiceChatConnecting}
            className={getVoiceChatButtonClass()}
            title="语音对话"
            aria-label="语音对话"
          >
            <IconMicWave />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={handleVoiceInput}
            disabled={isVoiceChatActive || isVoiceChatConnecting}
            className={getVoiceInputButtonClass()}
            title={isRecording ? "停止录音" : "语音输入"}
            aria-label={isRecording ? "停止录音" : "语音输入"}
          >
            {isRecording ? <IconX /> : <IconMic />}
          </button>
          <button
            type="button"
            onClick={handleVoiceChat}
            disabled={isVoiceChatActive || isVoiceChatConnecting}
            className={getVoiceChatButtonClass()}
            title={isVoiceChatActive ? "停止语音对话" : "语音对话"}
            aria-label={isVoiceChatActive ? "停止语音对话" : "语音对话"}
          >
            <IconMicWave />
          </button>
        </>
      )}
    </form>
  );
}
