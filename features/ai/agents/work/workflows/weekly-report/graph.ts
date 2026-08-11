/**
 * Weekly Report Workflow — Graph
 *
 * 周报工作流节点组合。
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { WorkflowStateAnnotation } from "./state";
import { getCheckpointer } from "./checkpointer";
import { collectDataNode } from "./nodes/collect-data";
import { draftNode } from "./nodes/draft";
import { waitReviewNode } from "./nodes/wait-review";
import { reviseNode } from "./nodes/revise";
import { outputNode } from "./nodes/output";
import {
  routeAfterCollect,
  routeAfterDraft,
  routeAfterRevise,
  routeAfterWaitReview,
} from "./edges/routing";

export const WEEKLY_REPORT_WORKFLOW_TYPE = "weekly_report";

type GlobalWeeklyGraph = typeof globalThis & {
  __weekly_report_graph?: ReturnType<typeof buildWeeklyReportGraph>;
  __weekly_report_graph_promise?: Promise<
    ReturnType<typeof buildWeeklyReportGraph>
  >;
};

function buildWeeklyReportGraph(
  checkpointer: Awaited<ReturnType<typeof getCheckpointer>>
) {
  const graph = new StateGraph(WorkflowStateAnnotation)
    .addNode("collectData", collectDataNode)
    .addNode("draftReport", draftNode)
    .addNode("waitReview", waitReviewNode)
    .addNode("revise", reviseNode)
    .addNode("output", outputNode)
    .addEdge(START, "collectData")
    .addConditionalEdges("collectData", routeAfterCollect, {
      draftReport: "draftReport",
      __end__: END,
    })
    .addConditionalEdges("draftReport", routeAfterDraft, {
      waitReview: "waitReview",
      __end__: END,
    })
    .addConditionalEdges("waitReview", routeAfterWaitReview, {
      output: "output",
      revise: "revise",
      __end__: END,
    })
    .addConditionalEdges("revise", routeAfterRevise, {
      waitReview: "waitReview",
      __end__: END,
    })
    .addEdge("output", END);

  return graph.compile({ checkpointer });
}

export type WeeklyReportCompiledGraph = ReturnType<
  typeof buildWeeklyReportGraph
>;

/**
 * Compiled weekly-report graph singleton (HMR-safe via globalThis).
 * Awaits checkpointer setup on first call.
 */
export async function getWeeklyReportGraph(): Promise<WeeklyReportCompiledGraph> {
  const g = globalThis as GlobalWeeklyGraph;
  if (g.__weekly_report_graph) {
    return g.__weekly_report_graph;
  }
  if (!g.__weekly_report_graph_promise) {
    g.__weekly_report_graph_promise = getCheckpointer()
      .then((cp) => {
        const compiled = buildWeeklyReportGraph(cp);
        g.__weekly_report_graph = compiled;
        return compiled;
      })
      .catch((err) => {
        delete g.__weekly_report_graph_promise;
        delete g.__weekly_report_graph;
        throw err;
      });
  }
  return g.__weekly_report_graph_promise;
}
