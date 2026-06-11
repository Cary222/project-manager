import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.ticketCommit.findFirst({ where: { ticketId: "cmq0hep7y002sjlwnua1vekb1" } });
  console.log("commitSha length:", c?.commitSha.length, "value:", c?.commitSha);
  console.log("slice(0,7):", c?.commitSha.slice(0, 7));
}
main().catch(console.error).finally(() => prisma.$disconnect());
