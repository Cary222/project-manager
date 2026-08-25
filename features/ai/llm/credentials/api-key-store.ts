/**
 * API Key 存储层 — CredentialService 核心
 *
 * 职责边界：
 * - ✅ 负责：UserApiKey CRUD、加密存储、凭证解析、三级降级链路
 * - ❌ 不负责：Provider-specific auth parsing（由 Pi SDK 负责）
 * - ❌ 不负责：模型发现（由 registry.ts 的 discoverModelsFromAPI 负责）
 * - ❌ 不负责：BaseURL 规范化（由 lib/normalize-base-url.ts 负责）
 *
 * 统一凭证链路：USER key → SYSTEM key fallback（Agnes）
 *
 * 依赖关系：
 * - @/lib/normalize-base-url.ts: BaseURL 规范化
 * - @/lib/user-models-cache.ts: User scope 缓存失效
 * - @/lib/unified-models-cache.ts: 跨端点 unified models 缓存失效（每次凭证变更均触发）
 * - prisma.userApiKey: 凭证存储
 */
import { prisma } from "@/shared/db/client";
import { encrypt, decrypt, hashApiKey } from "./encryption";
import {
  normalizeBaseURL,
  getEffectiveBaseURL,
} from "@/lib/normalize-base-url";
import type { ApiFormat } from "../providers/types";
import {
  invalidateUserModelsCache,
  invalidateAllUserModelsCache,
} from "@/lib/user-models-cache";
import { invalidateUnifiedModelsCache } from "@/lib/unified-models-cache";
import { readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";

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
  provider: string,
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
      apiKey: decrypt(
        userRecord.encryptedKey,
        userRecord.iv,
        userRecord.authTag,
      ),
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
      apiKey: decrypt(
        systemRecord.encryptedKey,
        systemRecord.iv,
        systemRecord.authTag,
      ),
      transport: (systemRecord.transport as "proxy" | "direct") ?? "proxy",
      apiFormat: (systemRecord.apiFormat as ApiFormat) ?? "openai-responses",
      ownerType: "SYSTEM",
    };
  }

  return null;
}

/**
 * 三级降级凭证解析。
 * 查找顺序：
 *  1. SYSTEM provider（ROOT 配置的系统默认）— 优先
 *  2. USER provider（用户个人配置）— 其次
 *  3. ENV fallback（环境变量兜底）— 最后
 *
 * 每级配置失败（无配置或无明文 key）才降级到下一级。
 */
export async function resolveCredentialWithFallback(
  userId: string,
  provider: string,
  envVarMap?: Record<string, string>,
): Promise<CredentialRecord | null> {
  // 1. SYSTEM provider
  const systemRecord = await prisma.userApiKey.findFirst({
    where: { userId: null, ownerType: "SYSTEM", provider, deletedAt: null },
  });
  if (systemRecord) {
    const apiKey = decrypt(
      systemRecord.encryptedKey,
      systemRecord.iv,
      systemRecord.authTag,
    );
    if (apiKey) {
      return {
        provider: systemRecord.provider,
        baseURL: systemRecord.baseURL
          ? normalizeBaseURL(systemRecord.baseURL)
          : getEffectiveBaseURL(provider, null),
        apiKey,
        transport: (systemRecord.transport as "proxy" | "direct") ?? "proxy",
        apiFormat: (systemRecord.apiFormat as ApiFormat) ?? "openai-chat",
        ownerType: "SYSTEM",
      };
    }
  }

  // 2. USER provider
  const userRecord = await prisma.userApiKey.findFirst({
    where: { userId, provider, deletedAt: null },
  });
  if (userRecord) {
    const apiKey = decrypt(
      userRecord.encryptedKey,
      userRecord.iv,
      userRecord.authTag,
    );
    if (apiKey) {
      return {
        provider: userRecord.provider,
        baseURL: userRecord.baseURL
          ? normalizeBaseURL(userRecord.baseURL)
          : getEffectiveBaseURL(provider, null),
        apiKey,
        transport: (userRecord.transport as "proxy" | "direct") ?? "direct",
        apiFormat: (userRecord.apiFormat as ApiFormat) ?? "openai-chat",
        ownerType: "USER",
      };
    }
  }

  // 3. ENV fallback
  if (envVarMap) {
    const apiKey = envVarMap.apiKey;
    const baseURL = envVarMap.baseURL;
    if (apiKey) {
      return {
        provider,
        baseURL: baseURL
          ? normalizeBaseURL(baseURL)
          : getEffectiveBaseURL(provider, null),
        apiKey,
        transport: "proxy",
        apiFormat: "openai-chat",
        ownerType: "SYSTEM",
      };
    }
  }

  return null;
}

/**
 * 保存用户 API Key（加密后存 DB）
 * - 若同一 provider 已存在则更新（upsert via find + create/update）
 * - 明文 key 不会返回给调用方
 */
