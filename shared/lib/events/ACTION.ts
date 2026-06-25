/**
 * 事件动作枚举（v1.0）
 *
 * 原则：
 * 1. 所有事件必须标准化 + 枚举化（避免拼写错误）
 * 2. 按 Tier 分阶段实现，未实现的 Tier 仅占位
 * 3. Tier 3 已有独立系统（ModerationLog / Notification），
 *    暂不路由到 Event Gateway，避免双写
 */
export const EVENT_VERSION = "1.0";

export const ACTION = {
  // === Tier 1 — 当前 phase 实现 ===
  PAGE_VIEW: "page.view",

  // === Tier 2 — RAG 问答阶段实现 ===
  SEARCH_QUERY: "search.query",
  SEARCH_RESULT_CLICK: "search.result_click",
  RAG_QUERY: "rag.query",
  RAG_FEEDBACK: "rag.feedback",

  // === Tier 3 — 通知/审计（已有独立系统，暂不路由） ===
  TICKET_CREATE: "ticket.create",
  TICKET_STATUS_CHANGE: "ticket.status_change",
  TICKET_ASSIGN: "ticket.assign",
  TICKET_DELETE: "ticket.delete",
  PROJECT_CREATE: "project.create",
  PROJECT_DELETE: "project.delete",
  NOTE_CREATE: "note.create",
  NOTE_UPDATE: "note.update",
  NOTE_DELETE: "note.delete",
  ADMIN_BAN_USER: "admin.ban_user",
  ADMIN_UNBAN_USER: "admin.unban_user",
  ADMIN_UPDATE_ROLE: "admin.update_role",
  ADMIN_UPDATE_SETTINGS: "admin.update_settings",
  ADMIN_DELETE_TICKET: "admin.delete_ticket",
  ADMIN_MERGE_MODULE: "admin.merge_module",
} as const;

export type ActionValue = (typeof ACTION)[keyof typeof ACTION];