import { MultiDirectedGraph } from "graphology";
import type { GraphViewData } from "../../lib/graph/view-types";

// Chart palette only; chrome uses ProjectHub's ink/brand design tokens.
export const NODE_STYLES: Record<string, { label: string; color: string }> = {
  PROJECT: { label: "项目", color: "#6366f1" },
  TICKET: { label: "工单", color: "#d97706" },
  USER: { label: "用户", color: "#059669" },
  COMMIT: { label: "提交", color: "#7c3aed" },
  MODULE: { label: "模块", color: "#2563eb" },
  DOCUMENT: { label: "文档", color: "#db2777" },
  PKM_NOTE: { label: "笔记", color: "#0d9488" },
  MEETING: { label: "会议", color: "#ea580c" },
};

/** GitNexus graph-adapter pattern: separate domain nodeType from Sigma renderer type. */
export function updateCanvasGraph(
  graph: MultiDirectedGraph,
  data: GraphViewData,
) {
  const ids = new Set(data.nodes.map((node) => node.id));
  const edgeIds = new Set(data.edges.map((edge) => edge.id));
  for (const id of graph.edges()) if (!edgeIds.has(id)) graph.dropEdge(id);
  for (const id of graph.nodes()) if (!ids.has(id)) graph.dropNode(id);
  data.nodes.forEach((node, index) => {
    const style = NODE_STYLES[node.type];
    const attributes = {
      label: node.label,
      nodeType: node.type,
      type: "circle",
      color: style?.color ?? "#64748b",
      size: node.type === "PROJECT" ? 10 : 6,
    };
    if (graph.hasNode(node.id)) graph.mergeNodeAttributes(node.id, attributes);
    else {
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const radius = 10 * Math.sqrt(index + 1);
      graph.addNode(node.id, {
        ...attributes,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
  });
  for (const edge of data.edges) {
    if (
      !graph.hasNode(edge.source) ||
      !graph.hasNode(edge.target) ||
      graph.hasEdge(edge.id)
    )
      continue;
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      label: edge.label,
      size: 1,
      type: "arrow",
      color: "#94a3b8",
    });
  }
}
