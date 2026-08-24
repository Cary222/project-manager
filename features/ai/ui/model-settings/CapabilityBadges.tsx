"use client";

/**
 * Shared Model Settings — Capability 徽标（REFACTOR，新建）
 * 展示 capability / contextWindow / reasoning 元数据，供
 * Model Settings 与 UnifiedModelSelector 复用。
 */

export type CapabilityBadgeKind =
  | "fast"
  | "standard"
  | "strong"
  | "vision"
  | "reasoning"
  | "image"
  | "video"
  | "audio";

const BADGE_STYLES: Record<CapabilityBadgeKind, { background: string; color: string; label: string }> = {
  fast:      { background: "rgba(16,185,129,0.12)", color: "#059669", label: "快速" },
  standard:  { background: "rgba(107,114,128,0.12)", color: "#6b7280", label: "标准" },
  strong:    { background: "rgba(59,130,246,0.12)", color: "#2563eb", label: "强力" },
  vision:    { background: "rgba(168,85,247,0.12)", color: "#9333ea", label: "视觉" },
  reasoning: { background: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.9)", label: "推理" },
  image:     { background: "rgba(236,72,153,0.12)", color: "#db2777", label: "图像" },
  video:     { background: "rgba(245,158,11,0.12)", color: "#d97706", label: "视频" },
  audio:     { background: "rgba(20,184,166,0.12)", color: "#0d9488", label: "音频" },
};

export function CapabilityBadge({ kind }: { kind: CapabilityBadgeKind }) {
  const style = BADGE_STYLES[kind];
  if (!style) return null;
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 5px",
        background: style.background,
        color: style.color,
        borderRadius: 3,
        whiteSpace: "nowrap",
        flexShrink: 0,
        fontWeight: 500,
      }}
    >
      {style.label}
    </span>
  );
}

export function CapabilityBadges({ capabilities }: { capabilities: readonly CapabilityBadgeKind[] }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, flexWrap: "wrap" }}>
      {capabilities.map((kind) => <CapabilityBadge key={kind} kind={kind} />)}
    </span>
  );
}

/** 格式化 context window（如 128000 → 128K）。 */
export function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1_000_000) return `${Math.round(contextWindow / 1_000_000)}M`;
  if (contextWindow >= 1000) return `${Math.round(contextWindow / 1000)}K`;
  return String(contextWindow);
}

export function ContextWindowBadge({ contextWindow }: { contextWindow?: number }) {
  if (!contextWindow) return null;
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 5px",
        background: "var(--bg-hover)",
        color: "var(--text-dim)",
        borderRadius: 3,
        whiteSpace: "nowrap",
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
      }}
      title={`Context window: ${contextWindow.toLocaleString()}`}
    >
      {formatContextWindow(contextWindow)}
    </span>
  );
}
