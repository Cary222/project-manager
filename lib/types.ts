/**
 * Central types for project-manager lib
 * Re-exports and defines shared types used across lib/
 */

// Re-export Theme from pi-coding-agent
export type { Theme } from "@earendil-works/pi-coding-agent";

// Re-export SessionHeader and SessionEntry from pi-coding-agent
export type { SessionHeader, SessionEntry, SessionEntryBase } from "@earendil-works/pi-coding-agent";

// SessionContext from pi-coding-agent
export type { SessionContext } from "@earendil-works/pi-coding-agent";

// AgentMessage from pi-agent-core
export type { AgentMessage } from "@earendil-works/pi-agent-core";

// Re-export Extension types from ai-workspace
export type {
  ExtensionUiRequest,
  ExtensionUiResponse,
  BlockingExtensionUiRequest,
} from "@/features/ai/ui/ai-workspace/lib/types";

export type { ExtensionStatusItem, ExtensionWidgetItem } from "@/features/ai/ui/ai-workspace/lib/types";

// Re-export SessionMessageEntry from ai-workspace
export type { SessionMessageEntry } from "@/features/ai/ui/ai-workspace/lib/types";

/**
 * SessionInfo - mirrors pi-coding-agent SessionInfo with all required fields
 */
export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  allMessagesText?: string;
  parentSessionId?: string;
  parentSessionPath?: string;
  projectRoot?: string;
  projectKey?: string;
  worktreeBranch?: string;
  transient?: boolean;
  model?: {
    provider: string;
    modelId: string;
  } | null;
}

// Locale types
export type Locale = string;

export interface TranslationParams {
  [key: string]: string | number | boolean | undefined;
}

// Locale plugin for i18n system
export interface LocalePlugin {
  locale: Locale;
  messages: Record<string, string>;
  pluralRules?: (n: number) => number;
}

// Message preview for session entries
export interface MessagePreview {
  role?: "user" | "assistant";
  text?: string;
}

// Branch preview for git
export interface BranchPreview {
  branch: string;
  ahead: number;
  behind: number;
  hasUncommitted: boolean;
  isClean: boolean;
}
