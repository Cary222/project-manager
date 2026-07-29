import { prisma } from "@/lib/prisma";

async function fixExpenseShares() {
  console.log("开始修复报销分摊金额...\n");

  // 获取所有报销记录
  const expenses = await prisma.monthlyExpense.findMany({
    include: {
      shares: true,
    },
  });

  console.log(`找到 ${expenses.length} 条报销记录\n`);

  for (const expense of expenses) {
    if (expense.shares.length === 0) continue;

    const totalAmount = expense.amount;
    const shareCount = expense.shares.length;
    const correctShare = Math.round((totalAmount / shareCount) * 100) / 100;

    // 检查是否有错误（分摊金额不等于均分值）
    const hasError = expense.shares.some((s) => Math.abs(s.shareAmount - correctShare) > 0.01);

    if (hasError) {
      console.log(`修复报销: ${expense.id}`);
      console.log(`  金额: ¥${totalAmount}, 分摊人数: ${shareCount}`);
      console.log(`  正确的每人分摊: ¥${correctShare}`);
      console.log(`  当前分摊:`);
      expense.shares.forEach((s) => {
        console.log(`    ${s.userId}: ¥${s.shareAmount}`);
      });

      // 修复分摊金额
      await prisma.expenseShare.updateMany({
        where: { expenseId: expense.id },
        data: { shareAmount: correctShare },
      });

      console.log(`  已修复为: ¥${correctShare}\n`);
    }
  }

  console.log("修复完成！");
}

fixExpenseShares()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
