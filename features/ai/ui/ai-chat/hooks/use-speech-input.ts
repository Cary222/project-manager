"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechInputStatus = "idle" | "recording" | "transcribing" | "error";

export interface UseSpeechInputOptions {
  timeoutMs?: number;
  onTranscribe?: (text: string) => void;
  onError?: (error: string) => void;
}

export interface UseSpeechInputReturn {
  status: SpeechInputStatus;
  duration: number;
  transcript: string;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  reset: () => void;
  setTranscript: (text: string) => void;
}

function formatForMimeType(mimeType: string): "webm" | "mp4" | "wav" {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

/**
 * 录音完成后调用文件转写 API，而不是 Realtime WebSocket。
 * 会议转录和普通语音输入共享同一 STT 凭证解析与模型选择链路；Realtime 模型是另一项可选能力。
 */
export function useSpeechInput(
  options: UseSpeechInputOptions = {},
): UseSpeechInputReturn {
  const { timeoutMs = 60_000, onTranscribe, onError } = options;
  const [status, setStatus] = useState<SpeechInputStatus>("idle");
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timerRef.current = null;
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    recorderRef.current?.stop();
    clearRecording();
    setStatus("idle");
    setDuration(0);
    setTranscript("");
  }, [clearRecording]);

  const startRecording = useCallback(async () => {
    if (recorderRef.current || status === "transcribing") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      setStatus("recording");
      setDuration(0);
      setTranscript("");
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        clearRecording();
        if (!chunks.length) {
          setStatus("idle");
          return;
        }
        void (async () => {
          const controller = new AbortController();
          abortRef.current = controller;
          try {
            setStatus("transcribing");
            const blob = new Blob(chunks, { type: recorder.mimeType });
            const audio = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () => reject(new Error("无法读取录音"));
              reader.onload = () =>
                resolve(String(reader.result).split(",")[1] ?? "");
              reader.readAsDataURL(blob);
            });
            const response = await fetch("/api/ai/audio/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                audio,
                format: formatForMimeType(blob.type),
              }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error ?? "语音转写失败");
            const text = String(payload.data?.text ?? "").trim();
            if (!text) throw new Error("未识别到语音内容");
            setTranscript(text);
            onTranscribe?.(text);
            setStatus("idle");
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") return;
            const message =
              error instanceof Error ? error.message : "语音转写失败";
            setStatus("error");
            onError?.(message);
          }
        })();
      };
      recorder.start();
      timerRef.current = setInterval(
        () => setDuration((value) => value + 1),
        1000,
      );
      timeoutRef.current = setTimeout(() => recorder.stop(), timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法访问麦克风";
      setStatus("error");
      onError?.(message);
    }
  }, [clearRecording, onError, onTranscribe, status, timeoutMs]);

  const stopRecording = useCallback(() => recorderRef.current?.stop(), []);

  useEffect(() => () => reset(), [reset]);
  return {
    status,
    duration,
    transcript,
    startRecording,
    stopRecording,
    reset,
    setTranscript,
  };
}
