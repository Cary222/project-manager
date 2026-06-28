export type AiMode = "auto" | "search" | "chat";

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
    key: "search",
    label: "知识检索",
    icon: "search",
    description: "强制搜索知识库，获取准确的项目相关信息",
  },
  {
    key: "chat",
    label: "通用对话",
    icon: "message",
    description: "纯聊天模式，不检索知识库，快速响应",
  },
];
