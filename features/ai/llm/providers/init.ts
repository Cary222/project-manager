/**
 * SYSTEM Provider 初始化
 *
 * 首次启动时确保 Agnes 凭证存在于 DB（ownerType=SYSTEM）
 * 后续所有模型统一走 resolveCredential() → createModel()
 */
import { prisma } from "@/shared/db/client";
import { encrypt, hashApiKey } from "../credentials/encryption";

export async function ensureSystemProvider(): Promise<void> {
  const existing = await prisma.userApiKey.findFirst({
    where: { userId: null, ownerType: "SYSTEM", provider: "agnes", deletedAt: null },
  });
  if (existing) return;

  const apiKey = process.env.AGNES_API_KEY;
  if (!apiKey) {
    console.warn("[system-provider] AGNES_API_KEY not set — Agnes will be unavailable");
    return;
  }

  const { encryptedKey, iv, authTag } = encrypt(apiKey);
  await prisma.userApiKey.create({
    data: {
      userId: null,
      ownerType: "SYSTEM",
      provider: "agnes",
      name: "Agnes",
      baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
      encryptedKey,
      iv,
      authTag,
      keyLast4: apiKey.slice(-4),
      keyHash: hashApiKey(apiKey),
      transport: "proxy",
      apiFormat: "openai-responses",
    },
  });
  console.log("[system-provider] Agnes provider initialized");
}
