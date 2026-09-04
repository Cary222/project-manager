"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  IconMic,
  IconMicWave,
  IconPause,
  IconSend,
  IconX,
  IconUpload,
  IconPlus,
} from "@/shared/ui/icons";
import { useSpeechInput } from "../hooks/use-speech-input";
import { useVoiceSession } from "../hooks/use-voice-session";
import { toast } from "sonner";
import {
  compressImage,
  ImageCompressionError,
} from "@/features/ai/lib/images/image-compressor";
import { uploadImageToFileAsset } from "@/features/ai/lib/images/upload-image-to-file-asset";
import type { ReasoningLevel } from "@/features/ai/llm/model-reasoning";

export interface ThinkingOption {
  value: ReasoningLevel;
  label: string;
  badge?: string;
  desc: string;
}

export const THINKING_OPTIONS: ThinkingOption[] = [
  {
    value: "high",
    label: "High",
    badge: "深度",
    desc: "高强度推理，适合复杂逻辑与代码",
  },
  {
    value: "medium",
    label: "Medium",
    badge: "均衡",
    desc: "平衡速度与推理质量",
  },
  { value: "low", label: "Low", badge: "快速", desc: "轻量快速思考，响应更快" },
  {
    value: "off",
    label: "Off",
    badge: "直出",
    desc: "关闭思考链，直接生成回答",
  },
];

function splitModelRef(ref?: string) {
  if (!ref) return { provider: "", modelId: "" };
  const idx = ref.indexOf(":");
  return {
    provider: idx >= 0 ? ref.slice(0, idx) : "",
    modelId: idx >= 0 ? ref.slice(idx + 1) : ref,
  };
}

