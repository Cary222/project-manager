import { loadEnvConfig } from "@next/env";
import type { SearchDocumentSourceType as PrismaSearchDocumentSourceType } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { SEARCH_DOCUMENT_SOURCE_TYPES } from "@/shared/lib/search-types";

loadEnvConfig(process.cwd());

async function main() {
  const noteSourceType = SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE as PrismaSearchDocumentSourceType;
  const existing = await prisma.searchDocument.count({ where: { sourceType: noteSourceType } });
  const result = await prisma.searchDocument.deleteMany({ where: { sourceType: noteSourceType } });
  console.log(`[search:clear-pkm] deleted ${result.count} PKM SearchDocument rows (of ${existing} matched)`);
}

main()
  .catch((error) => {
    console.error("[search:clear-pkm] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
