"use client";

import { useEffect, useRef, useState } from "react";
import { MultiDirectedGraph } from "graphology";
import Sigma from "sigma";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type { GraphViewData } from "../../lib/graph/view-types";
import { updateCanvasGraph } from "./graph-adapter";

export default function GraphCanvas({
  data,
  selectedId,
  onSelect,
  height,
}: {
  data: GraphViewData;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  height: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<Sigma | null>(null);
  const [failure, setFailure] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let sigma: Sigma | undefined;
    try {
      sigma = new Sigma(new MultiDirectedGraph(), container.current, {
        defaultNodeType: "circle",
        defaultEdgeType: "arrow",
        labelSize: 12,
        labelRenderedSizeThreshold: 7,
        renderEdgeLabels: false,
        allowInvalidContainer: true,
      });
      renderer.current = sigma;
      sigma.on("clickNode", ({ node }) => onSelect(node));
      sigma.on("clickStage", () => onSelect(null));
    } catch (error) {
      console.warn(
        "[knowledge-graph] WebGL unavailable",
        error instanceof Error ? error.name : "unknown",
      );
      queueMicrotask(() => {
        if (!disposed) setFailure(true);
      });
    }
    return () => {
      disposed = true;
      sigma?.kill();
      renderer.current = null;
    };
  }, [onSelect]);

  useEffect(() => {
    const sigma = renderer.current;
    if (!sigma) return;
    const graph = sigma.getGraph() as MultiDirectedGraph;
    const initial = graph.order === 0;
    updateCanvasGraph(graph, data);
    // ponytail: at most 200 nodes; use a layout worker if this cap is increased.
    if (initial && graph.order > 1)
      forceAtlas2.assign(graph, {
        iterations: 30,
        settings: { barnesHutOptimize: true, gravity: 1, scalingRatio: 5 },
      });
    sigma.refresh();
  }, [data]);

  useEffect(() => {
    const sigma = renderer.current;
    if (!sigma) return;
    const graph = sigma.getGraph();
    graph.forEachNode((id) =>
      graph.setNodeAttribute(id, "highlighted", id === selectedId),
    );
    if (selectedId && graph.hasNode(selectedId)) {
      const point = sigma.getNodeDisplayData(selectedId);
      if (point) sigma.getCamera().setState({ x: point.x, y: point.y });
    }
  }, [selectedId, data]);

  return (
    <div className="relative min-w-0 flex-1" style={{ height }}>
      <div
        ref={container}
        className="h-full w-full"
        aria-label="知识图谱画布；也可使用旁边的实体列表"
      />
      {failure && (
        <p
          role="status"
          className="absolute inset-0 flex items-center justify-center bg-ink-50 p-6 text-sm text-ink-500"
        >
          当前设备无法使用 WebGL，请使用实体列表浏览关系。
        </p>
      )}
      {!failure && (
        <div className="absolute bottom-3 left-3 flex gap-1">
          <button
            type="button"
            aria-label="放大图谱"
            className="rounded border border-ink-200 bg-white px-3 py-1 focus-visible:ring-2"
            onClick={() => {
              const camera = renderer.current?.getCamera();
              if (camera) camera.setState({ ratio: camera.ratio / 1.5 });
            }}
          >
            ＋
          </button>
          <button
            type="button"
            aria-label="缩小图谱"
            className="rounded border border-ink-200 bg-white px-3 py-1 focus-visible:ring-2"
            onClick={() => {
              const camera = renderer.current?.getCamera();
              if (camera) camera.setState({ ratio: camera.ratio * 1.5 });
            }}
          >
            −
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 bg-white px-3 py-1 text-xs focus-visible:ring-2"
            onClick={() =>
              renderer.current
                ?.getCamera()
                .setState({ x: 0.5, y: 0.5, ratio: 1 })
            }
          >
            适应画布
          </button>
        </div>
      )}
    </div>
  );
}
