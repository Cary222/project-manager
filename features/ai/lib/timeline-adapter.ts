/**
 * TimelineAdapter — converts LangGraph GraphChunk to TimelineCommands.
 *
 * Philosophy: "Graph events → User language" not "Graph events → Program log"
 *
 * Architecture:
 *   graph.stream() → Route → TimelineAdapter → TimelineStore → SSE → React
 *
 * Key design:
 * - Each node fires TWO commands: "node_start" (create task) and "node_end" (update task)
 * - Titles are user-facing, not node names
 * - Details are extracted from tool results and formatted for humans
 */

import type { TaskRecord, TaskStatus } from "@/features/ai/types/timeline";
import {
  NODE_CATEGORY_MAP,
  NODE_STEP_LABELS,
  NODE_DISPLAY_TITLES,
} from "@/features/ai/types";

// ─── Execution ID Counter ───────────────────────────────────────────────────────

/** Counter to ensure unique IDs even for the same node called multiple times */
let executionCounter = 0;
function nextId(): string {
  return `exec-${Date.now()}-${++executionCounter}`;
}

// ─── Command Factories ─────────────────────────────────────────────────────────

/**
 * Create a "create" command — fires when a node STARTS.
 * Task is created in "running" status immediately.
 */
export function createTaskCmd(data: {
  id: string;
  stepLabel: string;
  title: string;
  category: TaskRecord["category"];
  status: TaskStatus;
  startTime: number;
}) {
  return {
    op: "create" as const,
    task: {
      id: data.id,
      parentId: null,
      stepLabel: data.stepLabel,
      title: data.title,
      status: data.status,
      detail: undefined,
      startTime: data.startTime,
      endTime: undefined,
      category: data.category,
      metadata: undefined,
    } satisfies TaskRecord,
  };
}

/**
 * Create an "update" command — fires when a node ENDS.
 * Updates status, endTime, and optional detail/metadata.
 */
export function updateTaskCmd(
  id: string,
  updates: Partial<TaskRecord>,
) {
  return { op: "update" as const, id, updates };
}

// ─── Detail Extraction ─────────────────────────────────────────────────────────

/**
 * Extract a human-readable detail string from node output.
 * This is the key to making the timeline feel like "AI thinking" not "program log".
 *
 * Examples:
 *   { queryType: "ambiguous", candidates: [...] }  → "需要确认用户身份：刘工 · 张工"
 *   { candidates: [...] }  → "刘工 · 张工 · 王工"
 *   { resolvedEntities: { user: {...} } }  → "已确认：刘工"
 *   { attribution: { kind: "user_activity", targetUserName: "刘工" } }  → "刘工的活动"
 *   { mode: "search" }  → "使用搜索模式"
 *   { mode: "chat" }  → "闲聊模式"
 *   { pendingHumanAction: {...} }  → "等待确认"
 *   { response: "..." }  → "回答已生成"
 *
 * Exported for unit testing. The function is otherwise an implementation detail
 * of `adaptGraphChunk` / `onNodeEnd`.
 */
export function extractDetail(nodeOutput: Record<string, unknown>): string | undefined {
  // Disambiguation: "需要确认用户身份"
  if (nodeOutput.queryType === "ambiguous" && Array.isArray(nodeOutput.candidates)) {
    const labels = nodeOutput.candidates
      .slice(0, 3)
      .map((c: unknown) => {
        if (typeof c === "object" && c !== null) {
          const obj = c as Record<string, unknown>;
          return (obj.label ?? obj.name ?? String(c)) as string;
        }
        return String(c);
      });
    const rest = nodeOutput.candidates.length > 3 ? `等${nodeOutput.candidates.length}人` : "";
    return `需要确认用户身份：${labels.join(" · ")}${rest}`;
  }

  // Candidates list
  if (Array.isArray(nodeOutput.candidates) && nodeOutput.candidates.length > 0) {
    const labels = nodeOutput.candidates
      .slice(0, 4)
      .map((c: unknown) => {
        if (typeof c === "object" && c !== null) {
          const obj = c as Record<string, unknown>;
          return (obj.label ?? obj.name ?? String(c)) as string;
        }
        return String(c);
      });
    const rest = nodeOutput.candidates.length > 4 ? `等${nodeOutput.candidates.length}个` : "";
    return labels.join(" · ") + rest;
  }

  // Resolved entities — "已确认：刘工"
  if (nodeOutput.resolvedEntities && typeof nodeOutput.resolvedEntities === "object") {
    const entities = nodeOutput.resolvedEntities as Record<string, unknown>;
    const resolved = Object.entries(entities)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k]) => {
        if (k === "user" && typeof entities.user === "object") {
          return (entities.user as Record<string, unknown>).name as string ?? k;
        }
        if (k === "weekly_report" || k === "ticket" || k === "project") return k;
        return k;
      });
    if (resolved.length > 0) {
      return `已确认：${resolved.join("、")}`;
    }
  }

  // Attribution — "刘工的活动"
  if (nodeOutput.attribution && typeof nodeOutput.attribution === "object") {
    const attr = nodeOutput.attribution as Record<string, unknown>;
    if (
      attr.kind === "user_activity" &&
      typeof attr.targetUserName === "string"
    ) {
      return `${attr.targetUserName} 的活动`;
    }
  }

  // Mode hints
  if (nodeOutput.mode === "search") return "搜索模式";
  if (nodeOutput.mode === "chat") return "闲聊模式";
  if (nodeOutput.mode === "web") return "联网模式";

  // Pending human action
  if (nodeOutput.pendingHumanAction) return "等待确认";

  // Response generated
  if (typeof nodeOutput.response === "string" && nodeOutput.response.length > 0) {
    const preview = nodeOutput.response.slice(0, 30).replace(/\n/g, " ");
    return nodeOutput.response.length > 30 ? `${preview}…` : preview;
  }

  // Tool results summary
  const toolResults = nodeOutput.toolResults;
  if (toolResults && typeof toolResults === "object") {
    for (const [, result] of Object.entries(toolResults as Record<string, unknown>)) {
      if (!result || typeof result !== "object") continue;
      const r = result as Record<string, unknown>;
      if (typeof r.count === "number") return `找到 ${r.count} 条记录`;
      if (typeof r.summary === "string" && r.summary.length > 0) {
        const preview = r.summary.slice(0, 40).replace(/\n/g, " ");
        return r.summary.length > 40 ? `${preview}…` : preview;
      }
    }
  }

  return undefined;
}

