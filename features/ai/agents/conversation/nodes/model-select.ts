import type { AgentState } from "../agent";
import { selectModel } from "@/features/ai/llm/model-routing";
import type { TaskType } from "@/features/ai/llm/providers/types";

export async function modelSelectNode(
  state: AgentState
): Promise<Partial<AgentState>> {
  const taskType = (state as unknown as { queryType?: string }).queryType as TaskType ?? "chat";

  // If the incoming state already has a manualOverride (set by the message route
  // when the user explicitly selected a model), preserve it — do NOT let
  // selectModel overwrite it with the default Agnes model.
  // providerId/modelName are still required by the Annotation schema (set to "").
  if (state.modelContext?.userConfig?.manualOverride) {
    return {
      modelContext: {
        ...state.modelContext,
        taskType,
        providerId: state.modelContext.providerId || "",
        modelName: state.modelContext.modelName || "",
      },
    };
  }

  // Normal path: compute model from routing rules
  const userConfig = state.modelContext?.userConfig;
  const { providerId, modelName } = selectModel(taskType, userConfig);

  return {
    modelContext: {
      taskType,
      providerId,
      modelName,
      userConfig,
    },
  };
}
