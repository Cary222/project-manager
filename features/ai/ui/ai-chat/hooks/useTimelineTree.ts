/**
 * TreeBuilder — converts flat TaskRecord Map to nested TreeNode array.
 *
 * Architecture:
 *   graph.stream() → Route → TimelineAdapter → TimelineStore → TreeBuilder → React
 *
 * Usage:
 *   const tree = useMemo(() => buildTree(records), [records]);
 */

import type { TaskRecord, TaskStatus } from "@/features/ai/types/timeline";

/**
 * TreeNode — nested representation for UI rendering.
 * Each node contains children for sub-task trees.
 */
export interface TreeNode {
  id: string;
  title: string;
  status: TaskStatus;
  detail?: string;
  startTime: number;
  endTime?: number;
  /** Duration in milliseconds */
  duration?: number;
  category: TaskRecord["category"];
  children: TreeNode[];
  metadata?: Record<string, unknown>;
}

/**
 * Build a tree from flat TaskRecords.
 *
 * Algorithm:
 * 1. Create TreeNode for each TaskRecord
 * 2. Establish parent-child relationships based on parentId
 * 3. Sort siblings by startTime
 *
 * Note: In v1, all tasks have parentId=null (root level).
 * Future versions may spawn sub-tasks via parallel nodes.
 */
export function buildTree(records: TaskRecord[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // 1. Create TreeNode for each TaskRecord
  for (const record of records) {
    nodes.set(record.id, {
      id: record.id,
      title: record.title,
      status: record.status,
      detail: record.detail,
      startTime: record.startTime,
      endTime: record.endTime,
      duration: record.endTime ? record.endTime - record.startTime : undefined,
      category: record.category,
      children: [],
      metadata: record.metadata,
    });
  }

  // 2. Establish parent-child relationships
  for (const record of records) {
    const node = nodes.get(record.id)!;
    if (record.parentId && nodes.has(record.parentId)) {
      // Attach to parent
      nodes.get(record.parentId)!.children.push(node);
    } else {
      // Root node
      roots.push(node);
    }
  }

  // 3. Sort siblings by startTime (ascending)
  const sortByTime = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.startTime - b.startTime);
    arr.forEach((n) => sortByTime(n.children));
  };
  sortByTime(roots);

  return roots;
}

/**
 * Format duration for display.
 * e.g., 500ms → "500ms", 1500ms → "1.5s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Get status display config for UI.
 */
export function getStatusConfig(status: TaskStatus): {
  icon: string;
  className: string;
  label: string;
} {
  switch (status) {
    case "pending":
      return { icon: "○", className: "status-pending", label: "等待中" };
    case "running":
      return { icon: "●", className: "status-running", label: "进行中" };
    case "success":
      return { icon: "✓", className: "status-success", label: "已完成" };
    case "warning":
      return { icon: "⚠", className: "status-warning", label: "跳过" };
    case "error":
      return { icon: "✗", className: "status-error", label: "错误" };
    default:
      return { icon: "?", className: "status-unknown", label: "未知" };
  }
}

/**
 * Get category display config for UI.
 */
export function getCategoryConfig(category: TaskRecord["category"]): {
  icon: string;
  label: string;
} {
  switch (category) {
    case "reason":
      return { icon: "🧠", label: "推理" };
    case "tool":
      return { icon: "🔧", label: "工具" };
    case "workflow":
      return { icon: "⚙", label: "工作流" };
    case "system":
      return { icon: "⚡", label: "系统" };
    case "human":
      return { icon: "👤", label: "人工" };
    default:
      return { icon: "📌", label: "其他" };
  }
}
