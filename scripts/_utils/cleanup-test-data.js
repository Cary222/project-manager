/**
 * scripts/cleanup-test-data.js - 清理测试数据
 * 
 * 运行方式：node scripts/cleanup-test-data.js
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/postgres",
    },
  },
});

async function cleanup() {
  console.log("开始清理测试数据...\n");

  // 1. 找出所有测试模块并删除（会级联删除单子）
  const testModules = await prisma.module.findMany({
    where: {
      name: { contains: "E2E测试" },
    },
    select: { id: true, name: true },
  });

  console.log(`找到 ${testModules.length} 个测试模块:`);
  for (const m of testModules) {
    console.log(`  - ${m.name}`);
  }

  if (testModules.length > 0) {
    await prisma.module.deleteMany({
      where: {
        id: { in: testModules.map((m) => m.id) },
      },
    });
    console.log("\n测试模块已删除（单子也会级联删除）");
  }

  // 2. 重置单号计数器到最大单号+1
  const maxTicket = await prisma.ticket.findFirst({
    orderBy: { ticketNo: "desc" },
    select: { ticketNo: true },
  });

  const counter = await prisma.counter.findUnique({
    where: { key: "ticketNo" },
  });

  if (counter) {
    const nextValue = (maxTicket?.ticketNo ?? 9999) + 1;
    console.log(`\n当前最大单号: ${maxTicket?.ticketNo ?? "无"}`);
    console.log(`当前计数器: nextValue = ${counter.nextValue}`);
    await prisma.counter.update({
      where: { key: "ticketNo" },
      data: { nextValue },
    });
    console.log(`单号计数器已重置到 ${nextValue}`);
  }

  await prisma.$disconnect();
  console.log("\n✅ 清理完成！");
}

cleanup().catch((e) => {
  console.error("清理失败:", e);
  process.exit(1);
});
