"use client";

import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useResizablePanel } from "./useResizablePanel";
import "./workspace-layout.css";

const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 420;

const RIGHT_PANEL_DEFAULT_WIDTH = 360;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 600;

interface AiWorkspaceLayoutProps {
  sidebar: ReactNode;
  children: ReactNode;
  rightPanel?: ReactNode;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  rightPanelOpen?: boolean;
  onToggleRightPanel?: () => void;
  topBarCenter?: ReactNode;
  topBarRight?: ReactNode;
  className?: string;
}

export function AiWorkspaceLayout({
  sidebar,
  children,
  rightPanel,
  sidebarOpen,
  onToggleSidebar,
  rightPanelOpen = false,
  onToggleRightPanel,
  topBarCenter,
  topBarRight,
  className = "",
}: AiWorkspaceLayoutProps) {
  const sidebarPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  const [sidebarWidth, isSidebarResizing, sidebarSeparatorProps] = useResizablePanel({
    ariaLabel: "调整侧边栏宽度",
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH,
    growthDirection: "right",
    storageKey: "pm-ai-sidebar-width",
    panelRef: sidebarPanelRef,
  });

  const [rightPanelWidth, isRightPanelResizing, rightPanelSeparatorProps] = useResizablePanel({
    ariaLabel: "调整右侧辅助面板宽度",
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_DEFAULT_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    growthDirection: "left",
    storageKey: "pm-ai-right-panel-width",
    panelRef: rightPanelRef,
  });

  // Shortcut: Cmd+B / Ctrl+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        onToggleSidebar();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggleSidebar]);

  return (
    <div
      className={`relative flex h-full w-full min-h-0 overflow-hidden bg-white ${className}`}
    >
      {/* Mobile Drawer Backdrop */}
      {sidebarOpen && (
        <div
          className="ai-sidebar-mobile-backdrop md:hidden"
          onClick={onToggleSidebar}
          aria-hidden="true"
        />
      )}

      {/* Left Panel: Conversation History */}
      <aside
        ref={sidebarPanelRef}
        id="ai-sidebar-container"
        suppressHydrationWarning
        className={`ai-sidebar-container ${
          sidebarOpen ? "ai-sidebar-open" : "ai-sidebar-closed"
        } ${isSidebarResizing ? "ai-sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarWidth}px`,
        } as React.CSSProperties}
      >
        <div className="h-full w-full overflow-hidden border-r border-ink-200 bg-ink-50/50">
          {sidebar}
        </div>
      </aside>

      {/* Sidebar Resize Handle */}
      {sidebarOpen && (
        <div
          {...sidebarSeparatorProps}
          suppressHydrationWarning
          className={`ai-panel-resize-handle ${
            isSidebarResizing ? "is-resizing" : ""
          }`}
          title="拖拽调整侧边栏宽度"
        />
      )}

      {/* Center Main Panel */}
      <main className="flex flex-1 min-w-0 flex-col h-full overflow-hidden bg-white">
        {/* Global Top Bar */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-ink-100 px-3 bg-white/80 backdrop-blur-xs z-10">
          <div className="flex items-center gap-2">
            {/* Sidebar Toggle Button (Similar to ChatGPT top-left sidebar icon) */}
            <button
              type="button"
              onClick={onToggleSidebar}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 hover:bg-ink-100 hover:text-ink-800 transition"
              title={sidebarOpen ? "收起侧边栏 (Cmd+B)" : "展开侧边栏 (Cmd+B)"}
              aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>

            {topBarCenter}
          </div>

          <div className="flex items-center gap-2">
            {topBarRight}

            {/* Right Panel Toggle Button */}
            {onToggleRightPanel && (
              <button
                type="button"
                onClick={onToggleRightPanel}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition ${
                  rightPanelOpen
                    ? "bg-brand-50 text-brand-700 hover:bg-brand-100"
                    : "text-ink-500 hover:bg-ink-100 hover:text-ink-800"
                }`}
                title={rightPanelOpen ? "收起辅助面板" : "展开辅助面板"}
                aria-label={rightPanelOpen ? "收起辅助面板" : "展开辅助面板"}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="15" y1="3" x2="15" y2="21" />
                </svg>
              </button>
            )}
          </div>
        </header>

        {/* Center Main View Content */}
        <div className="flex-1 min-h-0 overflow-hidden relative">
          {children}
        </div>
      </main>

      {/* Right Panel Resize Handle */}
      {rightPanel && rightPanelOpen && (
        <div
          {...rightPanelSeparatorProps}
          suppressHydrationWarning
          className={`ai-panel-resize-handle ${
            isRightPanelResizing ? "is-resizing" : ""
          }`}
          title="拖拽调整辅助面板宽度"
        />
      )}

      {/* Right Inspector Panel */}
      {rightPanel && (
        <aside
          ref={rightPanelRef}
          id="ai-right-panel-container"
          suppressHydrationWarning
          className={`ai-right-panel-container ${
            rightPanelOpen ? "ai-right-panel-open" : "ai-right-panel-closed"
          } ${isRightPanelResizing ? "ai-right-panel-resizing" : ""}`}
          style={{
            "--right-panel-width": `${rightPanelWidth}px`,
          } as React.CSSProperties}
        >
          <div className="h-full w-full overflow-hidden border-l border-ink-200 bg-white">
            {rightPanel}
          </div>
        </aside>
      )}
    </div>
  );
}
