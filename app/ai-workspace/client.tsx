'use client';

import { Component, Suspense, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell as PiWebAppShell } from "@/features/ai/ui/ai-workspace/AppShell";
import { AppShell as SiteAppShell } from "@/shared/ui/AppShell";
import "@/features/ai/ui/ai-workspace/styles/pi-web.css";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class AiWorkspaceErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[AI Workspace] Render error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="pi-web-root h-screen w-screen flex flex-col items-center justify-center gap-4 p-8" style={{ background: "var(--bg)", color: "var(--text)" }}>
          <div className="font-semibold text-lg text-red-500">Something went wrong</div>
          <div className="text-sm font-mono max-w-lg text-center" style={{ color: "var(--text-muted)" }}>
            {this.state.error?.message ?? "Unknown error"}
          </div>
          <button
            className="mt-2 px-4 py-2 rounded-md transition-colors"
            style={{ background: "var(--accent)", color: "white" }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AiWorkspaceFallback() {
  return (
    <div className="pi-web-root h-screen w-screen flex items-center justify-center" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>
      <div>Loading AI Workspace...</div>
    </div>
  );
}

/**
 * 两种显示模式：
 * - 嵌入（默认，/ai-workspace）：工作区收缩在网站侧边栏 + 顶栏之下
 * - 全屏（/ai-workspace?fullscreen=1）：工作区独占整个视口
 */
function AiWorkspaceInner() {
  const searchParams = useSearchParams();
  const embedded = searchParams.get("fullscreen") !== "1";

  if (!embedded) {
    return <PiWebAppShell />;
  }

  return (
    <SiteAppShell
      header={
        <div>
          <h1 className="text-lg font-semibold leading-tight">AI Workspace</h1>
          <p className="text-xs text-ink-400">小星：star · AI 助手工作区</p>
        </div>
      }
    >
      {/* --app-viewport-height 覆盖到容器高度，避免工作区内部再用整屏高度撑破面板 */}
      <div
        className="h-[calc(100dvh-6rem)] overflow-hidden rounded-2xl border border-ink-200 shadow-sm sm:h-[calc(100dvh-7rem)]"
        style={{ "--app-viewport-height": "100%" } as CSSProperties}
      >
        <PiWebAppShell />
      </div>
    </SiteAppShell>
  );
}

export function AiWorkspaceClient() {
  return (
    <AiWorkspaceErrorBoundary>
      <Suspense fallback={<AiWorkspaceFallback />}>
        <AiWorkspaceInner />
      </Suspense>
    </AiWorkspaceErrorBoundary>
  );
}
