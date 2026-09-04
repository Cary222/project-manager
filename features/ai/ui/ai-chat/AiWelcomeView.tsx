"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  IconSend,
  IconMic,
  IconMicWave,
  IconPlus,
  IconX,
} from "@/shared/ui/icons";
import { UnifiedModelSelector } from "@/features/ai/ui/model-select/UnifiedModelSelector";
import { useSpeechInput } from "./hooks/use-speech-input";
import { uploadImageToFileAsset } from "@/features/ai/lib/images/upload-image-to-file-asset";
import { toast } from "sonner";
import type { WorkRoute } from "@/features/ai/agents/work/runtime/work-run-ref";

export type WelcomeMode = "chat" | "work";

export interface CustomWorkflowItem {
  id: string;
  title: string;
  description: string;
  icon?: string;
  route?: WorkRoute;
  promptTemplate: string;
}

interface AiWelcomeViewProps {
  initialMode?: WelcomeMode;
  onStartChat: (
    message: string,
    modelName: string,
    images?: { id: string; url: string; name: string }[]
  ) => void;
  onStartWork: (
    goal: string,
    route?: WorkRoute,
    modelName?: string
  ) => void;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  /** 自定义固化工作流列表（供后续 Coding 模式生成并动态挂载） */
  customWorkflows?: CustomWorkflowItem[];
  className?: string;
}