export async function saveApiKey(
  input: SaveApiKeyInput,
): Promise<MaskedKeyInfo> {
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

  // 失效该用户的模型缓存
  invalidateUserModelsCache(userId);
  // 失效 unified models 缓存（跨端点共享）
  invalidateUnifiedModelsCache();

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
  provider: string,
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
export async function getMaskedKeyInfo(
  userId: string,
): Promise<MaskedKeyInfo[]> {
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
 * 软删除用户 API Key（按 id 删除）
 */
export async function deleteApiKeyById(
  id: string,
  userId: string,
): Promise<void> {
  await prisma.userApiKey.updateMany({
    where: { id, userId, ownerType: "USER" },
    data: { deletedAt: new Date() },
  });
  // 失效该用户的模型缓存
  invalidateUserModelsCache(userId);
  // 失效 unified models 缓存（跨端点共享）
  invalidateUnifiedModelsCache();
}

/**
 * 软删除用户 API Key（兼容旧接口，按 provider 删除所有匹配项）
 * @deprecated 请使用 deleteApiKeyById
 */
export async function deleteApiKey(
  userId: string,
  provider: string,
): Promise<void> {
  await prisma.userApiKey.updateMany({
    where: { userId, provider, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  // 失效该用户的模型缓存
  invalidateUserModelsCache(userId);
  // 失效 unified models 缓存（跨端点共享）
  invalidateUnifiedModelsCache();
}

/**
 * 检查用户是否已配置某 provider 的 key
 */
export async function hasApiKey(
  userId: string,
  provider: string,
): Promise<boolean> {
  const count = await prisma.userApiKey.count({
    where: { userId, provider, deletedAt: null },
  });
  return count > 0;
}

/**
 * 获取用户所有已配置的 provider 记录（包含 baseURL，用于动态模型发现）
 */
export async function getUserProviderRecords(userId: string): Promise<
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
 * 获取所有 SYSTEM provider 的解密凭证（用于模型发现等服务端操作）
 */
export async function getSystemCredentials(): Promise<CredentialRecord[]> {
  const records = await prisma.userApiKey.findMany({
    where: { ownerType: "SYSTEM", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  return records.map((r) => ({
    provider: r.provider,
    baseURL: r.baseURL
      ? normalizeBaseURL(r.baseURL)
      : getEffectiveBaseURL(r.provider, null),
    apiKey: decrypt(r.encryptedKey, r.iv, r.authTag),
    transport: (r.transport as "proxy" | "direct") ?? "proxy",
    apiFormat: (r.apiFormat as ApiFormat) ?? "openai-chat",
    ownerType: "SYSTEM",
  }));
}

/**
 * 保存/更新 SYSTEM provider（加密后存 DB）
 * - ownerType=SYSTEM，userId=null
 * - 按 provider 做 upsert（每个 SYSTEM provider 全局唯一）
 */
export async function saveSystemProvider(
  input: SystemProviderInput,
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

  // 失效所有用户的模型缓存（SYSTEM provider 变更影响全局）
  invalidateAllUserModelsCache();
  // 失效 unified models 全量缓存（SYSTEM 凭证变更影响所有用户）
  invalidateUnifiedModelsCache();

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
 * SYSTEM provider 删除时同步清理本地 models.json 中同名 provider 条目，
 * 保证 ProjectHub DB（/api/ai/models 数据源）与 Workspace models.json（/api/models 数据源）
 * 两侧删除一致，避免"DB 已删、Workspace 仍显示"的漂移。
 * 失败不阻塞主流程（models.json 清理是尽力而为）。
 */
async function stripProviderFromModelsConfig(
  provider: string,
  modelsPath?: string,
): Promise<void> {
  try {
    const config = await readModelsConfig(modelsPath);
    const providers = (config.providers ?? {}) as Record<string, unknown>;
    if (!(provider in providers)) return;
    const next = { ...providers };
    delete next[provider];
    await writeModelsConfig({ ...config, providers: next }, modelsPath);
  } catch (err) {
    console.warn(
      `[api-key-store] failed to strip provider "${provider}" from models.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 软删除 SYSTEM provider（按 id 精确删除）
 */
export async function deleteSystemProviderById(id: string): Promise<void> {
  const row = await prisma.userApiKey.findFirst({
    where: { id, ownerType: "SYSTEM" },
    select: { provider: true },
  });
  await prisma.userApiKey.updateMany({
    where: { id, ownerType: "SYSTEM" },
    data: { deletedAt: new Date() },
  });
  // 失效所有用户的模型缓存
  invalidateAllUserModelsCache();
  // 失效 unified models 全量缓存（SYSTEM 凭证变更影响所有用户）
  invalidateUnifiedModelsCache();
  if (row?.provider) await stripProviderFromModelsConfig(row.provider);
}

/**
 * 软删除 SYSTEM provider（按 provider 删除所有匹配项）
 */
export async function deleteSystemProvider(provider: string): Promise<void> {
  await prisma.userApiKey.updateMany({
    where: { ownerType: "SYSTEM", provider, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  // 失效所有用户的模型缓存
  invalidateAllUserModelsCache();
  // 失效 unified models 全量缓存（SYSTEM 凭证变更影响所有用户）
  invalidateUnifiedModelsCache();
  await stripProviderFromModelsConfig(provider);
}
