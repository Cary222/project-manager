/**
 * 语音凭证解析器
 *
 * 设计原则：基于模型能力选择凭证，遵循生图模块的模式。
 *
 * 生图模式：modelRef = "openai:wan2.7-image" → resolveCredentialWithFallback(userId, "openai")
 * 语音模式：同样支持 modelRef，让用户指定用哪个 provider 的语音能力
 *
 * 如果没有指定 modelRef：
 * 1. 从 SYSTEM provider 的模型列表中查找支持该能力的模型
 * 2. 从 USER provider 的模型列表中查找支持该能力的模型
 * 3. 如果都没找到，回退到 dashscope provider（传统兼容）
 * 4. 最后检查环境变量
 */

import { prisma } from "@/shared/db/client";
import { decrypt } from "../llm/credentials/encryption";
import { getEffectiveBaseURL, normalizeBaseURL, discoverModelsFromAPI } from "../llm/providers/registry";
import type { CredentialRecord } from "../llm/credentials/api-key-store";

export type VoiceCapability = "tts" | "stt" | "realtime";

// 模型 ID 关键词匹配（用于判断模型是否支持某种能力）
const VOICE_MODEL_PATTERNS: Record<VoiceCapability, RegExp[]> = {
  tts: [/\btts\b/i, /speech[-_]?synthesis/i, /audio[-_]?3[._-]?0[-_]?tts/i, /^qwen-audio-3\.0-tts/i],
  stt: [/\basr\b/i, /transcri(be|ption)/i, /speech[-_]?to[-_]?text/i, /^qwen3.*asr/i, /^fun-asr/i],
  realtime: [/realtime/i, /^qwen-audio-3\.0-realtime/i],
};

/**
 * 判断模型 ID 是否支持指定能力
 */
export function modelSupportsCapability(modelId: string, capability: VoiceCapability): boolean {
  const patterns = VOICE_MODEL_PATTERNS[capability];
  return patterns.some((pattern) => pattern.test(modelId));
}

export interface VoiceCredentialResult {
  credential: CredentialRecord;
  modelName: string;
  capability: VoiceCapability;
}

/**
 * 获取语音凭证
 *
 * 遵循生图模块模式：支持 modelRef 参数（格式: "provider:modelName"）
 *
 * @param userId 用户 ID
 * @param capability 需要的语音能力（tts/stt/realtime）
 * @param modelRef 可选的模型引用（格式: "openai:wan2.7-image"）
 * @returns 凭证结果（包含 credential、modelName、capability）
 */
export async function resolveVoiceCredential(
  userId: string,
  capability: VoiceCapability,
  modelRef?: string
): Promise<VoiceCredentialResult | null> {
  // 如果指定了 modelRef，按生图模式处理
  if (modelRef) {
    const result = await resolveFromModelRef(userId, capability, modelRef);
    if (result) return result;
  }

  // 否则从已配置的模型中自动查找支持该能力的模型
  const result = await resolveFromAvailableModels(userId, capability);
  if (result) return result;

  // 回退到 dashscope provider（传统兼容）
  const dashscopeResult = await resolveDashscopeFallback(userId, capability);
  if (dashscopeResult) return dashscopeResult;

  // 最后检查环境变量
  return resolveEnvFallback(capability);
}

/**
 * 从 modelRef 解析凭证（生图模式）
 */
async function resolveFromModelRef(
  userId: string,
  capability: VoiceCapability,
  modelRef: string
): Promise<VoiceCredentialResult | null> {
  // modelRef 格式: "provider:modelName" 或 "modelName"
  const colonIndex = modelRef.indexOf(":");
  const provider = colonIndex > 0 ? modelRef.substring(0, colonIndex) : null;
  const modelName = colonIndex > 0 ? modelRef.substring(colonIndex + 1) : modelRef;

  // 验证模型是否支持指定能力
  if (!modelSupportsCapability(modelName, capability)) {
    console.warn(`[voice-credential] 模型 ${modelName} 不支持 ${capability} 能力`);
    return null;
  }

  // 查找 provider 的凭证
  const resolvedProvider = provider || guessProviderFromModel(modelName);
  const cred = await resolveProviderCredential(userId, resolvedProvider);
  if (!cred) {
    console.warn(`[voice-credential] 未找到 provider ${resolvedProvider} 的凭证`);
    return null;
  }

  return {
    credential: cred,
    modelName,
    capability,
  };
}

