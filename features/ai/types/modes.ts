/**
 * AiMode, ToolMode, AI_MODE_OPTIONS
 * Core mode types for the AI system.
 *
 * Type hierarchy:
 * - AiTaskCategory (UI Tab 层): "auto" | "chat" | "image" | "video"
 * - AiMode (用户可见模式): includes all tool sub-modes
 * - TaskType (模型路由粒度): used internally by model-routing
 * - ChatToolMode (chat 子工具): "chat" | "search" | "web" ⊂ AiTaskCategory.chat
 */

export type AiMode = "auto" | "search" | "chat" | "web" | "image" | "video";

/** Chat sub-mode within chat category */
export type ChatToolMode = "chat" | "web" | "search";

/** Top-level task category for UI tabs and model filtering */
export type AiTaskCategory = "auto" | "chat" | "image" | "video";

export interface AiModeOption {
  key: AiMode;
  label: string;
  icon: string;
  description: string;
}

export const AI_MODE_OPTIONS: AiModeOption[] = [
  {
    key: "auto",
    label: "自动",
    icon: "sparkles",
    description: "智能检测问题类型，自动选择最佳模式",
  },
  {
    key: "chat",
    label: "通用对话",
    icon: "message",
    description: "纯聊天模式，不检索知识库，快速响应",
  },
  {
    key: "image",
    label: "生图",
    icon: "image",
    description: "AI 图片生成，输入描述即可创作图像",
  },
  {
    key: "video",
    label: "视频",
    icon: "video",
    description: "AI 视频生成，输入描述即可创作视频",
  },
];

/** Sub-modes for the chat tab (collapsed into chat tab dropdown) */
export const CHAT_SUB_MODE_OPTIONS: { key: ChatToolMode; label: string; icon: string }[] = [
  { key: "chat", label: "通用对话", icon: "message" },
  { key: "search", label: "知识检索", icon: "search" },
  { key: "web", label: "联网搜索", icon: "globe" },
];