export function AiWelcomeView({
  initialMode = "chat",
  selectedModel: propSelectedModel,
  onModelChange,
  onStartChat,
  onStartWork,
  customWorkflows = [],
  className = "",
}: AiWelcomeViewProps) {
  const [mode, setMode] = useState<WelcomeMode>(initialMode);
  const [input, setInput] = useState("");
  const [internalModel, setInternalModel] = useState("agnes:agnes-2.5-flash");
  const selectedModel = propSelectedModel ?? internalModel;
  const handleModelChange = onModelChange ?? setInternalModel;
  const [images, setImages] = useState<{ id: string; url: string; name: string }[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 56), 180);
    el.style.height = `${nextHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Focus textarea when mode changes
  useEffect(() => {
    textareaRef.current?.focus();
  }, [mode]);

  // STT Voice input
  const {
    status: speechStatus,
    duration: speechDuration,
    startRecording,
    stopRecording,
  } = useSpeechInput({
    timeoutMs: 60_000,
    onTranscribe: (text) => {
      setInput((prev) => prev + (prev ? " " : "") + text);
      textareaRef.current?.focus();
    },
    onError: (err) => {
      console.error("[AiWelcomeView] STT error:", err);
      toast.error("语音识别错误，请重试");
    },
  });

  const isRecording = speechStatus === "recording";

  // Handle image upload
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) {
          toast.error("目前仅支持上传图片格式附件");
          continue;
        }
        const uploaded = await uploadImageToFileAsset(file);
        setImages((prev) => [...prev, { id: uploaded.id, url: uploaded.url, name: file.name }]);
      }
    } catch (err) {
      console.error("[AiWelcomeView] Upload error:", err);
      toast.error("图片上传失败，请重试");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleRemoveImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Submit action
  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed && images.length === 0) return;

    if (mode === "chat") {
      onStartChat(trimmed || "请分析上传的附件", selectedModel, images);
    } else {
      onStartWork(trimmed, undefined, selectedModel);
    }
  }, [images, input, mode, onStartChat, onStartWork, selectedModel]);

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
    [handleSubmit]
  );

  // Quick prompt suggestions
  const chatSuggestions = [
    {
      icon: "🎨",
      title: "生成图片或设计原型",
      desc: "利用 FLUX/Seedream 模型根据文字生成图片或设计图",
      prompt: "帮我生成一张现代极简风格的项目管理仪表盘概念设计图",
    },
    {
      icon: "✍️",
      title: "编写或润色文档",
      desc: "撰写技术方案、发布说明或重构计划书",
      prompt: "帮我撰写一份关于前端工作台组件化重构的技术说明文档",
    },
    {
      icon: "🌐",
      title: "检索知识库与工单",
      desc: "查询系统工单流转规范与知识库最佳实践",
      prompt: "系统中如何规范关联 Git 提交和工单？有哪些自动化规则？",
    },
  ];

  const workSuggestions = [
    {
      icon: "📊",
      title: "生成本周工作周报",
      desc: "汇总本周活跃工单与代码提交，生成结构化周报",
      route: "weekly_report" as WorkRoute,
      prompt: "汇总我本周负责的工单与代码提交，生成一份本周工作周报",
    },
    {
      icon: "🎙️",
      title: "整理会议纪要录音",
      desc: "上传录音音频进行智能转录并提炼会议行动项",
      route: "meeting_minutes" as WorkRoute,
      prompt: "整理会议录音纪要，提取会议决议与待办事项分配",
    },
    {
      icon: "📈",
      title: "汇总项目进展报告",
      desc: "聚合多维度工单、Git 提交与知识库指标",
      route: "project_progress" as WorkRoute,
      prompt: "聚合当前项目的工单完成度与核心里程碑进展，生成综合项目报告",
    },
    {
      icon: "💻",
      title: "执行代码开发任务",
      desc: "创建受控 Coding 任务并生成实施方案与 Diff",
      route: "coding" as WorkRoute,
      prompt: "/plan 为项目增加三面板折叠工作区支持",
    },
  ];

  return (
    <div
      className={`flex flex-col h-full w-full items-center justify-between px-4 py-8 overflow-y-auto ${className}`}
    >
      {/* 1. Top Mode Switcher Tab (ChatGPT style) */}
      <div className="flex shrink-0 items-center justify-center pt-2">
        <div className="inline-flex items-center p-1 rounded-full bg-ink-100/90 border border-ink-200/60 shadow-2xs">
          <button
            type="button"
            onClick={() => setMode("chat")}
            className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${
              mode === "chat"
                ? "bg-white text-ink-900 shadow-xs scale-100"
                : "text-ink-500 hover:text-ink-800"
            }`}
          >
            对话
          </button>
          <button
            type="button"
            onClick={() => setMode("work")}
            className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${
              mode === "work"
                ? "bg-white text-ink-900 shadow-xs scale-100"
                : "text-ink-500 hover:text-ink-800"
            }`}
          >
            工作
          </button>
        </div>
      </div>

      {/* 2. Center Content: Hero Greetings + Input Box + Suggestions */}
      <div className="flex flex-col items-center justify-center w-full max-w-2xl my-auto py-6">
        {/* Hero Title */}
        <div className="text-center mb-6 select-none">
          <h1 className="text-2xl sm:text-3xl font-semibold text-ink-900 tracking-tight">
            {mode === "chat" ? "今天想聊点什么？" : "有什么工作任务需要处理？"}
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-ink-500 max-w-md mx-auto">
            {mode === "chat"
              ? "支持自由探索问答、知识库检索、工单查询与日常工作交流"
              : "自动分诊确定性工作流：周报生成、会议纪要转写、项目进展与受控代码开发"}
          </p>
        </div>

        {/* Input Box Card */}
        <div className="w-full rounded-3xl border border-ink-200 bg-white p-3.5 shadow-soft focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-50 transition-all">
          {/* Attached image preview chips */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-1">
              {images.map((img, idx) => (
                <div
                  key={img.id || idx}
                  className="group relative flex items-center gap-1.5 rounded-xl border border-ink-200 bg-ink-50 px-2.5 py-1 text-xs text-ink-700"
                >
                  <span className="truncate max-w-[120px]">{img.name || `图片 ${idx + 1}`}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(idx)}
                    className="text-ink-400 hover:text-danger transition"
                    title="移除图片"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main textarea */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            rows={1}
            placeholder={
              mode === "chat"
                ? "问问小星，或输入 @ 引用工单/项目..."
                : "描述工作目标，例如：汇总本周工单并生成周报 / 帮我审查 ticket 模块..."
            }
            className="w-full resize-none border-0 bg-transparent px-2 text-sm leading-relaxed text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-0"
          />

          {/* Bottom controls row */}
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-ink-100/60 pt-2 px-1">
            <div className="flex items-center gap-1">
              {/* Add attachment button */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-500 hover:bg-ink-100 hover:text-ink-800 transition disabled:opacity-50"
                title="上传图片参考或附件"
              >
                <IconPlus className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Unified Model Selector */}
              <UnifiedModelSelector
                value={selectedModel}
                onChange={handleModelChange}
                category={mode === "chat" ? "chat" : "chat"}
                className="h-8 text-xs"
                dropdownClassName="w-72"
              />

              {/* Speech Input Microphone */}
              <button
                type="button"
                onClick={isRecording ? stopRecording : () => void startRecording()}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
                  isRecording
                    ? "bg-danger text-white animate-pulse"
                    : "text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                }`}
                title={isRecording ? `录音中 (${speechDuration}s) - 点击停止` : "语音输入"}
              >
                {isRecording ? (
                  <IconMicWave className="h-4 w-4" />
                ) : (
                  <IconMic className="h-4 w-4" />
                )}
              </button>

              {/* Send Button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={(!input.trim() && images.length === 0) || isUploading}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white shadow-xs hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                title="发送"
              >
                <IconSend className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* 3. Quick Prompt Suggestions List */}
        <div className="w-full mt-6 space-y-2">
          {mode === "chat"
            ? chatSuggestions.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => {
                    setInput(item.prompt);
                    textareaRef.current?.focus();
                  }}
                  className="flex items-center gap-3 w-full p-2.5 rounded-2xl border border-transparent hover:border-ink-200 hover:bg-ink-50/70 text-left transition group"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ink-100/80 text-base group-hover:bg-white group-hover:shadow-2xs transition">
                    {item.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-800 group-hover:text-brand-700 transition">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-ink-400 truncate">{item.desc}</p>
                  </div>
                </button>
              ))
            : [
                ...workSuggestions,
                ...customWorkflows.map((cw) => ({
                  icon: cw.icon || "⚡",
                  title: cw.title,
                  desc: cw.description,
                  route: cw.route,
                  prompt: cw.promptTemplate,
                })),
              ].map((item) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => {
                    setInput(item.prompt);
                    textareaRef.current?.focus();
                  }}
                  className="flex items-center gap-3 w-full p-2.5 rounded-2xl border border-transparent hover:border-ink-200 hover:bg-ink-50/70 text-left transition group"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-base text-brand-700 group-hover:bg-white group-hover:shadow-2xs transition">
                    {item.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-ink-800 group-hover:text-brand-700 transition">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-ink-400 truncate">{item.desc}</p>
                  </div>
                </button>
              ))}
        </div>
      </div>

      {/* Footer subtle hint */}
      <footer className="shrink-0 text-center text-[11px] text-ink-400 select-none pb-1">
        <span>小星 AI 由恒星研大模型与 LangGraph 驱动 · 内容仅供参考</span>
      </footer>
    </div>
  );
}
