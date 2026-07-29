/**
 * 诊断脚本：查看本周周报数据是否正确
 * 运行：npx tsx scripts/diagnose-weekly-reports.ts
 */
import { loadEnvConfig } from "@next/env";
import { prisma } from "@/shared/db/client";
import { getWeekRange } from "@/features/weekly-reports/lib/week";

loadEnvConfig(process.cwd());

async function main() {
  console.log("=== 诊断：本周周报数据 ===\n");

  const now = new Date();
  console.log(`当前时间（UTC）: ${now.toISOString()}`);
  console.log(`当前时间（北京时间）: ${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);

  const { weekStart, weekEnd } = getWeekRange(now);
  console.log(`\n本周 weekStart: ${weekStart.toISOString()}`);
  console.log(`本周 weekEnd:   ${weekEnd.toISOString()}`);

  // 查询所有用户
  const allUsers = await prisma.user.findMany({
    where: { bannedAt: null },
    select: { id: true, name: true, email: true },
  });
  console.log(`\n总用户数（未封禁）: ${allUsers.length}`);

  // 查询本周范围内所有周报（基于 createdAt）
  const weekReports = await prisma.weeklyReport.findMany({
    where: {
      createdAt: { gte: weekStart, lte: weekEnd },
    },
    select: { userId: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`\n本周范围内（按 createdAt）的周报数: ${weekReports.length}`);
  for (const r of weekReports) {
    const user = allUsers.find(u => u.id === r.userId);
    console.log(`  - ${user?.name ?? r.userId}: "${r.title}" createdAt=${r.createdAt.toISOString()}`);
  }

  // 按 createdAt 查 DISTINCT userId
  const distinctReports = await prisma.weeklyReport.findMany({
    where: {
      createdAt: { gte: weekStart, lte: weekEnd },
    },
    select: { userId: true },
    distinct: ["userId"],
  });
  console.log(`\n本周（按 createdAt）DISTINCT userId 数: ${distinctReports.length}`);

  // submitted / missing
  const submittedIds = new Set(distinctReports.map(r => r.userId));
  const submitted = allUsers.filter(u => submittedIds.has(u.id));
  const missing   = allUsers.filter(u => !submittedIds.has(u.id));
  console.log(`submitted (by createdAt): ${submitted.length}`);
  console.log(`missing:   ${missing.length}`);
  console.log(`周报率:     ${allUsers.length > 0 ? Math.round((submitted.length / allUsers.length) * 100) : 0}%`);

  // 查 submitted 详情
  if (submitted.length > 0) {
    console.log(`\n已提交用户:`);
    for (const u of submitted) {
      console.log(`  - ${u.name ?? u.email}`);
    }
  }

  // 查 missing 详情
  if (missing.length > 0) {
    console.log(`\n未提交用户（前10）:`);
    for (const u of missing.slice(0, 10)) {
      console.log(`  - ${u.name ?? u.email}`);
    }
  }

  // 查所有周报的 createdAt 分布
  const recentReports = await prisma.weeklyReport.findMany({
    select: { userId: true, createdAt: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  console.log(`\n最近 30 条周报记录的 createdAt:`);
  for (const r of recentReports) {
    const user = allUsers.find(u => u.id === r.userId);
    const inWeek = r.createdAt >= weekStart && r.createdAt <= weekEnd;
    console.log(`  [${inWeek ? "✓本周" : "✗非本周"}] ${user?.name ?? r.userId} | createdAt=${r.createdAt.toISOString()} | ${r.title}`);
  }
}

main().catch(console.error);
