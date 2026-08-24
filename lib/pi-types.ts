import type {
  AgentSessionEvent,
  BashOperations,
  SessionManager,
  SettingsManager,
  SlashCommandInfo,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ModelLike {
  id: string;
  provider: string;
}

export interface ToolInfo {
  name: string;
  description: string;
}

export interface NavigateTreeResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

export interface SessionStatsInfo {
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  contextUsage?: ContextUsage;
  /** Estimated active time across all entries in the session file. */
  totalActiveMs?: number;
}

interface PromptTemplateLike {
  name: string;
  description?: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface SkillLike {
  name: string;
  description?: string;
  sourceInfo: SlashCommandInfo["sourceInfo"];
}

interface ResourceLoaderLike {
  getSkills(): { skills: SkillLike[] };
}

interface ExtensionRunnerLike {
  getRegisteredCommands(): Array<{
    invocationName: string;
    description?: string;
    sourceInfo: SlashCommandInfo["sourceInfo"];
  }>;
  emit?(event: { type: "session_shutdown"; reason: "quit" }): Promise<unknown>;
  setUIContext?(uiContext?: unknown, mode?: "tui" | "rpc" | "json" | "print"): void;
}

type DialogOptionsLike = {
  signal?: AbortSignal;
  timeout?: number;
};

type WidgetOptionsLike = {
  placement?: "aboveEditor" | "belowEditor";
};

export interface ExtensionUiContextLike {
  select(title: string, options: string[], opts?: DialogOptionsLike): Promise<string | undefined>;
  confirm(title: string, message: string, opts?: DialogOptionsLike): Promise<boolean>;
  input(title: string, placeholder?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  editor(title: string, prefill?: string, opts?: DialogOptionsLike): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
  onTerminalInput(): () => void;
  setStatus(key: string, text: string | undefined): void;
  setWorkingMessage(message?: string): void;
  setWorkingVisible(visible: boolean): void;
  setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }): void;
  setHiddenThinkingLabel(label?: string): void;
  setWidget(key: string, content: string[] | ((...args: never[]) => unknown) | undefined, options?: WidgetOptionsLike): void;
  setFooter(factory: unknown): void;
  setHeader(factory: unknown): void;
  setTitle(title: string): void;
  custom<T = unknown>(...args: unknown[]): Promise<T>;
  pasteToEditor(text: string): void;
  setEditorText(text: string): void;
  getEditorText(): string;
  addAutocompleteProvider(): void;
  setEditorComponent(): void;
  getEditorComponent(): undefined;
  readonly theme: Theme;
  getAllThemes(): unknown[];
  getTheme(name: string): undefined;
  setTheme(theme: unknown): { success: boolean; error?: string };
  getToolsExpanded(): boolean;
  setToolsExpanded(expanded: boolean): void;
}

export interface AgentSessionLike {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly isStreaming: boolean;
  readonly isCompacting: boolean;
  readonly autoCompactionEnabled: boolean;
  readonly autoRetryEnabled: boolean;
  readonly model: ModelLike | undefined;
  readonly modelRuntime: {
    getModel: (provider: string, modelId: string) => ModelLike | undefined;
    refresh: (options?: { allowNetwork?: boolean }) => Promise<unknown>;
  };
  readonly sessionManager: SessionManager;
  readonly settingsManager: SettingsManager;
  readonly agent: {
    state?: {
      systemPrompt?: string;
      thinkingLevel?: string;
      streamingMessage?: AgentMessage;
    };
  };
  readonly extensionRunner: ExtensionRunnerLike;
  readonly promptTemplates: readonly PromptTemplateLike[];
  readonly resourceLoader: ResourceLoaderLike;

  readonly bindExtensions?: unknown;
  dispose(): void;
  reload(options?: { beforeSessionStart?: () => void | Promise<void> }): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, options?: {
    images?: Array<{ type: "image"; data: string; mimeType: string }>;
    streamingBehavior?: "steer" | "followUp";
    source?: "interactive" | "rpc";
    preflightResult?: (success: boolean) => void;
  }): Promise<void>;
  abort(): Promise<void>;
  executeBash(command: string, onChunk?: (chunk: string) => void, options?: {
    excludeFromContext?: boolean;
    operations?: BashOperations;
  }): Promise<{ output: string; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string }>;
  abortBash(): void;
  readonly isBashRunning: boolean;
  setModel(model: ModelLike): Promise<void>;
  navigateTree(targetId: string, options?: { summarize?: boolean }): Promise<NavigateTreeResult>;
  setThinkingLevel(level: string): void;
  compact(customInstructions?: string): Promise<unknown>;
  setSessionName(name: string): void;
  getSessionStats(): Omit<SessionStatsInfo, "sessionName">;
  getLastAssistantText(): string | undefined;
  setAutoCompactionEnabled(enabled: boolean): void;
  setAutoRetryEnabled(enabled: boolean): void;
  steer(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  followUp(text: string, images?: Array<{ type: "image"; data: string; mimeType: string }>): Promise<void>;
  readonly pendingMessageCount: number;
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  clearQueue(): { steering: string[]; followUp: string[] };
  getAllTools(): ToolInfo[];
  getActiveToolNames(): string[];
  setActiveToolsByName(names: string[]): void;
  abortCompaction(): void;
  getContextUsage(): ContextUsage | undefined;
}

// ─── API route helpers ─────────────────────────────────────────────────────────

export interface GetSessionsIndexResult {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  parentSessionId?: string;
  transient?: boolean;
  projectRoot?: string;
  projectKey?: string;
  worktreeBranch?: string;
}

export interface GetSessionDataResult {
  sessionId: string;
  filePath: string;
  totalActiveMs: number;
  tree: unknown[];
  leafId: string | null;
  context: {
    messages: unknown[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

/** Returns IDs of sessions currently running in-process. */
export function getRunningSessionIds(): string[] {
  // session-registry.ts is the stable shared module; rpc-manager.ts and pi-types.ts
  // both depend on it, breaking the cycle that prevented a direct import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRunningRpcSessionIds } = require("@/lib/session-registry");
  return getRunningRpcSessionIds();
}

/** Returns all session summaries (disk-backed + transient), enriched with project info. */
export async function getSessionsIndex(): Promise<GetSessionsIndexResult[]> {
  const { listAllSessions } = await import("@/lib/session-reader");
  return listAllSessions() as Promise<GetSessionsIndexResult[]>;
}

/** Loads a single session's full data from its JSONL file. Returns null if not found. */
export async function getSessionData(
  sessionId: string,
  options: { deferThinking?: boolean; deferMedia?: boolean } = {},
): Promise<GetSessionDataResult | null> {
  const { resolveSessionPath, getSessionEntries, buildSessionContext } = await import("@/lib/session-reader");
  const { computeSessionTotalActiveMs } = await import("@/lib/session-timing");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");

  const filePath = await resolveSessionPath(sessionId);
  if (!filePath) return null;

  const manager = SessionManager.open(filePath);
  const entries = await getSessionEntries(filePath);
  const ctx = await buildSessionContext(entries, undefined, {
    deferThinking: options.deferThinking,
    deferToolResultImages: options.deferMedia,
  });
  const totalActiveMs = computeSessionTotalActiveMs(entries as readonly { type: string; timestamp: string; message?: { role?: string } }[]);

  void manager;

  return {
    sessionId,
    filePath,
    totalActiveMs,
    tree: [],
    leafId: null,
    context: {
      messages: ctx.messages,
      entryIds: ctx.entryIds,
      thinkingLevel: ctx.thinkingLevel ?? "auto",
      model: ctx.model ?? null,
    },
  };
}
