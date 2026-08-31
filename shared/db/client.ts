import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// 开发环境下，若 cached client 缺少新生成模型（如 projectMeeting），自动重建实例
if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.prisma &&
  !(globalForPrisma.prisma as unknown as { projectMeeting?: unknown })
    .projectMeeting
) {
  globalForPrisma.prisma = undefined;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
