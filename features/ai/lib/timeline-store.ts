/**
 * TimelineStore — flat Map-based store for TaskRecords.
 *
 * Architecture:
 *   graph.stream() → Route → TimelineAdapter → TimelineStore → TreeBuilder → React
 *
 * Design:
 * - Flat Map<string, TaskRecord> for O(1) updates
 * - Command-based mutations (CRDT-style)
 * - Subscriber pattern for reactive updates
 *
 * Usage in Route:
 *   const store = new TimelineStore();
 *   const unsub = store.onUpdate((tasks) => sendSSE({ type: "timeline_snapshot", tasks }));
 *   for await (const chunk of graphStream) {
 *     adaptGraphChunk(nodeName, nodeOutput, (cmd) => store.applyCommand(cmd));
 *   }
 */

import type { TaskRecord, TimelineCommand } from "@/features/ai/types/timeline";

type UpdateCallback = (tasks: Map<string, TaskRecord>) => void;

export class TimelineStore {
  private tasks: Map<string, TaskRecord> = new Map();
  private listeners: Set<UpdateCallback> = new Set();

  /**
   * Apply a TimelineCommand mutation.
   * All subscribers will be notified after the mutation.
   */
  applyCommand(cmd: TimelineCommand): void {
    switch (cmd.op) {
      case "create":
        this.tasks.set(cmd.task.id, cmd.task);
        break;

      case "update": {
        const existing = this.tasks.get(cmd.id);
        if (existing) {
          this.tasks.set(cmd.id, { ...existing, ...cmd.updates });
        }
        break;
      }

      case "delete":
        this.tasks.delete(cmd.id);
        break;

      case "snapshot":
        this.tasks.clear();
        for (const task of cmd.tasks) {
          this.tasks.set(task.id, task);
        }
        break;
    }
    this.notifyUpdate();
  }

  /**
   * Subscribe to task map changes.
   * Returns an unsubscribe function.
   */
  onUpdate(callback: UpdateCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Get all tasks as a Map.
   * Returns a copy to prevent external mutation.
   */
  getTasks(): Map<string, TaskRecord> {
    return new Map(this.tasks);
  }

  /**
   * Get a single task by ID.
   */
  getTask(id: string): TaskRecord | undefined {
    return this.tasks.get(id);
  }

  /**
   * Check if store has any tasks.
   */
  isEmpty(): boolean {
    return this.tasks.size === 0;
  }

  /**
   * Get task count.
   */
  size(): number {
    return this.tasks.size;
  }

  /**
   * Clear all tasks and notify subscribers.
   */
  clear(): void {
    this.tasks.clear();
    this.notifyUpdate();
  }

  private notifyUpdate(): void {
    const snapshot = new Map(this.tasks);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error("[TimelineStore] listener error:", err);
      }
    }
  }
}