/**
 * 从已配置的模型中查找支持指定能力的模型
 */
async function resolveFromAvailableModels(
  userId: string,
  capability: VoiceCapability
): Promise<VoiceCredentialResult | null> {
  // 收集所有已配置的 provider
  const providers = new Set<string>();

  // SYSTEM providers
  const systemRecords = await prisma.userApiKey.findMany({
    where: { ownerType: "SYSTEM", deletedAt: null },
    select: { provider: true, baseURL: true },
  });
  for (const r of systemRecords) {
    providers.add(r.provider);
  }

  // USER providers
  const userRecords = await prisma.userApiKey.findMany({
    where: { userId, deletedAt: null },
    select: { provider: true, baseURL: true },
  });
  for (const r of userRecords) {
    providers.add(r.provider);
  }

  // 遍历每个 provider，查找支持该能力的模型
  for (const prov of providers) {
    // 跳过非语音相关的 provider
    if (!["openai", "dashscope", "anthropic"].includes(prov)) continue;

    const cred = await resolveProviderCredential(userId, prov);
    if (!cred) continue;

    // Token Plan MaaS：使用已知的模型列表（不依赖动态发现）
    const isMaaS = cred.baseURL.includes("token-plan") && cred.baseURL.includes(".maas.");
    if (isMaaS) {
      const knownModel = getKnownMaaSModel(capability);
      if (knownModel) {
        console.log(`[voice-credential] Token Plan MaaS 使用已知模型: ${knownModel} (${capability})`);
        return {
          credential: cred,
          modelName: knownModel,
          capability,
        };
      }
      // Token Plan MaaS 不支持该能力，跳过此 provider
      console.log(`[voice-credential] Token Plan MaaS 不支持 ${capability}，跳过`);
      continue;
    }

    // 标准 provider：从 API 动态发现
    try {
      const models = await discoverModelsFromAPI({
        provider: prov,
        baseURL: cred.baseURL,
        apiKey: cred.apiKey,
        transport: cred.transport,
      });

      // 查找支持指定能力的模型
      for (const model of models) {
        if (modelSupportsCapability(model.modelName, capability)) {
          console.log(`[voice-credential] 找到支持 ${capability} 的模型: ${model.modelName} (${prov})`);
          return {
            credential: cred,
            modelName: model.modelName,
            capability,
          };
        }
      }
    } catch (err) {
      console.warn(`[voice-credential] 从 ${prov} 获取模型列表失败:`, err instanceof Error ? err.message : String(err));
      // 如果动态发现失败，回退到已知模型
      const fallbackModel = getKnownMaaSModel(capability);
      if (fallbackModel) {
        console.log(`[voice-credential] 回退到已知模型: ${fallbackModel} (${capability})`);
        return {
          credential: cred,
          modelName: fallbackModel,
          capability,
        };
      }
    }
  }

  return null;
}

/**
 * 回退到 dashscope provider（传统兼容）
 */
async function resolveDashscopeFallback(
  userId: string,
  capability: VoiceCapability
): Promise<VoiceCredentialResult | null> {
  const cred = await resolveProviderCredential(userId, "dashscope");
  if (!cred) return null;

  // 默认模型
  const defaultModel = getDefaultModelForCapability(capability);
  return {
    credential: cred,
    modelName: defaultModel,
    capability,
  };
}

/**
 * 从环境变量回退
 */
