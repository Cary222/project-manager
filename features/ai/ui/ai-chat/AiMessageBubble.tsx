"use client";

import { useState } from "react";
import Image from "next/image";
import { AiResponsePanel } from "./AiResponsePanel";
import { ImageLightbox } from "@/shared/ui/ImageLightbox";
import { AiLoadingIndicator } from "./AiLoadingIndicator";
import type { TaskRecord } from "@/features/ai/types";
import type { SourceReference } from "./AiSourcesList";
import type { ClarificationSuggestion } from "@/features/ai/search/evidence-evaluator";

interface CandidateUser {
  id: string;
  label?: string;
  summary?: string;
  name?: string;
  email?: string;
  sublabel?: string;
}

interface AiMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  sources?: SourceReference[];
  candidates?: CandidateUser[];
  suggestions?: ClarificationSuggestion[];
  onSuggestionSelect?: (query: string) => void;
  isStreaming?: boolean;
  thinkingSteps?: TaskRecord[];
  totalThinkingMs?: number;
  /** 执行状态：QUEUED / PROCESSING / COMPLETED / FAILED */
  executionStatus?: string;
  /** 附件列表（生图模式使用） */
  attachments?: Array<{
    id: string;
    type: string;
    fileAssetId: string;
  }>;
  /** 用户上传的参考图列表（Image 模式，用于在对话气泡中展示） */
  userImages?: Array<{
    id: string;
    url: string;
    name: string;
  }>;
  onCandidateSelect?: (candidateId: string) => void;
  /** 加载指示器类型（用于 QUEUED/PROCESSING 状态） */
  loadingType?: "image" | "video";
  /** 进度信息（生图/视频模式使用） */
  progress?: {
    step: string;
    percent?: number;
    detail?: string;
  };
}

export function AiMessageBubble({
  role,
  content,
  sources,
  candidates,
  suggestions,
  onSuggestionSelect,
  isStreaming,
  thinkingSteps,
  totalThinkingMs,
  executionStatus,
  attachments,
  userImages,
  onCandidateSelect,
  loadingType = "image",
  progress,
}: AiMessageBubbleProps) {
  const isUserMessage = role === "user";
  const hasCandidates = candidates && candidates.length > 0;

  // Lightbox state for generated images
  const [lightboxImage, setLightboxImage] = useState<{ src: string; name: string } | null>(null);

  // Lightbox state for user uploaded reference images
  const [userImageLightbox, setUserImageLightbox] = useState<{ src: string; name: string } | null>(null);


  // User message: right-aligned bubble (max-w-[75%])
  if (isUserMessage) {
    return (
      <>
        <div className="flex justify-end">
          <div className="max-w-[75%]">
            {/* 用户上传的参考图（Image 模式） */}
            {userImages && userImages.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 justify-end">
                {userImages.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setUserImageLightbox({ src: img.url, name: img.name })}
                    className="group relative max-w-sm overflow-hidden rounded-lg border border-white/20 shadow-sm transition-all hover:shadow-md hover:scale-[1.02]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt={img.name}
                      className="max-h-48 object-contain"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 text-white text-sm bg-black/50 px-3 py-1 rounded-full transition-opacity">
                        点击放大
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="rounded-2xl bg-brand-600 px-4 py-2.5 text-white rounded-br-md">
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
            </div>
            <span className="mt-1 block text-[10px] text-ink-400">你</span>
          </div>
        </div>

        {/* ImageLightbox for user uploaded reference images */}
        {userImageLightbox && (
          <ImageLightbox
            image={userImageLightbox}
            onClose={() => setUserImageLightbox(null)}
            onDownload={() => {
              const a = document.createElement("a");
              a.href = userImageLightbox.src;
              a.download = userImageLightbox.name;
              a.click();
            }}
          />
        )}
      </>
    );
  }

  // AI message: Code Agent style — left-aligned full-width panel
  return (
    <div className="w-full">
      {/* Candidate selection buttons (Human-in-Loop) */}
      {!isStreaming && hasCandidates && onCandidateSelect && (
        <div className="mb-2 flex flex-col gap-1.5">
          {candidates!.map((candidate, index) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => onCandidateSelect(candidate.id)}
              className="w-full rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm transition-colors hover:border-warning/60 hover:bg-warning/20"
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded bg-warning/20 text-xs font-medium text-warning-foreground">
                {index + 1}
              </span>
              <span className="font-medium text-ink-900">{candidate.label ?? candidate.name}</span>
              {(candidate.email ?? candidate.sublabel) && (
                <span className="ml-2 text-xs text-ink-500">{candidate.email ?? candidate.sublabel}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <AiResponsePanel
        content={content}
        thinkingSteps={thinkingSteps}
        sources={sources}
        suggestions={suggestions}
        onSelectSuggestion={onSuggestionSelect}
        isStreaming={isStreaming}
        totalThinkingMs={totalThinkingMs}
      />

      {/* 执行状态指示器（QUEUED / PROCESSING）— 统一使用 AiLoadingIndicator */}
      {(executionStatus === "QUEUED" || executionStatus === "PROCESSING") && (
        <div className="mt-2">
          <AiLoadingIndicator
            type={loadingType}
            label={progress?.detail ?? (loadingType === "video" ? "正在生成视频..." : "正在生成图片...")}
            progress={progress?.percent}
            aspectRatio={loadingType === "video" ? "wide" : "square"}
            estimatedWidth={loadingType === "video" ? 480 : 320}
          />
        </div>
      )}

      {/* 生成完成后显示图片附件 */}
      {attachments && attachments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3">
          {attachments
            .filter((a) => a.type === "IMAGE")
            .map((att) => {
              const imgSrc = `/api/ai/file-assets/${att.fileAssetId}`;
              return (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => setLightboxImage({ src: imgSrc, name: `ai-image-${att.id}` })}
                  className="group relative max-w-sm overflow-hidden rounded-lg border border-ink-subtle shadow-sm transition-all hover:shadow-md hover:scale-[1.02]"
                >
                  <Image
                    src={imgSrc}
                    alt="AI 生成图片"
                    width={320}
                    height={320}
                    className="object-cover"
                    loading="lazy"
                    unoptimized
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 text-white text-sm bg-black/50 px-3 py-1 rounded-full transition-opacity">
                      点击放大
                    </span>
                  </div>
                </button>
              );
            })}

          {/* 视频附件 */}
          {attachments
            .filter((a) => a.type === "VIDEO")
            .map((att) => {
              const videoSrc = `/api/ai/file-assets/${att.fileAssetId}`;
              return (
                <video
                  key={att.id}
                  src={videoSrc}
                  controls
                  className="max-w-sm overflow-hidden rounded-lg border border-ink-subtle shadow-sm"
                >
                  您的浏览器不支持视频播放。
                </video>
              );
            })}
        </div>
      )}

      {/* ImageLightbox for zoom & download */}
      {lightboxImage && (
        <ImageLightbox
          image={lightboxImage}
          onClose={() => setLightboxImage(null)}
          onDownload={() => {
            const a = document.createElement("a");
            a.href = lightboxImage.src;
            a.download = lightboxImage.name;
            a.click();
          }}
        />
      )}

      {/* ImageLightbox for user uploaded reference images */}
      {userImageLightbox && (
        <ImageLightbox
          image={userImageLightbox}
          onClose={() => setUserImageLightbox(null)}
          onDownload={() => {
            const a = document.createElement("a");
            a.href = userImageLightbox.src;
            a.download = userImageLightbox.name;
            a.click();
          }}
        />
      )}
    </div>
  );
}
