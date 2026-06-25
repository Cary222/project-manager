import { ACTION } from "./ACTION";

/** 有效停留阈值（毫秒）：超过此值的 page.view 计为有效访问 */
export const VALID_VIEW_THRESHOLD_MS = 3000;

export interface ComputedFields {
  dwellMs: number | null;
  isValidView: boolean;
}

/**
 * 后端计算 dwellMs / isValidView
 * 原则：后端全权判断，前端只传原始数据（dwellMs / enterAt / leaveAt）
 *
 * 非 page.view 事件：dwellMs = null, isValidView = false
 * page.view 事件且 dwellMs 无效：dwellMs = null, isValidView = false
 * page.view 事件且 dwellMs 有效：按阈值判断
 */
export function computeDwellMetrics(
  action: string,
  context: Record<string, unknown> | undefined
): ComputedFields {
  if (action !== ACTION.PAGE_VIEW || !context) {
    return { dwellMs: null, isValidView: false };
  }

  const raw = context.dwellMs;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return { dwellMs: null, isValidView: false };
  }

  const dwellMs = Math.floor(raw);
  return {
    dwellMs,
    isValidView: dwellMs > VALID_VIEW_THRESHOLD_MS,
  };
}