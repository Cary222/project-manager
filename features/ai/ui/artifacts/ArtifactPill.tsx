/**
 * ArtifactPill - 浮动 Artifact 触发器
 * 参考 pi-web-ui ArtifactPill.ts
 */

'use client';

interface ArtifactPillProps {
  count: number;
  onClick: () => void;
}

export function ArtifactPill({ count, onClick }: ArtifactPillProps) {
  return (
    <button
      onClick={onClick}
      className="pointer-events-auto absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-brand-200 bg-white px-3 py-1.5 shadow-sm transition-all hover:shadow-md"
    >
      {/* Icon */}
      <svg
        className="h-3.5 w-3.5 text-brand-600"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>

      {/* Text */}
      <span className="text-xs font-medium text-ink-700">Artifacts</span>

      {/* Count Badge */}
      <span className="rounded bg-brand-100 px-1.5 py-0.5 font-mono text-[10px] leading-none tabular-nums text-brand-700">
        {count}
      </span>
    </button>
  );
}
