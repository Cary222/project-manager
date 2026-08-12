/**
 * dashscope.ts — TTS 语音合成（通义语音）
 *
 * 文档：https://help.aliyun.com/zh/dashscope/api/speech-synthesis/tongyi-bailian-speech-synthesis
 *
 * 模型：qwen-audio-3.0-tts-plus
 *
 * 调用方式（非流式）：
 *   const result = await synthesizeWithDashScope(userId, text, options);
 *
 * Base URL：
 * - 标准：https://dashscope.aliyuncs.com/api/v1
 * - Token Plan MaaS：https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1
 */
import { resolveVoiceCredential } from "@/features/ai/audio/credentials";

const TTS_TIMEOUT_MS = 30_000;

export interface TtsResult {
  audio: Uint8Array;
  duration?: number;
}

/**
 * TTS 结果转 Prisma Bytes（用于存储）
 */
export function ttsResultToBytes(result: TtsResult): Uint8Array {
  return result.audio;
}

export interface TtsOptions {
  voice?: string;
  format?: string;
  speed?: number;
  sampleRate?: number;
}

// DashScope 支持的音色选项
export const TTS_VOICE_OPTIONS = {
  "af_xianger": "甜萌童声（女）",
  "af_baitiang": "百灵鸟（女）",
  "af_cibei": "慈祥温和（女）",
  "af_dingdang": "活泼开朗（女）",
  "af_jingjing": "知性沉稳（女）",
  "af_luona": "知性温柔（女）",
  "af_sichuan": "四川方言（女）",
  "af_xiaowei": "甜美可爱（女）",
  "af_youling": "清冷空灵（女）",
  "af_zhizhong": "稚嫩萌音（女）",
  "am_fei": "飞飞哥（男）",
  "am_yunyan": "云Yan（男）",
  "am_xiaogang": "小刚（男）",
  "am_xiaohe": "小合（男）",
  "am_adam": "Adam（男）",
  "am_ailun": "艾伦（男）",
  "am_xiaobai": "小白（男）",
  "am_xiaoming": "小明（男）",
  "am_yeye": "和蔼老年（男）",
  "ar_tianxiang": "天翔（男）",
  "ar_kangning": "康宁（男）",
  "ar_taibai": "太白金星（男）",
  "ar_liubei": "刘备（男）",
  "ar_zhangfei": "张飞（男）",
  "ar_guanyu": "关羽（男）",
  "ar_zhaoyun": "赵云（男）",
  "ar_pangde": "庞德（男）",
} as const;

export type TtsVoice = keyof typeof TTS_VOICE_OPTIONS;

/**
 * 非流式语音合成
 *
 * @param userId - 用户 ID（用于查找 DashScope 凭证）
 * @param text - 待合成文本（建议 200 字以内，过长文本建议分段调用）
 * @param options - 可选参数
 * @returns 包含音频 Buffer 的 TtsResult
 */
export async function synthesizeWithDashScope(
  userId: string,
  text: string,
  options: TtsOptions = {}
): Promise<TtsResult> {
  // 1. 使用新的凭证解析器
  const voiceResult = await resolveVoiceCredential(userId, "tts");
  if (!voiceResult) {
    throw new Error(
      "语音合成服务未配置。请在「设置 > AI Providers」中添加支持 TTS 的 provider（如 dashscope 或 openai）。"
    );
  }

  const { credential, modelName } = voiceResult;

  // Token Plan MaaS 检测
  const isMaaS = credential.baseURL.includes("token-plan") && credential.baseURL.includes(".maas.");

  // 2. 构建请求参数
  const {
    voice = isMaaS ? "longanhuan_v3.6" : "af_luona", // Token Plan 默认长安唤声
    format = isMaaS ? "mp3" : "mp3",
    speed = isMaaS ? 1.0 : 1.0,
    sampleRate = isMaaS ? 24000 : 16000,
  } = options;

  // TTS API 端点（Token Plan 使用不同的路径）
  const ttsApiUrl = isMaaS
    ? `${credential.baseURL}/services/audio/tts/SpeechSynthesizer`
    : `${credential.baseURL}/services/audio/tts/synthesis`;

  console.log(`[tts] 使用 API: ${ttsApiUrl}, model: ${modelName}, isMaaS: ${isMaaS}`);

  // 3. 构建请求体（Token Plan 格式不同于标准 DashScope）
  const requestBody = isMaaS
    ? {
        model: modelName,
        input: {
          text,
          voice,
          format,
          sample_rate: sampleRate,
        },
      }
    : {
        model: modelName,
        input: { text },
        parameters: {
          voice,
          format,
          speed,
          sample_rate: sampleRate,
        },
      };

  // 4. 发起 TTS 请求
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  try {
    const response = await fetch(ttsApiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${credential.apiKey}`,
        "Content-Type": "application/json",
        ...(isMaaS ? {} : { "X-App-Id": "pangu" }),
      },
      body: JSON.stringify(requestBody),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorMsg = errorData?.error?.message || errorData?.message || errorMsg;
      } catch {
        // ignore parse error
      }
      throw new Error(`TTS 合成失败: ${errorMsg}`);
    }

    // 4. 获取音频数据
    const arrayBuffer = await response.arrayBuffer();
    const audio = new Uint8Array(arrayBuffer);

    // 5. 估算时长（mp3 约 16kbps，平均每 MB 约 8 分钟）
    // 这是一个粗略估算，实际时长由 API 返回
    const estimatedDuration = Math.round((audio.length / 1024 / 1024) * 8 * 60);

    return {
      audio,
      duration: estimatedDuration,
    };
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("TTS 合成超时，请稍后重试");
    }

    throw error;
  }
}

/**
 * 便捷函数：使用默认音色合成
 */
export async function synthesizeText(
  userId: string,
  text: string,
  voice?: TtsVoice
): Promise<TtsResult> {
  return synthesizeWithDashScope(userId, text, {
    voice: voice ?? "af_luona",
  });
}
