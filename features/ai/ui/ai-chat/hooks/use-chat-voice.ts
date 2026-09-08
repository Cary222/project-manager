"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceInputStatus = "idle" | "recording" | "transcribing" | "error";
export type VoiceChatStatus =
  | "idle"
  | "recording"
  | "transcribing"
  | "generating"
  | "speaking"
  | "error";

type VoiceMode = "input" | "chat";

export interface UseChatVoiceOptions {
  onVoiceInput: (text: string) => void;
  onVoiceChat: (
    text: string,
    onDelta?: (delta: string, fullContent: string) => void,
  ) => Promise<string | null>;
  onError?: (message: string) => void;
  timeoutMs?: number;
  continuous?: boolean;
}

function audioFormat(mimeType: string): "webm" | "mp4" | "wav" {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

// SAFETY: WebKit prefix on older Safari browsers
interface WindowWithWebkitAudio extends Window {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

/**
 * 清洗 Markdown 格式字符，生成适合语音朗读的自然中文文本
 */
export function cleanMarkdownForTts(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*>\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/\n+/g, "，")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 分句检测：在流式生成过程中提取完整句子
 */
function splitSentence(
  buffer: string,
  isFirst = false,
): { sentence: string; rest: string } | null {
  if (isFirst) {
    const earlyMatch = buffer.match(/([。！？；，,：:\n]|\. |\! |\? |; )/);
    if (earlyMatch && earlyMatch.index !== undefined) {
      const splitPos = earlyMatch.index + earlyMatch[0].length;
      if (splitPos >= 4) {
        return {
          sentence: buffer.slice(0, splitPos),
          rest: buffer.slice(splitPos),
        };
      }
    }
    if (buffer.length >= 20) {
      return {
        sentence: buffer.slice(0, 20),
        rest: buffer.slice(20),
      };
    }
    return null;
  }

  const match = buffer.match(/([。！？；\n]|\. |\! |\? |; )/);
  if (!match || match.index === undefined) {
    if (buffer.length > 35) {
      const commaMatch = buffer.match(/([，,])/);
      if (
        commaMatch &&
        commaMatch.index !== undefined &&
        commaMatch.index >= 8
      ) {
        const splitPos = commaMatch.index + commaMatch[0].length;
        return {
          sentence: buffer.slice(0, splitPos),
          rest: buffer.slice(splitPos),
        };
      }
    }
    return null;
  }

  const splitPos = match.index + match[0].length;
  if (match[0] === "\n" && splitPos < 6) {
    return null;
  }

  return {
    sentence: buffer.slice(0, splitPos),
    rest: buffer.slice(splitPos),
  };
}

interface AudioQueueItem {
  rawText: string;
  sentence: string;
  promise: Promise<string | null>;
  controller: AbortController;
}

/**
 * 共享普通语音输入与语音对话生命周期。
 * 语音对话支持流式分句 TTS 播报与连续人机实时对话循环（无缝多轮 VAD 自动检测）。
 */
export function useChatVoice({
  onVoiceInput,
  onVoiceChat,
  onError,
  timeoutMs = 60_000,
  continuous = false,
}: UseChatVoiceOptions) {
  const [inputStatus, setInputStatus] = useState<VoiceInputStatus>("idle");
  const [inputDuration, setInputDuration] = useState(0);
  const [chatStatus, setChatStatus] = useState<VoiceChatStatus>("idle");
  const [isChatActive, setIsChatActive] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiResponseText, setAiResponseText] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<VoiceMode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationRef = useRef(0);
  const stopPlaybackRef = useRef<(() => void) | null>(null);
  const chatActiveRef = useRef(false);

  // VAD 静音检测持久化 Ref（在整个会话期间保持，避免多轮对话 AudioContext 挂起）
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vadAudioCtxRef = useRef<AudioContext | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef(0);
  const isListeningForSpeechRef = useRef(false);
  // 实时流式语音转写 Ref（Web Speech API 零延迟字级流式上屏）
  const speechRecognitionRef = useRef<{ stop: () => void } | null>(null);
  const realtimeTranscriptRef = useRef("");

  // 流式语音播放队列
  const audioQueueRef = useRef<AudioQueueItem[]>([]);
  const isPlayingQueueRef = useRef(false);
  const speechBufferRef = useRef("");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const llmDoneRef = useRef(false);
  const spokenTextRef = useRef("");

  // 避免递归访问 useCallback 导致 react-hooks/immutability 警告
  const startTurnRef = useRef<((mode: VoiceMode) => Promise<void>) | null>(
    null,
  );

  const isCurrentOperation = useCallback((operation: number) => {
    return operationRef.current === operation;
  }, []);

  const clearAudioQueue = useCallback(() => {
    for (const item of audioQueueRef.current) {
      item.controller.abort();
      void item.promise.then((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    }
    audioQueueRef.current = [];
    speechBufferRef.current = "";
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    isPlayingQueueRef.current = false;
  }, []);

  const stopVoiceChat = useCallback(() => {
    chatActiveRef.current = false;
    isListeningForSpeechRef.current = false;
    setIsChatActive(false);
    operationRef.current += 1;
    modeRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;

    if (timerRef.current) clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timerRef.current = null;
    timeoutRef.current = null;

    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }

    if (vadAudioCtxRef.current) {
      try {
        if (vadAudioCtxRef.current.state !== "closed") {
          void vadAudioCtxRef.current.close();
        }
      } catch {
        // ignore
      }
      vadAudioCtxRef.current = null;
    }
    vadAnalyserRef.current = null;

    if (recorderRef.current) {
      try {
        recorderRef.current.stop();
      } catch {
        // ignore
      }
      recorderRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
      speechRecognitionRef.current = null;
    }
    realtimeTranscriptRef.current = "";

    stopPlaybackRef.current?.();
    stopPlaybackRef.current = null;
    clearAudioQueue();

    setInputStatus("idle");
    setInputDuration(0);
    setChatStatus("idle");
    setUserTranscript("");
    setAiResponseText("");
  }, [clearAudioQueue]);

  const transcribe = useCallback(
    async (blob: Blob, operation: number) => {
      const controller = new AbortController();
      abortRef.current = controller;
      const audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("无法读取录音"));
        reader.onload = () =>
          resolve(String(reader.result).split(",")[1] ?? "");
        reader.readAsDataURL(blob);
      });
      if (!isCurrentOperation(operation)) {
        throw new DOMException("Cancelled", "AbortError");
      }

      const response = await fetch("/api/ai/audio/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ audio, format: audioFormat(blob.type) }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "语音转写失败");
      return String(payload.data?.text ?? "").trim();
    },
    [isCurrentOperation],
  );

  /**
   * 启动分句音频播放管道
   */
  /**
   * 检查是否整个回合（LLM 流式生成完毕 + 所有排队音频播放完毕）已彻底结束
   */
  const checkTurnCompletion = useCallback(
    (operation: number) => {
      if (
        llmDoneRef.current &&
        audioQueueRef.current.length === 0 &&
        !isPlayingQueueRef.current &&
        isCurrentOperation(operation) &&
        chatActiveRef.current
      ) {
        if (continuous) {
          setTimeout(() => {
            if (chatActiveRef.current && isCurrentOperation(operation)) {
              void startTurnRef.current?.("chat");
            }
          }, 250);
        } else {
          setChatStatus("idle");
        }
      }
    },
    [continuous, isCurrentOperation],
  );

  /**
   * 启动分句音频播放管道
   */
  const playQueueLoop = useCallback(
    async (operation: number) => {
      if (isPlayingQueueRef.current) return;
      isPlayingQueueRef.current = true;

      while (audioQueueRef.current.length > 0) {
        if (!isCurrentOperation(operation) || !chatActiveRef.current) break;
        const item = audioQueueRef.current.shift();
        if (!item) break;

        const url = await item.promise;
        if (!url || !isCurrentOperation(operation) || !chatActiveRef.current) {
          if (url) URL.revokeObjectURL(url);
          continue;
        }

        // 音字联动：音频开始发声的同时，将该句文字同步输出到界面！
        spokenTextRef.current += item.rawText;
        setAiResponseText(spokenTextRef.current);
        setChatStatus("speaking");
        const audio = new Audio(url);
        currentAudioRef.current = audio;

        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            audio.onended = null;
            audio.onerror = null;
            URL.revokeObjectURL(url);
            currentAudioRef.current = null;
            stopPlaybackRef.current = null;
            resolve();
          };
          stopPlaybackRef.current = () => {
            audio.pause();
            finish();
          };
          audio.onended = () => finish();
          audio.onerror = () => finish();
          void audio.play().catch(finish);
        });
      }

      isPlayingQueueRef.current = false;
      checkTurnCompletion(operation);
    },
    [checkTurnCompletion, isCurrentOperation],
  );

  /**
   * 将一段清洗后的完整句子送入流式合成队列并立即触发并发发声
   */
  const enqueueTtsSentence = useCallback(
    (rawText: string, operation: number) => {
      const clean = cleanMarkdownForTts(rawText);
      // 必须包含有效文本字符（避免只有逗号或标点导致 TTS 400 失败）
      if (!clean || !/[\p{L}\p{N}]{2,}/u.test(clean)) {
        spokenTextRef.current += rawText;
        setAiResponseText(spokenTextRef.current);
        return;
      }

      const controller = new AbortController();
      const promise = (async () => {
        try {
          const res = await fetch("/api/ai/audio/synthesize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              text: clean.length > 300 ? `${clean.slice(0, 300)}……` : clean,
            }),
          });
          if (!res.ok) return null;
          const blob = await res.blob();
          return URL.createObjectURL(blob);
        } catch {
          return null;
        }
      })();

      audioQueueRef.current.push({
        rawText,
        sentence: clean,
        promise,
        controller,
      });
      void playQueueLoop(operation);
    },
    [playQueueLoop],
  );

  /**
   * 获取或复用麦克风媒体流，并绑定持续监听的 AnalyserNode
   */
  const ensureStreamAndVad = useCallback(async (mode: VoiceMode) => {
    if (mode === "input") {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    let stream = streamRef.current;
    if (!stream || !stream.active) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
    }

    const win =
      typeof window !== "undefined"
        ? (window as WindowWithWebkitAudio)
        : undefined;
    const AudioContextClass = win?.AudioContext || win?.webkitAudioContext;

    if (AudioContextClass && !vadAudioCtxRef.current) {
      try {
        const audioCtx = new AudioContextClass();
        if (audioCtx.state === "suspended") {
          void audioCtx.resume();
        }
        vadAudioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        vadAnalyserRef.current = analyser;
      } catch {
        // fallback
      }
    }

    return stream;
  }, []);

  const startRecordingTurn = useCallback(
    async (mode: VoiceMode) => {
      // 如果已有活跃 recorder 正在录音，避免重叠
      if (recorderRef.current) {
        return;
      }

      const operation = operationRef.current + 1;
      operationRef.current = operation;
      clearAudioQueue();

      try {
        const stream = await ensureStreamAndVad(mode);
        if (!isCurrentOperation(operation)) {
          stream.getTracks().forEach((track) => track.stop());
          if (streamRef.current === stream) streamRef.current = null;
          return;
        }

        // 确保 AudioContext 处于 running 状态，避免第二轮对话被浏览器自动挂起
        if (
          vadAudioCtxRef.current &&
          vadAudioCtxRef.current.state === "suspended"
        ) {
          void vadAudioCtxRef.current.resume();
        }

        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        modeRef.current = mode;
        recorderRef.current = recorder;

        if (mode === "input") {
          setInputStatus("recording");
          setInputDuration(0);
        } else {
          setChatStatus("recording");
        }

        // 初始化本轮 VAD 检测状态
        hasSpokenRef.current = false;
        silenceStartRef.current = 0;
        isListeningForSpeechRef.current = mode === "chat";
        realtimeTranscriptRef.current = "";
        // 尝试启动浏览器原生实时流式语音转写（Chrome/Safari/Edge 毫秒级字级上屏）
        // SAFETY: Web Speech API constructor on window or webkit prefix
        const winWithSpeech =
          typeof window !== "undefined"
            ? (window as unknown as {
                SpeechRecognition?: new () => {
                  continuous: boolean;
                  interimResults: boolean;
                  lang: string;
                  onresult: ((event: unknown) => void) | null;
                  onerror: (() => void) | null;
                  onend: (() => void) | null;
                  start: () => void;
                  stop: () => void;
                };
                webkitSpeechRecognition?: new () => {
                  continuous: boolean;
                  interimResults: boolean;
                  lang: string;
                  onresult: ((event: unknown) => void) | null;
                  onerror: (() => void) | null;
                  onend: (() => void) | null;
                  start: () => void;
                  stop: () => void;
                };
              })
            : undefined;
        const SpeechRecognitionClass =
          winWithSpeech?.SpeechRecognition ||
          winWithSpeech?.webkitSpeechRecognition;

        if (SpeechRecognitionClass && mode === "chat") {
          try {
            const recognition = new SpeechRecognitionClass();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = "zh-CN";
            recognition.onresult = (event: unknown) => {
              const resList = (event as { results?: Array<Array<{ transcript?: string }>> })?.results;
              if (!resList) return;
              let accumulated = "";
              for (let i = 0; i < resList.length; i++) {
                accumulated += resList[i]?.[0]?.transcript || "";
              }
              if (accumulated.trim()) {
                hasSpokenRef.current = true;
                silenceStartRef.current = 0;
                realtimeTranscriptRef.current = accumulated;
                setUserTranscript(accumulated);
              }
            };
            recognition.onerror = () => {};
            recognition.onend = () => {};
            recognition.start();
            speechRecognitionRef.current = recognition;
          } catch {
            // fallback
          }
        }

        // 启动持续 VAD 静音监听计时器（若尚未启动）
        if (mode === "chat" && !vadIntervalRef.current) {
          const buffer = new Uint8Array(128);
          vadIntervalRef.current = setInterval(() => {
            if (!isListeningForSpeechRef.current || !recorderRef.current)
              return;
            if (!vadAnalyserRef.current) return;

            vadAnalyserRef.current.getByteTimeDomainData(buffer);
            let sum = 0;
            for (let i = 0; i < buffer.length; i++) {
              sum += Math.abs(buffer[i] - 128);
            }
            const avgDeviation = sum / buffer.length;

            // 能量偏离阈值（> 5 视为有人声输入）
            if (avgDeviation > 5) {
              if (!hasSpokenRef.current) {
                hasSpokenRef.current = true;
              }
              silenceStartRef.current = 0;
            } else if (hasSpokenRef.current) {
              // 人声说完后的静音计时
              if (silenceStartRef.current === 0) {
                silenceStartRef.current = Date.now();
              } else if (Date.now() - silenceStartRef.current > 1300) {
                // 静音达到 1.3 秒，判定为说完，停止录音转入回答
                isListeningForSpeechRef.current = false;
                hasSpokenRef.current = false;
                silenceStartRef.current = 0;
                if (recorderRef.current) {
                  recorderRef.current.stop();
                }
              }
            }
          }, 100);
        }

        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };

        recorder.onstop = () => {
          isListeningForSpeechRef.current = false;
          hasSpokenRef.current = false;
          silenceStartRef.current = 0;
          if (speechRecognitionRef.current) {
            try {
              speechRecognitionRef.current.stop();
            } catch {
              // ignore
            }
            speechRecognitionRef.current = null;
          }

          if (timerRef.current) clearInterval(timerRef.current);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timerRef.current = null;
          timeoutRef.current = null;

          recorderRef.current = null;
          const activeMode = modeRef.current;
          modeRef.current = null;
          if (activeMode === "input") {
            stream.getTracks().forEach((track) => track.stop());
            if (streamRef.current === stream) streamRef.current = null;
          }

          if (!activeMode || !isCurrentOperation(operation) || !chunks.length) {
            if (activeMode && isCurrentOperation(operation)) {
              if (activeMode === "input") {
                setInputStatus("idle");
              } else if (continuous && chatActiveRef.current) {
                void startTurnRef.current?.("chat");
              } else {
                setChatStatus("idle");
              }
            }
            return;
          }

          void (async () => {
            try {
              if (activeMode === "input") {
                setInputStatus("transcribing");
              } else {
                setChatStatus("transcribing");
              }

              let text = realtimeTranscriptRef.current.trim();
              if (!text) {
                text = await transcribe(
                  new Blob(chunks, { type: recorder.mimeType }),
                  operation,
                );
              }

              if (!isCurrentOperation(operation)) return;

              if (!text) {
                throw new Error("未识别到语音内容");
              }

              if (activeMode === "input") {
                onVoiceInput(text);
                setInputStatus("idle");
                return;
              }

              // 呈现实时识别的用户文字
              setUserTranscript(text);
              setAiResponseText("");
              setChatStatus("generating");
              speechBufferRef.current = "";

              let hasQueuedAnyAudio = false;
              llmDoneRef.current = false;
              spokenTextRef.current = "";
              let isFirstSentence = true;

              // 发送至当前选中的语言模型，在生成过程中实时分句并立即异步合成发声
              const response = await onVoiceChat(text, (delta) => {
                if (!isCurrentOperation(operation)) return;
                speechBufferRef.current += delta;

                // 尝试提取完整句子流式送入 TTS 并立即发声
                let extracted = splitSentence(speechBufferRef.current, isFirstSentence);
                while (extracted) {
                  speechBufferRef.current = extracted.rest;
                  hasQueuedAnyAudio = true;
                  enqueueTtsSentence(extracted.sentence, operation);
                  isFirstSentence = false;
                  extracted = splitSentence(speechBufferRef.current, isFirstSentence);
                }
              });

              if (!isCurrentOperation(operation) || !chatActiveRef.current) {
                return;
              }

              // 处理剩余未分句的尾部文本
              const remaining = speechBufferRef.current.trim();
              if (remaining) {
                speechBufferRef.current = "";
                hasQueuedAnyAudio = true;
                enqueueTtsSentence(remaining, operation);
              } else if (!hasQueuedAnyAudio && response) {
                // 若没有分句命中（如无标点短句），直接全量播报
                enqueueTtsSentence(response, operation);
              }

              llmDoneRef.current = true;
              if (response && audioQueueRef.current.length === 0 && !isPlayingQueueRef.current) {
                setAiResponseText(response);
              }
              checkTurnCompletion(operation);
            } catch (error) {
              if (error instanceof Error && error.name === "AbortError") return;
              if (!isCurrentOperation(operation)) return;
              const message =
                error instanceof Error ? error.message : "语音服务失败";
              onError?.(message);
              if (activeMode === "input") {
                setInputStatus("error");
              } else {
                setChatStatus("error");
              }
            }
          })();
        };

        recorder.start();
        timerRef.current = setInterval(() => {
          if (mode === "input") setInputDuration((value) => value + 1);
        }, 1000);
        timeoutRef.current = setTimeout(() => {
          if (recorderRef.current) {
            recorderRef.current.stop();
          }
        }, timeoutMs);
      } catch (error) {
        if (!isCurrentOperation(operation)) return;
        const message =
          error instanceof Error ? error.message : "无法访问麦克风";
        onError?.(message);
        if (mode === "input") {
          setInputStatus("error");
        } else {
          setChatStatus("error");
          chatActiveRef.current = false;
          setIsChatActive(false);
        }
      }
    },
    [
      checkTurnCompletion,
      clearAudioQueue,
      continuous,
      enqueueTtsSentence,
      ensureStreamAndVad,
      isCurrentOperation,
      onError,
      onVoiceChat,
      onVoiceInput,
      timeoutMs,
      transcribe,
    ],
  );

  useEffect(() => {
    startTurnRef.current = startRecordingTurn;
  }, [startRecordingTurn]);

  const toggleInput = useCallback(() => {
    if (inputStatus === "recording") recorderRef.current?.stop();
    else void startRecordingTurn("input");
  }, [inputStatus, startRecordingTurn]);

  // 手动快速完成说话（跳过静音等待）
  const finishSpeaking = useCallback(() => {
    if (recorderRef.current && isListeningForSpeechRef.current) {
      isListeningForSpeechRef.current = false;
      recorderRef.current.stop();
    }
  }, []);

  const toggleChat = useCallback(() => {
    if (chatActiveRef.current && recorderRef.current) {
      finishSpeaking();
    } else if (chatActiveRef.current) {
      stopVoiceChat();
    } else {
      chatActiveRef.current = true;
      setIsChatActive(true);
      setUserTranscript("");
      setAiResponseText("");
      void startRecordingTurn("chat");
    }
  }, [finishSpeaking, startRecordingTurn, stopVoiceChat]);

  useEffect(() => () => stopVoiceChat(), [stopVoiceChat]);

  return {
    inputStatus,
    inputDuration,
    chatStatus,
    isChatActive,
    userTranscript,
    aiResponseText,
    toggleInput,
    toggleChat,
    finishSpeaking,
    stopVoiceChat,
  };
}
