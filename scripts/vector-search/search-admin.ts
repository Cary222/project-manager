/**
 * search-admin.ts — 向量搜索管理 CLI（整合版）
 *
 * 用法:
 *   npx tsx scripts/vector-search/search-admin.ts status
 *   npx tsx scripts/vector-search/search-admin.ts backfill [--types=ticket,commit,note]
 *   npx tsx scripts/vector-search/search-admin.ts reindex [--batch-size=20] [--concurrency=1] [--clear] [noteId...]
 *   npx tsx scripts/vector-search/search-admin.ts embed [--batch-size=50]
 *   npx tsx scripts/vector-search/search-admin.ts clear [--types=note,ticket,commit]
 *   npx tsx scripts/vector-search/search-admin.ts inspect [noteId]
 *   npx tsx scripts/vector-search/search-admin.ts search <query> [--viewer-user-id=xxx] [--limit=10]
 */
import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import type { SearchDocumentSourceType as PrismaSearchDocumentSourceType } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { backfillSearchIndex } from "@/lib/git-sync/scan";
import {
  searchDocuments,
  syncPkmNoteSearchDocument,
  backfillMissingSearchEmbeddings,
  upsertSearchDocument,
  buildSearchableTicketDocument,
  buildSearchableCommitDocument,
} from "@/shared/lib/search";
import { SEARCH_DOCUMENT_SOURCE_TYPES } from "@/shared/lib/search-types";

loadEnvConfig(process.cwd());

// ─────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────

function parseArgs() {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=");
      if (key) flags.set(key, value ?? "true");
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function parseCommaList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function disconnect() {
  await prisma.$disconnect();
}

// ─────────────────────────────────────────────
// 命令: status
// ─────────────────────────────────────────────

async function cmdStatus() {
  const rows = await prisma.$queryRaw<{ source: string; total: bigint; with_vec: bigint }[]>`
    SELECT "sourceType" AS source,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE "embedding" IS NOT NULL) AS with_vec
    FROM pm."SearchDocument"
    GROUP BY "sourceType"
    ORDER BY "sourceType"
  `;
  console.log("\nSearchDocument 统计：");
  console.log("┌────────────┬───────┬──────────┐");
  console.log("│ sourceType │ total │ with_vec │");
  console.log("├────────────┼───────┼──────────┤");
  for (const r of rows) {
    const pct = Number(r.total) > 0
      ? `${((Number(r.with_vec) / Number(r.total)) * 100).toFixed(0)}%`
      : "0%";
    console.log(`│ ${String(r.source).padEnd(10)} │ ${String(r.total).padStart(5)} │ ${String(`${r.with_vec} (${pct})`).padStart(8)} │`);
  }
  console.log("└────────────┴───────┴──────────┘");

  const noteRows = await prisma.$queryRaw<{ id: string; title: string; userId: string; isPublic: boolean }[]>`
    SELECT n."id", n."title", n."userId", n."isPublic"
    FROM pm."PkmNote" n
    ORDER BY n."updatedAt" DESC
  `;
  console.log(`\nPkmNote 总数: ${noteRows.length}`);
  console.log("最近 5 条：");
  for (const n of noteRows.slice(0, 5)) {
    console.log(`  ${n.id}  "${n.title}"  user=${n.userId.slice(0, 8)}  public=${n.isPublic}`);
  }
}

// ─────────────────────────────────────────────
// 命令: backfill
// ─────────────────────────────────────────────

async function cmdBackfill(flags: Map<string, string>) {
  const types = parseCommaList(flags.get("types"));

  const all = types.length === 0;

  if (all || types.includes("ticket")) {
    console.log("[backfill] 正在回填 TICKET...");
    const tickets = await prisma.ticket.findMany({
      include: {
        project: { select: { id: true, name: true } },
        module: { include: { responsibility: { select: { kind: true } } } },
        assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
        creator: { select: { name: true, email: true } },
      },
    });
    const results = await Promise.allSettled(tickets.map((t) => upsertSearchDocument(buildSearchableTicketDocument(t))));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").length;
    console.log(`[backfill] TICKET done: ${tickets.length} total, ${failed} failed`);
  }

  if (all || types.includes("commit")) {
    console.log("[backfill] 正在回填 COMMIT...");
    const commits = await prisma.ticketCommit.findMany({
      include: {
        ticket: { select: { id: true, project: { select: { id: true, name: true } }, module: { select: { name: true } } } },
      },
    });
    const results = await Promise.allSettled(commits.map((c) => upsertSearchDocument(buildSearchableCommitDocument(c))));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").length;
    console.log(`[backfill] COMMIT done: ${commits.length} total, ${failed} failed`);
  }

  if (all || types.includes("note")) {
    console.log("[backfill] 正在回填 PKM_NOTE...");
    const notes = await prisma.pkmNote.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
      },
    });
    const results = await Promise.allSettled(notes.map((n) => syncPkmNoteSearchDocument(n.id)));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").length;
    console.log(`[backfill] PKM_NOTE done: ${notes.length} total, ${failed} failed`);
  }

  console.log("[backfill] 完成");
}

