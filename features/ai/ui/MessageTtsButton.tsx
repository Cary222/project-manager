"use client";

import { useEffect, useRef, useState } from "react";
import { IconVolume, IconVolumeOff } from "@/shared/ui/icons";

interface MessageTtsButtonProps {
  content: string;
}

const BUTTON_CLASSES = "text-ink-400 hover:bg-ink-100 hover:text-ink-700";

export function MessageTtsButton({ content }: MessageTtsButtonProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 清理函数：组件卸载时停止播放
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  const handlePlay = async () => {
    // 正在播放时点击 → 停止
    if (isPlaying || isLoading) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsPlaying(false);
      setIsLoading(false);
      return;
    }

    // 开始播放
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/audio/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: content }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `请求失败: ${response.status}`);
      }

      const blob = await response.blob();
      const audioUrl = URL.createObjectURL(blob);

      // 创建 Audio 对象
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      // 监听播放结束
      audio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        setError("音频播放失败");
        URL.revokeObjectURL(audioUrl);
      };

      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
      setIsPlaying(false);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handlePlay}
      disabled={isLoading}
      className={`mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400/40 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_CLASSES}`}
      aria-label={isPlaying ? "停止播放" : isLoading ? "正在合成语音" : "朗读消息"}
      title={error ?? (isPlaying ? "停止播放" : "朗读消息")}
    >
      {isLoading ? (
        <span className="h-3 w-3 animate-pulse">
          <IconVolume className="h-3 w-3" />
        </span>
      ) : isPlaying ? (
        <IconVolumeOff className="h-3 w-3" />
      ) : (
        <IconVolume className="h-3 w-3" />
      )}
      <span>{isLoading ? "合成中..." : isPlaying ? "停止" : "朗读"}</span>
    </button>
  );
}
