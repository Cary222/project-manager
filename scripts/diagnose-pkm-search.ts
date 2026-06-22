import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import type { SearchDocumentSourceType as PrismaSearchDocumentSourceType } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { searchDocuments } from "@/shared/lib/search";
import { SEARCH_DOCUMENT_SOURCE_TYPES } from "@/shared/lib/search-types";

loadEnvConfig(process.cwd());

const CONTENT_PREVIEW_LENGTH = 240;

type Command = "baseline" | "measure";

type DirtyNoteRow = {
  id: string;
  title: string;
  contentLength: number;
  hasInlineImage: boolean;
  hasCodeBlock: boolean;
};

type SearchDocumentPreviewRow = {
  id: string;
  title: string;
  content: string;
  hasEmbedding: boolean;
};

const RECOMMENDED_SEARCH_TERMS = [
  { kind: "标题词", example: "虚拟列表" },
  { kind: "正文概念词", example: "元素复用" },
  { kind: "之前搜不到的片段", example: "intersection observer" },
] as const;

function parseCommand(argv: string[]): { command: Command; positional: string[] } {
  const [, , maybeCommand, ...positional] = argv;
  if (maybeCommand !== "baseline" && maybeCommand !== "measure") {
    throw new Error("用法: diagnose-pkm-search.ts baseline | measure <noteId> <searchTerm>");
  }
  return { command: maybeCommand, positional };
}

async function listDirtyNoteCandidates(limit: number): Promise<DirtyNoteRow[]> {
  const dirty = await prisma.$queryRaw<DirtyNoteRow[]>(Prisma.sql`
    SELECT
      n."id" AS "id",
      n."title" AS "title",
      length(n."content") AS "contentLength",
      (n."content" LIKE '%data:image%') AS "hasInlineImage",
      (n."content" LIKE '%\`\`\`%') AS "hasCodeBlock"
    FROM pm."PkmNote" n
    WHERE n."content" LIKE '%data:image%'
    ORDER BY length(n."content") DESC
    LIMIT ${limit}
  `);

  if (dirty.length > 0) return dirty;

  return prisma.$queryRaw<DirtyNoteRow[]>(Prisma.sql`
    SELECT
      n."id" AS "id",
      n."title" AS "title",
      length(n."content") AS "contentLength",
      false AS "hasInlineImage",
      (n."content" LIKE '%\`\`\`%') AS "hasCodeBlock"
    FROM pm."PkmNote" n
    ORDER BY length(n."content") DESC
    LIMIT ${limit}
  `);
}

async function fetchSearchDocumentForNote(noteId: string): Promise<SearchDocumentPreviewRow | null> {
  const sourceType = SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE as PrismaSearchDocumentSourceType;
  const sourceTypeLiteral = String(sourceType);
  const rows = await prisma.$queryRaw<SearchDocumentPreviewRow[]>(Prisma.sql`
    SELECT
      d."id" AS "id",
      d."title" AS "title",
      d."content" AS "content",
      (d."embedding" IS NOT NULL) AS "hasEmbedding"
    FROM pm."SearchDocument" d
    WHERE d."sourceId" = ${noteId}
      AND d."sourceType" = ${sourceTypeLiteral}::"SearchDocumentSourceType"
    LIMIT 1
  `);
  return rows[0] ?? null;
}

function preview(text: string, length = CONTENT_PREVIEW_LENGTH): string {
  return text.length <= length ? text : `${text.slice(0, length)}…`;
}

function printTable(headers: string[], rows: string[][]) {
  const widths = headers.map((header, index) =>
    rows.reduce((max, row) => Math.max(max, (row[index] ?? "").length), header.length),
  );
  const render = (cells: string[]) =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  console.log(render(headers));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(render(row));
  }
}

