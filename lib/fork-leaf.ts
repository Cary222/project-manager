/**
 * 会话分叉叶子解析（供 lib/rpc-manager.ts case "fork" 使用）。
 *
 * @earendil-works/pi-coding-agent 的 SessionManager.createBranchedSession(leafId)
 * 复制 root→leaf 全路径且**包含** leaf 本身。因此：
 * - 从用户消息 fork：传 parentId（排除被点的问题，维持旧行为）
 * - 从 AI 回答 fork：传回合末尾的 entry（包含该回答；若是带工具调用的
 *   中间步骤，则沿子链包含后续 toolResult 直到回合结束，避免
 *   tool_use/tool_result 配对断裂导致下次调用报 API 错误）
 */

export interface ForkLeafEntry {
  id: string;
  parentId?: string | null;
  type?: string;
  message?: { role?: string } | null;
}

const isUserMessageEntry = (e: ForkLeafEntry): boolean =>
  e.type === "message" && e.message?.role === "user";

export function resolveForkLeaf(entries: readonly ForkLeafEntry[], entryId: string): string {
  const children = new Map<string, ForkLeafEntry[]>();
  let start: ForkLeafEntry | undefined;
  for (const e of entries) {
    if (e.id === entryId) start = e;
    if (e.parentId) {
      const list = children.get(e.parentId);
      if (list) list.push(e);
      else children.set(e.parentId, [e]);
    }
  }
  if (!start) throw new Error(`Entry ${entryId} not found`);

  if (isUserMessageEntry(start)) {
    if (!start.parentId) throw new Error(`Entry ${entryId} has no parent to branch at`);
    return start.parentId;
  }

  // AI 回答：沿子链前进，跳过非用户消息 entry（toolResult / 元数据等），停在回合末尾
  let current = start;
  const visited = new Set<string>([current.id]);
  for (;;) {
    const next = (children.get(current.id) ?? []).find(
      (k) => !visited.has(k.id) && !isUserMessageEntry(k),
    );
    if (!next) return current.id;
    visited.add(next.id);
    current = next;
  }
}