function resolveEnvFallback(capability: VoiceCapability): VoiceCredentialResult | null {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;

  const baseURL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
  const defaultModel = getDefaultModelForCapability(capability);

  return {
    credential: {
      provider: "env",
      baseURL,
      apiKey,
      transport: "direct",
      apiFormat: "openai-chat",
      ownerType: "SYSTEM",
    },
    modelName: defaultModel,
    capability,
  };
}

/**
 * 解析指定 provider 的凭证
 */
async function resolveProviderCredential(
  userId: string,
  provider: string
): Promise<CredentialRecord | null> {
  // 1. SYSTEM provider
  const systemRecord = await prisma.userApiKey.findFirst({
    where: { ownerType: "SYSTEM", provider, deletedAt: null },
  });
  if (systemRecord) {
    const apiKey = decrypt(systemRecord.encryptedKey, systemRecord.iv, systemRecord.authTag);
    if (apiKey) {
      let baseURL = systemRecord.baseURL
        ? normalizeBaseURL(systemRecord.baseURL)
        : getEffectiveBaseURL(provider, null);
      baseURL = normalizeMaaSBaseURL(baseURL);
      return {
        provider: systemRecord.provider,
        baseURL,
        apiKey,
        transport: (systemRecord.transport as "proxy" | "direct") ?? "proxy",
        apiFormat: (systemRecord.apiFormat as "openai-chat" | "openai-responses" | "anthropic") ?? "openai-chat",
        ownerType: "SYSTEM",
      };
    }
  }

  // 2. USER provider
  const userRecord = await prisma.userApiKey.findFirst({
    where: { userId, provider, deletedAt: null },
  });
  if (userRecord) {
    const apiKey = decrypt(userRecord.encryptedKey, userRecord.iv, userRecord.authTag);
    if (apiKey) {
      let baseURL = userRecord.baseURL
        ? normalizeBaseURL(userRecord.baseURL)
        : getEffectiveBaseURL(provider, null);
      baseURL = normalizeMaaSBaseURL(baseURL);
      return {
        provider: userRecord.provider,
        baseURL,
        apiKey,
        transport: (userRecord.transport as "proxy" | "direct") ?? "direct",
        apiFormat: (userRecord.apiFormat as "openai-chat" | "openai-responses" | "anthropic") ?? "openai-chat",
        ownerType: "USER",
      };
    }
  }

  return null;
}

/**
 * 规范化 Token Plan MaaS Base URL
 */
function normalizeMaaSBaseURL(baseURL: string): string {
  if (baseURL.includes("token-plan") && baseURL.includes("compatible-mode")) {
    return baseURL.replace("/compatible-mode/v1", "/api/v1");
  }
  return baseURL;
}

/**
 * 根据模型名猜测 provider
 */
function guessProviderFromModel(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (lower.includes("dashscope") || lower.includes("qwen") || lower.includes("tts") || lower.includes("asr")) {
    return "dashscope";
  }
  if (lower.includes("openai") || lower.includes("whisper")) {
    return "openai";
  }
  return "dashscope"; // 默认
}

/**
 * 获取各能力的默认模型
 */
function getDefaultModelForCapability(capability: VoiceCapability): string {
  switch (capability) {
    case "tts":
      return "qwen-audio-3.0-tts-plus";
    case "stt":
      return "qwen-audio-3.0-asr-flash-filetrans";
    case "realtime":
      return "qwen-audio-3.0-realtime-plus";
  }
}

/**
 * 获取 Token Plan MaaS 的已知模型（基于终端显示的模型列表）
 */
function getKnownMaaSModel(capability: VoiceCapability): string | null {
  switch (capability) {
    case "tts":
      return "qwen-audio-3.0-tts-plus";
    case "stt":
      // Token Plan MaaS 不提供独立的 STT 模型
      // 回退到标准 DashScope API
      return null;
    case "realtime":
      return "qwen-audio-3.0-realtime-plus";
    default:
      return null;
  }
}