// ─────────────────────────────────────────────
// 命令: reindex
// ─────────────────────────────────────────────

async function cmdReindex(noteIds: string[], flags: Map<string, string>) {
  const batchSize = Number.parseInt(flags.get("batch-size") ?? "20", 10);
  const concurrency = Number.parseInt(flags.get("concurrency") ?? "1", 10);
  const clear = flags.has("clear");

  const noteSourceType = SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE as PrismaSearchDocumentSourceType;

  if (clear) {
    const existing = await prisma.searchDocument.count({ where: { sourceType: noteSourceType } });
    const result = await prisma.searchDocument.deleteMany({ where: { sourceType: noteSourceType } });
    console.log(`[reindex] cleared ${result.count} PKM SearchDocument rows (of ${existing} matched)`);
  }

  const ids = noteIds.length > 0
    ? noteIds
    : (await prisma.pkmNote.findMany({ select: { id: true }, orderBy: { updatedAt: "desc" } })).map((n) => n.id);

  console.log(`[reindex] notes=${ids.length} batchSize=${batchSize} concurrency=${concurrency}`);

  const batches = chunk(ids, batchSize);
  let processed = 0;
  let failed = 0;
  const failedSamples: Array<{ noteId: string; message: string }> = [];

  for (const [index, batch] of batches.entries()) {
    const slotSize = Math.max(1, Math.floor(batchSize / concurrency));
    const slots = chunk(batch, slotSize);

    for (const slot of slots) {
      const results = await Promise.allSettled(slot.map((noteId) => syncPkmNoteSearchDocument(noteId)));
      for (const [i, result] of results.entries()) {
        if (result.status === "rejected") {
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          console.error(`[reindex] failed ${slot[i]}: ${msg}`);
          failedSamples.push({ noteId: slot[i], message: msg });
          failed++;
        } else {
          processed++;
        }
      }
    }

    console.log(`[reindex] batch ${index + 1}/${batches.length}: done=${batch.length} errors=${results.filter((r) => r.status === "rejected").length}`);
  }

  console.log(`[reindex] finished total=${ids.length} processed=${processed} failed=${failed}`);
  if (failedSamples.length > 0) {
    for (const s of failedSamples.slice(0, 10)) console.log(`  - ${s.noteId}: ${s.message}`);
  }
}

// ─────────────────────────────────────────────
// 命令: embed
// ─────────────────────────────────────────────

async function cmdEmbed(flags: Map<string, string>) {
  const batchSize = Number.parseInt(flags.get("batch-size") ?? "50", 10);
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    console.error("[embed] invalid batch size:", batchSize);
    process.exitCode = 1;
    return;
  }
  console.log(`[embed] batchSize=${batchSize}`);
  const result = await backfillMissingSearchEmbeddings(batchSize);
  console.log("[embed] done", result);
}

// ─────────────────────────────────────────────
// 命令: clear
// ─────────────────────────────────────────────

async function cmdClear(flags: Map<string, string>) {
  const types = parseCommaList(flags.get("types"));
  const sourceTypeMap: Record<string, PrismaSearchDocumentSourceType> = {
    note: SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE as PrismaSearchDocumentSourceType,
    ticket: SEARCH_DOCUMENT_SOURCE_TYPES.TICKET as PrismaSearchDocumentSourceType,
    commit: SEARCH_DOCUMENT_SOURCE_TYPES.COMMIT as PrismaSearchDocumentSourceType,
  };

  const targets = types.length > 0 ? types : ["note"];

  for (const t of targets) {
    const st = sourceTypeMap[t];
    if (!st) { console.warn(`[clear] unknown type: ${t}, skip`); continue; }
    const existing = await prisma.searchDocument.count({ where: { sourceType: st } });
    const result = await prisma.searchDocument.deleteMany({ where: { sourceType: st } });
    console.log(`[clear] ${st}: deleted ${result.count} rows (of ${existing} matched)`);
  }
}

// ─────────────────────────────────────────────
// 命令: inspect
// ─────────────────────────────────────────────

