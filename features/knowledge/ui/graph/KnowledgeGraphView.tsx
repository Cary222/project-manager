"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import useSWR, { SWRConfig } from "swr";
import { useSession } from "next-auth/react";
import {
  mergeSubgraphs,
  type GraphViewData,
  type GraphViewNode,
  type KnowledgeGraphViewProps,
} from "../../lib/graph/view-types";
import { NODE_STYLES } from "./graph-adapter";

const GraphCanvas = dynamic(() => import("./GraphCanvas"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-ink-400">加载画布…</p>,
});
const EMPTY: GraphViewData = { nodes: [], edges: [], truncated: false };
const buttonClass =
  "rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50";

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "请先登录"
        : response.status === 404
          ? "图谱尚未建立或无权访问"
          : "图谱加载失败，请重试",
    );
  return response.json();
}

/** Public reusable entry: safe to import from Server Components, PKM and project tabs. */
export function KnowledgeGraphView(props: KnowledgeGraphViewProps) {
  const { data: session, status } = useSession();
  if (status === "loading")
    return (
      <p role="status" className="p-4 text-sm text-ink-400">
        验证图谱访问权限…
      </p>
    );
  if (!session?.user?.id)
    return <p className="p-4 text-sm text-ink-500">请先登录后查看知识图谱。</p>;
  const scope = JSON.stringify([
    session.user.id,
    props.projectId,
    props.centerNodeId,
    props.noteId,
  ]);
  return (
    <SWRConfig
      key={scope}
      value={{ provider: () => new Map(), shouldRetryOnError: false }}
    >
      <GraphPanel {...props} />
    </SWRConfig>
  );
}

