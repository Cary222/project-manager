/* eslint-disable @typescript-eslint/no-explicit-any */
async function main() {
  // Must set env BEFORE importing prisma
  process.env.DATABASE_URL =
    "postgresql://community:community@192.168.1.14:5432/community?options=-c%20search_path%3Dpm";

  // Force fresh import
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    // Check what tables exist first
    const tables = await prisma.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname = 'pm'`;
    console.log("Tables in pm schema:", tables.map((t) => t.tablename));

     
    await (prisma as any).$executeRawUnsafe(
      `ALTER TABLE "aiChatMessage" ADD COLUMN IF NOT EXISTS "metadata" jsonb`
    );
    console.log("✅ metadata column added");
  } catch (e: any) {
    if (
      e.message?.includes("already exists") ||
      e.code === "4273"
    ) {
      console.log("ℹ️  metadata column already exists, skipping");
    } else {
      console.error("Error:", e);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