async function runBaseline() {
  const candidates = await listDirtyNoteCandidates(5);

  console.log(`[diagnose:baseline] 找到 ${candidates.length} 个候选样本\n`);
  printTable(
    ["id", "title", "content_len", "has_inline_img", "has_code_block"],
    candidates.map((candidate) => [
      candidate.id,
      candidate.title,
      String(candidate.contentLength),
      candidate.hasInlineImage ? "yes" : "no",
      candidate.hasCodeBlock ? "yes" : "no",
    ]),
  );

  console.log("\n[diagnose:baseline] 每个候选样本对应的 SearchDocument 预览（前 240 字）");
  for (const candidate of candidates) {
    const doc = await fetchSearchDocumentForNote(candidate.id);
    console.log(`\n--- note ${candidate.id} :: ${candidate.title} ---`);
    if (!doc) {
      console.log("(no SearchDocument yet)");
      continue;
    }
    console.log(`SearchDocument.id=${doc.id}  has_embedding=${doc.hasEmbedding}  content_len=${doc.content.length}`);
    console.log(`content_preview: ${preview(doc.content)}`);
  }

  console.log("\n[diagnose:baseline] 推荐的三组搜索词（直接拷贝到 measure 子命令）");
  for (const term of RECOMMENDED_SEARCH_TERMS) {
    console.log(`  - ${term.kind}: "${term.example}"`);
  }

  console.log("\n[diagnose:baseline] 下一步");
  console.log("  1. 选一条 candidate.id 作为 '测试笔记 T'");
  console.log("  2. 跑 measure 取改前分数：");
  console.log(`     npx tsx scripts/diagnose-pkm-search.ts measure <noteId> "虚拟列表"`);
  console.log("  3. 跑 reindex 重建 SearchDocument");
  console.log("     npx tsx scripts/reindex-pkm-notes.ts");
  console.log("  4. 用同样的搜索词再跑 measure，对比改后分数");
}

async function runMeasure(noteId: string, searchTerm: string) {
  const note = await prisma.pkmNote.findUnique({
    where: { id: noteId },
    select: { id: true, title: true, content: true },
  });

  if (!note) {
    console.error(`[diagnose:measure] 找不到 noteId=${noteId}`);
    return;
  }

  const document = await fetchSearchDocumentForNote(noteId);

  console.log(`[diagnose:measure] noteId=${noteId}`);
  console.log(`  title=${note.title}`);
  console.log(`  note.content.length=${note.content.length}`);
  if (document) {
    console.log(`  SearchDocument.content.length=${document.content.length}  has_embedding=${document.hasEmbedding}`);
    console.log(`  content_preview: ${preview(document.content)}`);
  } else {
    console.log(`  (no SearchDocument found for this noteId)`);
  }

  const response = await searchDocuments({ query: searchTerm, limit: 20 });
  const noteResult = response.results.find((item) => item.metadata.noteUserId || item.url === `/pkm/notes/${noteId}`)
    ?? response.results.find((item) => item.url === `/pkm/notes/${noteId}`);

  const rank = response.results.findIndex((item) => item.url === `/pkm/notes/${noteId}`) + 1;

  console.log(`\n[diagnose:measure] search term="${searchTerm}" tookMs=${response.tookMs} total=${response.total}`);
  printTable(
    ["rank", "type", "title", "score", "keyword", "semantic"],
    response.results.slice(0, 10).map((item, index) => [
      String(index + 1),
      item.type,
      item.title,
      item.score.toFixed(2),
      item.keywordScore.toFixed(2),
      item.semanticScore.toFixed(2),
    ]),
  );

  if (rank > 0 && noteResult) {
    console.log(`\n[diagnose:measure] 测试笔记 T 命中:`);
    console.log(`  rank=${rank}  score=${noteResult.score.toFixed(2)}  keyword=${noteResult.keywordScore.toFixed(2)}  semantic=${noteResult.semanticScore.toFixed(2)}`);
  } else {
    console.log(`\n[diagnose:measure] 测试笔记 T 没有出现在结果里`);
  }
}

async function main() {
  const { command, positional } = parseCommand(process.argv);

  if (command === "baseline") {
    await runBaseline();
    return;
  }

  const [noteId, ...termParts] = positional;
  const searchTerm = termParts.join(" ").trim();
  if (!noteId || !searchTerm) {
    throw new Error("measure 用法: diagnose-pkm-search.ts measure <noteId> <searchTerm>");
  }

  await runMeasure(noteId, searchTerm);
}

main()
  .catch((error) => {
    console.error("[diagnose] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });