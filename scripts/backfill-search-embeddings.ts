import { loadEnvConfig } from "@next/env";
import { backfillMissingSearchEmbeddings } from "@/shared/lib/search";

loadEnvConfig(process.cwd());

async function main() {
  const batchSize = Number(process.env.SEARCH_EMBED_BATCH_SIZE ?? "50");
  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("SEARCH_EMBED_BATCH_SIZE_INVALID");
  }

  const result = await backfillMissingSearchEmbeddings(batchSize);
  console.log("[search:embed] done", result);
}

main().catch((error) => {
  console.error("[search:embed] failed", error);
  process.exitCode = 1;
});
