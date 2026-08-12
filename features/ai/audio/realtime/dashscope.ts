/**
 * dashscope.ts — DashScope Realtime API 配置获取
 *
 * 文档：https://help.aliyun.com/zh/dashscope/api/speech-generation/realtime
 *
 * 模型：qwen-audio-3.0-realtime-plus
 *
 * 流程：
 *   - 标准 DashScope：POST /v1/realtime/oauth2/token 获取 ephemeral token
 *   - Token Plan MaaS：直接使用 WebSocket 端点
 *
 * Base URL：
 *   - 标准：https://dashscope.aliyuncs.com/api/v1
 *   - Token Plan MaaS：https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1
 */

import { resolveVoiceCredential } from "@/features/ai/audio/credentials";
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

  // Token Plan MaaS 检测
  const isMaaS = credential.baseURL.includes("token-plan") && credential.baseURL.includes(".maas.");

  if (isMaaS) {
    // Token Plan MaaS：Realtime WebSocket 端点
    // 格式：wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime
    const wsUrl = `wss://dashscope.cn-beijing.aliyuncs.com/api-ws/v1/services/audio/realtime?model=${modelName}&api_key=${credential.apiKey}`;

    console.log(`[realtime] Token Plan MaaS 模式: model=${modelName}, url=${wsUrl.substring(0, 80)}...`);

    return {
      mode: "direct",
      url: wsUrl,
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

    // WebSocket URL 构造
    const wsUrl = `wss://dashscope.cn/audio/realtime?model=${modelName}&token=${data.token}`;

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
