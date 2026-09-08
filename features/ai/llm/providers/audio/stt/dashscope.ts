/**
 * dashscope.ts — STT (Speech-to-Text) 语音识别
 *
 * 支持三种模式：
 * 1. 百炼专属空间 / DashScope WebSocket 流式实时识别（优先，支持 qwen-audio-3.0-asr-flash-streaming、fun-asr-realtime、paraformer 等）
 * 2. Token Plan MaaS 异步 API（/services/audio/asr/transcription → 轮询 /tasks/{id}）
 * 3. 标准 DashScope 同步 API（/audio/transcriptions）
 *
 * 支持格式：mp3, wav, m4a, webm, mp4, pcm, opus, aac
 */

import WebSocket from "ws";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { resolveVoiceCredential } from "@/features/ai/llm/providers/audio/credentials";

const DASHSCOPE_TIMEOUT_MS = 60_000;

/**
 * 直传阈值（5MB）：上游网关对 multipart/form-data request body 有 6MB / 10MB 硬限制。
 * 超过 5MB 的音频自动路由至对象存储/临时 OSS 异步转写链路，杜绝 BadRequest.TooLarge。
 */
export const DIRECT_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;

export type SupportedAudioFormat = "webm" | "mp4" | "wav" | "mp3" | "m4a";

export interface TranscribeResult {
  text: string;
  duration?: number;
}

export interface TranscribeOptions {
  userId: string;
  model?: string;
  originalName?: string;
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
    task_status: "PENDING" | "RUNNING" | "SUCCESS" | "SUCCEEDED" | "FAIL" | "FAILED";
    transcription_url?: string;
    result?: { transcription_url?: string };
    results?: Array<{ transcription_url?: string; subtask_status?: string }>;
    code?: string;
    message?: string;
  };
  request_id: string;
}
interface DashScopeError {
  code: string;
  message: string;
}

/**
 * 纯 JS 解析音频真实采样率（无需 ffmpeg，毫秒级读取 WAV/MP3 帧头）
 */
export function detectAudioSampleRate(
  buffer: Buffer,
  format: SupportedAudioFormat,
): number {
  if (
    format === "wav" ||
    (buffer.length >= 28 && buffer.slice(0, 4).toString() === "RIFF")
  ) {
    const sampleRate = buffer.readUInt32LE(24);
    if (sampleRate >= 8000 && sampleRate <= 96000) {
      return sampleRate;
    }
  }

  if (
    format === "mp3" ||
    (buffer.length >= 10 && buffer.slice(0, 3).toString() === "ID3")
  ) {
    let offset = 0;
    if (buffer.slice(0, 3).toString() === "ID3" && buffer.length > 10) {
      const id3Size =
        ((buffer[6] & 0x7f) << 21) |
        ((buffer[7] & 0x7f) << 14) |
        ((buffer[8] & 0x7f) << 7) |
        (buffer[9] & 0x7f);
      offset = 10 + id3Size;
    }

    for (let i = offset; i < Math.min(buffer.length - 4, offset + 8192); i++) {
      if (buffer[i] === 0xff && (buffer[i + 1] & 0xe0) === 0xe0) {
        const versionBits = (buffer[i + 1] >> 3) & 0x03;
        const sampleRateIdx = (buffer[i + 2] >> 2) & 0x03;

        if (sampleRateIdx === 3) continue;

        if (versionBits === 3) {
          const rates = [44100, 48000, 32000];
          return rates[sampleRateIdx] ?? 48000;
        } else if (versionBits === 2) {
          const rates = [22050, 24000, 16000];
          return rates[sampleRateIdx] ?? 16000;
        } else if (versionBits === 0) {
          const rates = [11025, 12000, 8000];
          return rates[sampleRateIdx] ?? 16000;
        }
      }
    }
  }

  return format === "mp3" ? 48000 : 16000;
}

/**
 * 尝试通过 ffmpeg 重采样为 16000Hz 单声道 WAV；若未安装 ffmpeg 则自适应检测真实采样率
 */
