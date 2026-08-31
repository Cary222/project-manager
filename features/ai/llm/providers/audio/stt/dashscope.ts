/**
 * dashscope.ts — STT (Speech-to-Text) 语音识别
 *
 * 支持两种模式：
 * 1. 标准 DashScope：同步 API（/audio/transcriptions）
 * 2. Token Plan MaaS：异步 API（/services/audio/asr/transcription → 轮询 /tasks/{id}）
 *
 * 模型：
 * - qwen3-asr-flash-filetrans（推荐，异步，长音频）
 * - qwen-audio-3.0-asr-flash-filetrans
 * - fun-asr-recorded-speech-recognition-http-api
 *
 * Base URL：
 * - 标准：https://dashscope.aliyuncs.com/api/v1
 * - Token Plan MaaS：https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1
 */

import { resolveVoiceCredential } from "@/features/ai/llm/providers/audio/credentials";

const DASHSCOPE_TIMEOUT_MS = 60_000;

export type SupportedAudioFormat = "webm" | "mp4" | "wav" | "mp3" | "m4a";

export interface TranscribeResult {
  text: string;
  duration?: number;
}

export interface TranscribeOptions {
  userId: string;
  model?: string;
}

interface TranscribeResponse {
  output?: {
    text?: string;
    transcription_url?: string;
    sentence_count?: number;
  };
  usage?: {
    audio_seconds?: number;
  };
  request_id: string;
}

interface TaskStatusResponse {
  output?: {
    task_id: string;
    task_status: "PENDING" | "RUNNING" | "SUCCESS" | "FAIL";
    transcription_url?: string;
  };
  request_id: string;
}

interface DashScopeError {
  code: string;
  message: string;
}

/**
 * 调用 ASR API 进行语音识别
 *
 * @param audioBuffer 音频数据（mp3/wav/m4a/webm/mp4 格式）
 * @param format      音频格式（mp3 | wav | m4a | webm | mp4）
 * @param options     选项（userId 用于凭证解析）
 * @returns 识别结果 { text, duration? }
 */
export async function transcribeWithDashScope(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  options: TranscribeOptions
): Promise<TranscribeResult> {
  const { userId, model } = options;

  // 使用新的凭证解析器
  const voiceResult = await resolveVoiceCredential(userId, "stt", model);
  if (!voiceResult) {
    throw new Error(
      "语音识别服务未配置。请在「设置 > AI Providers」中添加支持 ASR 的 provider（如 dashscope 或 openai）。"
    );
  }

  const { credential, modelName } = voiceResult;
  const isMaaS = credential.baseURL.includes("token-plan") && credential.baseURL.includes(".maas.");

  // Token Plan MaaS 使用异步 API
  if (isMaaS) {
    return transcribeAsyncMaaS(audioBuffer, format, modelName, credential.apiKey, credential.baseURL);
  }

  // 标准 DashScope 使用同步 API
  return transcribeSync(audioBuffer, format, modelName, credential.apiKey, credential.baseURL);
}

/**
 * 标准 DashScope 同步 ASR（已弃用，Token Plan 不支持）
 */
