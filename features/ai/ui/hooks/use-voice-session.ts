"use client";

import { useCallback, useRef, useState } from "react";
import { PCMPlayer } from "@/shared/media/audio/player/pcm-player";
import type { RealtimeConfig, RealtimeMessage } from "@/features/ai/audio/realtime/types";

export type VoiceSessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export interface UseVoiceSessionOptions {
  onTranscript?: (text: string) => void;
  onAiResponse?: (text: string) => void;
  onError?: (error: string) => void;
}

export interface UseVoiceSessionReturn {
  startSession: () => Promise<void>;
  stopSession: () => void;
  status: VoiceSessionStatus;
  transcript: string;
  aiResponse: string;
  errorMessage: string | null;
}

export function useVoiceSession(
  options: UseVoiceSessionOptions = {}
): UseVoiceSessionReturn {
  const { onTranscript, onAiResponse, onError } = options;

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

      if (!configRes.ok) {
        const json = await configRes.json();
        const msg = json?.error ?? "无法获取 Realtime 配置";
        setErrorMessage(msg);
        setStatus("error");
        onError?.(msg);
        return;
      }

      const { data: config } = (await configRes.json()) as { data: RealtimeConfig };

      const ws = new WebSocket(config.url);
      wsRef.current = ws;

      ws.onopen = async () => {
        setStatus("connected");

        const player = new PCMPlayer();
        await player.init();
        pcmPlayerRef.current = player;

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
          console.error("[useVoiceSession] 音频设备初始化失败:", audioErr);
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg: RealtimeMessage = JSON.parse(event.data);

          switch (msg.type) {
            case "session.created":
              ws.send(
                JSON.stringify({
                  type: "session.update",
                  session: {
                    modalities: ["text", "audio"],
                    voice: "alloy",
                    turn_detection: {
                      type: "server_vad",
                      threshold: 0.5,
                      silence_duration_ms: 500,
                    },
                  },
                })
              );
              break;

            case "conversation.item.input_audio_transcription.completed":
              if (msg.text) {
                setTranscript((prev) => prev + msg.text);
                onTranscript?.(msg.text);
              }
              break;

            case "response.audio.delta":
              if (msg.audioDelta) {
                pcmPlayerRef.current?.playChunk(msg.audioDelta);
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
              const errMsg = msg.error ?? "未知错误";
              setErrorMessage(errMsg);
              setStatus("error");
              onError?.(errMsg);
              break;
          }
        } catch {
          console.error("[useVoiceSession] 解析 WebSocket 消息失败");
        }
      };

      ws.onerror = () => {
        const msg = "WebSocket 连接错误";
        setErrorMessage(msg);
        setStatus("error");
        onError?.(msg);
      };

      ws.onclose = () => {
        setStatus("disconnected");
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "启动语音会话失败";
      setErrorMessage(msg);
      setStatus("error");
      onError?.(msg);
    }
  }, [onTranscript, onAiResponse, onError]);

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

  return {
    startSession,
    stopSession,
    status,
    transcript,
    aiResponse,
    errorMessage,
  };
}
