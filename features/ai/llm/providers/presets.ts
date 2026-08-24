/**
 * Provider Presets — Shared AI Domain（Stage 6）
 *
 * ProjectHub AI Settings 的 Provider 目录（Pi UX：40+ provider / 搜索 / 分类）。
 * 仅作为 UI 预设与默认值来源；凭证仍存 UserApiKey DB（CredentialService）。
 */

import type { ApiFormat } from "./types";

export interface ProviderPreset {
  id: string;
  displayName: string;
  /** 默认 Base URL（可被用户覆盖）。 */
  baseUrl?: string;
  /** 默认 API 协议。 */
  apiFormat: ApiFormat;
  /** UI 分类（用于 picker 分组/筛选）。 */
  category: "international" | "china" | "cloud" | "gateway" | "local";
  /** provider-icons 的 icon key（与 PROVIDER_ICONS 对齐）。 */
  iconKey?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ── 国际主流 ──────────────────────────────────────────────
  { id: "anthropic", displayName: "Anthropic", baseUrl: "https://api.anthropic.com", apiFormat: "anthropic", category: "international", iconKey: "anthropic" },
  { id: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", apiFormat: "openai-chat", category: "international", iconKey: "openai" },
  { id: "google", displayName: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiFormat: "openai-chat", category: "international", iconKey: "google" },
  { id: "xai", displayName: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", apiFormat: "openai-chat", category: "international", iconKey: "xai" },
  { id: "mistral", displayName: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", apiFormat: "openai-chat", category: "international", iconKey: "mistral" },
  { id: "cohere", displayName: "Cohere", baseUrl: "https://api.cohere.com/compatibility/v1", apiFormat: "openai-chat", category: "international", iconKey: "cohere" },
  { id: "perplexity", displayName: "Perplexity", baseUrl: "https://api.perplexity.ai", apiFormat: "openai-chat", category: "international", iconKey: "perplexity" },
  { id: "groq", displayName: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiFormat: "openai-chat", category: "international", iconKey: "groq" },
  { id: "cerebras", displayName: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", apiFormat: "openai-chat", category: "international", iconKey: "cerebras" },
  { id: "fireworks", displayName: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", apiFormat: "openai-chat", category: "international", iconKey: "fireworks" },
  { id: "together", displayName: "Together AI", baseUrl: "https://api.together.xyz/v1", apiFormat: "openai-chat", category: "international", iconKey: "together" },
  { id: "huggingface", displayName: "HuggingFace", baseUrl: "https://router.huggingface.co/v1", apiFormat: "openai-chat", category: "international", iconKey: "huggingface" },
  { id: "nvidia", displayName: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", apiFormat: "openai-chat", category: "international", iconKey: "nvidia" },

  // ── 国内主流 ──────────────────────────────────────────────
  { id: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai-chat", category: "china", iconKey: "deepseek" },
  { id: "qwen", displayName: "阿里云百炼 (Qwen)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiFormat: "openai-chat", category: "china", iconKey: "qwen" },
  { id: "moonshot", displayName: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1", apiFormat: "openai-chat", category: "china", iconKey: "moonshot" },
  { id: "minimax", displayName: "MiniMax", baseUrl: "https://api.minimax.chat/v1", apiFormat: "openai-chat", category: "china", iconKey: "minimax" },
  { id: "zhipu", displayName: "智谱 AI (GLM)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiFormat: "openai-chat", category: "china", iconKey: "zhipu" },
  { id: "zai", displayName: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4", apiFormat: "openai-chat", category: "china", iconKey: "zai" },
  { id: "xiaomi", displayName: "小米 MiMo", baseUrl: "https://api.xiaomimimo.com/v1", apiFormat: "openai-chat", category: "china", iconKey: "xiaomi" },
  { id: "ant-ling", displayName: "蚂蚁灵光", apiFormat: "openai-chat", category: "china", iconKey: "ant-ling" },

  // ── 云平台 ────────────────────────────────────────────────
  { id: "amazon-bedrock", displayName: "Amazon Bedrock", apiFormat: "anthropic", category: "cloud", iconKey: "amazon-bedrock" },
  { id: "azure-openai", displayName: "Azure OpenAI", apiFormat: "openai-chat", category: "cloud", iconKey: "azure-openai-responses" },
  { id: "google-vertex", displayName: "Google Vertex AI", apiFormat: "openai-chat", category: "cloud", iconKey: "google-vertex" },
  { id: "cloudflare-workers-ai", displayName: "Cloudflare Workers AI", apiFormat: "openai-chat", category: "cloud", iconKey: "cloudflare-workers-ai" },
  { id: "github-copilot", displayName: "GitHub Copilot", apiFormat: "openai-chat", category: "cloud", iconKey: "github-copilot" },

  // ── 网关 / 聚合 ───────────────────────────────────────────
  { id: "openrouter", displayName: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiFormat: "openai-chat", category: "gateway", iconKey: "openrouter" },
  { id: "vercel-ai-gateway", displayName: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", apiFormat: "openai-chat", category: "gateway", iconKey: "vercel-ai-gateway" },
  { id: "cloudflare-ai-gateway", displayName: "Cloudflare AI Gateway", apiFormat: "openai-chat", category: "gateway", iconKey: "cloudflare-ai-gateway" },
  { id: "opencode", displayName: "OpenCode Zen", baseUrl: "https://opencode.ai/zen/v1", apiFormat: "openai-chat", category: "gateway", iconKey: "opencode" },
  { id: "kimi-coding", displayName: "Kimi for Coding", apiFormat: "anthropic", category: "gateway", iconKey: "kimi-coding" },

  // ── 本地 / 自托管 ─────────────────────────────────────────
  { id: "ollama", displayName: "Ollama", baseUrl: "http://localhost:11434/v1", apiFormat: "openai-chat", category: "local" },
  { id: "lmstudio", displayName: "LM Studio", baseUrl: "http://localhost:1234/v1", apiFormat: "openai-chat", category: "local" },
  { id: "vllm", displayName: "vLLM", baseUrl: "http://localhost:8000/v1", apiFormat: "openai-chat", category: "local" },
];

export function getProviderPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/** 已知 provider 的展示名（含 presets + Agnes 系统 provider）。 */
export function getProviderPresetDisplayName(id: string): string | undefined {
  if (id === "agnes") return "Agnes";
  return getProviderPreset(id)?.displayName;
}
