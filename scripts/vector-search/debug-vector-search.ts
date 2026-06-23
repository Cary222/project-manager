import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";
import { fetchEmbedding } from "@/shared/lib/embedding";

loadEnvConfig(process.cwd());

async function main() {
  const query = process.argv.slice(2).join(" ");
  console.log(`[vdbg] query="${query}"`);
  const vec = await fetchEmbedding(query);
  console.log(`[vdbg] vec length=${vec.length} sample=${vec.slice(0, 5).join(",")}`);
  const literal = `[${vec.join(",")}]`;
  const rows = await prisma.$queryRaw<Array<{ id: string; title: string; distance: number }>>(Prisma.sql`
    SELECT id, title, (embedding <=> ${literal}::vector) AS distance
    FROM pm."SearchDocument"
    WHERE "sourceType" = 'PKM_NOTE'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector ASC
    LIMIT 5
  `);
  console.log(`[vdbg] top 5 by vector distance:`);
  for (const r of rows) {
    console.log(`  distance=${r.distance.toFixed(4)}  ${r.title}`);
  }
}

main()
  .catch((e) => { console.error("[vdbg] failed", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());