async function normalizeAudioToWav(
  inputBuffer: Buffer,
  originalFormat: SupportedAudioFormat,
): Promise<{ buffer: Buffer; format: string; sampleRate: number }> {
  const binary = process.env.FFMPEG_PATH || "ffmpeg";
  try {
    const wavBuffer = await new Promise<Buffer>((resolve, reject) => {
      const ff = spawn(
        binary,
        ["-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      const chunks: Buffer[] = [];
      let errOutput = "";
      ff.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      ff.stderr.on("data", (chunk: Buffer) => {
        errOutput += chunk.toString();
      });
      ff.on("close", (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(
            new Error(
              `ffmpeg exited with code ${code}: ${errOutput.slice(-200)}`,
            ),
          );
        }
      });
      ff.on("error", (err) => reject(err));
      ff.stdin.write(inputBuffer);
      ff.stdin.end();
    });

    return { buffer: wavBuffer, format: "wav", sampleRate: 16000 };
  } catch {
    const detectedRate = detectAudioSampleRate(inputBuffer, originalFormat);
    const validFormat = ["mp3", "wav", "opus", "aac", "pcm"].includes(
      originalFormat,
    )
      ? originalFormat
      : "mp3";
    console.log(
      `[stt] 未使用 ffmpeg，自动检测音频参数: format=${validFormat}, sampleRate=${detectedRate}`,
    );
    return {
      buffer: inputBuffer,
      format: validFormat,
      sampleRate: detectedRate,
    };
  }
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
  audioInput: Buffer | string,
  format: SupportedAudioFormat,
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const { userId, model, originalName } = options;

  // 使用语音凭证解析器
  const voiceResult = await resolveVoiceCredential(userId, "stt", model);
  if (!voiceResult) {
    throw new Error(
      "语音识别服务未配置。请在「设置 > AI Providers」中添加支持 ASR 的 provider（如 dashscope、token plan 或 openai）。",
    );
  }

  const { credential } = voiceResult;

  // 1. 如果传入的是已存在的远程/临时 OSS URL，直接走异步转写任务
  if (typeof audioInput === "string") {
    console.log(
      `[stt] 接收到音频 URL，直接走异步转写任务: ${audioInput.slice(0, 80)}`,
    );
    return await transcribeWithAsyncFiletrans(
      audioInput,
      credential.apiKey,
      credential.baseURL,
      voiceResult.modelName,
    );
  }

  const audioBuffer = audioInput;
  const isLarge = audioBuffer.length > DIRECT_UPLOAD_THRESHOLD_BYTES;

  // 2. 大文件 (> 5MB)：必须走大文件异步转写链路，杜绝 RequestBody 超过 6MB 导致 BadRequest.TooLarge
  if (isLarge) {
    console.log(
      `[stt] 音频大小为 ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB，超过直传阈值 (${DIRECT_UPLOAD_THRESHOLD_BYTES / 1024 / 1024}MB)，自动走大文件异步转写链路`,
    );

    try {
      // 阶段 1: 上传到 DashScope 临时 OSS
      const ossUrl = await uploadToDashscopeOss(
        audioBuffer,
        format,
        credential.apiKey,
        credential.baseURL,
        voiceResult.modelName,
        originalName,
      );

      // 阶段 2: 提交异步转写并轮询
      return await transcribeWithAsyncFiletrans(
        ossUrl,
        credential.apiKey,
        credential.baseURL,
        voiceResult.modelName,
      );
    } catch (ossError) {
      console.warn(
        "[stt] DashScope 临时 OSS 大文件异步转录失败，尝试 ffmpeg 分片兜底:",
        ossError instanceof Error ? ossError.message : String(ossError),
      );

      // 阶段 3 (兜底): ffmpeg 分片顺序转写合并
      return await transcribeWithFfmpegChunking(
        audioBuffer,
        format,
        credential.apiKey,
        credential.baseURL,
        voiceResult.modelName,
      );
    }
  }

  // 3. 小文件 (<= 5MB)：保留直传 / WebSocket 快速链路
  // 3.1 极短音频 (<= 2MB) 优先尝试 WebSocket 流式识别
  if (audioBuffer.length <= 2 * 1024 * 1024) {
    try {
      const wsModel = model || "qwen-audio-3.0-asr-flash-streaming";
      return await transcribeWithWebSocket(
        audioBuffer,
        format,
        credential.apiKey,
        credential.baseURL,
        wsModel,
      );
    } catch (wsError) {
      console.warn(
        "[stt] 小文件 WebSocket ASR 尝试失败，降级至 HTTP 链路:",
        wsError instanceof Error ? wsError.message : String(wsError),
      );
    }
  }

  // 3.2 HTTP 直传 (MaaS 异步 / 标准同步)
  const isMaaS = credential.baseURL.includes(".maas.aliyuncs.com");
  try {
    if (isMaaS) {
      return await transcribeAsyncMaaS(
        audioBuffer,
        format,
        voiceResult.modelName,
        credential.apiKey,
        credential.baseURL,
      );
    }
    return await transcribeSync(
      audioBuffer,
      format,
      voiceResult.modelName,
      credential.apiKey,
      credential.baseURL,
    );
  } catch (httpError) {
    const errorText =
      httpError instanceof Error ? httpError.message : String(httpError);
    if (
      errorText.includes("TooLarge") ||
      errorText.includes("RequestEntityTooLarge") ||
      errorText.includes("413")
    ) {
      console.warn(
        "[stt] HTTP 直传仍然超限，自动转入 OSS 大文件异步链路:",
        errorText,
      );
      const ossUrl = await uploadToDashscopeOss(
        audioBuffer,
        format,
        credential.apiKey,
        credential.baseURL,
        voiceResult.modelName,
        originalName,
      );
      return await transcribeWithAsyncFiletrans(
        ossUrl,
        credential.apiKey,
        credential.baseURL,
        voiceResult.modelName,
      );
    }
    throw httpError;
  }
}

/**
 * 通过 DashScope / MaaS 专属空间 WebSocket 协议执行实时语音识别
 */
export async function transcribeWithWebSocket(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  apiKey: string,
  baseURL: string,
  modelName: string = "qwen-audio-3.0-asr-flash-streaming",
): Promise<TranscribeResult> {
  // 智能重采样或自适应检测真实采样率，消除 sample_rate 不匹配错误
  const {
    buffer: readyBuffer,
    format: readyFormat,
    sampleRate,
  } = await normalizeAudioToWav(audioBuffer, format);

  // 构建 WebSocket 端点
  let wsUrl = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
  const match = baseURL.match(
    /https:\/\/([a-zA-Z0-9_-]+)\.cn-beijing\.maas\.aliyuncs\.com/,
  );
  if (match && match[1]) {
    wsUrl = `wss://${match[1]}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;
  }

  console.log(
    `[stt-ws] 开始 WebSocket 转录: url=${wsUrl}, model=${modelName}, format=${readyFormat}, sampleRate=${sampleRate}, bufferSize=${readyBuffer.length}`,
  );

  const taskId = "t" + Date.now().toString(16).padEnd(31, "0").slice(0, 31);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isFinished = false;
    const finalSentences: string[] = [];
    let currentSentence = "";
    let totalDuration = 0;

    const cleanup = () => {
      isFinished = true;
      if (
        ws &&
        (ws.readyState === WebSocket.OPEN ||
          ws.readyState === WebSocket.CONNECTING)
      ) {
        try {
          ws.close();
        } catch (closeErr) {
          console.debug("[stt-ws] WebSocket close error:", closeErr);
        }
      }
    };

    try {
      ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `bearer ${apiKey}`,
        },
      });
    } catch (wsErr) {
      return reject(wsErr);
    }

    // 超时控制 (5 分钟)
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket 语音转录超时 (超过 5 分钟)"));
    }, 300_000);

    ws.on("open", () => {
      console.log(
        `[stt-ws] WebSocket 连接已建立，发送 run-task: taskId=${taskId}`,
      );
      const runTask = {
        header: {
          action: "run-task",
          task_id: taskId,
          streaming: "duplex",
        },
        payload: {
          task_group: "audio",
          task: "asr",
          function: "recognition",
          model: modelName,
          parameters: {
            sample_rate: sampleRate,
            format: readyFormat,
          },
          input: {},
        },
      };
      ws?.send(JSON.stringify(runTask));
    });

    ws.on("message", (data) => {
      let msg: {
        header?: { event?: string; error_message?: string };
        payload?: {
          output?: { sentence?: { text?: string; sentence_end?: boolean } };
          usage?: { duration?: number };
        };
      };
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        console.warn("[stt-ws] 解析消息失败:", err);
        return;
      }

      const event = msg.header?.event;

      if (event === "task-started") {
        console.log(
          "[stt-ws] 服务端已就绪 (task-started)，开始流式发送音频数据...",
        );
        let offset = 0;
        const chunkSize = 3200; // 约 100ms 音频帧

        const sendNextChunk = () => {
          if (isFinished || !ws || ws.readyState !== WebSocket.OPEN) return;

          if (offset >= readyBuffer.length) {
            console.log("[stt-ws] 音频发送完毕，发送 finish-task...");
            ws.send(
              JSON.stringify({
                header: {
                  action: "finish-task",
                  task_id: taskId,
                  streaming: "duplex",
                },
                payload: { input: {} },
              }),
            );
            return;
          }

          const end = Math.min(offset + chunkSize, readyBuffer.length);
          const chunk = readyBuffer.slice(offset, end);
          offset += chunkSize;

          ws.send(chunk);
          setTimeout(sendNextChunk, 20); // 间隔 20ms 流式推送
        };

        sendNextChunk();
      } else if (event === "result-generated") {
        const sentenceObj = msg.payload?.output?.sentence;
        if (
          sentenceObj &&
          typeof sentenceObj === "object" &&
          sentenceObj.text
        ) {
          currentSentence = sentenceObj.text;
          if (sentenceObj.sentence_end) {
            finalSentences.push(currentSentence);
            currentSentence = "";
          }
        } else if (typeof sentenceObj === "string" && sentenceObj) {
          currentSentence = sentenceObj;
        } else if (
          msg.payload?.output &&
          typeof msg.payload.output === "object"
        ) {
          const directText = (msg.payload.output as Record<string, unknown>)
            .text;
          if (typeof directText === "string" && directText) {
            currentSentence = directText;
          }
        }

        if (msg.payload?.usage?.duration) {
          totalDuration = msg.payload.usage.duration;
        }
      } else if (event === "task-finished") {
        console.log("[stt-ws] 转录任务圆满完成！");
        clearTimeout(timeoutTimer);
        cleanup();
        if (currentSentence) {
          finalSentences.push(currentSentence);
        }
        const finalText = finalSentences.join("").trim();
        resolve({
          text: finalText,
          duration: totalDuration || undefined,
        });
      } else if (event === "task-failed") {
        clearTimeout(timeoutTimer);
        const errMsg = msg.header?.error_message || "语音识别任务失败";
        console.error(`[stt-ws] 任务失败:`, errMsg);
        cleanup();
        reject(new Error(`WebSocket ASR 失败: ${errMsg}`));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeoutTimer);
      console.error("[stt-ws] WebSocket 连接错误:", err);
      cleanup();
      reject(err);
    });

    ws.on("close", (code, reason) => {
      clearTimeout(timeoutTimer);
      if (!isFinished) {
        reject(
          new Error(`WebSocket 连接异常断开: code=${code}, reason=${reason}`),
        );
      }
    });
  });
}

/**
 * 规范化 DashScope / Token Plan 基础地址，适配 /services 与 /tasks 端点
 */
function normalizeDashscopeBaseUrl(baseURL: string): string {
  let cleaned = baseURL.trim().replace(/\/+$/, "");
  if (cleaned.endsWith("/compatible-mode/v1")) {
    cleaned = cleaned.replace(/\/compatible-mode\/v1$/, "/api/v1");
  } else if (cleaned.endsWith("/compatible-mode")) {
    cleaned = cleaned.replace(/\/compatible-mode$/, "/api/v1");
  } else if (!cleaned.includes("/api/v1") && !cleaned.endsWith("/v1")) {
    cleaned = `${cleaned}/api/v1`;
  }
  return cleaned;
}

/**
 * 标准 DashScope 同步 ASR
 */
async function transcribeSync(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  modelName: string,
  apiKey: string,
  baseURL: string,
): Promise<TranscribeResult> {
  const apiBase = normalizeDashscopeBaseUrl(baseURL);
  const mimeType = formatToMimeType(format);

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
    `audio.${format}`,
  );
  formData.append("model", modelName);

  const url = `${apiBase}/audio/transcriptions`;

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
      const errorData = (await response
        .json()
        .catch(() => ({}))) as DashScopeError;
      throw new Error(
        `ASR 请求失败: ${errorData.code ?? response.status} - ${errorData.message ?? response.statusText}`,
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
 * Token Plan MaaS 异步 ASR（HTTP 轮询降级）
 */
async function transcribeAsyncMaaS(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  modelName: string,
  apiKey: string,
  baseURL: string,
): Promise<TranscribeResult> {
  const apiBase = normalizeDashscopeBaseUrl(baseURL);
  const submitUrl = `${apiBase}/services/audio/asr/transcription`;

  const candidateModels = Array.from(
    new Set(
      [
        modelName,
        "qwen3-asr-flash-filetrans",
        "paraformer-v2",
        "sensevoice-v1",
      ].filter((m): m is string => Boolean(m && !m.includes("streaming") && !m.includes("realtime"))),
    ),
  );

  let taskId: string | null = null;
  let lastErrorText = "";

  for (const currentModel of candidateModels) {
    console.log(
      `[stt] 尝试提交异步转写任务: url=${submitUrl}, model=${currentModel}`,
    );

    const mimeType = formatToMimeType(format);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
      `audio.${format}`,
    );
    formData.append("model", currentModel);
    formData.append(
      "parameters",
      JSON.stringify({
        language_hints: ["zh", "en"],
      }),
    );

    const submitResponse = await fetch(submitUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-DashScope-Async": "enable",
      },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (submitResponse.ok) {
      const submitData = (await submitResponse.json()) as {
        output?: { task_id: string };
        request_id: string;
      };
      taskId = submitData.output?.task_id ?? null;
      if (taskId) {
        console.log(
          `[stt] 任务提交成功: model=${currentModel}, task_id=${taskId}`,
        );
        break;
      }
    } else {
      lastErrorText = await submitResponse.text().catch(() => "");
      console.warn(
        `[stt] 模型 ${currentModel} 提交失败 (${submitResponse.status}):`,
        lastErrorText,
      );
      if (!lastErrorText.includes("Model not exist")) {
        break;
      }
    }
  }

  if (!taskId) {
    throw new Error(`ASR 提交任务失败: ${lastErrorText}`);
  }

  console.log(`[stt] 任务已提交: task_id=${taskId}`);

  // 轮询任务状态
  const taskUrl = `${apiBase}/tasks/${taskId}`;
  const maxAttempts = 60;
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

    console.log(
      `[stt] 任务状态: ${status} (attempt ${attempt + 1}/${maxAttempts})`,
    );

    if (status === "SUCCESS" || status === "SUCCEEDED") {
      transcriptionUrl =
        statusData.output?.transcription_url ??
        statusData.output?.result?.transcription_url ??
        statusData.output?.results?.[0]?.transcription_url ??
        null;
      break;
    }

    if (status === "FAIL" || status === "FAILED") {
      throw new Error(`ASR 转写失败: ${JSON.stringify(statusData)}`);
    }
  }

  if (!transcriptionUrl) {
    throw new Error("ASR 转写超时（超过 2 分钟）");
  }

  // 下载结果 JSON
  const resultResponse = await fetch(transcriptionUrl, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!resultResponse.ok) {
    throw new Error(`下载转写结果失败: ${resultResponse.status}`);
  }

  const resultData = (await resultResponse.json()) as {
    transcripts?: Array<{ text: string; content_duration_in_milliseconds?: number }>;
    text?: string;
    properties?: { original_duration_in_milliseconds?: number };
    audio_info?: { duration_in_milliseconds?: number };
  };

  let text = "";
  let duration: number | undefined;

  if (resultData.transcripts?.length) {
    text = resultData.transcripts.map((t) => t.text).join(" ");
    const firstDuration = resultData.transcripts[0]?.content_duration_in_milliseconds;
    if (typeof firstDuration === "number") {
      duration = Math.round(firstDuration / 1000);
    }
  } else if (resultData.text) {
    text = resultData.text;
  }

  if (!duration) {
    const rawDurationMs =
      resultData.properties?.original_duration_in_milliseconds ??
      resultData.audio_info?.duration_in_milliseconds;
    if (typeof rawDurationMs === "number") {
      duration = Math.round(rawDurationMs / 1000);
    }
  }

  return { text: text.trim(), duration };
}

/**
 * 上传音频至 DashScope 官方临时 OSS 存储空间（支持最大 1024MB）
 */
interface DashScopeUploadPolicyResponse {
  data?: {
    policy: string;
    signature: string;
    upload_dir: string;
    upload_host: string;
    expire_in_seconds?: number;
    max_file_size_mb?: number;
    oss_access_key_id: string;
    x_oss_object_acl?: string;
    x_oss_forbid_overwrite?: string;
  };
  code?: string;
  message?: string;
  request_id?: string;
}

async function uploadToDashscopeOss(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  apiKey: string,
  baseURL: string,
  modelName: string,
  originalName?: string,
): Promise<string> {
  const apiBase = normalizeDashscopeBaseUrl(baseURL);
  const targetModel = modelName || "paraformer-v2";
  const policyUrl = `${apiBase}/uploads?action=getPolicy&model=${encodeURIComponent(targetModel)}`;

  console.log(`[stt-oss] 获取 DashScope 临时 OSS 凭证: url=${policyUrl}`);
  const policyRes = await fetch(policyUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!policyRes.ok) {
    const errText = await policyRes.text().catch(() => "");
    throw new Error(`获取 DashScope OSS 凭证失败 (${policyRes.status}): ${errText}`);
  }

  const policyJson = (await policyRes.json()) as DashScopeUploadPolicyResponse;
  const policyData = policyJson.data;
  if (!policyData || !policyData.upload_host || !policyData.upload_dir) {
    throw new Error(`DashScope OSS 凭证响应不完整: ${JSON.stringify(policyJson)}`);
  }

  const safeExt = format || "mp3";
  const rawBaseName = originalName
    ? path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_")
    : `audio_${Date.now()}.${safeExt}`;
  const fileName = rawBaseName.toLowerCase().endsWith(`.${safeExt}`)
    ? rawBaseName
    : `${rawBaseName}.${safeExt}`;
  const key = `${policyData.upload_dir}/${fileName}`;

  const formData = new FormData();
  formData.append("OSSAccessKeyId", policyData.oss_access_key_id);
  formData.append("Signature", policyData.signature);
  formData.append("policy", policyData.policy);
  if (policyData.x_oss_object_acl) {
    formData.append("x-oss-object-acl", policyData.x_oss_object_acl);
  }
  if (policyData.x_oss_forbid_overwrite) {
    formData.append("x-oss-forbid-overwrite", policyData.x_oss_forbid_overwrite);
  }
  formData.append("key", key);
  formData.append("success_action_status", "200");
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: formatToMimeType(format) }),
    fileName,
  );

  console.log(
    `[stt-oss] 开始上传音频至 OSS (${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB) ... host=${policyData.upload_host}`,
  );
  const uploadRes = await fetch(policyData.upload_host, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(180_000),
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`音频上传到 DashScope OSS 失败 (${uploadRes.status}): ${errText}`);
  }

  const ossUrl = `oss://${key}`;
  console.log(`[stt-oss] OSS 上传成功，临时资源: ${ossUrl}`);
  return ossUrl;
}

/**
 * 通过远程/OSS URL 提交大文件异步 ASR 任务并轮询获取结果
 */
async function transcribeWithAsyncFiletrans(
  audioUrl: string,
  apiKey: string,
  baseURL: string,
  modelName?: string,
): Promise<TranscribeResult> {
  const apiBase = normalizeDashscopeBaseUrl(baseURL);
  const submitUrl = `${apiBase}/services/audio/asr/transcription`;

  const candidateModels = Array.from(
    new Set(
      [
        modelName,
        "qwen3-asr-flash-filetrans",
        "paraformer-v2",
        "sensevoice-v1",
      ].filter((m): m is string => Boolean(m && !m.includes("streaming") && !m.includes("realtime"))),
    ),
  );

  let taskId: string | null = null;
  let lastErrorText = "";
  const isOss = audioUrl.startsWith("oss://");

  for (const currentModel of candidateModels) {
    console.log(
      `[stt-async] 提交异步转写任务: model=${currentModel}, url=${audioUrl.slice(0, 80)}`,
    );

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
    };
    if (isOss) {
      headers["X-DashScope-OssResourceResolve"] = "enable";
    }

    const submitResponse = await fetch(submitUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: currentModel,
        input: {
          file_url: audioUrl,
          file_urls: [audioUrl],
        },
        parameters: {
          language_hints: ["zh", "en"],
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (submitResponse.ok) {
      const submitData = (await submitResponse.json()) as {
        output?: { task_id: string; task_status?: string };
        request_id: string;
      };
      taskId = submitData.output?.task_id ?? null;
      if (taskId) {
        console.log(
          `[stt-async] 任务提交成功: model=${currentModel}, task_id=${taskId}`,
        );
        break;
      }
    } else {
      lastErrorText = await submitResponse.text().catch(() => "");
      console.warn(
        `[stt-async] 模型 ${currentModel} 提交失败 (${submitResponse.status}):`,
        lastErrorText,
      );
    }
  }

  if (!taskId) {
    throw new Error(`ASR 提交任务失败: ${lastErrorText}`);
  }

  // 轮询任务状态 (最长 5 分钟)
  const taskUrl = `${apiBase}/tasks/${taskId}`;
  const maxAttempts = 100;
  let transcriptionUrl: string | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));

    let statusResponse: Response;
    try {
      statusResponse = await fetch(taskUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (fetchErr) {
      console.warn(`[stt-async] 轮询网络抖动 (${attempt + 1}/${maxAttempts}):`, fetchErr);
      continue;
    }

    if (!statusResponse.ok) {
      const err = await statusResponse.text().catch(() => "");
      console.warn(`[stt-async] 查询状态失败: ${statusResponse.status}`, err);
      continue;
    }

    const statusData = (await statusResponse.json()) as TaskStatusResponse;
    const status = statusData.output?.task_status;

    if (
      attempt % 5 === 0 ||
      status === "SUCCESS" ||
      status === "SUCCEEDED" ||
      status === "FAIL" ||
      status === "FAILED"
    ) {
      console.log(
        `[stt-async] 任务状态: ${status} (attempt ${attempt + 1}/${maxAttempts})`,
      );
    }

    if (status === "SUCCESS" || status === "SUCCEEDED") {
      transcriptionUrl =
        statusData.output?.transcription_url ??
        statusData.output?.result?.transcription_url ??
        statusData.output?.results?.[0]?.transcription_url ??
        null;
      break;
    }

    if (status === "FAIL" || status === "FAILED") {
      throw new Error(
        `ASR 转写失败: ${statusData.output?.code || "FAILED"} - ${statusData.output?.message || JSON.stringify(statusData)}`,
      );
    }
  }

  if (!transcriptionUrl) {
    throw new Error("ASR 转写超时（超过 5 分钟）");
  }

  console.log(`[stt-async] 正在下载识别结果: ${transcriptionUrl.slice(0, 100)}...`);
  const resultResponse = await fetch(transcriptionUrl, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!resultResponse.ok) {
    throw new Error(`下载转写结果失败: ${resultResponse.status}`);
  }

  const resultData = (await resultResponse.json()) as {
    transcripts?: Array<{
      text?: string;
      content_duration_in_milliseconds?: number;
    }>;
    text?: string;
    properties?: {
      original_duration_in_milliseconds?: number;
    };
    audio_info?: {
      duration_in_milliseconds?: number;
    };
  };

  let text = "";
  let duration: number | undefined;

  if (Array.isArray(resultData.transcripts) && resultData.transcripts.length > 0) {
    text = resultData.transcripts
      .map((t) => t.text?.trim())
      .filter(Boolean)
      .join(" ");

    const firstDuration = resultData.transcripts[0]?.content_duration_in_milliseconds;
    if (typeof firstDuration === "number") {
      duration = Math.round(firstDuration / 1000);
    }
  } else if (resultData.text) {
    text = resultData.text.trim();
  }

  if (!duration) {
    const rawDurationMs =
      resultData.properties?.original_duration_in_milliseconds ??
      resultData.audio_info?.duration_in_milliseconds;
    if (typeof rawDurationMs === "number") {
      duration = Math.round(rawDurationMs / 1000);
    }
  }

  return { text: text.trim(), duration };
}

/**
 * 当 Provider 不支持 OSS / URL 时的 ffmpeg 分片兜底方案。
 * 将大音频以 180s（3 分钟）分片切分，严格控制单片小于 4.5MB，顺序识别后合并。
 */
async function transcribeWithFfmpegChunking(
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  apiKey: string,
  baseURL: string,
  modelName: string,
): Promise<TranscribeResult> {
  const binary = process.env.FFMPEG_PATH || "ffmpeg";
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stt-chunk-"));
  const inputPath = path.join(tmpDir, `input.${format}`);
  const outputPattern = path.join(tmpDir, "chunk_%03d.mp3");

  try {
    await fs.promises.writeFile(inputPath, audioBuffer);
    console.log(
      `[stt-chunk] 启动 ffmpeg 分片兜底: 总大小 ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`,
    );

    // 180 秒一片，压制为 64kbps mp3，单片约 1.4MB，远低于 5MB 限制
    await new Promise<void>((resolve, reject) => {
      const ff = spawn(
        binary,
        [
          "-y",
          "-i",
          inputPath,
          "-f",
          "segment",
          "-segment_time",
          "180",
          "-c:a",
          "libmp3lame",
          "-b:a",
          "64k",
          outputPattern,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      let stderr = "";
      ff.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      ff.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg 分片退出码 ${code}: ${stderr.slice(-200)}`));
      });
      ff.on("error", (err) => reject(err));
    });

    const entries = await fs.promises.readdir(tmpDir);
    const chunkFiles = entries
      .filter((name) => name.startsWith("chunk_") && name.endsWith(".mp3"))
      .sort();

    if (chunkFiles.length === 0) {
      throw new Error("ffmpeg 分片未生成任何有效音频片段");
    }

    console.log(`[stt-chunk] 音频分片完成，共 ${chunkFiles.length} 个片段`);

    const chunkTexts: string[] = [];
    let totalDuration = 0;

    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkFile = chunkFiles[i];
      const chunkPath = path.join(tmpDir, chunkFile);
      const chunkBuf = await fs.promises.readFile(chunkPath);
      console.log(
        `[stt-chunk] 转写片段 ${i + 1}/${chunkFiles.length} (${(chunkBuf.length / 1024).toFixed(1)}KB)...`,
      );

      const isMaaS = baseURL.includes(".maas.aliyuncs.com");
      let chunkResult: TranscribeResult;
      if (isMaaS) {
        chunkResult = await transcribeAsyncMaaS(
          chunkBuf,
          "mp3",
          modelName,
          apiKey,
          baseURL,
        );
      } else {
        chunkResult = await transcribeSync(
          chunkBuf,
          "mp3",
          modelName,
          apiKey,
          baseURL,
        );
      }

      if (chunkResult.text) {
        chunkTexts.push(chunkResult.text);
      }
      if (chunkResult.duration) {
        totalDuration += chunkResult.duration;
      }
    }

    return {
      text: chunkTexts.join(" ").trim(),
      duration: totalDuration > 0 ? totalDuration : undefined,
    };
  } finally {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn("[stt-chunk] 清理临时分片目录失败:", cleanupErr);
    }
  }
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
export function inferFormatFromMimeType(
  mimeType: string,
  filename?: string,
): SupportedAudioFormat {
  const lowerMime = mimeType.toLowerCase();
  const lowerName = (filename ?? "").toLowerCase();

  if (
    lowerMime.includes("mpeg") ||
    lowerMime.includes("mp3") ||
    lowerName.endsWith(".mp3")
  )
    return "mp3";
  if (
    lowerMime.includes("m4a") ||
    lowerMime.includes("x-m4a") ||
    lowerName.endsWith(".m4a")
  )
    return "m4a";
  if (lowerMime.includes("wav") || lowerName.endsWith(".wav")) return "wav";
  if (lowerMime.includes("webm") || lowerName.endsWith(".webm")) return "webm";
  if (lowerMime.includes("mp4") || lowerName.endsWith(".mp4")) return "mp4";
  return "mp3";
}
