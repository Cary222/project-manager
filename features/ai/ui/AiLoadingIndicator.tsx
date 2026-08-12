"use client";

import { ThinkingOrb } from "thinking-orbs";

export type LoadingType = "thinking" | "image" | "video";

interface AiLoadingIndicatorProps {
  type: LoadingType;
  /** 状态文字 */
  label?: string;
  /** 进度百分比（0-100），传入时显示真实进度条 */
  progress?: number;
  /** 仅用于图片/视频类型：预计尺寸（用于占位框） */
  aspectRatio?: "square" | "wide" | "portrait";
  /** 仅用于图片类型：预估宽度（px），用于样式提示 */
  estimatedWidth?: number;
  className?: string;
}

const DEFAULT_LABELS: Record<LoadingType, string> = {
  thinking: "思考中...",
  image: "正在生成图片...",
  video: "正在生成视频...",
};

export function AiLoadingIndicator({
  type,
  label,
  progress,
  aspectRatio = "square",
  estimatedWidth = 320,
  className = "",
}: AiLoadingIndicatorProps) {
  const displayLabel = label ?? DEFAULT_LABELS[type];

  if (type === "thinking") {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <ThinkingOrb state="working" size={64} />
        <span className="text-sm text-ink-secondary">{displayLabel}</span>
      </div>
    );
  }

  // 图片/视频占位动画：深色占位框 + 脉冲动画 + 状态文字
  const aspectClass = {
    square: "aspect-square",
    wide: "aspect-video",
    portrait: "aspect-[3/4]",
  }[aspectRatio];

  return (
    <div className={`flex flex-col items-start gap-2 ${className}`}>
      {/* 占位框 */}
      <div
        className={`relative overflow-hidden rounded-xl bg-ink-100 ${aspectClass}`}
        style={{ width: estimatedWidth, maxWidth: "100%" }}
      >
        {/* 脉冲背景 */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="h-full w-full animate-pulse rounded-xl bg-gradient-to-br from-ink-200/50 to-ink-100/30"
            style={{ animationDuration: "2s", animationIterationCount: "infinite" }}
          />
        </div>

        {/* 中心图标 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          {type === "image" ? (
            <svg
              className="h-8 w-8 text-ink-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          ) : (
            <svg
              className="h-8 w-8 text-ink-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}

          {/* 进度条 */}
          <div className="h-1 w-3/4 overflow-hidden rounded-full bg-ink-200/50">
            {progress !== undefined ? (
              // 真实进度条
              <div
                className="h-full rounded-full bg-brand-500 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            ) : (
              // 动画进度条
              <div
                className="h-full animate-progress-bar rounded-full bg-brand-400/60"
                style={{
                  animationDuration: "2s",
                  animationIterationCount: "infinite",
                }}
              />
            )}
          </div>

          {/* 百分比显示 */}
          {progress !== undefined && (
            <span className="text-xs font-medium text-ink-500">{progress}%</span>
          )}
        </div>
      </div>

      {/* 状态文字 */}
      <span className="text-sm text-ink-secondary">{displayLabel}</span>
    </div>
  );
}
