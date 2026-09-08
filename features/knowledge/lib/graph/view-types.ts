export const GRAPH_NODE_LIMIT = 200;
export const GRAPH_EDGE_LIMIT = 1000;

export interface GraphViewNode {
  id: string;
  label: string;
  type: string;
  projectId: string | null;
  href: string | null;
}
export interface GraphViewEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}
export interface GraphViewData {
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  truncated: boolean;
}
export interface KnowledgeGraphViewProps {
  projectId?: string;
  centerNodeId?: string;
  noteId?: string;
  className?: string;
  height?: number;
}

/** Bounded union: expanding a node never replaces the previously loaded neighborhood. */
export function mergeSubgraphs(
  previous: GraphViewData,
  incoming: GraphViewData,
): GraphViewData {
  const allNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  for (const node of incoming.nodes) allNodes.set(node.id, node);
  const nodes = [...allNodes.values()].slice(0, GRAPH_NODE_LIMIT);
  const ids = new Set(nodes.map((node) => node.id));
  const allEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
  for (const edge of incoming.edges) allEdges.set(edge.id, edge);
  const edges = [...allEdges.values()].filter(
    (edge) => ids.has(edge.source) && ids.has(edge.target),
  );
  return {
    nodes,
    edges: edges.slice(0, GRAPH_EDGE_LIMIT),
    truncated:
      previous.truncated ||
      incoming.truncated ||
      allNodes.size > nodes.length ||
      edges.length > GRAPH_EDGE_LIMIT,
  };
}