async function cmdInspect(noteId?: string) {
  const noteSourceType = SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE as PrismaSearchDocumentSourceType;
  const noteSourceTypeLiteral = String(noteSourceType);

  const docs = await prisma.$queryRaw<Array<{
    id: string; sourceId: string; title: string; clen: number;
    has_emb: boolean; updatedAt: Date; metadata: unknown;
  }>>(Prisma.sql`
    SELECT id, "sourceId", title,
           length(content) AS clen,
           (embedding IS NOT NULL) AS has_emb,
           "updatedAt", metadata
    FROM pm."SearchDocument"
    WHERE "sourceType" = ${noteSourceTypeLiteral}::"SearchDocumentSourceType"
    ORDER BY "updatedAt" DESC
  `);

  if (noteId) {
    const filtered = docs.filter((d) => d.sourceId === noteId);
    console.log(`[inspect] ${filtered.length} rows for noteId=${noteId}`);
    for (const d of filtered) {
      const meta = d.metadata as Record<string, unknown>;
      console.log(`  id=${d.id} chunkLen=${d.clen} has_emb=${d.has_emb} hash=${meta?.embeddingHash ?? "none"}`);
    }
  } else {
    console.log(`[inspect] total ${docs.length} PKM SearchDocument rows:`);
    for (const d of docs) {
      const meta = d.metadata as Record<string, unknown>;
      const marker = noteId && d.sourceId === noteId ? " >>>" : "";
      console.log(`  ${d.sourceId}  "${d.title}"  len=${d.clen}  emb=${d.has_emb}  hash=${meta?.embeddingHash ?? "none"}${marker}`);
    }
  }
}

// ─────────────────────────────────────────────
// 命令: search
// ─────────────────────────────────────────────

async function cmdSearch(query: string, flags: Map<string, string>) {
  const viewerUserId = flags.get("viewer-user-id") ?? "cmpuv1ot";
  const limit = Number.parseInt(flags.get("limit") ?? "10", 10);

  console.log(`[search] query="${query}" viewer=${viewerUserId} limit=${limit}`);

  const result = await searchDocuments({ query, limit, viewerUserId });

  console.log(`total=${result.total} took=${result.tookMs}ms\n`);

  const GROUP_LABELS: Record<string, string> = { note: "笔记", ticket: "工单", commit: "提交" };
  for (const [group, items] of Object.entries(result.grouped)) {
    const label = GROUP_LABELS[group] ?? group;
    console.log(`━━━ ${label} (${items.length} 条) ━━`);
    for (const item of items) {
      const noteMeta = group === "note"
        ? ` userId=${item.metadata?.noteUserId?.slice(0, 8)} isPublic=${item.metadata?.noteIsPublic}`
        : "";
      console.log(`  [${item.score.toFixed(2)}] keyword=${item.keywordScore} semantic=${item.semanticScore.toFixed(2)} | ${item.title}${noteMeta}`);
    }
    console.log();
  }
}

// ─────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────

async function main() {
  const { positional, flags } = parseArgs();
  const [command, ...cmdArgs] = positional;

  switch (command) {
    case "status":
      await cmdStatus();
      break;
    case "backfill":
      await cmdBackfill(flags);
      break;
    case "reindex":
      await cmdReindex(cmdArgs, flags);
      break;
    case "embed":
      await cmdEmbed(flags);
      break;
    case "clear":
      await cmdClear(flags);
      break;
    case "inspect":
      await cmdInspect(cmdArgs[0]);
      break;
    case "search":
      if (!cmdArgs[0]) { console.error("[search] 用法: search <query> [--viewer-user-id=xxx] [--limit=10]"); process.exitCode = 1; break; }
      await cmdSearch(cmdArgs.join(" "), flags);
      break;
    default:
      if (!command) {
        console.log(`用法: search-admin.ts <command> [args...]

可用命令:
  status              查看 SearchDocument 统计和最近笔记
  backfill [--types=note,ticket,commit]  回填所有内容（默认全量）
  reindex [--batch-size=20] [--concurrency=1] [--clear] [noteId...]
                       重建 PKM 笔记 SearchDocument（默认全量，可指定 noteId）
  embed [--batch-size=50]  补充缺失的向量（已有 content 但无 vector 的行）
  clear [--types=note]      删除 SearchDocument（默认只清 PKM_NOTE）
  inspect [noteId]          查看 PKM SearchDocument 明细
  search <query>            测试搜索（默认 viewerUserId=cmpuv1ot）
`);
      } else {
        console.error(`未知命令: ${command}`);
        process.exitCode = 1;
      }
  }

  await disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
