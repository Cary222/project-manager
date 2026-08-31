/**
 * 语音凭证解析器
 *
 * 设计原则：基于模型能力选择凭证，遵循生图模块的模式。
 *
 * Credential 链路：
 * - resolveCredentialWithFallback() 提供统一的三级降级（SYSTEM → USER → ENV）
 * - 本模块负责 Voice 特有的 capability matching 和 provider selection
 *
 * 职责边界：
 * - CredentialService (api-key-store.ts): 凭证 CRUD / Resolution / Decryption
 * - 本模块: Voice Credential Resolver + Capability Matching + Provider Selection
 *
 * NOT: 不负责 Model Discovery（由 registry.ts 的 discoverModelsFromAPI 提供）
 */

import { discoverModelsFromAPI } from "../registry";
import {
  resolveCredentialWithFallback,
  getSystemCredentials,
  getUserProviderRecords,
  type CredentialRecord,
} from "../../credentials/api-key-store";

export type VoiceCapability = "tts" | "stt" | "realtime";

// 模型 ID 关键词匹配（用于判断模型是否支持某种能力）
const VOICE_MODEL_PATTERNS: Record<VoiceCapability, RegExp[]> = {
  tts: [
    /\btts\b/i,
    /speech[-_]?synthesis/i,
    /audio[-_]?3[._-]?0[-_]?tts/i,
    /^qwen-audio-3\.0-tts/i,
    /cosyvoice/i,
  ],
  stt: [
    /\basr\b/i,
    /transcri(be|ption)/i,
    /speech[-_]?to[-_]?text/i,
    /^qwen3.*asr/i,
    /^fun-asr/i,
    /^paraformer/i,
    /^sensevoice/i,
    /whisper/i,
    /audio/i,
  ],
  realtime: [/realtime/i, /^qwen-audio-3\.0-realtime/i],
};

/**
 * 判断模型 ID 是否支持指定能力
 */
