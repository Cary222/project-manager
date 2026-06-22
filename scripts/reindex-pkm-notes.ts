import { loadEnvConfig } from "@next/env";
import type { SearchDocumentSourceType as PrismaSearchDocumentSourceType } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { syncPkmNoteSearchDocument } from "@/shared/lib/search";
import { SEARCH_DOCUMENT_SOURCE_TYPES } from "@/shared/lib/search-types";

loadEnvConfig(process.cwd());

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 1;

type BatchTiming = {
  batchIndex: number;
  total: number;
  done: number;
  errors: number;
  durationMs: number;
};

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (const arg of argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key) args.set(key, value ?? "true");
  }
  return {
    batchSize: Number.parseInt(args.get("batch-size") ?? `${DEFAULT_BATCH_SIZE}`, 10),
    concurrency: Number.parseInt(args.get("concurrency") ?? `${DEFAULT_CONCURRENCY}`, 10),
    dryRun: args.has("dry-run"),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function processBatchSerially(noteIds: string[]) {
  const done: string[] = [];
  const errors: Array<{ noteId: string; message: string }> = [];

  for (const noteId of noteIds) {
    try {
      await syncPkmNoteSearchDocument(noteId);
      done.push(noteId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[search:reindex-pkm] failed ${noteId}: ${message}`);
      errors.push({ noteId, message });
    }
  }

  return { done, errors };
}

async function main() {
  const args = parseArgs(process.argv);
  const batchSize = Number.isFinite(args.batchSize) && args.batchSize > 0 ? args.batchSize : DEFAULT_BATCH_SIZE;
  const concurrency = Number.isFinite(args.concurrency) && args.concurrency > 0 ? args.concurrency : DEFAULT_CONCURRENCY;

  const noteSourceType = SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE as PrismaSearchDocumentSourceType;

  const totalNotes = await prisma.pkmNote.count();
  const totalDocuments = await prisma.searchDocument.count({ where: { sourceType: noteSourceType } });

  console.log(
    `[search:reindex-pkm] discovered ${totalNotes} PkmNote rows / ${totalDocuments} existing SearchDocument rows`,
  );

  if (args.dryRun) {
    console.log(`[search:reindex-pkm] dry-run enabled, would reindex all ${totalNotes} PKM notes`);
    console.log(`[search:reindex-pkm] batchSize=${batchSize} concurrency=${concurrency}`);
    return;
  }

  const notes = await prisma.pkmNote.findMany({
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  const noteIds = notes.map((note) => note.id);
  const batches = chunk(noteIds, batchSize);
  const startedAt = Date.now();

  console.log(
    `[search:reindex-pkm] starting batch reindex: notes=${noteIds.length} batches=${batches.length} batchSize=${batchSize} concurrency=${concurrency}`,
  );

  let processed = 0;
  let failed = 0;
  const failedSamples: Array<{ noteId: string; message: string }> = [];

  for (const [index, noteBatch] of batches.entries()) {
    const batchStartedAt = Date.now();
    let batchErrors = 0;
    let batchDone = 0;

    if (concurrency <= 1) {
      const result = await processBatchSerially(noteBatch);
      batchDone = result.done.length;
      batchErrors = result.errors.length;
      for (const item of result.errors) failedSamples.push(item);
    } else {
      const slots = chunk(noteBatch, concurrency);
      for (const slot of slots) {
        const result = await processBatchSerially(slot);
        batchDone += result.done.length;
        batchErrors += result.errors.length;
        for (const item of result.errors) failedSamples.push(item);
      }
    }

    processed += batchDone;
    failed += batchErrors;

    const timing: BatchTiming = {
      batchIndex: index + 1,
      total: batches.length,
      done: batchDone,
      errors: batchErrors,
      durationMs: Date.now() - batchStartedAt,
    };
    console.log(
      `[search:reindex-pkm] batch ${timing.batchIndex}/${timing.total} done=${timing.done} errors=${timing.errors} avgMs=${Math.round(timing.durationMs / Math.max(timing.done, 1))}`,
    );
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    `[search:reindex-pkm] finished total=${noteIds.length} processed=${processed} failed=${failed} elapsedMs=${elapsedMs}`,
  );

  if (failedSamples.length > 0) {
    console.log(`[search:reindex-pkm] first ${Math.min(failedSamples.length, 10)} failed noteIds:`);
    for (const sample of failedSamples.slice(0, 10)) {
      console.log(`  - ${sample.noteId}: ${sample.message}`);
    }
  }
}

main()
  .catch((error) => {
    console.error("[search:reindex-pkm] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });