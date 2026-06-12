import { backfillSearchIndex } from "../lib/git-sync/scan";
import { prisma } from "../shared/db/client";

async function main() {
  const result = await backfillSearchIndex();
  console.log("search index backfilled", result);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