function GraphPanel({
  projectId,
  centerNodeId,
  noteId,
  className = "",
  height = 480,
}: KnowledgeGraphViewProps) {
  const [center, setCenter] = useState(centerNodeId);
  const [depth, setDepth] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [type, setType] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const params = new URLSearchParams({ depth: String(depth) });
  if (projectId) params.set("projectId", projectId);
  if (center) params.set("nodeId", center);
  else if (noteId) params.set("noteId", noteId);
  const url = `/api/knowledge/graph/subgraph?${params}`;
  const {
    data = EMPTY,
    error,
    isLoading,
    mutate,
  } = useSWR<GraphViewData>(url, fetchJson);
  const searchParams = new URLSearchParams({ q: query, limit: "10" });
  if (projectId) searchParams.set("projectId", projectId);
  const search = useSWR<{ results: GraphViewNode[] }>(
    query ? `/api/knowledge/graph/search?${searchParams}` : null,
    fetchJson,
  );

  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [url],
  );

  const selected = data.nodes.find((node) => node.id === selectedId);
  const displayedNodes = type
    ? data.nodes.filter((node) => node.type === type)
    : data.nodes;
  const displayedIds = new Set(displayedNodes.map((node) => node.id));
  const displayed = {
    ...data,
    nodes: displayedNodes,
    edges: data.edges.filter(
      (edge) => displayedIds.has(edge.source) && displayedIds.has(edge.target),
    ),
  };

  async function expand(id: string) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setExpanding(true);
    setExpandError("");
    const next = new URLSearchParams(params);
    next.set("nodeId", id);
    next.delete("noteId");
    try {
      const incoming = await fetchJson<GraphViewData>(
        `/api/knowledge/graph/subgraph?${next}`,
        controller.signal,
      );
      if (!controller.signal.aborted)
        await mutate(
          (previous) => mergeSubgraphs(previous ?? EMPTY, incoming),
          { revalidate: false },
        );
    } catch (failure) {
      if (!controller.signal.aborted)
        setExpandError(failure instanceof Error ? failure.message : "展开失败");
    } finally {
      if (!controller.signal.aborted) setExpanding(false);
    }
  }

  function reset(nextCenter = centerNodeId, nextDepth = depth) {
    pending.current?.abort();
    setExpanding(false);
    setExpandError("");
    setSelectedId(null);
    setType("");
    setCenter(nextCenter);
    setDepth(nextDepth);
  }

  return (
    <section
      aria-label="知识图谱"
      className={`overflow-hidden rounded-xl border border-ink-200 bg-white ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50 p-3">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(input.trim());
          }}
        >
          <input
            aria-label="搜索图谱实体"
            maxLength={120}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="搜索工单、笔记、模块…"
            className="min-w-0 flex-1 rounded-md border border-ink-200 px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          <button className={buttonClass} type="submit">
            搜索
          </button>
        </form>
        <label className="flex items-center gap-1 text-xs text-ink-500">
          深度
          <select
            aria-label="图谱展开深度"
            value={depth}
            onChange={(event) => reset(center, Number(event.target.value))}
            className={buttonClass}
          >
            <option value={1}>1 跳</option>
            <option value={2}>2 跳</option>
          </select>
        </label>
        <select
          aria-label="筛选实体类型"
          className={buttonClass}
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">全部类型</option>
          {Object.entries(NODE_STYLES).map(([key, style]) => (
            <option key={key} value={key}>
              {style.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            reset();
            void mutate();
          }}
        >
          重置
        </button>
      </div>
      {query && (
        <div className="border-b border-ink-100 p-3" aria-label="实体搜索结果">
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setQuery("");
              setInput("");
            }}
          >
            关闭搜索结果
          </button>
          {search.isLoading && <p role="status">搜索中…</p>}
          {search.error && (
            <p role="alert" className="text-sm text-red-600">
              搜索失败，请重试。
            </p>
          )}
          {search.data?.results.length === 0 && (
            <p className="p-2 text-sm text-ink-500">没有可访问的匹配实体。</p>
          )}
          {search.data?.results.map((node) => (
            <button
              type="button"
              key={node.id}
              className="block w-full rounded p-2 text-left text-sm hover:bg-ink-50 focus-visible:ring-2"
              onClick={() => {
                reset(node.id);
                setQuery("");
              }}
            >
              {NODE_STYLES[node.type]?.label} · {node.label}
            </button>
          ))}
        </div>
      )}
      {isLoading && (
        <p role="status" className="p-6 text-sm text-ink-500">
          加载知识图谱…
        </p>
      )}
      {(error || expandError) && (
        <div role="alert" className="p-4 text-sm text-red-600">
          {expandError ||
            (error instanceof Error ? error.message : "图谱不可用")}{" "}
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setExpandError("");
              void mutate();
            }}
          >
            重试
          </button>
        </div>
      )}
      {!error && !isLoading && (
        <>
          <p className="px-3 py-2 text-xs text-ink-500" role="status">
            {data.nodes.length} 个实体 · {data.edges.length} 条关系
            {data.truncated ? " · 已限量展示，请搜索实体缩小范围" : ""}
          </p>
          {data.nodes.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-400">
              暂无可访问图谱；可搜索已有实体，未索引的笔记不会自动触发重建。
            </p>
          ) : (
            <div className="flex flex-col border-t border-ink-100 lg:flex-row">
              <GraphCanvas
                data={displayed}
                selectedId={selectedId}
                onSelect={setSelectedId}
                height={height}
              />
              <aside
                aria-label="图谱实体与关系"
                className="w-full shrink-0 overflow-y-auto border-t border-ink-100 p-3 lg:w-72 lg:border-l lg:border-t-0"
                style={{ maxHeight: height }}
              >
                {selected && (
                  <div className="mb-3 rounded-lg bg-ink-50 p-3">
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => setSelectedId(null)}
                    >
                      关闭详情
                    </button>
                    <h3 className="my-2 break-words text-sm font-semibold">
                      {selected.label}
                    </h3>
                    {selected.href && (
                      <Link
                        href={selected.href}
                        className="text-xs text-brand-600 underline"
                      >
                        查看业务来源
                      </Link>
                    )}
                    <button
                      type="button"
                      disabled={expanding}
                      className={`${buttonClass} mt-2 block`}
                      onClick={() => void expand(selected.id)}
                    >
                      {expanding ? "展开中…" : "展开相连节点"}
                    </button>
                    <ul
                      aria-label="所选实体的关联关系"
                      className="mt-2 space-y-2 text-xs text-ink-500"
                    >
                      {data.edges
                        .filter(
                          (edge) =>
                            edge.source === selected.id ||
                            edge.target === selected.id,
                        )
                        .map((edge) => (
                          <li key={edge.id}>
                            {
                              data.nodes.find((node) => node.id === edge.source)
                                ?.label
                            }{" "}
                            → {edge.label} →{" "}
                            {
                              data.nodes.find((node) => node.id === edge.target)
                                ?.label
                            }
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
                <h3 className="mb-2 text-xs font-medium text-ink-500">
                  实体列表（支持键盘选择）
                </h3>
                {displayedNodes.map((node) => (
                  <button
                    type="button"
                    key={node.id}
                    aria-pressed={selectedId === node.id}
                    onClick={() => setSelectedId(node.id)}
                    className="block w-full rounded p-2 text-left text-xs hover:bg-ink-50 focus-visible:ring-2"
                  >
                    <span className="mr-1 text-ink-400">
                      {NODE_STYLES[node.type]?.label}
                    </span>
                    {node.label}
                  </button>
                ))}
              </aside>
            </div>
          )}
        </>
      )}
    </section>
  );
}
