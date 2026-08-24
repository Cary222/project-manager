/**
 * AI Workspace 类型别名层
 * 
 * 为兼容现有代码，提供简化的类型定义
 */

import type { AgentMessage, AssistantMessage, UserMessage, ToolResultMessage, CustomMessage, BashExecutionMessage, AssistantContentBlock, TextContent } from "./lib/types";

export type { AgentMessage, AssistantMessage, UserMessage, ToolResultMessage, CustomMessage, BashExecutionMessage, AssistantContentBlock, TextContent } from "./lib/types";

/**
 * Artifact 类型定义
 */
export interface Artifact {
  filename: string;
  content: string;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 简化的消息内容类型（用于旧代码的 string content）
 */
export interface SimpleMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

/**
 * 转换 SimpleMessage 为 UserMessage 或 AssistantMessage
 */
export function toAgentMessage(msg: SimpleMessage): UserMessage | AssistantMessage {
  if (msg.role === "user") {
    return {
      role: "user",
      content: msg.content,
      timestamp: msg.timestamp,
    } as UserMessage;
  }
  return {
    role: "assistant",
    content: [{ type: "text", text: msg.content }],
    model: "",
    provider: "",
    timestamp: msg.timestamp,
  } as AssistantMessage;
}
