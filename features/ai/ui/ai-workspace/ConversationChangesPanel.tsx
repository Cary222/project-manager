"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "./hooks/useI18n";
import { getFileName } from "./lib/file-paths";
import {
  buildConversationChangeRows,
  loadConversationPaths,
  subscribeConversationChanges,
  type ConversationChangeRow,
} from "./lib/conversation-changes";
import type { GitStatusResponse } from "./lib/git-types";
import { getFileIcon } from "./FileIcons";

const GIT_STATUS_KEYS: Record<string, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

const GIT_STATUS_COLORS: Record<string, string> = {
  modified: "#d6a84b",
  added: "#4ade80",
  deleted: "#f87171",
  renamed: "#60a5fa",
  untracked: "#4ade80",
  conflict: "#f87171",
};

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse | null> {
  try {
    const params = new URLSearchParams({ cwd });
    const res = await fetch(`/api/git/status?${params.toString()}`);
    if (!res.ok) return null;
    return (await res.json()) as GitStatusResponse;
  } catch {
    return null;
  }
}

/**
 * Right-side panel listing the files the CURRENT conversation wrote, with
 * live git status badges. Clicking a changed file opens it in diff mode in
 * the viewer below; "clean" rows were resolved externally (committed,
 * reverted, or a branch switch) and open without a diff.
 */
export function ConversationChangesPanel({
  sessionId,
  cwd,
  activeTabId,
  refreshKey,
  onOpenFile,
}: {
  sessionId: string | null;
  cwd: string | null;
  activeTabId: string;
  /** Bumped by the explorer's manual refresh — reuse it to refetch status. */
  refreshKey: number;
  onOpenFile: (
    filePath: string,
    fileName: string,
    options?: { modeHint?: "diff"; sourceSessionId?: string | null },
  ) => void;
}) {
  const { t } = useI18n();
  const [pathsVersion, setPathsVersion] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const [git, setGit] = useState<GitStatusResponse | null>(null);

  // Live updates: ChatWindow persists the replayed path list while the agent
  // writes; this subscription re-reads localStorage as that happens.
  useEffect(() => subscribeConversationChanges(() => setPathsVersion((v) => v + 1)), []);

  useEffect(() => {
    if (!cwd) return;
    let cancelled = false;
    fetchGitStatus(cwd).then((status) => {
      if (!cancelled) setGit(status);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd, refreshKey, pathsVersion]);

  const touchedPaths = useMemo(
    () => (sessionId ? loadConversationPaths(sessionId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pathsVersion tracks external persistence
    [sessionId, pathsVersion],
  );

  const rows = useMemo(
    () => buildConversationChangeRows(touchedPaths, git),
    [touchedPaths, git],
  );

  const openRow = useCallback(
    (row: ConversationChangeRow) => {
      onOpenFile(row.displayPath, getFileName(row.displayPath), {
        sourceSessionId: sessionId,
        ...(row.status !== "clean" ? { modeHint: "diff" as const } : {}),
      });
    },
    [onOpenFile, sessionId],
  );

  if (!sessionId || rows.length === 0) return null;

  return (
    <div
      style={{
        flexShrink: 0,
        maxHeight: "40%",
        display: "flex",
        flexDirection: "column",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
          aria-hidden="true"
        >
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ flex: 1 }}>
          {t("changes.panelTitle")} ({rows.length})
        </span>
      </button>
      {expanded && (
        <div style={{ overflowY: "auto", minHeight: 0 }}>
          {rows.map((row) => {
            const selected = activeTabId === `file:${row.displayPath}`;
            return (
              <button
                key={row.filePath}
                type="button"
                title={row.filePath}
                aria-label={t("chat.openWrittenFile", { name: getFileName(row.displayPath) })}
                onClick={() => openRow(row)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  padding: "4px 10px",
                  background: selected ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
                  color: row.status === "clean" ? "var(--text-muted)" : "var(--text)",
                  fontSize: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  aria-label={
                    row.status === "clean" ? t("changes.resolved") : t(GIT_STATUS_KEYS[row.status])
                  }
                  title={row.status === "clean" ? t("changes.resolved") : t(GIT_STATUS_KEYS[row.status])}
                  style={{
                    width: 14,
                    height: 14,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    color:
                      row.status === "clean"
                        ? "var(--text-muted)"
                        : GIT_STATUS_COLORS[row.status],
                  }}
                >
                  {row.code || "✓"}
                </span>
                <span style={{ flexShrink: 0, display: "flex" }}>
                  {getFileIcon(getFileName(row.displayPath), 12)}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {getFileName(row.displayPath)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
