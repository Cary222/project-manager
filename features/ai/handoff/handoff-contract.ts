/**
 * Chat to Work Handoff Contract — 双链路平滑切入协议。
 *
 * 核心原则：
 * 1. 无侵入提示：Chat 识别出明确执行意图时，展示轻量卡片而非强行打断或静默切换；
 * 2. 授权上下文继承：Handoff 携带 sourceConversationId、projectId、ticketId 等，
 *    后端根据 ID 重新加载授权数据范围与上下文，无需客户端拷贝冗长文本；
 * 3. Work Orchestrator 自决：workflowHint 仅作为提示，具体工作流或 Planner 仍由 Work 端决策器自决。
 */

export interface ChatToWorkHandoffPayload {
 originalPrompt: string;
 sourceConversationId?: string;
 sourceMessageId?: string;
 projectId?: string;
 ticketId?: string;
 entityRefs?: Record<string, string>;
 workflowHint?: string;
 capabilityHint?: string;
 contextSummary?: string;
}

/**
 * 将 Handoff 数据包序列化为 URL 路由参数
 */
export function serializeHandoffParams(
 payload: ChatToWorkHandoffPayload,
): URLSearchParams {
 const params = new URLSearchParams();
 params.set("m", "work");
 params.set("goal", payload.originalPrompt);

 if (payload.sourceConversationId) {
  params.set("c", payload.sourceConversationId);
 }
 if (payload.workflowHint) {
  params.set("route", payload.workflowHint);
 }
 if (payload.projectId) {
  params.set("projectId", payload.projectId);
 }
 if (payload.ticketId) {
  params.set("ticketId", payload.ticketId);
 }

 return params;
}

/**
 * 从 URL 路由参数反序列化 Handoff 数据包
 */
export function deserializeHandoffParams(
 searchParams: URLSearchParams,
): Partial<ChatToWorkHandoffPayload> {
 const goal = searchParams.get("goal") || "";
 const conversationId = searchParams.get("c") || undefined;
 const workflowHint = searchParams.get("route") || undefined;
 const projectId = searchParams.get("projectId") || undefined;
 const ticketId = searchParams.get("ticketId") || undefined;

 return {
  originalPrompt: goal,
  sourceConversationId: conversationId,
  workflowHint,
  projectId,
  ticketId,
 };
}
