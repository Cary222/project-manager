import { loadEnvConfig } from "@next/env";
import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/db/client";

loadEnvConfig(process.cwd());

async function main() {
  const noteId = process.argv[2];
  if (!noteId) {
    console.error("usage: tsx scripts/inspect-search-doc.ts <noteId>");
    process.exit(1);
  }

  const docs = await prisma.$queryRaw<Array<{
    id: string;
    sourceId: string;
    title: string;
    clen: number;
    has_emb: boolean;
    metadata: any;
    updatedAt: Date;
  }>>(Prisma.sql`
    SELECT
      id,
      "sourceId",
      title,
      length(content) AS clen,
      (embedding IS NOT NULL) AS has_emb,
      metadata,
      "updatedAt"
    FROM pm."SearchDocument"
    WHERE "sourceType" = 'PKM_NOTE'
    ORDER BY "updatedAt" DESC
  `);

  console.log(`found ${docs.length} PKM SearchDocument rows`);
  for (const d of docs) {
    console.log(`---`);
    console.log(`id=${d.id}`);
    console.log(`sourceId=${d.sourceId}`);
    console.log(`title=${d.title}`);
    console.log(`content_len=${d.clen}`);
    console.log(`has_embedding=${d.has_emb}`);
    console.log(`updatedAt=${d.updatedAt.toISOString()}`);
    console.log(`metadata.embeddingHash=${d.metadata?.embeddingHash ?? "(none)"}`);
    if (noteId && d.sourceId === noteId) {
      console.log(`>>> MATCH for ${noteId}`);
      console.log(`content_preview=${d.title}`);
      const doc = await prisma.searchDocument.findUnique({ where: { id: d.id } });
      if (doc) {
        console.log(`first 200 chars: ${doc.content.slice(0, 200)}`);
      }
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());