import { z } from "zod";

export const GoalTypeEnum = z.enum([
  "informational",
  "analytical",
  "actionable",
  "transactional",
]);
export type GoalType = z.infer<typeof GoalTypeEnum>;

export const RouteChoiceEnum = z.enum([
  "chat",
  "work",
  "stay_current",
  "chat_then_offer_work",
]);
export type RouteChoice = z.infer<typeof RouteChoiceEnum>;

export const ModeDecisionSchema = z.object({
  route: RouteChoiceEnum,
  intent: z.string().max(60).describe("用户意图简要标签"),
  goalType: GoalTypeEnum,
  requiresExecution: z
    .boolean()
    .describe("是否需要执行修改、生成交付物或产生外部副作用"),
  confidence: z.number().min(0).max(1),
  workSuggestion: z
    .object({
      workflowHint: z.string().optional(),
      capability: z.string().optional(),
      reason: z.string().max(200),
    })
    .optional(),
  extractedEntities: z.record(z.string(), z.string()).optional(),
});

export type ModeDecision = z.infer<typeof ModeDecisionSchema>;

export interface GlobalRouterContext {
  currentRoute?: "chat" | "work";
  conversationId?: string | null;
  projectId?: string | null;
  ticketId?: string | null;
  userId?: string;
  recentInputs?: string[];
}