// ─── Graph Chunk Adapter ───────────────────────────────────────────────────────

/**
 * Adapt a single node output from graph.stream().
 *
 * Call this function TWICE per node:
 *   1. onNodeStart() — immediately when you know the node is starting
 *   2. onNodeEnd()   — when the node's output is available
 *
 * This separates "log append" from "status update" so the frontend
 * can show tasks appearing one by one (log stream style).
 */
export function adaptGraphChunk(
  nodeName: string,
  nodeOutput: Record<string, unknown>,
  onCommand: (
    cmd:
      | ReturnType<typeof createTaskCmd>
      | ReturnType<typeof updateTaskCmd>,
  ) => void,
): void {
  const category = NODE_CATEGORY_MAP[nodeName] ?? "system";
  const title = NODE_DISPLAY_TITLES[nodeName] ?? `执行 ${nodeName}`;
  const stepLabel = NODE_STEP_LABELS[nodeName] ?? nodeName;
  const executionId = nextId();
  const startTime = Date.now();

  // ── 1. Node START — task appears in the timeline immediately ────────────────
  onCommand(
    createTaskCmd({
      id: executionId,
      stepLabel,
      title,
      category,
      status: "running",
      startTime,
    }),
  );

  // ── 2. Determine final status ─────────────────────────────────────────────
  let finalStatus: TaskStatus = "success";
  let errorMessage: string | undefined;

  const pendingHA = nodeOutput.pendingHumanAction;
  if (
    pendingHA &&
    typeof pendingHA === "object" &&
    (pendingHA as Record<string, unknown>).type === "select"
  ) {
    finalStatus = "running"; // Still waiting for human
  }

  const toolResults = nodeOutput.toolResults;
  if (toolResults && typeof toolResults === "object") {
    for (const [, result] of Object.entries(
      toolResults as Record<string, unknown>,
    )) {
      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        if (r.error && typeof r.error === "string") {
          finalStatus = "error";
          errorMessage = r.error;
        }
      }
    }
  }

  // ── 3. Node END — update status, timing, and detail ───────────────────────
  const updates: Partial<TaskRecord> = {
    status: finalStatus,
    endTime: Date.now(),
  };

  const detail = extractDetail(nodeOutput);
  if (detail) {
    updates.detail = detail;
  }

  if (errorMessage) {
    updates.metadata = { error: errorMessage };
  }

  onCommand(updateTaskCmd(executionId, updates));
}

/**
 * Fire a "node start" event only — for true log-stream behavior.
 *
 * Call this when you know a node is starting (e.g., before awaiting its output).
 * Then call onNodeEnd() separately when the result arrives.
 *
 * @param nodeName - the LangGraph node name
 * @param startTime - the timestamp when the node STARTED (captured by caller before await)
 * @param onCommand - callback to apply the command
 * @returns executionId for correlation with onNodeEnd()
 */
export function onNodeStart(
  nodeName: string,
  startTime: number,
  onCommand: (cmd: ReturnType<typeof createTaskCmd>) => void,
): string {
  const category = NODE_CATEGORY_MAP[nodeName] ?? "system";
  const title = NODE_DISPLAY_TITLES[nodeName] ?? `执行 ${nodeName}`;
  const stepLabel = NODE_STEP_LABELS[nodeName] ?? nodeName;
  const executionId = nextId();

  onCommand(
    createTaskCmd({
      id: executionId,
      stepLabel,
      title,
      category,
      status: "running",
      startTime,
    }),
  );

  return executionId;
}

/**
 * Fire a "node end" event only — updates an existing task.
 *
 * @param executionId — the ID returned by onNodeStart()
 * @param nodeOutput  — the result from the node (used for detail extraction)
 */
export function onNodeEnd(
  executionId: string,
  nodeOutput: Record<string, unknown>,
  onCommand: (cmd: ReturnType<typeof updateTaskCmd>) => void,
): void {
  let finalStatus: TaskStatus = "success";
  let errorMessage: string | undefined;

  const pendingHA = nodeOutput.pendingHumanAction;
  if (
    pendingHA &&
    typeof pendingHA === "object" &&
    (pendingHA as Record<string, unknown>).type === "select"
  ) {
    finalStatus = "running";
  }

  const toolResults = nodeOutput.toolResults;
  if (toolResults && typeof toolResults === "object") {
    for (const [, result] of Object.entries(
      toolResults as Record<string, unknown>,
    )) {
      if (result && typeof result === "object") {
        const r = result as Record<string, unknown>;
        if (r.error && typeof r.error === "string") {
          finalStatus = "error";
          errorMessage = r.error;
        }
      }
    }
  }

  const updates: Partial<TaskRecord> = {
    status: finalStatus,
    endTime: Date.now(),
  };

  const detail = extractDetail(nodeOutput);
  if (detail) {
    updates.detail = detail;
  }

  if (errorMessage) {
    updates.metadata = { error: errorMessage };
  }

  onCommand(updateTaskCmd(executionId, updates));
}
