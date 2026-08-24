"use client";

import { useCallback, useRef, useState } from "react";
import { useVoiceSession } from "./use-voice-session";

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
  stopRecording: () => void;
  /** 重置状态 */
  reset: () => void;
  /** 主动设置识别结果（用于外部填充） */
  setTranscript: (text: string) => void;
}

/**
 * 语音输入 Hook（封装 useVoiceSession 实现）
 *
 * 使用 Realtime WebSocket API 进行实时语音转文字
 * - startRecording → 启动 WebSocket 会话，开始麦克风采集
 * - stopRecording → 提交音频缓冲，触发 response.create
 */
export function useSpeechInput(
  options: UseSpeechInputOptions = {}
): UseSpeechInputReturn {
  const { timeoutMs = 60_000, onTranscribe, onError } = options;

  const [status, setStatus] = useState<SpeechInputStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscriptState] = useState("");

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 内部使用 useVoiceSession (input 模式)
  const voiceSession = useVoiceSession({
    mode: "input",
    onTranscript: (text) => {
      setTranscriptState(text);
      onTranscribe?.(text);
    },
    onError: (error) => {
      setStatus("error");
      onError?.(error);
    },
  });

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
    voiceSession.stopSession();
  }, [clearTimers, voiceSession]);

  const startRecording = useCallback(async () => {
    try {
      reset();
      setStatus("recording");
      setDuration(0);

      // 启动语音会话
      await voiceSession.startSession();

      // 启动计时器
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);

      // 超时保护
      timeoutRef.current = setTimeout(() => {
        void stopRecording();
      }, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "启动录音失败";
      setStatus("error");
      onError?.(message);
    }
  }, [reset, timeoutMs, onError, voiceSession]);

  const stopRecording = useCallback(() => {
    clearTimers();
    setStatus("transcribing");
    // 提交音频缓冲并触发识别
    voiceSession.finishInput();
  }, [clearTimers, voiceSession]);

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
