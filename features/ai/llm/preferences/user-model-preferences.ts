/**
 * User Scope 模型偏好 Service（Stage 6）
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - UserAiModelPreference CRUD（批量 upsert、单条读取、全量读取）
 *   - enabled 语义：无行 = 默认启用；enabled=false 行 = 显式禁用
 *
 * ❌ 不负责：
 *   - 模型可用性 / Discovery（由 registry.ts 提供）
 *   - Runtime Config 合并（由 model-runtime-config.ts 提供）
 *   - 凭证管理（由 api-key-store.ts 提供）
 *
 * 依赖：prisma.userAiModelPreference（pm schema）
 */
import { prisma } from "@/shared/db/client";

export interface UserModelPreferenceRecord {
  provider: string;
  modelId: string;
  enabled: boolean;
  favorite: boolean;
  thinkingLevel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  updatedAt: string;
}

export interface UserModelPreferenceInput {
  provider: string;
  modelId: string;
  enabled?: boolean;
  favorite?: boolean;
  thinkingLevel?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
}

function toRecord(row: {
  provider: string;
  modelId: string;
  enabled: boolean;
  favorite: boolean;
  thinkingLevel: string | null;
  temperature: number | null;
  maxTokens: number | null;
  updatedAt: Date;
}): UserModelPreferenceRecord {
  return {
    provider: row.provider,
    modelId: row.modelId,
    enabled: row.enabled,
    favorite: row.favorite,
    thinkingLevel: row.thinkingLevel,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 读取用户全部偏好行（仅存在显式配置的模型才有行）。 */
export async function getUserModelPreferences(
  userId: string,
): Promise<UserModelPreferenceRecord[]> {
  const rows = await prisma.userAiModelPreference.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toRecord);
}

export async function getModelPreference(
  userId: string,
  provider: string,
  modelId: string,
): Promise<UserModelPreferenceRecord | null> {
  const row = await prisma.userAiModelPreference.findUnique({
    where: { userId_provider_modelId: { userId, provider, modelId } },
  });
  if (!row) return null;
  return toRecord(row);
}

/**
 * 批量 upsert 偏好。按 (provider, modelId) 定位，字段级写入：
 * 未提供的字段保持原值（新建行用默认值）。
 */
export async function upsertModelPreferences(
  userId: string,
  items: UserModelPreferenceInput[],
): Promise<number> {
  if (items.length === 0) return 0;

  const operations = items.map((item) => {
    const data = {
      ...(item.enabled !== undefined ? { enabled: item.enabled } : {}),
      ...(item.favorite !== undefined ? { favorite: item.favorite } : {}),
      ...(item.thinkingLevel !== undefined ? { thinkingLevel: item.thinkingLevel } : {}),
      ...(item.temperature !== undefined ? { temperature: item.temperature } : {}),
      ...(item.maxTokens !== undefined ? { maxTokens: item.maxTokens } : {}),
    };
    return prisma.userAiModelPreference.upsert({
      where: {
        userId_provider_modelId: { userId, provider: item.provider, modelId: item.modelId },
      },
      create: {
        userId,
        provider: item.provider,
        modelId: item.modelId,
        enabled: item.enabled ?? true,
        favorite: item.favorite ?? false,
        thinkingLevel: item.thinkingLevel ?? null,
        temperature: item.temperature ?? null,
        maxTokens: item.maxTokens ?? null,
      },
      update: data,
    });
  });

  await prisma.$transaction(operations);
  return items.length;
}

/** 模型是否对该用户启用（无偏好行 = 默认启用）。 */
export async function isModelEnabledForUser(
  userId: string,
  provider: string,
  modelId: string,
): Promise<boolean> {
  const row = await prisma.userAiModelPreference.findUnique({
    where: { userId_provider_modelId: { userId, provider, modelId } },
    select: { enabled: true },
  });
  return row?.enabled !== false;
}
