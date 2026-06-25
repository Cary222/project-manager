import { AppShell } from "@/shared/ui/AppShell";
import { KnowledgeSearchPanel } from "@/features/knowledge/ui/KnowledgeSearchPanel";
import { KnowledgeSpaces } from "@/features/knowledge/ui/KnowledgeSpaces";
import { KnowledgePublicTags } from "@/features/knowledge/ui/KnowledgePublicTags";
import { KnowledgeNoteList } from "@/features/knowledge/ui/KnowledgeNoteList";

type KnowledgeTab = "latest" | "hot";

function parseTab(raw: string | undefined): KnowledgeTab {
  return raw === "hot" ? "hot" : "latest";
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; tab?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const initialQuery = params?.q ?? "";
  const tab = parseTab(params?.tab);
  const showSearchResults = initialQuery.trim().length > 0;

  return (
    <AppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">知识库</h1>
          <p className="text-xs text-ink-400">Knowledge Base · 团队文档与规范沉淀</p>
        </div>
      }
    >
      <div className="space-y-5 pm-fade-in">
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium">已接入</span>
          知识库当前结果来自工单、提交记录与个人笔记。
        </div>

        <KnowledgeSearchPanel initialQuery={initialQuery} />

        {!showSearchResults ? (
          <>
            <KnowledgeSpaces />
            <KnowledgePublicTags />
            <KnowledgeNoteList initialTab={tab} />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
