import { prisma } from "./shared/db/client";

async function main() {
  const docs = await prisma.searchDocument.findMany({
    where: { sourceType: "PKM_NOTE" },
    include: {
      metadata: true,
    },
  });

  console.log(`Found ${docs.length} PKM_NOTE SearchDocuments`);

  for (const doc of docs) {
    const meta = doc.metadata as Record<string, unknown>;
    const tags: string[] = Array.isArray(meta?.noteTags) ? meta.noteTags : [];

    if (tags.length === 0) continue;

    const tagsStr = `标签 ${tags.join(" ")}`;
    const hasTags = doc.content.includes(tagsStr);
    if (hasTags) {
      console.log(`Doc ${doc.id}: tags already in content`);
      continue;
    }

    const newContent = `${tagsStr}\n${doc.content}`;
    await prisma.searchDocument.update({
      where: { id: doc.id },
      data: { content: newContent },
    });
    console.log(`Updated doc ${doc.id}: added tags to content`);
  }

  console.log("Done");
}

main().catch(console.error);
