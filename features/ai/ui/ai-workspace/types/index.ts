/**
 * AI Workspace 类型兼容层
 * 
 * 桥接 pi-web 的 AgentMessage 类型与 project-manager 现有的 ChatMessage/WorkEvent 系统
 */

import type {
  AgentMessage,
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  CustomMessage,
  BashExecutionMessage,
  AssistantContentBlock,
} from "../lib/types";

/**
 * 简化的消息内容类型（兼容旧代码的 string 类型）
 */
export type MessageContent = string | AssistantContentBlock[];

/**
 * 扩展的 AgentMessage，支持 string content
 */
export interface ExtendedAgentMessage {
  role: AgentMessage["role"];
  content: MessageContent;
  timestamp?: number;
  model?: string;
  provider?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

/**
 * 转换字符串 content 为 AssistantContentBlock[]
 */
export function stringToContentBlocks(content: string): AssistantContentBlock[] {
  return [{ type: "text", text: content }];
}

/**
 * 转换 AssistantContentBlock[] 为字符串
 */
export function contentBlocksToString(blocks: AssistantContentBlock[] | string): string {
  if (typeof blocks === "string") return blocks;
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// Re-export pi-web types for use by other modules
export type {
  AgentMessage,
  AssistantMessage,
  UserMessage,
  ToolResultMessage,
  CustomMessage,
  BashExecutionMessage,
  AssistantContentBlock,
} from "../lib/types";

export type { Artifact } from "../types";
