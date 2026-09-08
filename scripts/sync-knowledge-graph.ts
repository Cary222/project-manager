/**
 * CLI 入口：执行确定性业务图全量同步
 *
 * 用法：npx tsx scripts/sync-knowledge-graph.ts
 */

import { PrismaClient } from "@prisma/client";
import { syncBusinessGraph } from "../features/knowledge/lib/graph/sync-business";

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("🔄 Starting business graph sync...");
    const stats = await syncBusinessGraph(prisma);
    console.log(
      `✅ Sync complete: ${stats.nodes} nodes, ${stats.edges} edges in ${stats.durationMs}ms`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("❌ Sync failed:", err);
  process.exit(1);
});
