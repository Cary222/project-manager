"use client";

import { useCallback, useRef, useState } from "react";
import { PCMPlayer } from "@/shared/media/audio/player/pcm-player";
import type { RealtimeConfig } from "@/features/ai/llm/providers/audio/realtime/types";

export type VoiceSessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export type VoiceMode = "input" | "output";

export interface UseVoiceSessionOptions {
  /** 模式: input=仅输入转文字, output=带 TTS 语音回复 */
  mode?: VoiceMode;
  /** 用户输入文字回调 */
  onTranscript?: (text: string) => void;
  /** AI 文字回复回调 */
  onAiResponse?: (text: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

export interface UseVoiceSessionReturn {
  startSession: () => Promise<void>;
  stopSession: () => void;
  finishInput: () => void;
  status: VoiceSessionStatus;
  transcript: string;
  aiResponse: string;
  errorMessage: string | null;
}

/**
 * 构建 Session Config（根据模式选择不同的配置）
 */
function buildSessionConfig(mode: VoiceMode) {
  if (mode === "input") {
    return {
      modalities: ["text"] as const,
      input_audio_transcription: {
        model: "fun-asr",
      },
      turn_detection: null,
    };
  }

  // output 模式：文本 + 语音 + 语义级打断检测
  return {
    modalities: ["text", "audio"] as const,
    input_audio_transcription: {
      model: "fun-asr",
    },
    turn_detection: {
      type: "smart_turn",
    },
    voice: "longanqian",
  };
}

/**
 * 解析 WebSocket 事件并规范化输出
 */
function parseVoiceEvent(
  data: unknown
): {
  type: string;
  text?: string;
  audioDelta?: string;
  error?: string;
} | null {
  if (!data || typeof data !== "object") return null;

  const msg = data as Record<string, unknown>;

  // 规范化各种事件类型
  switch (msg.type) {
    case "session.created":
    case "session.updated":
      return { type: msg.type as string };

    case "conversation.item.input_audio_transcription.completed":
    case "input_audio_buffer.speech_started":
    case "input_audio_buffer.speech_stopped":
    case "input_audio_buffer.committed":
    case "response.created":
    case "response.done":
    case "response.output_item.added":
    case "response.content_part.added":
    case "conversation.created":
      return { type: msg.type as string, text: msg.transcript as string | undefined };

    case "conversation.item.input_audio_transcription.failed":
      return { type: msg.type as string, error: (msg.error as string) || "转写失败" };

    case "error":
      return {
        type: "error",
        error: (msg.error as string) || (msg.message as string) || "未知错误",
      };

    case "response.audio.delta":
      return {
        type: msg.type as string,
        audioDelta: msg.delta as string,
      };

    case "response.audio_transcript.delta":
    case "response.audio_transcript.done":
      return {
        type: msg.type as string,
        text: msg.delta as string | undefined || msg.transcript as string | undefined,
      };

    default:
      // 透传其他未知事件类型
      return { type: msg.type as string };
  }
}

export function useVoiceSession(
  options: UseVoiceSessionOptions = {}
): UseVoiceSessionReturn {
  const { mode = "output", onTranscript, onAiResponse, onError } = options;

  const [status, setStatus] = useState<VoiceSessionStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const pcmPlayerRef = useRef<PCMPlayer | null>(null);
  const aiTextBufferRef = useRef<string>("");

  /**
   * 发送 WebSocket 消息
   */
  const send = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  /**
   * 启动语音会话
   */
  const startSession = useCallback(async () => {
    setErrorMessage(null);
    setTranscript("");
    setAiResponse("");
    aiTextBufferRef.current = "";

    try {
      setStatus("connecting");

      const configRes = await fetch("/api/ai/audio/realtime/config", {
        method: "POST",
      });

      console.log("[useVoiceSession] Config 响应:", configRes.status, configRes.statusText);

      if (!configRes.ok) {
        const json = await configRes.json();
        const msg = json?.error ?? "无法获取 Realtime 配置";
        console.error("[useVoiceSession] Config 错误:", msg);
        setErrorMessage(msg);
        setStatus("error");
        onError?.(msg);
        return;
      }

      const { data: config } = (await configRes.json()) as { data: RealtimeConfig };
      console.log("[useVoiceSession] 获取到配置:", config);

      // 建立 WebSocket 连接
      // 注意：WebSocket API 不支持自定义 headers，Token 已在 URL 中（DashScope Realtime API 要求）
      // 如果需要更强的安全性，应通过服务端代理转发请求
      console.log("[DEBUG-ws] 连接 WebSocket:", config.url.replace(/token=[^&]+/, 'token=<REDACTED>'));
      const ws = new WebSocket(config.url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = async () => {
        setStatus("connected");
        console.log("[useVoiceSession] WebSocket 已连接，发送 session.update");

        // 发送 session 配置
        send({
          type: "session.update",
          session: buildSessionConfig(mode),
        });

        // 初始化音频播放器（仅 output 模式需要）
        if (mode === "output") {
          const player = new PCMPlayer();
          await player.init();
          pcmPlayerRef.current = player;
        }

        // 初始化麦克风采集
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              sampleRate: 16000,
              echoCancellation: true,
              noiseSuppression: true,
            },
          });
          mediaStreamRef.current = stream;

          const ctx = new AudioContext({ sampleRate: 16000 });
          audioContextRef.current = ctx;

          const source = ctx.createMediaStreamSource(stream);
          sourceNodeRef.current = source;

          await ctx.audioWorklet.addModule("/audio/pcm16-processor.js");

          const workletNode = new AudioWorkletNode(ctx, "pcm16-processor");

          workletNode.port.onmessage = (event) => {
            const float32Data: Float32Array = event.data;
            const int16Data = new Int16Array(float32Data.length);
            for (let i = 0; i < float32Data.length; i++) {
              const s = Math.max(-1, Math.min(1, float32Data[i]));
              int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            const buffer = int16Data.buffer;
            const bytes = new Uint8Array(buffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "input_audio_buffer.append",
                  audio: base64,
                })
              );
            }
          };

          source.connect(workletNode);
          workletNode.connect(ctx.destination);
        } catch (audioErr) {
          const audioErrMsg = audioErr instanceof Error ? audioErr.message : "音频设备初始化失败";
          console.error("[useVoiceSession] 音频设备初始化失败:", audioErrMsg);
          onError?.(`无法访问麦克风：${audioErrMsg}`);
          // 继续运行（用户可以手动重试）
        }
      };

