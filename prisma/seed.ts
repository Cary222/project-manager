import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rootPassword = process.env.ROOT_PASSWORD ?? "root123456";
  const userPassword = process.env.USER_PASSWORD ?? "user123456";

  const [rootHash, userHash] = await Promise.all([
    bcrypt.hash(rootPassword, 10),
    bcrypt.hash(userPassword, 10),
  ]);

  await prisma.counter.upsert({
    where: { key: "ticketNo" },
    update: {},
    create: { key: "ticketNo", nextValue: 10000 },
  });

  await prisma.user.upsert({
    where: { email: "root@example.com" },
    update: { role: UserRole.ROOT, passwordHash: rootHash, name: "Root" },
    create: {
      email: "root@example.com",
      name: "Root",
      role: UserRole.ROOT,
      passwordHash: rootHash,
    },
  });

  await prisma.user.upsert({
    where: { email: "user@example.com" },
    update: { role: UserRole.USER, passwordHash: userHash, name: "User" },
    create: {
      email: "user@example.com",
      name: "User",
      role: UserRole.USER,
      passwordHash: userHash,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