export function modelSupportsCapability(
  modelId: string,
  capability: VoiceCapability,
): boolean {
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
  modelRef?: string,
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
  modelRef: string,
): Promise<VoiceCredentialResult | null> {
  // modelRef 格式: "provider:modelName" 或 "modelName"
  const colonIndex = modelRef.indexOf(":");
  const provider = colonIndex > 0 ? modelRef.substring(0, colonIndex) : null;
  const modelName =
    colonIndex > 0 ? modelRef.substring(colonIndex + 1) : modelRef;

  // 验证模型是否支持指定能力
  if (!modelSupportsCapability(modelName, capability)) {
    console.warn(
      `[voice-credential] 模型 ${modelName} 不支持 ${capability} 能力`,
    );
    return null;
  }

  // 查找 provider 的凭证：使用统一的三级降级链路
  const resolvedProvider = provider || guessProviderFromModel(modelName);
  const cred = await resolveCredentialWithFallback(userId, resolvedProvider, {
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    baseURL: process.env.DASHSCOPE_BASE_URL ?? "",
  });
  if (!cred) {
    console.warn(
      `[voice-credential] 未找到 provider ${resolvedProvider} 的凭证`,
    );
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
  capability: VoiceCapability,
): Promise<VoiceCredentialResult | null> {
  // 收集所有已配置的 provider：使用统一的 CredentialService
  const providers = new Set<string>();

  // SYSTEM providers
  const systemCreds = await getSystemCredentials();
  for (const cred of systemCreds) {
    providers.add(cred.provider);
  }

  // USER providers
  const userRecords = await getUserProviderRecords(userId);
  for (const record of userRecords) {
    providers.add(record.provider);
  }

  let dashscopeLikeCred: CredentialRecord | null = null;

  // 遍历每个 provider，查找支持该能力的模型
  for (const prov of providers) {
    const cred = await resolveCredentialWithFallback(userId, prov, {
      apiKey: process.env.DASHSCOPE_API_KEY ?? "",
      baseURL: process.env.DASHSCOPE_BASE_URL ?? "",
    });
    if (!cred || !cred.apiKey) continue;

    const lowerProv = prov.toLowerCase();
    const lowerBase = (cred.baseURL || "").toLowerCase();

    // 检查是否可能为语音候选 provider (DashScope/Token Plan/OpenAI/Qwen/Aliyun 等)
    const isDashscopeLike =
      lowerProv.includes("dashscope") ||
      lowerProv.includes("token") ||
      lowerProv.includes("qwen") ||
      lowerProv.includes("aliyun") ||
      lowerBase.includes("dashscope") ||
      lowerBase.includes("token-plan") ||
      lowerBase.includes("aliyuncs.com");

    const isVoiceCandidate =
      isDashscopeLike ||
      lowerProv.includes("openai") ||
      lowerBase.includes("openai.com");

    if (!isVoiceCandidate) continue;

    if (isDashscopeLike && !dashscopeLikeCred) {
      dashscopeLikeCred = cred;
    }

    // Token Plan MaaS：使用已知的模型列表
    const isMaaS =
      lowerBase.includes("token-plan") && lowerBase.includes(".maas.");
    if (isMaaS) {
      const knownModel = getKnownMaaSModel(capability);
      if (knownModel) {
        console.log(
          `[voice-credential] Token Plan MaaS 使用已知模型: ${knownModel} (${capability})`,
        );
        return {
          credential: cred,
          modelName: knownModel,
          capability,
        };
      }
    }

    // 标准 provider：尝试从 API 动态发现
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
          console.log(
            `[voice-credential] 找到支持 ${capability} 的模型: ${model.modelName} (${prov})`,
          );
          return {
            credential: cred,
            modelName: model.modelName,
            capability,
          };
        }
      }
    } catch (err) {
      console.warn(
        `[voice-credential] 从 ${prov} 获取模型列表失败:`,
        err instanceof Error ? err.message : String(err),
      );
      const fallbackModel = getKnownMaaSModel(capability);
      if (fallbackModel && isDashscopeLike) {
        console.log(
          `[voice-credential] 回退到已知模型: ${fallbackModel} (${capability})`,
        );
        return {
          credential: cred,
          modelName: fallbackModel,
          capability,
        };
      }
    }
  }

  // 若动态发现未返回，但存在配置好的 DashScope/Token Plan 凭证，使用默认模型
  if (dashscopeLikeCred) {
    const defaultModel =
      getKnownMaaSModel(capability) || getDefaultModelForCapability(capability);
    console.log(
      `[voice-credential] 使用已配置的 DashScope/Token Plan 凭证默认模型: ${defaultModel}`,
    );
    return {
      credential: dashscopeLikeCred,
      modelName: defaultModel,
      capability,
    };
  }

  return null;
}

/**
 * 回退到 dashscope provider（传统兼容）
 */
async function resolveDashscopeFallback(
  userId: string,
  capability: VoiceCapability,
): Promise<VoiceCredentialResult | null> {
  // 使用统一的三级降级链路获取 dashscope 凭证
  const cred = await resolveCredentialWithFallback(userId, "dashscope", {
    apiKey: process.env.DASHSCOPE_API_KEY ?? "",
    baseURL: process.env.DASHSCOPE_BASE_URL ?? "",
  });
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
function resolveEnvFallback(
  capability: VoiceCapability,
): VoiceCredentialResult | null {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;

  const baseURL =
    process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1";
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
 * 根据模型名猜测 provider
 */
function guessProviderFromModel(modelName: string): string {
  const lower = modelName.toLowerCase();
  if (
    lower.includes("dashscope") ||
    lower.includes("qwen") ||
    lower.includes("tts") ||
    lower.includes("asr")
  ) {
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
      return "qwen3-asr-flash-filetrans";
    case "realtime":
      return "qwen-audio-3.0-realtime-plus";
  }
}

/**
 * 获取 Token Plan MaaS 的已知模型
 */
function getKnownMaaSModel(capability: VoiceCapability): string | null {
  switch (capability) {
    case "tts":
      return "qwen-audio-3.0-tts-plus";
    case "stt":
      return "qwen3-asr-flash-filetrans";
    case "realtime":
      return "qwen-audio-3.0-realtime-plus";
    default:
      return null;
  }
}
