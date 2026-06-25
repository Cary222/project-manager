import { EVENT_VERSION } from "./ACTION";

/**
 * 前端发送的原始事件
 * 原则：前端只记录"发生了什么"，不判定含义
 */
export interface RawEvent {
  eventVersion: typeof EVENT_VERSION;
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  sessionId?: string;
  /**
   * 原始上下文数据
   * page.view: { dwellMs: number, enterAt: number, leaveAt: number }
   */
  context?: Record<string, unknown>;
}

/**
 * 后端存储的完整事件
 */
export interface StoredEvent extends RawEvent {
  id: string;
  actorId: string;
  actorName?: string;
  /** 原始 dwellMs（无阈值过滤），可为 null（非 page.view） */
  dwellMs: number | null;
  /** 后端判定的有效访问（dwellMs > 3000） */
  isValidView: boolean;
  createdAt: Date;
}