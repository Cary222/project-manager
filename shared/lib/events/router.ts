import { ACTION, type ActionValue } from "./ACTION";

/**
 * 事件分类：决定事件落入哪个处理路径
 * - behavior：用户行为事件（page.view / search.* / rag.*）
 * - business：业务事件（后续阶段扩展，Tier 3 暂不路由）
 * - audit：审计事件（Tier 3 由 ModerationLog 独立承担）
 */
export type EventCategory = "behavior" | "business" | "audit";

export interface EventDecision {
  category: EventCategory;
}

/**
 * 决策引擎（骨架）
 * 原则：路由只决定"分类"，具体处理由各分类的执行器承担。
 * 当前 Phase 只识别分类；Tier 2+ 阶段会按分类扩展 writer。
 */
export function routeEvent(action: ActionValue): EventDecision {
  if (
    action.startsWith("page.") ||
    action.startsWith("search.") ||
    action.startsWith("rag.")
  ) {
    return { category: "behavior" };
  }

  // 兜底归类（Tier 3 业务事件虽然暂不路由，但 action 仍可识别）
  return { category: "business" };
}

/**
 * 当前路由支持的 action 集合（白名单）
 * Tier 3 事件由独立的 ModerationLog / Notification 系统承担，
 * 不应进入 Event Gateway。
 */
export function isRoutableAction(action: string): action is ActionValue {
  return (Object.values(ACTION) as string[]).includes(action)
    && !action.startsWith("ticket.")
    && !action.startsWith("project.")
    && !action.startsWith("note.")
    && !action.startsWith("admin.");
}