async function transcribeSync(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  modelName: string,
  apiKey: string,
  baseURL: string
): Promise<TranscribeResult> {
  const mimeType = formatToMimeType(format);

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
    `audio.${format}`
  );
  formData.append("model", modelName);

  const url = `${baseURL}/audio/transcriptions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: AbortSignal.timeout(DASHSCOPE_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as DashScopeError;
      throw new Error(
        `ASR 请求失败: ${errorData.code ?? response.status} - ${errorData.message ?? response.statusText}`
      );
    }

    const data = (await response.json()) as TranscribeResponse;

    const text = data.output?.text?.trim() ?? "";
    const duration = data.usage?.audio_seconds;

    return { text, duration };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        throw new Error("语音识别超时，请稍后重试");
      }
      throw error;
    }
    throw new Error(`语音识别失败: ${String(error)}`);
  }
}

/**
 * Token Plan MaaS 异步 ASR
 *
 * 流程：
 * 1. 提交任务（multipart/form-data 上传文件）→ 返回 task_id
 * 2. 轮询 GET /tasks/{task_id} 直到完成
 * 3. 解析返回结果
 */
async function transcribeAsyncMaaS(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  modelName: string,
  apiKey: string,
  baseURL: string
): Promise<TranscribeResult> {
  // Step 1: 提交转写任务（使用 multipart/form-data）
  const submitUrl = `${baseURL}/services/audio/asr/transcription`;
  console.log(`[stt] 提交异步转写任务: model=${modelName}`);

  const mimeType = formatToMimeType(format);
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
    `audio.${format}`
  );
  formData.append("model", modelName);
  formData.append("parameters", JSON.stringify({
    language_hints: ["zh", "en"],
  }));

  const submitResponse = await fetch(submitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text().catch(() => "");
    console.error(`[stt] 提交任务失败: ${submitResponse.status}`, errorText);
    throw new Error(`ASR 提交任务失败: ${submitResponse.status} - ${errorText}`);
  }

  const submitData = (await submitResponse.json()) as { output?: { task_id: string }; request_id: string };
  const taskId = submitData.output?.task_id;
  if (!taskId) {
    throw new Error(`ASR 返回无 task_id: ${JSON.stringify(submitData)}`);
  }
  console.log(`[stt] 任务已提交: task_id=${taskId}`);

  // Step 3: 轮询任务状态
  const taskUrl = `${baseURL}/tasks/${taskId}`;
  const maxAttempts = 60; // 最多 60 次 × 2s = 2 分钟
  let transcriptionUrl: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));

    const statusResponse = await fetch(taskUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!statusResponse.ok) {
      const err = await statusResponse.text().catch(() => "");
      console.warn(`[stt] 查询状态失败: ${statusResponse.status}`, err);
      continue;
    }

    const statusData = (await statusResponse.json()) as TaskStatusResponse;
    const status = statusData.output?.task_status;

    console.log(`[stt] 任务状态: ${status} (attempt ${attempt + 1}/${maxAttempts})`);

    if (status === "SUCCESS") {
      transcriptionUrl = statusData.output?.transcription_url ?? null;
      break;
    }

    if (status === "FAIL") {
      throw new Error(`ASR 转写失败: ${JSON.stringify(statusData)}`);
    }
  }

  if (!transcriptionUrl) {
    throw new Error("ASR 转写超时（超过 2 分钟）");
  }

  // Step 4: 下载结果 JSON
  const resultResponse = await fetch(transcriptionUrl, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!resultResponse.ok) {
    throw new Error(`下载转写结果失败: ${resultResponse.status}`);
  }

  const resultData = await resultResponse.json() as {
    transcripts?: Array<{ text: string }>;
    text?: string;
  };

  // 解析结果
  let text = "";
  if (resultData.transcripts?.length) {
    text = resultData.transcripts.map((t) => t.text).join(" ");
  } else if (resultData.text) {
    text = resultData.text;
  }

  return { text: text.trim() };
}

/**
 * 格式转 MIME 类型
 */
function formatToMimeType(format: SupportedAudioFormat): string {
  const mimeMap: Record<SupportedAudioFormat, string> = {
    webm: "audio/webm",
    mp4: "audio/mp4",
    wav: "audio/wav",
    mp3: "audio/mpeg",
    m4a: "audio/x-m4a",
  };
  return mimeMap[format] ?? "audio/webm";
}

/**
 * 根据 MIME 类型或文件名推断音频格式
 */
export function inferFormatFromMimeType(mimeType: string, filename?: string): SupportedAudioFormat {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = (filename ?? "").toLowerCase();

  if (lowerMime.includes("mpeg") || lowerMime.includes("mp3") || lowerName.endsWith(".mp3")) return "mp3";
  if (lowerMime.includes("m4a") || lowerMime.includes("x-m4a") || lowerName.endsWith(".m4a")) return "m4a";
  if (lowerMime.includes("wav") || lowerName.endsWith(".wav")) return "wav";
  if (lowerMime.includes("webm") || lowerName.endsWith(".webm")) return "webm";
  if (lowerMime.includes("mp4") || lowerName.endsWith(".mp4")) return "mp4";
  return "mp3";
}
