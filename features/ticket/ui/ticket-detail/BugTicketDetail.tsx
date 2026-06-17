"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { type Ticket } from "@/entities/ticket/model/types";
import { type CommitSummary } from "@/features/ticket/ui/modal/CommitDiffModal";
import { CommitList } from "@/features/repo/ui/CommitList";
import { CommitDiffModal } from "@/features/ticket/ui/modal/CommitDiffModal";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";

type Props = {
  ticketId: string;
  ticket: Ticket;
  onMessage: (msg: string) => void;
};

export function BugTicketDetail({ ticketId, ticket, onMessage }: Props) {
  const [selectedCommit, setSelectedCommit] = useState<CommitSummary | null>(null);
  const sourceInfo = ticket.bugSources?.[0];

  const { data: fixData } = useSWR<{ fixCommits: (CommitSummary & { id?: string })[] }>(
    `/api/tickets/${ticketId}/bug-fix-commits`,
    fetchJson,
    STALE_SWR_OPTIONS,
  );

  const fixCommits = fixData?.fixCommits ?? [];

  // Merge ticket.commits (synced from git) with fix commits, dedup by sha
  const allCommits = [
    ...ticket.commits,
    ...fixCommits.filter(
      (fc) => !ticket.commits.some((tc) => (tc.commitSha || "").startsWith(fc.commitSha.slice(0, 7)))
    ),
  ].sort((a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime());

  return (
    <>
      {/* 程序绑定 — shows source program ticket or empty state */}
      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">程序绑定</h2>
            <p className="mt-1 text-sm text-ink-500">
              {sourceInfo ? "此 Bug 单由程序单推送" : "暂无绑定的程序单"}
            </p>
          </div>
          {sourceInfo && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
              来源 #{sourceInfo.programTicket.ticketNo}
            </span>
          )}
        </div>

        {sourceInfo ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm">
              <p className="mt-1 text-ink-600">
                <span className="font-medium">单号：</span>#{sourceInfo.programTicket.ticketNo}
              </p>
              <p className="mt-1 text-ink-600">
                <span className="font-medium">标题：</span>{sourceInfo.programTicket.title}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/tickets/${sourceInfo.programTicket.id}`} className="inline-flex justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                查看程序单
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-400">暂无绑定的程序单</p>
        )}
      </section>

      {/* 修复记录 — merged from git sync + fix commit search */}
      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">修复记录</h2>
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-500">{allCommits.length}</span>
        </div>
        <CommitList
          commits={allCommits}
          onCommitClick={setSelectedCommit}
        />
      </section>

      <CommitDiffModal commit={selectedCommit} onClose={() => setSelectedCommit(null)} />
    </>
  );
}
