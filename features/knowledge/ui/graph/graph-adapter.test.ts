import { describe, expect, it } from "vitest";
import { MultiDirectedGraph } from "graphology";
import { updateCanvasGraph } from "./graph-adapter";
import {
  GRAPH_NODE_LIMIT,
  mergeSubgraphs,
  type GraphViewData,
  type GraphViewNode,
} from "../../lib/graph/view-types";

const node = (id: string): GraphViewNode => ({
  id,
  label: id,
  type: "TICKET",
  projectId: "p",
  href: null,
});
const data: GraphViewData = {
  nodes: [node("a"), node("b")],
  edges: [
    { id: "e1", source: "a", target: "b", label: "ASSIGNED_TO" },
    { id: "e2", source: "a", target: "b", label: "CREATED_BY" },
  ],
  truncated: false,
};

describe("graph canvas adapter", () => {
  it("separates renderer types and supports parallel directed edges", () => {
    const graph = new MultiDirectedGraph();
    updateCanvasGraph(graph, data);
    expect(graph.size).toBe(2);
    expect(graph.getNodeAttribute("a", "type")).toBe("circle");
    expect(graph.getNodeAttribute("a", "nodeType")).toBe("TICKET");
    expect(graph.getEdgeAttribute("e1", "type")).toBe("arrow");
  });
  it("keeps positions when adding neighbors and removes dangling edges when filtering", () => {
    const graph = new MultiDirectedGraph();
    updateCanvasGraph(graph, data);
    graph.setNodeAttribute("a", "x", 999);
    const next = mergeSubgraphs(data, {
      nodes: [node("b"), node("c")],
      edges: [],
      truncated: false,
    });
    updateCanvasGraph(graph, next);
    expect(graph.order).toBe(3);
    expect(graph.getNodeAttribute("a", "x")).toBe(999);
    updateCanvasGraph(graph, {
      nodes: [node("a")],
      edges: data.edges,
      truncated: false,
    });
    expect(graph.order).toBe(1);
    expect(graph.size).toBe(0);
  });
  it("caps merged results and reports truncation without dropping the original center", () => {
    const next = mergeSubgraphs(data, {
      nodes: Array.from({ length: 250 }, (_, i) => node(String(i))),
      edges: [],
      truncated: false,
    });
    expect(next.nodes).toHaveLength(GRAPH_NODE_LIMIT);
    expect(next.nodes[0].id).toBe("a");
    expect(next.truncated).toBe(true);
    expect(new Set(next.nodes.map((n) => n.id)).size).toBe(next.nodes.length);
  });
});