      ws.onmessage = (event) => {
        try {
          const rawMsg = JSON.parse(event.data);
          const msg = parseVoiceEvent(rawMsg);

          if (!msg) {
            console.warn("[useVoiceSession] 无法解析消息:", rawMsg);
            return;
          }

          console.log("[useVoiceSession] 收到事件:", msg.type);

          switch (msg.type) {
            case "session.created":
            case "session.updated":
              // 配置已发送，无需额外处理
              break;

            case "conversation.item.input_audio_transcription.completed":
              if (msg.text) {
                setTranscript((prev) => prev + msg.text);
                onTranscript?.(msg.text);
              }
              break;

            case "response.audio.delta":
              if (msg.audioDelta && pcmPlayerRef.current) {
                pcmPlayerRef.current.playChunk(msg.audioDelta);
              }
              break;

            case "response.audio_transcript.delta":
              if (msg.text) {
                aiTextBufferRef.current += msg.text;
                setAiResponse(aiTextBufferRef.current);
                onAiResponse?.(aiTextBufferRef.current);
              }
              break;

            case "response.audio_transcript.done":
              if (msg.text) {
                aiTextBufferRef.current += msg.text;
                setAiResponse(aiTextBufferRef.current);
                onAiResponse?.(aiTextBufferRef.current);
              }
              break;

            case "error":
            case "conversation.item.input_audio_transcription.failed": {
              const errMsg = msg.error ?? "未知错误";
              setErrorMessage(errMsg);
              setStatus("error");
              onError?.(errMsg);
              break;
            }

            default:
              // 其他事件忽略
              break;
          }
        } catch {
          console.error("[useVoiceSession] 解析 WebSocket 消息失败");
        }
      };

      ws.onerror = (event) => {
        console.error("[DEBUG-ws] WebSocket error event:", event);
        console.error("[DEBUG-ws] WebSocket readyState:", ws.readyState);
        console.error("[DEBUG-ws] WebSocket URL:", config.url.replace(/token=[^&]+/, 'token=<REDACTED>'));
        const msg = "WebSocket 连接错误";
        setErrorMessage(msg);
        setStatus("error");
        onError?.(msg);
      };

      ws.onclose = () => {
        setStatus("disconnected");
        // 清理音频资源（复用 stopSession 的清理逻辑）
        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((track) => track.stop());
          mediaStreamRef.current = null;
        }
        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        sourceNodeRef.current = null;
        if (pcmPlayerRef.current) {
          pcmPlayerRef.current.close();
          pcmPlayerRef.current = null;
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "启动语音会话失败";
      setErrorMessage(msg);
      setStatus("error");
      onError?.(msg);
    }
  }, [mode, onTranscript, onAiResponse, onError, send]);

  /**
   * 停止语音会话
   */
  const stopSession = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    sourceNodeRef.current = null;

    if (pcmPlayerRef.current) {
      pcmPlayerRef.current.close();
      pcmPlayerRef.current = null;
    }

    setStatus("idle");
  }, []);

  /**
   * 完成输入（用于 input 模式：commit + response.create）
   */
  const finishInput = useCallback(() => {
    send({ type: "input_audio_buffer.commit" });
    send({ type: "response.create" });
  }, [send]);

  return {
    startSession,
    stopSession,
    finishInput,
    status,
    transcript,
    aiResponse,
    errorMessage,
  };
}