interface AiChatInputProps {
  onSend: (
    message: string,
    images?: { id: string; url: string; name: string }[],
    inputFileIds?: { id: string; url: string; name: string }[],
  ) => void;
  onStop?: () => void;
  isGenerating?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 当前任务类别，用于控制参考图上传 UI 的显示 */
  taskCategory?: "chat" | "image" | "video";
  /** Image 模式专用：参考图上传完成回调 */
  onReferenceImagesChange?: (
    images: { id: string; url: string; name: string }[],
  ) => void;
  /** 外部传入的参考图（用于重连等场景） */
  initialReferenceImages?: { id: string; url: string; name: string }[];
  /**
   * Chat 模式专用：图片上传完成回调（携带 AiFileAsset.id，用于挂 INPUT 附件）
   * 如果不传，Chat 模式下上传图片仅本地预览不传给后端（向后兼容）
   */
  onChatImagesChange?: (
    images: { id: string; url: string; name: string }[],
  ) => void;
  /** 当前选中的模型，用于同步思考偏好 */
  selectedModel?: string;
  /** 当前思考强度受控属性 */
  thinkingLevel?: ReasoningLevel;
  /** 思考强度变更回调 */
  onThinkingLevelChange?: (level: ReasoningLevel) => void;
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
  onChatImagesChange,
  selectedModel,
  thinkingLevel: propThinkingLevel,
  onThinkingLevelChange,
}: AiChatInputProps) {
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<
    { id: string; url: string; name: string }[]
  >([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  // 思考强度状态与下拉框展开
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const [internalThinking, setInternalThinking] = useState<ReasoningLevel>(
    () => {
      if (propThinkingLevel) return propThinkingLevel;
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("preferredThinkingLevel");
        if (
          saved &&
          (saved === "off" ||
            saved === "minimal" ||
            saved === "low" ||
            saved === "medium" ||
            saved === "high" ||
            saved === "xhigh")
        ) {
          return saved as ReasoningLevel;
        }
      }
      return "high";
    },
  );
  const currentThinking = propThinkingLevel ?? internalThinking;

  // 点击外部关闭思考强度下拉菜单
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        thinkingDropdownRef.current &&
        !thinkingDropdownRef.current.contains(e.target as Node)
      ) {
        setThinkingDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectThinking = useCallback(
    async (level: ReasoningLevel) => {
      setInternalThinking(level);
      setThinkingDropdownOpen(false);
      onThinkingLevelChange?.(level);
      if (typeof window !== "undefined") {
        localStorage.setItem("preferredThinkingLevel", level);
      }
      if (selectedModel) {
        const { provider, modelId } = splitModelRef(selectedModel);
        if (provider && modelId) {
          try {
            await fetch("/api/ai/model-preferences", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                items: [
                  {
                    provider,
                    modelId,
                    thinkingLevel: level === "off" ? null : level,
                  },
                ],
              }),
            });
          } catch {
            // ignore network/auth errors silently
          }
        }
      }
    },
    [selectedModel, onThinkingLevelChange],
  );

  // Image 模式参考图上传 state（用于 I2I）
  const [referenceImages, setReferenceImages] = useState<
    { id: string; url: string; name: string }[]
  >(initialReferenceImages ?? []);
  const [uploadingReference, setUploadingReference] = useState(false);

  // 语音输入（STT）状态
  const [isVoiceInputRecording, setIsVoiceInputRecording] = useState(false);

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
  } = useVoiceSession({
    onTranscript: (text) => {
      setMessage((prev) => prev + (prev ? " " : "") + text);
    },
    onAiResponse: (text) => {
      // AI 回复完成后自动发送
      if (text.trim()) {
        onSend(text);
      }
    },
    onError: (error) => {
      console.error("[AiChatInput] Voice chat error:", error);
    },
  });

  const isVoiceChatActive = voiceChatStatus === "connected";

  // ── 语音输入处理 ──────────────────────────────────────────────────────────
  const handleVoiceInput = useCallback(async () => {
    if (isVoiceInputRecording || speechStatus === "recording") {
      await stopSpeechRecording();
      setIsVoiceInputRecording(false);
    } else {
      setIsVoiceInputRecording(true);
      await startSpeechRecording();
    }
  }, [
    isVoiceInputRecording,
    speechStatus,
    startSpeechRecording,
    stopSpeechRecording,
  ]);

  // ── 语音对话处理 ──────────────────────────────────────────────────────────
  const handleVoiceChat = useCallback(async () => {
    if (voiceChatStatus === "connecting" || voiceChatStatus === "connected") {
      stopVoiceChat();
    } else {
      await startVoiceChat();
    }
  }, [isVoiceChatActive, voiceChatStatus, startVoiceChat, stopVoiceChat]);

  // ── 图片处理 ──────────────────────────────────────────────────────────────
  const compressImageBlob = useCallback(
    (file: File, maxDim = 1600, quality = 0.82): Promise<Blob> => {
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
              quality,
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
    },
    [],
  );

  // ── Chat 模式图片上传：走 AiFileAsset 通道（#10208 Chat 识图） ───────────────
  const handleImageUpload = useCallback(
    async (file: File) => {
      if (uploadingImage) return;
      setUploadingImage(true);
      try {
        // 先压缩图片再上传（限制 1600px 边长，避免 token 超限）
        const compressed = await compressImageBlob(file, 1600, 0.82);
        const compressedFile = new File([compressed], file.name, {
          type: "image/jpeg",
        });
        console.log("[AiChatInput] 图片已压缩:", {
          original: `${(file.size / 1024).toFixed(1)}KB`,
          compressed: `${(compressed.size / 1024).toFixed(1)}KB`,
        });

        // 上传到 AiFileAsset（ownerId = session.user.id），返回 id 用于挂 INPUT 附件
        const result = await uploadImageToFileAsset(compressedFile);
        const newImage = { id: result.id, url: result.url, name: file.name };
        const updated = [...images, newImage];
        setImages(updated);
        onChatImagesChange?.(updated);
      } catch (err) {
        console.error("[AiChatInput] 图片上传失败:", err);
        if (err instanceof ImageCompressionError) {
          toast.error(err.message);
        } else {
          toast.error(
            `图片上传失败: ${err instanceof Error ? err.message : "未知错误"}`,
          );
        }
      } finally {
        setUploadingImage(false);
      }
    },
    [images, uploadingImage, onChatImagesChange, compressImageBlob],
  );

  const removeImage = useCallback(
    (id: string) => {
      setImages((prev) => {
        const next = prev.filter((img) => img.id !== id);
        onChatImagesChange?.(next);
        return next;
      });
    },
    [onChatImagesChange],
  );

  // ── Image 模式参考图上传（I2I）────────────────────────────────────────────
  const handleReferenceImageUpload = useCallback(
    async (file: File) => {
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
        const dataUri = await compressImage(file);
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
          const errorData = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
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
          toast.error(
            `参考图上传失败: ${err instanceof Error ? err.message : "未知错误"}`,
          );
        }
      } finally {
        setUploadingReference(false);
      }
    },
    [referenceImages, onReferenceImagesChange],
  );

  const removeReferenceImage = useCallback(
    (id: string) => {
      const updated = referenceImages.filter((img) => img.id !== id);
      setReferenceImages(updated);
      onReferenceImagesChange?.(updated);
    },
    [referenceImages, onReferenceImagesChange],
  );

  // ── 粘贴图片处理 ─────────────────────────────────────────────────────────
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData.items;
      let hasImage = false;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          hasImage = true;
          const file = item.getAsFile();
          if (file) {
            if (taskCategory === "image" || taskCategory === "video") {
              void handleReferenceImageUpload(file);
            } else {
              void handleImageUpload(file);
            }
          }
        }
      }

      if (hasImage) {
        e.preventDefault();
      }
    },
    [handleImageUpload, handleReferenceImageUpload, taskCategory],
  );

  // ── 发送逻辑 ──────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = message.trim();
      if ((!trimmed && images.length === 0) || disabled) return;

      const currentImages = [...images];
      const currentRefImages = [...referenceImages];

      setMessage("");
      setImages([]);
      onChatImagesChange?.([]);

      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      resetSpeechInput();

      onSend(
        trimmed,
        currentImages.length > 0 ? currentImages : undefined,
        currentRefImages.length > 0 ? currentRefImages : undefined,
      );
    },
    [
      message,
      images,
      referenceImages,
      disabled,
      onSend,
      onChatImagesChange,
      resetSpeechInput,
    ],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    lastCompositionEndAtRef.current = Date.now();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const isComposing =
        isComposingRef.current ||
        e.nativeEvent.isComposing ||
        e.keyCode === 229 ||
        Date.now() - lastCompositionEndAtRef.current < 100;

      if (e.key === "Enter" && !e.shiftKey) {
        if (isComposing) return;
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMessage(e.target.value);

      const textarea = e.target;
      if (textarea) {
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
      }
    },
    [],
  );

  const handleImageButtonClick = useCallback(() => {
    if (taskCategory === "image" || taskCategory === "video") {
      const refInput = document.getElementById("reference-image-input");
      if (refInput) {
        refInput.click();
        return;
      }
    }
    imageInputRef.current?.click();
  }, [taskCategory]);

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

  const getVoiceInputButtonClass = (): string => {
    if (isGenerating) {
      return "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-300 transition disabled:cursor-not-allowed";
    }
    if (isRecording) {
      return "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-danger bg-red-50 text-danger transition hover:border-danger hover:bg-red-100 animate-pulse";
    }
    if (isTranscribing) {
      return "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-300 bg-brand-50 text-brand-600 transition";
    }
    return "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600";
  };

  const getVoiceChatButtonClass = (): string => {
    if (isGenerating) {
      return "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-ink-50 text-ink-300 transition disabled:cursor-not-allowed";
    }
    if (isVoiceChatActive || isVoiceChatConnecting) {
      return "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-brand-300 bg-brand-50 text-brand-600 transition hover:border-brand-300 hover:bg-brand-100 animate-pulse";
    }
    return "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink-200 bg-white text-ink-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600";
  };

  const activeThinkingOption =
    THINKING_OPTIONS.find((opt) => opt.value === currentThinking) ??
    THINKING_OPTIONS[0];

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="relative flex-1">
        {/* Image/Video 模式参考图上传区域（I2I / I2V） */}
        {(taskCategory === "image" || taskCategory === "video") && (
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
                opacity:
                  uploadingReference || referenceImages.length >= 1 ? 0.5 : 1,
                pointerEvents:
                  uploadingReference || referenceImages.length >= 1
                    ? "none"
                    : "auto",
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
              <span className="text-xs text-ink-400">
                {taskCategory === "video"
                  ? "可选：上传参考图进行图生视频"
                  : "可选：上传参考图进行图生图"}
              </span>
            )}
          </div>
        )}

        {/* 聊天图片上传预览（仅 Chat 模式） */}
        {taskCategory === "chat" && images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 rounded-xl border border-ink-200 bg-white p-2">
            {images.map((img) => (
              <div key={img.id} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.name}
                  className="h-16 w-16 rounded-lg border border-ink-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white transition-opacity hover:bg-danger group-hover:flex"
                  aria-label="删除图片"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 现代胶囊输入框容器（ChatGPT 风格：内置 + 按钮，内置思考强度修改拉框） */}
        <div className="relative flex items-center rounded-full border border-ink-200 bg-white shadow-2xs transition-all focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-100/70">
          {/* 左侧 + 按钮 (上传图片/附件) */}
          <button
            type="button"
            onClick={handleImageButtonClick}
            disabled={disabled || isVoiceChatActive || uploadingImage}
            className="ml-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
            title="上传图片/附件"
            aria-label="上传图片/附件"
          >
            <IconPlus
              className={`h-4 w-4 ${uploadingImage ? "animate-pulse" : ""}`}
            />
          </button>

          {/* Textarea 输入主体 */}
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled || isVoiceChatActive}
            rows={1}
            className="w-full resize-none bg-transparent px-3 py-2.5 text-sm text-ink-900 placeholder-ink-400 focus:outline-none disabled:cursor-not-allowed disabled:text-ink-400"
            style={{ minHeight: "42px", maxHeight: "120px" }}
          />

          {/* 右侧内嵌控制区：录音状态指示 + 思考强度下拉修改拉框 */}
          <div className="mr-2 flex items-center gap-1.5 shrink-0">
            {/* 录音状态指示器 */}
            {isRecording && (
              <div className="flex items-center gap-1 text-xs text-red-500 mr-1">
                <span className="flex h-2 w-2 animate-pulse rounded-full bg-red-500" />
                <span className="tabular-nums font-mono font-medium">
                  {formatDuration(speechDuration)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void stopSpeechRecording();
                    setIsVoiceInputRecording(false);
                  }}
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-red-500 hover:bg-red-200"
                  aria-label="停止录音"
                >
                  <IconX className="h-2.5 w-2.5" />
                </button>
              </div>
            )}

            {/* 语音对话状态指示器 */}
            {(isVoiceChatActive || isVoiceChatConnecting) && (
              <div className="flex items-center gap-1 text-xs text-brand-600 mr-1">
                <span className="flex h-2 w-2 animate-pulse rounded-full bg-brand-500" />
                <span className="font-medium">
                  {isVoiceChatConnecting ? "连接中..." : "对话中"}
                </span>
              </div>
            )}

            {/* 思考强度修改拉框（Thinking Level Dropdown） */}
            <div className="relative" ref={thinkingDropdownRef}>
              <button
                type="button"
                onClick={() => setThinkingDropdownOpen((prev) => !prev)}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
                title="修改模型思考强度"
                aria-label="修改模型思考强度"
              >
                <span>{activeThinkingOption.label}</span>
                <svg
                  className={`h-3 w-3 text-ink-400 transition-transform duration-150 ${
                    thinkingDropdownOpen ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {/* 下拉菜单面板 */}
              {thinkingDropdownOpen && (
                <div className="absolute right-0 bottom-full mb-2 z-50 min-w-[180px] rounded-xl border border-ink-200 bg-white p-1.5 shadow-xl">
                  <div className="px-2 py-1 text-[10px] font-semibold text-ink-400 uppercase tracking-wider">
                    模型思考强度
                  </div>
                  {THINKING_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleSelectThinking(opt.value)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs text-left transition-colors ${
                        currentThinking === opt.value
                          ? "bg-brand-50 text-brand-700 font-semibold"
                          : "text-ink-700 hover:bg-ink-50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span>{opt.label}</span>
                        {opt.badge && (
                          <span className="rounded bg-ink-100 px-1 py-0.5 text-[9px] font-normal text-ink-500">
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      {currentThinking === opt.value && (
                        <svg
                          className="h-3.5 w-3.5 text-brand-600"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 隐藏的图片上传 input */}
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

      {/* 外置操作按钮组：麦克风 / 实时语音 / 发送 / 停止 */}
      <div className="flex items-center gap-1.5 shrink-0">
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger text-white shadow-sm transition hover:bg-red-600"
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
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 shadow-sm"
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
      </div>
    </form>
  );
}
