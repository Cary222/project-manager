/**
 * BaseURL 规范化模块
 *
 * 职责边界：
 * - 本模块是纯函数模块，不依赖任何业务逻辑
 * - 提供统一的 baseURL 规范化逻辑，供 ProjectHub 和 Voice 模块使用
 *
 * 不负责：
 * - Credential 解析（api-key-store.ts）
 * - 模型发现（registry.ts）
 * - Provider Auth（Pi SDK）
 */

/**
 * 规范化 baseURL
 * - 移除末尾斜杠
 * - 确保包含 /v1 路径
 */
export function normalizeBaseURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/$/, "");
  if (!trimmed.includes("/v1")) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Known provider defaults — used when user doesn't specify a custom baseURL
// ---------------------------------------------------------------------------
const KNOWN_DEFAULTS: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  together: "https://api.together.xyz/v1",
};

/**
 * 获取有效的 baseURL
 * - 优先使用用户自定义的 baseURL
 * - 其次使用已知的 provider 默认值
 * - 最后使用通用格式 "https://api.{provider}.com/v1"
 */
export function getEffectiveBaseURL(
  provider: string,
  customBaseURL?: string | null
): string {
  const raw = customBaseURL?.trim() || KNOWN_DEFAULTS[provider] || `https://api.${provider}.com/v1`;
  return normalizeBaseURL(raw);
}
