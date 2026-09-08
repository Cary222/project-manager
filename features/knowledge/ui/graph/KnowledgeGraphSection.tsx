"use client";

import { useState } from "react";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import type { KnowledgeGraphViewProps } from "../../lib/graph/view-types";

/** Mount only on demand: embedding in a note must not load WebGL or query the graph eagerly. */
export function KnowledgeGraphSection(props: KnowledgeGraphViewProps) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm text-ink-700 hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {open ? "收起知识图谱" : "查看关联知识图谱"}
      </button>
      {open && <KnowledgeGraphView {...props} />}
    </section>
  );
}
