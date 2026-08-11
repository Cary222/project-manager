/**
 * Weekly Report Workflow — Collect Data Node
 */

import type { WorkflowState, WorkflowStateUpdate } from "../state";
import { historyEvent } from "../state";
import { collectWeeklyData } from "../tools/weekly-report-tools";

export async function collectDataNode(
  state: WorkflowState
): Promise<WorkflowStateUpdate> {
  try {
    const weekStart = new Date(state.weekStart);
    const weekEnd = new Date(state.weekEnd);
    const collectedData = await collectWeeklyData(
      state.userId,
      weekStart,
      weekEnd
    );

    return {
      collectedData,
      status: "drafting",
      error: null,
      history: historyEvent("collect_data", {
        tickets: collectedData.tickets.length,
        notes: collectedData.notes.length,
        conversations: collectedData.conversations.length,
      }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "collect_data failed";
    return {
      status: "cancelled",
      error: message,
      history: historyEvent("collect_data_error", { message }),
    };
  }
}
