"use client";

import { useRef, useState, useEffect } from "react";
import { IconX, IconKnowledge, IconSparkles } from "@/shared/ui/icons";
import { AiSourcesList, type SourceReference } from "./AiSourcesList";
import { UserProfilePanel, type AiUserProfile } from "./UserProfilePanel";
import { UnifiedModelSelector } from "@/features/ai/ui/model-select/UnifiedModelSelector";
import {
  AI_MODE_OPTIONS,
  CHAT_SUB_MODE_OPTIONS,
  type AiMode,
  type ChatToolMode,
} from "@/features/ai/types/modes";

export type InspectorTab = "info" | "sources" | "profile";

interface AiRightInspectorPanelProps {
  mode: "chat" | "work";
  conversationId: string | null;
  sources?: SourceReference[];
  userProfile?: AiUserProfile | null;
  onUserProfileChange?: (next: AiUserProfile) => void;
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  onClose: () => void;
  className?: string;
  // 提升自会话顶部的属性
  aiMode?: AiMode;
  onAiModeChange?: (mode: AiMode) => void;
  chatToolMode?: ChatToolMode;
  onChatToolModeChange?: (toolMode: ChatToolMode) => void;
  onSwitchToWorkMode?: () => void;
  onClearConversation?: () => void;
}

export function AiRightInspectorPanel({
  mode,
  conversationId,
  sources = [],
  userProfile = null,
  onUserProfileChange,
  selectedModel = "agnes:agnes-2.5-flash",
  onModelChange,
  onClose,
  className = "",
  aiMode = "auto",
  onAiModeChange,
  chatToolMode = "chat",
  onChatToolModeChange,
  onSwitchToWorkMode,
  onClearConversation,
}: AiRightInspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("info");
  const [chatToolModeOpen, setChatToolModeOpen] = useState(false);
  const chatToolDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        chatToolDropdownRef.current &&
        !chatToolDropdownRef.current.contains(e.target as Node)
      ) {
        setChatToolModeOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const modeCategory =
    aiMode === "image" ? "image" : aiMode === "video" ? "video" : "chat";

  return (
    <div
      className={`flex h-full w-full flex-col bg-white select-none ${className}`}
    >
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-ink-100 px-3.5">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-brand-50 text-brand-600 text-xs">
            ℹ️
          </span>
          <span className="text-xs font-semibold text-ink-800 tracking-tight">
            {mode === "chat" ? "会话辅助检查器" : "工作任务检查器"}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition"
          title="收起面板"
          aria-label="收起面板"
        >
          <IconX className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      {mode === "chat" && (
        <div className="flex border-b border-ink-100 bg-ink-50/60 px-2 py-1.5 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("info")}
            className={`flex-1 rounded-lg py-1 text-center text-xs font-medium transition ${
              activeTab === "info"
                ? "bg-white text-brand-700 shadow-2xs font-semibold"
                : "text-ink-500 hover:text-ink-800"
            }`}
          >
            会话属性
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("sources")}
            className={`flex-1 rounded-lg py-1 text-center text-xs font-medium transition ${
              activeTab === "sources"
                ? "bg-white text-brand-700 shadow-2xs font-semibold"
                : "text-ink-500 hover:text-ink-800"
            }`}
          >
            引用来源 {sources.length > 0 && `(${sources.length})`}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`flex-1 rounded-lg py-1 text-center text-xs font-medium transition ${
              activeTab === "profile"
                ? "bg-white text-brand-700 shadow-2xs font-semibold"
                : "text-ink-500 hover:text-ink-800"
            }`}
          >
            偏好画像
          </button>
        </div>
      )}

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {mode === "chat" ? (
          <>
            {activeTab === "info" && (
              <div className="space-y-3.5">
                {/* 1. 小星 AI 助手 形象与状态卡片 */}
                <div className="rounded-xl border border-brand-200/80 bg-gradient-to-br from-brand-50/60 via-white to-ink-50/40 p-3 shadow-2xs space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 via-brand-600 to-brand-700 text-white shadow-sm">
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-ink-900 text-sm">
                            小星 · AI 助手
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            就绪
                          </span>
                        </div>
                        <p className="text-[11px] text-ink-500 mt-0.5">
                          {aiMode === "auto"
                            ? "智能检测中"
                            : aiMode === "search"
                              ? "知识检索模式"
                              : aiMode === "image"
                                ? "生图模式"
                                : aiMode === "video"
                                  ? "视频模式"
                                  : "通用对话模式"}
                        </p>
                      </div>
                    </div>

                    {onSwitchToWorkMode && (
                      <button
                        type="button"
                        onClick={onSwitchToWorkMode}
                        className="flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2 py-1 text-xs font-medium text-brand-700 shadow-2xs transition hover:bg-brand-50"
                        title="切换到工作模式"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                        </svg>
                        <span>工作模式</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. 模式切换器（自动 / 通用对话 / 生图 / 视频） */}
                <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink-700">
                      对话模式
                    </span>
                    <span className="text-[10px] text-ink-400">
                      {aiMode === "auto"
                        ? "自动检测问题意图"
                        : aiMode === "chat"
                          ? chatToolMode === "search"
                            ? "知识库语义检索"
                            : chatToolMode === "web"
                              ? "联网搜索增强"
                              : "普通文本对话"
                          : aiMode === "image"
                            ? "图片生成 / 编辑"
                            : "视频合成创作"}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1 rounded-lg bg-ink-100 p-1">
                    {AI_MODE_OPTIONS.map((option) => (
                      <div key={option.key} className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            if (option.key === "chat") {
                              onAiModeChange?.("chat");
                              setChatToolModeOpen((v) => !v);
                            } else {
                              onAiModeChange?.(option.key);
                              setChatToolModeOpen(false);
                            }
                          }}
                          className={`w-full rounded-md py-1.5 text-center text-xs font-medium transition-all ${
                            aiMode === option.key ||
                            (option.key === "chat" &&
                              (aiMode === "chat" ||
                                aiMode === "search" ||
                                aiMode === "web"))
                              ? "bg-white text-brand-700 shadow-2xs font-semibold"
                              : "text-ink-600 hover:text-ink-900"
                          }`}
                          title={option.description}
                        >
                          <span>
                            {option.key === "chat"
                              ? (CHAT_SUB_MODE_OPTIONS.find(
                                  (s) => s.key === chatToolMode,
                                )?.label ?? "通用对话")
                              : option.label}
                          </span>
                          {option.key === "chat" && (
                            <svg
                              className={`ml-0.5 inline h-2.5 w-2.5 transition-transform ${
                                chatToolModeOpen ? "rotate-180" : ""
                              }`}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          )}
                        </button>

                        {/* 对话子模式下拉菜单 */}
                        {option.key === "chat" && chatToolModeOpen && (
                          <div
                            ref={chatToolDropdownRef}
                            className="absolute left-0 top-full z-50 mt-1 min-w-[130px] rounded-lg border border-ink-200 bg-white p-1 shadow-lg"
                          >
                            {CHAT_SUB_MODE_OPTIONS.map((sub) => (
                              <button
                                key={sub.key}
                                type="button"
                                onClick={() => {
                                  onChatToolModeChange?.(sub.key);
                                  onAiModeChange?.(
                                    sub.key === "chat" ? "chat" : sub.key,
                                  );
                                  setChatToolModeOpen(false);
                                }}
                                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-left transition-colors ${
                                  chatToolMode === sub.key
                                    ? "bg-brand-50 text-brand-700 font-medium"
                                    : "text-ink-700 hover:bg-ink-50"
                                }`}
                              >
                                <span>{sub.label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. 当前模型选择 */}
                <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink-700">
                      当前模型
                    </span>
                    <span className="text-[10px] text-ink-400 font-mono">
                      {modeCategory === "image"
                        ? "Image Model"
                        : modeCategory === "video"
                          ? "Video Model"
                          : "Chat Model"}
                    </span>
                  </div>
                  <UnifiedModelSelector
                    value={selectedModel}
                    onChange={onModelChange ?? (() => {})}
                    category={modeCategory}
                    autoMode={aiMode === "auto"}
                    fullWidth
                    align="full"
                    className="w-full text-xs"
                    dropdownClassName="w-full"
                  />
                </div>

                {/* 4. 会话元信息与操作 */}
                <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink-700">
                      会话信息
                    </span>
                    {onClearConversation && (
                      <button
                        type="button"
                        onClick={onClearConversation}
                        className="text-[11px] text-danger hover:underline font-medium"
                      >
                        清空对话
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5 text-[11px] text-ink-600">
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-ink-400">会话状态</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        在线就绪
                      </span>
                    </div>
                    {conversationId && (
                      <div className="flex items-center justify-between py-0.5">
                        <span className="text-ink-400">会话 ID</span>
                        <span
                          className="font-mono text-[10px] text-ink-500 truncate max-w-[150px]"
                          title={conversationId}
                        >
                          {conversationId}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. System Prompt Info */}
                <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-ink-700 font-medium">
                    <IconSparkles className="h-3.5 w-3.5 text-brand-600" />
                    <span>系统设定 (System Role)</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-ink-500">
                    恒星研项目管理平台智能助理「小星」，支持知识库召回、工单追踪管理、Git
                    代码提交自动化关联，以及自动化工作流向导。
                  </p>
                </div>

                {/* 6. Quick Shortcuts */}
                <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-2">
                  <span className="text-ink-700 font-medium block">
                    快捷指令参考
                  </span>
                  <div className="space-y-1 text-[11px] text-ink-600">
                    <div className="flex justify-between py-0.5">
                      <span className="font-mono text-ink-800">#10001</span>
                      <span className="text-ink-400">定位关联工单</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="font-mono text-ink-800">@知识库</span>
                      <span className="text-ink-400">检索文档库</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="font-mono text-ink-800">Cmd+B</span>
                      <span className="text-ink-400">折叠/展开侧边栏</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "sources" && (
              <div className="space-y-3">
                {sources.length > 0 ? (
                  <AiSourcesList sources={sources} />
                ) : (
                  <div className="rounded-xl border border-dashed border-ink-200 p-6 text-center text-ink-400">
                    <IconKnowledge className="mx-auto h-7 w-7 text-ink-300 mb-2" />
                    <p className="font-medium text-ink-600">
                      暂无引用的外部来源
                    </p>
                    <p className="mt-1 text-[11px] text-ink-400 leading-relaxed">
                      提问中涉及具体工单（如
                      #10001）、项目文档或知识库内容时，自动召回的参考来源将展示在这里。
                    </p>
                  </div>
                )}
              </div>
            )}

            {activeTab === "profile" && (
              <div className="space-y-3">
                <UserProfilePanel
                  profile={userProfile}
                  onChange={onUserProfileChange}
                  defaultCollapsed={false}
                />
              </div>
            )}
          </>
        ) : (
          /* Work Mode Inspector */
          <div className="space-y-4">
            <div className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-brand-900 font-medium">
                <span>⚡ Work 模式控制中心</span>
              </div>
              <p className="text-[11px] leading-relaxed text-brand-700">
                当前运行在通用办公工作台模式下。所有执行步骤均包含 LangGraph
                确定性流转、状态持久化与人机协同审批（HIL）。
              </p>
            </div>

            <div className="rounded-xl border border-ink-200 bg-white p-3 space-y-2">
              <span className="text-ink-700 font-medium block">
                支持的工作流类型
              </span>
              <div className="space-y-2 text-[11px]">
                <div className="p-2 rounded-lg bg-ink-50">
                  <span className="font-medium text-ink-800 block">
                    周报汇总 (Weekly Report)
                  </span>
                  <span className="text-ink-400">
                    汇总本周工单与代码提交，产出结构化周报。
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-ink-50">
                  <span className="font-medium text-ink-800 block">
                    会议纪要 (Meeting Minutes)
                  </span>
                  <span className="text-ink-400">
                    音频上传、智能语音识别与决议项提取。
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-ink-50">
                  <span className="font-medium text-ink-800 block">
                    代码任务 (Coding /plan)
                  </span>
                  <span className="text-ink-400">
                    接入 Pi Web 代码执行引擎，产出安全受控 Diff。
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
