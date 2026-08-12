"use client";

import { useCallback, useRef, useState } from "react";
import { getSupportedMimeType } from "@/shared/media/audio/pcm/mime-type";

export type SpeechInputStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "error";

export interface UseSpeechInputOptions {
  /** 录音超时时间（毫秒），默认 60 秒 */
  timeoutMs?: number;
  /** 识别完成回调 */
  onTranscribe?: (text: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

export interface UseSpeechInputReturn {
  /** 录音状态 */
  status: SpeechInputStatus;
  /** 已录制时长（秒） */
  duration: number;
  /** 识别结果文本 */
  transcript: string;
  /** 开始录音 */
  startRecording: () => Promise<void>;
  /** 停止录音并触发识别 */
  stopRecording: () => Promise<void>;
  /** 重置状态 */
  reset: () => void;
  /** 主动设置识别结果（用于外部填充） */
  setTranscript: (text: string) => void;
}

/**
 * 语音输入 Hook
 *
 * 功能：
 * - 使用 MediaRecorder 录音
 * - 动态检测支持的 MIME 类型
 * - 60 秒超时保护
 * - 调用 /api/ai/audio/transcribe 进行识别
 */
export function useSpeechInput(
  options: UseSpeechInputOptions = {}
): UseSpeechInputReturn {
  const { timeoutMs = 60_000, onTranscribe, onError } = options;

  const [status, setStatus] = useState<SpeechInputStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscriptState] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setStatus("idle");
    setDuration(0);
    setTranscriptState("");
    audioChunksRef.current = [];
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
    mediaRecorderRef.current = null;
  }, [clearTimers]);

  const startRecording = useCallback(async () => {
    try {
      reset();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(1000); // 每秒收集一次数据块

      setStatus("recording");
      setDuration(0);

      // 计时器：每秒更新时长
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      // 超时保护
      timeoutRef.current = setTimeout(() => {
        void stopRecording();
      }, timeoutMs);
    } catch (error) {
      let message = "无法访问麦克风";
      
      if (error instanceof Error) {
        if (error.message.includes("Permission denied") || error.name === "NotAllowedError") {
          message = "请允许麦克风权限。请在浏览器设置中启用麦克风访问。";
        } else if (error.message.includes("Requested device not found") || error.name === "NotFoundError") {
          message = "未检测到麦克风设备。请检查麦克风是否已连接。";
        } else if (error.name === "NotReadableError") {
          message = "麦克风被其他应用占用。请关闭其他使用麦克风的程序。";
        } else if (error.name === "OverconstrainedError") {
          message = "麦克风不支持请求的配置。";
        } else {
          message = `无法访问麦克风: ${error.message}`;
        }
      }
      
      setStatus("error");
      onError?.(message);
    }
  }, [reset, timeoutMs, onError]);

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }

    clearTimers();

    const mediaRecorder = mediaRecorderRef.current;

    return new Promise<void>((resolve) => {
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: getSupportedMimeType(),
        });

        setStatus("transcribing");

        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);

          // 从 MIME 类型推断格式
          const mimeType = getSupportedMimeType();
          const format = mimeType.includes("mp4") ? "mp4" : mimeType.includes("wav") ? "wav" : "webm";

          const response = await fetch("/api/ai/audio/transcribe", {
            method: "POST",
            body: JSON.stringify({
              audio: buffer.toString("base64"),
              format,
            }),
            headers: {
              "Content-Type": "application/json",
            },
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error ?? `请求失败: ${response.status}`);
          }

          const data = await response.json();

          if (data.error) {
            throw new Error(data.error);
          }

          const text = data.data?.text ?? "";
          setTranscriptState(text);
          onTranscribe?.(text);
          setStatus("idle");
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "语音识别失败，请重试";
          setStatus("error");
          onError?.(message);
        } finally {
          // 停止所有音轨
          mediaRecorder.stream.getTracks().forEach((track) => track.stop());
          resolve();
        }
      };

      mediaRecorder.stop();
    });
  }, [clearTimers, onTranscribe, onError]);

  return {
    status,
    duration,
    transcript,
    startRecording,
    stopRecording,
    reset,
    setTranscript: setTranscriptState,
  };
}
