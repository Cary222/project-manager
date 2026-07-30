/**
 * API Key 存储层
 * 提供 save/get/delete 接口，操作 prisma UserApiKey 表
 * 统一凭证链路：USER key → SYSTEM key fallback（Agnes）
 */
import { prisma } from "@/shared/db/client";
import { encrypt, decrypt, hashApiKey } from "./encryption";
import { getEffectiveBaseURL, normalizeBaseURL } from "../providers/registry";
import type { ApiFormat } from "../providers/types";

// ---------------------------------------------------------------------------
// baseURL normalization — ensures all API calls use consistent /v1 suffix
// Re-exported here so api-key-store can use it without importing registry internals
// ---------------------------------------------------------------------------
export { normalizeBaseURL };

export interface SaveApiKeyInput {
  userId: string;
  provider: string;
  name: string;
  apiKey: string;
  baseURL?: string;
  transport?: "proxy" | "direct";
  apiFormat?: ApiFormat;
}

export interface MaskedKeyInfo {
  id: string;
  provider: string;
  name: string;
  baseURL: string | null;
  keyLast4: string;
  lastUsedAt: string | null;
  createdAt: string;
  ownerType: string;
  transport: string;
  apiFormat: string;
}

export interface CredentialRecord {
  provider: string;
  baseURL: string;
  apiKey: string;
  transport: "proxy" | "direct";
  apiFormat: ApiFormat;
  ownerType: "SYSTEM" | "USER";
}

/**
 * 统一凭证解析入口。
 * 查找顺序：USER key → SYSTEM key（Agnes fallback）→ null
 */
export async function resolveCredential(
  userId: string,
  provider: string
): Promise<CredentialRecord | null> {
  // 1. 查用户自己的 key
  const userRecord = await prisma.userApiKey.findFirst({
    where: { userId, provider, deletedAt: null },
  });
  if (userRecord) {
    return {
      provider: userRecord.provider,
      baseURL: userRecord.baseURL
        ? normalizeBaseURL(userRecord.baseURL)
        : getEffectiveBaseURL(provider, null),
      apiKey: decrypt(userRecord.encryptedKey, userRecord.iv, userRecord.authTag),
      transport: (userRecord.transport as "proxy" | "direct") ?? "direct",
      apiFormat: (userRecord.apiFormat as ApiFormat) ?? "openai-chat",
      ownerType: "USER",
    };
  }

  // 2. SYSTEM key fallback（Agnes）
  const systemRecord = await prisma.userApiKey.findFirst({
    where: { userId: null, ownerType: "SYSTEM", provider, deletedAt: null },
  });
  if (systemRecord) {
    return {
      provider: systemRecord.provider,
      baseURL: systemRecord.baseURL
        ? normalizeBaseURL(systemRecord.baseURL)
        : getEffectiveBaseURL(provider, null),
      apiKey: decrypt(systemRecord.encryptedKey, systemRecord.iv, systemRecord.authTag),
      transport: (systemRecord.transport as "proxy" | "direct") ?? "proxy",
      apiFormat: (systemRecord.apiFormat as ApiFormat) ?? "openai-responses",
      ownerType: "SYSTEM",
    };
  }

  return null;
}

/**
 * 保存用户 API Key（加密后存 DB）
 * - 若同一 provider 已存在则更新（upsert via find + create/update）
 * - 明文 key 不会返回给调用方
 */
