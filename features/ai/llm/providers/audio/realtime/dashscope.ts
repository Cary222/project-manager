/**
 * dashscope.ts — DashScope Realtime API 配置获取
 *
 * 文档：https://help.aliyun.com/zh/dashscope/api/speech-generation/realtime
 *
 * 模型：qwen-audio-3.0-realtime-plus
 *
 * 流程：
 *   - 标准 DashScope：POST /v1/realtime/oauth2/token 获取 ephemeral token
 *   - Token Plan MaaS：使用 MaaS 专用 WebSocket 端点（wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference）
 *
 * Base URL：
 *   - 标准：https://dashscope.aliyuncs.com/api/v1
 *   - MaaS：https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1
 *   - MaaS WebSocket：wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
 */

import { resolveVoiceCredential } from "@/features/ai/llm/providers/audio/credentials";
import type { RealtimeConfig } from "./types";

interface DashScopeTokenResponse {
  token: string;
  expires_at: number;
}

interface DashScopeError {
  code: string;
  message: string;
}

/**
 * 获取 DashScope Realtime 配置
 *
 * @param userId 用户 ID，用于凭证解析
 * @returns RealtimeConfig 包含 WebSocket 连接 URL 和 token
 */
export async function getRealtimeConfig(userId: string): Promise<RealtimeConfig> {
  const voiceResult = await resolveVoiceCredential(userId, "realtime");
  if (!voiceResult) {
    throw new Error(
      "实时语音服务未配置。请在「设置 > AI Providers」中添加支持 Realtime 的 provider（如 dashscope 或 openai）。"
    );
  }

  const { credential, modelName } = voiceResult;

  // Token Plan MaaS 检测：同时检查 baseURL 和 apiKey
  const isMaaS =
    (credential.baseURL.includes("token-plan") && credential.baseURL.includes(".maas.")) ||
    credential.apiKey.startsWith("sk-sp-");

  if (isMaaS) {
    // Token Plan MaaS 使用专用 WebSocket 端点，无需获取 ephemeral token
    // 参考文档：https://platform.qianwenai.com/docs/token-plan/best-practices/vision
    const maasWsUrl = `wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;

    console.log(`[dashscope-realtime] MaaS 模式: ${maasWsUrl}, model=${modelName}`);

    return {
      mode: "direct",
      url: maasWsUrl,
      token: credential.apiKey, // MaaS 直接使用 API Key 作为 token
      expiresAt: Date.now() + 3600000, // 设置 1 小时过期时间（MaaS Key 无实际过期）
    };
  }

  // 标准 DashScope Realtime 流程：先获取 ephemeral token
  const url = `${credential.baseURL}/realtime/oauth2/token`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
      }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as DashScopeError;
      throw new Error(
        `Realtime token 请求失败: ${errorData.code ?? response.status} - ${errorData.message ?? response.statusText}`
      );
    }

    const data = (await response.json()) as DashScopeTokenResponse;

    // 标准 DashScope：使用统一的 WebSocket URL 格式（带区域）
    // ephemeral token 有效期短（约 5 分钟），在 URL 中传递是可接受的安全权衡
    const wsUrl = `wss://dashscope.${credential.baseURL.includes("cn-beijing") ? "cn-beijing" : "cn-shanghai"}.aliyuncs.com/api-ws/v1/realtime?model=${modelName}&token=${data.token}`;

    return {
      mode: "direct",
      url: wsUrl,
      token: data.token,
      expiresAt: data.expires_at,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Realtime 配置获取失败: ${String(error)}`);
  }
}
