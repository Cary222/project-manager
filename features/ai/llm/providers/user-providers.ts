/**
 * User Providers Service — Shared AI Domain（Stage 6）
 *
 * User Scope provider 凭证解析（供 /api/ai/providers/discover 与 /test 使用）：
 * - 请求携带 apiKey → 草稿凭证（未保存，直接用）
 * - 否则 → CredentialService（api-key-store.resolveCredential）读取 UserApiKey DB
 *
 * 不重新实现 Provider Auth；baseURL 规范化沿用 lib/normalize-base-url。
 */

import { resolveCredential, type CredentialRecord } from "../credentials/api-key-store";
import { getEffectiveBaseURL, normalizeBaseURL } from "@/lib/normalize-base-url";
import { getProviderPreset } from "./presets";
import type { ApiFormat } from "./types";

export interface UserProviderAuthInput {
  provider: string;
  baseURL?: string;
  apiFormat?: ApiFormat;
  /** 草稿 API Key（未保存场景，如配置表单里的连接测试/发现）。 */
  apiKey?: string;
}

export interface UserProviderAuth {
  provider: string;
  apiKey: string;
  baseURL: string;
  apiFormat: ApiFormat;
}

/**
 * 解析 User Scope provider 凭证。
 * 找不到凭证时抛错（message 可直接展示给用户）。
 */
export async function resolveUserProviderAuth(
  userId: string,
  input: UserProviderAuthInput,
): Promise<UserProviderAuth> {
  const preset = getProviderPreset(input.provider);

  // 草稿凭证优先（UI 中尚未保存的 key）
  if (input.apiKey && input.apiKey.trim()) {
    const baseURL = input.baseURL?.trim()
      ? normalizeBaseURL(input.baseURL)
      : preset?.baseUrl
        ? normalizeBaseURL(preset.baseUrl)
        : getEffectiveBaseURL(input.provider, null);
    return {
      provider: input.provider,
      apiKey: input.apiKey.trim(),
      baseURL,
      apiFormat: input.apiFormat ?? preset?.apiFormat ?? "openai-chat",
    };
  }

  // CredentialService：USER key → SYSTEM key fallback
  const cred = await resolveCredential(userId, input.provider);
  if (!cred) {
    throw new Error(`No credential found for provider "${input.provider}". Please configure your API key.`);
  }
  return {
    provider: cred.provider,
    apiKey: cred.apiKey,
    baseURL: input.baseURL?.trim() ? normalizeBaseURL(input.baseURL) : cred.baseURL,
    apiFormat: input.apiFormat ?? cred.apiFormat,
  };
}

/** ApiFormat → Pi models.json api 字符串（复用 Pi Auth Parsing / Discovery 语义）。 */
export function apiFormatToPiApi(apiFormat: ApiFormat): string {
  return apiFormat === "anthropic" ? "anthropic-messages" : "openai-completions";
}

/**
 * 站点凭证回落（Stage 7 继承链路）：
 * Pi Workspace 的 discover/test 在配置未携带 apiKey 时，回落到站点
 * CredentialService（USER key → SYSTEM key fallback）。凭证不出库，
 * 仅服务端内部使用。无会话/无凭证时返回 null。
 */
export async function resolveSiteCredential(
  providerName: string,
): Promise<CredentialRecord | null> {
  const { auth } = await import("@/lib/auth");
  const session = await auth().catch(() => null);
  const userId = session?.user?.id;
  if (!userId) return null;
  return resolveCredential(userId, providerName);
}
