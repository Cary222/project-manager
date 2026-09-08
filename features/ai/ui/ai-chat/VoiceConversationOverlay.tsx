import { IconMicWave, IconX } from "@/shared/ui/icons";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";

export type VoiceChatStatus =
  | "connecting"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error";

const labels: Record<VoiceChatStatus, string> = {
  connecting: "正在连接…",
  listening: "正在聆听…",
  transcribing: "正在识别…",
  thinking: "正在思考…",
  speaking: "正在回答…",
  error: "语音服务出错",
};

export interface VoiceConversationOverlayProps {
  status: VoiceChatStatus;
  userText?: string;
  aiText?: string;
  onStop: () => void;
  onFinishSpeaking?: () => void;
}

export function VoiceConversationOverlay({
  status,
  userText,
  aiText,
  onStop,
  onFinishSpeaking,
}: VoiceConversationOverlayProps) {
  const active = status === "listening" || status === "speaking";
  const hasDialogue = Boolean(userText || aiText || status === "thinking");

  return (
    <div
      className="absolute inset-0 z-20 grid place-items-center bg-white/95 p-6 backdrop-blur-md motion-reduce:backdrop-blur-none"
      role="dialog"
      aria-modal="true"
      aria-label="语音对话"
    >
      <div className="flex w-full max-w-sm flex-col items-center text-center">
        <button
          type="button"
          onClick={status === "listening" ? onFinishSpeaking : undefined}
          disabled={status !== "listening"}
          className={`relative grid h-36 w-36 place-items-center rounded-full bg-gradient-to-br from-brand-400 via-brand-600 to-violet-600 shadow-xl transition-transform ${
            active ? "animate-pulse" : ""
          } ${status === "listening" ? "cursor-pointer hover:scale-105" : "cursor-default"}`}
          title={status === "listening" ? "直接说话或点击完成说话" : undefined}
          aria-label={status === "listening" ? "说完了" : "语音动画"}
        >
          <span className="absolute inset-[-12px] rounded-full border border-brand-300/60 animate-ping motion-reduce:animate-none" />
          <span className="absolute inset-[-28px] rounded-full border border-brand-200/60 animate-ping [animation-delay:300ms] motion-reduce:animate-none" />
          <IconMicWave className="relative h-12 w-12 text-white" />
        </button>

        <p
          className="mt-6 text-lg font-semibold text-ink-900"
          aria-live="polite"
        >
          {labels[status]}
        </p>
        <p className="mt-1 text-xs text-ink-500">
          {status === "listening"
            ? "直接说话，AI 会自动识别并实时语音回答。"
            : status === "transcribing"
              ? "正在将你的语音转换为文字…"
              : status === "thinking"
                ? "AI 正在组织回答…"
                : status === "speaking"
                  ? "AI 正在实时播报回复…"
                  : "语音文字会保留在当前对话中。"}
        </p>

        {/* 实时对话文字呈现区 */}
        {hasDialogue && (
          <div className="mt-4 flex w-full flex-col gap-2.5 rounded-2xl border border-ink-200/80 bg-ink-50/90 p-4 text-left shadow-2xs backdrop-blur-xs max-h-48 overflow-y-auto">
            {userText && (
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded-md bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                  你
                </span>
                <p className="text-xs font-medium text-ink-800 leading-relaxed break-words">
                  {userText}
                </p>
              </div>
            )}
            {aiText ? (
              <div
                className={`flex items-start gap-2 ${
                  userText ? "border-t border-ink-200/60 pt-2" : ""
                }`}
              >
                <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
                  小星
                </span>
                <div className="text-xs text-ink-900 leading-relaxed break-words flex-1 min-w-0 prose prose-xs max-w-none">
                  <MarkdownContent content={aiText} />
                  {(status === "thinking" || status === "speaking") && (
                    <span className="inline-block h-3 w-1 animate-pulse bg-brand-500 align-middle ml-0.5" />
                  )}
                </div>
              </div>
            ) : status === "thinking" ? (
              <div
                className={`flex items-start gap-2 ${
                  userText ? "border-t border-ink-200/60 pt-2" : ""
                }`}
              >
                <span className="shrink-0 rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
                  小星
                </span>
                <div className="flex items-center gap-1.5 text-xs text-ink-500 py-0.5">
                  <span className="flex h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                  <span>正在检索与组织回答…</span>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-2">
          {status === "listening" && onFinishSpeaking && (
            <button
              type="button"
              onClick={onFinishSpeaking}
              className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3.5 py-1.5 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
              aria-label="我说完了"
            >
              我说完了（立即发送）
            </button>
          )}
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-700 shadow-sm"
            aria-label="结束语音对话"
          >
            <IconX className="h-4 w-4" /> 结束对话
          </button>
        </div>
      </div>
    </div>
  );
}