export async function saveApiKey(input: SaveApiKeyInput): Promise<MaskedKeyInfo> {
  const { userId, provider, name, apiKey } = input;

  const { encryptedKey, iv, authTag } = encrypt(apiKey);
  const keyHash = hashApiKey(apiKey);
  const keyLast4 = apiKey.slice(-4);

  // 查找是否已存在（USER 记录）
  const existing = await prisma.userApiKey.findFirst({
    where: { userId, provider, deletedAt: null },
  });

  let record;
  if (existing) {
    record = await prisma.userApiKey.update({
      where: { id: existing.id },
      data: {
        name,
        baseURL: input.baseURL ?? null,
        encryptedKey,
        iv,
        authTag,
        keyLast4,
        keyHash,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
  } else {
    record = await prisma.userApiKey.create({
      data: {
        userId,
        ownerType: "USER",
        transport: input.transport ?? "direct",
        apiFormat: input.apiFormat ?? "openai-chat",
        provider,
        name,
        baseURL: input.baseURL ?? null,
        encryptedKey,
        iv,
        authTag,
        keyLast4,
        keyHash,
      },
    });
  }

  return {
    id: record.id,
    provider: record.provider,
    name: record.name,
    baseURL: record.baseURL,
    keyLast4: record.keyLast4,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    ownerType: record.ownerType,
    transport: record.transport,
    apiFormat: record.apiFormat,
  };
}

/**
 * 获取用户指定 provider 的解密后 API Key
 * 返回 null 表示未配置
 */
export async function getApiKey(
  userId: string,
  provider: string
): Promise<string | null> {
  const record = await prisma.userApiKey.findFirst({
    where: { userId, provider, deletedAt: null },
  });

  if (!record) return null;

  // 更新 lastUsedAt
  await prisma.userApiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return decrypt(record.encryptedKey, record.iv, record.authTag);
}

/**
 * 获取用户所有已配置的 API Key（掩码信息，不含明文）
 */
export async function getMaskedKeyInfo(userId: string): Promise<MaskedKeyInfo[]> {
  const records = await prisma.userApiKey.findMany({
    where: { userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return records.map((r) => ({
    id: r.id,
    provider: r.provider,
    name: r.name,
    baseURL: r.baseURL,
    keyLast4: r.keyLast4,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    ownerType: r.ownerType,
    transport: r.transport,
    apiFormat: r.apiFormat,
  }));
}

/**
 * 软删除用户 API Key
 */
export async function deleteApiKey(
  userId: string,
  provider: string
): Promise<void> {
  await prisma.userApiKey.updateMany({
    where: { userId, provider },
    data: { deletedAt: new Date() },
  });
}

/**
 * 检查用户是否已配置某 provider 的 key
 */
export async function hasApiKey(
  userId: string,
  provider: string
): Promise<boolean> {
  const count = await prisma.userApiKey.count({
    where: { userId, provider, deletedAt: null },
  });
  return count > 0;
}

/**
 * 获取用户所有已配置的 provider 记录（包含 baseURL，用于动态模型发现）
 */
export async function getUserProviderRecords(
  userId: string
): Promise<
  Array<{
    provider: string;
    baseURL: string | null;
  }>
> {
  const records = await prisma.userApiKey.findMany({
    where: { userId, deletedAt: null },
    select: { provider: true, baseURL: true },
    distinct: ["provider"],
  });
  return records.map((r) => ({
    provider: r.provider,
    baseURL: r.baseURL,
  }));
}

// ---------------------------------------------------------------------------
// SYSTEM Provider 管理（ROOT 管理员专用）
// ---------------------------------------------------------------------------

export interface SystemProviderInput {
  provider: string;
  name: string;
  apiKey: string;
  baseURL?: string;
  transport?: "proxy" | "direct";
  apiFormat?: ApiFormat;
}

/**
 * 获取所有 SYSTEM provider（掩码信息）
 */
export async function getSystemProviders(): Promise<MaskedKeyInfo[]> {
  const records = await prisma.userApiKey.findMany({
    where: { ownerType: "SYSTEM", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  return records.map((r) => ({
    id: r.id,
    provider: r.provider,
    name: r.name,
    baseURL: r.baseURL,
    keyLast4: r.keyLast4,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    ownerType: r.ownerType,
    transport: r.transport,
    apiFormat: r.apiFormat,
  }));
}

/**
 * 保存/更新 SYSTEM provider（加密后存 DB）
 * - ownerType=SYSTEM，userId=null
 * - 按 provider 做 upsert（每个 SYSTEM provider 全局唯一）
 */
export async function saveSystemProvider(
  input: SystemProviderInput
): Promise<MaskedKeyInfo> {
  const { provider, name, apiKey } = input;

  const { encryptedKey, iv, authTag } = encrypt(apiKey);
  const keyHash = hashApiKey(apiKey);
  const keyLast4 = apiKey.slice(-4);

  const existing = await prisma.userApiKey.findFirst({
    where: { ownerType: "SYSTEM", provider, deletedAt: null },
  });

  let record;
  if (existing) {
    record = await prisma.userApiKey.update({
      where: { id: existing.id },
      data: {
        name,
        baseURL: input.baseURL ?? null,
        encryptedKey,
        iv,
        authTag,
        keyLast4,
        keyHash,
        transport: input.transport ?? existing.transport,
        apiFormat: input.apiFormat ?? existing.apiFormat,
        deletedAt: null,
        updatedAt: new Date(),
      },
    });
  } else {
    record = await prisma.userApiKey.create({
      data: {
        userId: null,
        ownerType: "SYSTEM",
        provider,
        name,
        baseURL: input.baseURL ?? null,
        encryptedKey,
        iv,
        authTag,
        keyLast4,
        keyHash,
        transport: input.transport ?? "proxy",
        apiFormat: input.apiFormat ?? "openai-chat",
      },
    });
  }

  return {
    id: record.id,
    provider: record.provider,
    name: record.name,
    baseURL: record.baseURL,
    keyLast4: record.keyLast4,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    ownerType: record.ownerType,
    transport: record.transport,
    apiFormat: record.apiFormat,
  };
}

/**
 * 软删除 SYSTEM provider
 */
export async function deleteSystemProvider(provider: string): Promise<void> {
  await prisma.userApiKey.updateMany({
    where: { ownerType: "SYSTEM", provider },
    data: { deletedAt: new Date() },
  });
}
