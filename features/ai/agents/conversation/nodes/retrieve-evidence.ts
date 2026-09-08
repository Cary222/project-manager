import type { AgentState } from "../agent";
import { retrievePlannedContext } from "@/features/ai/search/planned-retrieval";
import { understandQuery } from "@/features/ai/search/query-understanding";

export async function retrieveEvidenceNode(
  state: AgentState,
): Promise<Partial<AgentState>> {
  const currentStep = state.agenticStep ?? 0;
  const last = state.messages.at(-1);
  const baseQuery =
    state.originalQuery ||
    (typeof last?.content === "string" ? last.content : "");
  const plan = state.retrievalPlan ?? understandQuery(baseQuery);
  // On autonomous retry steps (> 0), use the orthogonal sub-query for the current step
  const queryToUse =
    currentStep > 0 && plan.subQueries && plan.subQueries.length >= currentStep
      ? plan.subQueries[currentStep - 1]
      : baseQuery;

  const model = state.modelContext;
  const modelRef =
    model?.userConfig?.manualOverride ||
    (model?.providerId && model.modelName
      ? `${model.providerId}:${model.modelName}`
      : undefined);
  try {
    const context = await retrievePlannedContext(
      queryToUse,
      state.userId,
      plan,
      modelRef,
    );
    return {
      agenticStep: currentStep + 1,
      retrievalPlan: context.retrieval.plan,
      searchResults: [context.contextText],
      toolResults: { searchKnowledge: context, retrieval: context.retrieval, ragTrace: context.ragTrace },
      ragTrace: context.ragTrace,
    };
  } catch (error) {
    // Failure to establish authorization fails closed; it never authorizes external search.
    console.error(
      "[retrieval] unable to establish query context",
      error instanceof Error ? error.name : "unknown",
    );
    return {
      agenticStep: currentStep + 1,
      retrievalPlan: plan,
      searchResults: [
        "站内检索暂时不可用，不能据此断言站内没有数据。请稍后重试。",
      ],
      toolResults: {
        retrieval: { allowWeb: false, enough: false, failed: true },
      },
    };
  }
}
