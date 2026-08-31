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
 * 尝试通过 ffmpeg 将任意输入音频转为标准 16000Hz 单声道 PCM WAV 格式
 */
async function normalizeAudioToWav(inputBuffer: Buffer): Promise<{ buffer: Buffer; format: "wav" }> {
  try {
    const wavBuffer = await new Promise<Buffer>((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-i", "pipe:0",
        "-ar", "16000",
        "-ac", "1",
        "-f", "wav",
        "pipe:1",
      ], { stdio: ["pipe", "pipe", "pipe"] });

      const chunks: Buffer[] = [];
      ff.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      ff.on("close", (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`ffmpeg exited with code ${code}`));
        }
      });
      ff.on("error", (err) => reject(err));
      ff.stdin.write(inputBuffer);
      ff.stdin.end();
    });

    return { buffer: wavBuffer, format: "wav" };
  } catch (err) {
    console.warn("[stt] ffmpeg 格式重采样未执行或失败，回落到原格式:", err instanceof Error ? err.message : String(err));
    return { buffer: inputBuffer, format: "wav" };
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
  audioBuffer: Buffer,
  format: SupportedAudioFormat,
  options: TranscribeOptions,
): Promise<TranscribeResult> {
  const { userId, model } = options;

  // 使用语音凭证解析器
  const voiceResult = await resolveVoiceCredential(userId, "stt", model);
  if (!voiceResult) {
    throw new Error(
      "语音识别服务未配置。请在「设置 > AI Providers」中添加支持 ASR 的 provider（如 dashscope、token plan 或 openai）。",
    );
  }

  const { credential } = voiceResult;

  // 1. 优先使用 WebSocket 流式识别协议（百炼 MaaS 专属空间与标准 DashScope 官方推荐，支持 qwen-audio-3.0-asr-flash-streaming）
  try {
    const wsModel = model || "qwen-audio-3.0-asr-flash-streaming";
    return await transcribeWithWebSocket(audioBuffer, format, credential.apiKey, credential.baseURL, wsModel);
  } catch (wsError) {
    console.warn("[stt] WebSocket ASR 尝试失败，开始尝试 HTTP 异步/同步 ASR 降级链路:", wsError instanceof Error ? wsError.message : String(wsError));

    const isMaaS = credential.baseURL.includes(".maas.aliyuncs.com");
    if (isMaaS) {
      return transcribeAsyncMaaS(audioBuffer, format, voiceResult.modelName, credential.apiKey, credential.baseURL);
    }
    return transcribeSync(audioBuffer, format, voiceResult.modelName, credential.apiKey, credential.baseURL);
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
  // 预先将音频转为 16000Hz 单声道 wav 以彻底消除 sample_rate 不匹配错误
  const { buffer: readyBuffer, format: readyFormat } = await normalizeAudioToWav(audioBuffer);

  // 构建 WebSocket 端点
  let wsUrl = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
  const match = baseURL.match(/https:\/\/([a-zA-Z0-9_-]+)\.cn-beijing\.maas\.aliyuncs\.com/);
  if (match && match[1]) {
    wsUrl = `wss://${match[1]}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;
  }

  console.log(`[stt-ws] 开始 WebSocket 转录: url=${wsUrl}, model=${modelName}, format=${readyFormat}, bufferSize=${readyBuffer.length}`);

  const taskId = "t" + Date.now().toString(16).padEnd(31, "0").slice(0, 31);

  return new Promise((resolve, reject) => {
    let ws: WebSocket | null = null;
    let isFinished = false;
    const finalSentences: string[] = [];
    let currentSentence = "";
    let totalDuration = 0;

    const cleanup = () => {
      isFinished = true;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
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
      console.log(`[stt-ws] WebSocket 连接已建立，发送 run-task: taskId=${taskId}`);
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
            sample_rate: 16000,
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
        console.log("[stt-ws] 服务端已就绪 (task-started)，开始流式发送音频数据...");
        let offset = 0;
        const chunkSize = 3200; // 约 100ms 音频帧 @ 16kHz

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
        if (sentenceObj?.text) {
          currentSentence = sentenceObj.text;
          if (sentenceObj.sentence_end) {
            finalSentences.push(currentSentence);
            currentSentence = "";
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
        reject(new Error(`WebSocket 连接异常断开: code=${code}, reason=${reason}`));
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
      const errorData = (await response.json().catch(() => ({}))) as DashScopeError;
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

  const candidateModels = Array.from(new Set([
    modelName,
    "qwen-audio-3.0-asr-flash-streaming",
    "qwen3-asr-flash-filetrans",
    "paraformer-v2",
    "sensevoice-v1",
  ]));

  let taskId: string | null = null;
  let lastErrorText = "";

  for (const currentModel of candidateModels) {
    console.log(`[stt] 尝试提交异步转写任务: url=${submitUrl}, model=${currentModel}`);

    const mimeType = formatToMimeType(format);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
      `audio.${format}`,
    );
    formData.append("model", currentModel);
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

    if (submitResponse.ok) {
      const submitData = (await submitResponse.json()) as { output?: { task_id: string }; request_id: string };
      taskId = submitData.output?.task_id ?? null;
      if (taskId) {
        console.log(`[stt] 任务提交成功: model=${currentModel}, task_id=${taskId}`);
        break;
      }
    } else {
      lastErrorText = await submitResponse.text().catch(() => "");
      console.warn(`[stt] 模型 ${currentModel} 提交失败 (${submitResponse.status}):`, lastErrorText);
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

  // 下载结果 JSON
  const resultResponse = await fetch(transcriptionUrl, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!resultResponse.ok) {
    throw new Error(`下载转写结果失败: ${resultResponse.status}`);
  }

  const resultData = (await resultResponse.json()) as {
    transcripts?: Array<{ text: string }>;
    text?: string;
  };

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
