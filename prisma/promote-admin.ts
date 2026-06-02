import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list") || args.includes("-l")) {
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true, role: true, bannedAt: true },
    });
    console.log("\n用户列表：");
    console.log("-".repeat(60));
    for (const user of users) {
      const status = user.bannedAt ? " [已封禁]" : "";
      const name = user.name || "(未命名)";
      console.log(`  ${user.role.padEnd(6)}  ${name.padEnd(20)} ${user.email}${status}`);
    }
    console.log("-".repeat(60));
    console.log(`共 ${users.length} 人\n`);
    return;
  }

  if (args.length === 0) {
    console.log("用法：");
    console.log("  npx tsx prisma/promote-admin.ts <邮箱>    提升为 ROOT");
    console.log("  npx tsx prisma/promote-admin.ts --list     列出所有用户");
    console.log("  npx tsx prisma/promote-admin.ts --help     显示帮助");
    return;
  }

  const email = args[0];
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.error(`错误：未找到邮箱为 "${email}" 的用户`);
    process.exit(1);
  }

  await prisma.user.update({
    where: { email },
    data: { role: UserRole.ROOT },
  });

  console.log(`已将 ${user.name || user.email} (${user.email}) 提升为 ROOT`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
