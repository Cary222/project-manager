import Link from "next/link";
import {
  IconArrowRight,
  IconBook,
  IconSearch,
} from "@/components/icons";
import type { SearchResponse, SearchResultItem, SearchResultType } from "@/lib/search-types";

type KnowledgeSearchResultsProps = {
  data: SearchResponse;
  loading?: boolean;
};

const TYPE_LABEL: Record<SearchResultType, string> = {
  ticket: "工单",
  commit: "提交",
  note: "笔记",
};

const TYPE_STYLE: Record<SearchResultType, string> = {
  ticket: "bg-brand-50 text-brand-700",
  commit: "bg-violet-50 text-violet-700",
  note: "bg-amber-50 text-amber-700",
};

function ResultMeta({ item }: { item: SearchResultItem }) {
  if (item.type === "ticket") {
    return (
      <span className="text-xs text-ink-400">
        {item.project?.name || item.metadata.projectName || "未分组项目"}
        {item.metadata.moduleName ? ` · ${item.metadata.moduleName}` : ""}
        {item.metadata.ticketNo ? ` · #${item.metadata.ticketNo}` : ""}
      </span>
    );
  }

  if (item.type === "note") {
    return (
      <span className="text-xs text-ink-400">
        {item.project?.name || item.metadata.projectName || "未分组项目"}
        {item.metadata.noteUserName ? ` · ${item.metadata.noteUserName}` : ""}
        {item.metadata.noteTags && item.metadata.noteTags.length > 0
          ? ` · ${item.metadata.noteTags.slice(0, 3).join(" / ")}`
          : ""}
      </span>
    );
  }

  return (
    <span className="text-xs text-ink-400">
      {item.project?.name || item.metadata.projectName || "未分组项目"}
      {item.metadata.author ? ` · ${item.metadata.author}` : ""}
      {item.metadata.commitSha ? ` · ${item.metadata.commitSha.slice(0, 7)}` : ""}
    </span>
  );
}

function ResultCard({ item }: { item: SearchResultItem }) {
  return (
    <Link
      href={item.url}
      className="block rounded-xl border border-ink-200 bg-white p-4 shadow-soft transition hover:border-brand-200 hover:shadow-base"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_STYLE[item.type]}`}>
              {TYPE_LABEL[item.type]}
            </span>
            <ResultMeta item={item} />
          </div>
          <p className="mt-2 truncate text-sm font-medium text-ink-900">{item.title}</p>
        </div>
        <IconArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-300" />
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-ink-500">{item.snippet}</p>
    </Link>
  );
}

function GroupSection({
  type,
  items,
}: {
  type: SearchResultType;
  items: SearchResultItem[];
}) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-ink-700">{TYPE_LABEL[type]}</h3>
          <p className="text-xs text-ink-400">{items.length} 条结果</p>
        </div>
      </div>
      <div className="grid gap-3">
        {items.map((item) => (
          <ResultCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3 rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <div className="h-4 w-24 animate-pulse rounded bg-ink-100" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-ink-100 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-ink-100" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-ink-100" />
            <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-ink-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center shadow-soft">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
        <IconBook className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-medium text-ink-700">未找到与“{query}”相关的结果</p>
      <p className="mt-1 text-sm text-ink-400">可以换个关键词，或尝试项目名、单号、提交主题中的关键描述。</p>
    </div>
  );
}

export function KnowledgeSearchResults({ data, loading = false }: KnowledgeSearchResultsProps) {
  if (loading) {
    return <LoadingState />;
  }

  if (data.total === 0) {
    return <EmptyState query={data.query} />;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
        <div className="flex items-center gap-2 text-sm text-ink-500">
          <IconSearch className="h-4 w-4" />
          <span>
            找到 <span className="font-medium text-ink-900">{data.total}</span> 条结果
          </span>
          <span>·</span>
          <span>{data.tookMs} ms</span>
        </div>
      </section>

      <GroupSection type="ticket" items={data.grouped.ticket} />
      <GroupSection type="commit" items={data.grouped.commit} />
      <GroupSection type="note" items={data.grouped.note} />
    </div>
  );
}
