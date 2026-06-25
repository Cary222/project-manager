import { prisma } from "../shared/db/client";
import { Prisma } from "@prisma/client";

async function main() {
  const total = await prisma.searchDocument.count({ where: { sourceType: "PKM_NOTE" } });
  const withVec = await prisma.searchDocument.count({ where: { sourceType: "PKM_NOTE", embedding: { not: Prisma.DbNull } } });
  const ticket = await prisma.searchDocument.count({ where: { sourceType: "TICKET" } });
  const commit = await prisma.searchDocument.count({ where: { sourceType: "COMMIT" } });
  console.log("PKM_NOTE total:", total, "| with vector:", withVec);
  console.log("TICKET:", ticket, "| COMMIT:", commit);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
