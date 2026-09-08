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
import { resolveVoiceCredential } from "@/features/ai/llm/providers/audio/credentials";

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
  longanqian: "知性女声（默认推荐）",
  af_xianger: "甜萌童声（女）",
  af_baitiang: "百灵鸟（女）",
  af_cibei: "慈祥温和（女）",
  af_dingdang: "活泼开朗（女）",
  af_jingjing: "知性沉稳（女）",
  af_luona: "知性温柔（女）",
  af_sichuan: "四川方言（女）",
  af_xiaowei: "甜美可爱（女）",
  af_youling: "清冷空灵（女）",
  af_zhizhong: "稚嫩萌音（女）",
  am_fei: "飞飞哥（男）",
  am_yunyan: "云Yan（男）",
  am_xiaogang: "小刚（男）",
  am_xiaohe: "小合（男）",
  am_adam: "Adam（男）",
  am_ailun: "艾伦（男）",
  am_xiaobai: "小白（男）",
  am_xiaoming: "小明（男）",
  am_yeye: "和蔼老年（男）",
  ar_tianxiang: "天翔（男）",
  ar_kangning: "康宁（男）",
  ar_taibai: "太白金星（男）",
  ar_liubei: "刘备（男）",
  ar_zhangfei: "张飞（男）",
  ar_guanyu: "关羽（男）",
  ar_zhaoyun: "赵云（男）",
  ar_pangde: "庞德（男）",
} as const;

export type TtsVoice = keyof typeof TTS_VOICE_OPTIONS;

/**
 * 非流式语音合成
 *
 * @param userId - 用户 ID（用于查找 DashScope 凭证）
 * @param text - 待合成文本（建议 400 字以内）
 * @param options - 可选参数
 * @returns 包含音频 Buffer 的 TtsResult
 */
export async function synthesizeWithDashScope(
  userId: string,
  text: string,
  options: TtsOptions = {},
): Promise<TtsResult> {
  const voiceResult = await resolveVoiceCredential(userId, "tts");
  if (!voiceResult) {
    throw new Error(
      "语音合成服务未配置。请在「设置 > AI Providers」中添加支持 TTS 的 provider（如 dashscope 或 openai）。",
    );
  }

  const { credential, modelName } = voiceResult;

  const {
    voice = "longanqian",
    format = "mp3",
    speed = 1.0,
    sampleRate = 16000,
  } = options;

  // 端点解析：兼容 compatible-mode base URL 与标准 DashScope 端点
  let ttsApiUrl =
    "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
  if (credential.baseURL && !credential.baseURL.includes("compatible-mode")) {
    ttsApiUrl = `${credential.baseURL.replace(/\/+$/, "")}/services/audio/tts/SpeechSynthesizer`;
  }

  // 优先选用正式 DashScope 语音合成模型
  const targetModel =
    modelName &&
    !modelName.includes("realtime") &&
    !modelName.includes("vd") &&
    !modelName.includes("vc")
      ? modelName
      : "qwen-audio-3.0-tts-plus";

  const requestBody = {
    model: targetModel,
    input: {
      text,
      voice,
    },
    parameters: {
      voice,
      format,
      speed,
      sample_rate: sampleRate,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

  try {
    const response = await fetch(ttsApiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        "Content-Type": "application/json",
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

    const contentType = response.headers.get("content-type") || "";
    let audio: Uint8Array;

    if (contentType.includes("application/json")) {
      const data = await response.json();
      const audioUrl = data.output?.audio?.url;
      if (audioUrl) {
        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok) throw new Error("下载合成音频失败");
        audio = new Uint8Array(await audioRes.arrayBuffer());
      } else if (data.output?.audio?.data) {
        audio = new Uint8Array(Buffer.from(data.output.audio.data, "base64"));
      } else {
        throw new Error(data.message || "未能获取合成音频数据");
      }
    } else {
      audio = new Uint8Array(await response.arrayBuffer());
    }

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
  voice?: TtsVoice,
): Promise<TtsResult> {
  return synthesizeWithDashScope(userId, text, {
    voice: voice ?? "longanqian",
  });
}
