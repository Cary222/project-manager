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

type FixCommit = CommitSummary & { id: string };

export function BugTicketDetail({ ticketId, ticket, onMessage }: Props) {
  const [selectedCommit, setSelectedCommit] = useState<CommitSummary | null>(null);
  const sourceInfo = ticket.bugSources?.[0];
  const fixCommitPattern = /(?<=[\u4e00-\u9fa5a-zA-Z\s]|^)fix(?::|：|$|[\s\u4e00-\u9fa5])/i;
  const ticketFixCommits = ticket.commits.filter((c) => fixCommitPattern.test(c.subject));

  const { data: fixData } = useSWR<{ fixCommits: FixCommit[] }>(
    `/api/tickets/${ticketId}/bug-fix-commits`,
    fetchJson,
    STALE_SWR_OPTIONS,
  );
  const fixCommits = fixData?.fixCommits ?? [];

  const allFixCommits = [
    ...ticketFixCommits,
    ...fixCommits.filter(
      (fc) => !ticketFixCommits.some((tc) => (tc.commitSha || "").startsWith(fc.commitSha.slice(0, 7)))
    ),
  ];

  return (
    <>
      {sourceInfo && (
        <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">来源程序单</h2>
              <p className="mt-1 text-sm text-ink-500">此 Bug 单由程序单推送</p>
            </div>
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
              来源 #{sourceInfo.programTicket.ticketNo}
            </span>
          </div>
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
        </section>
      )}

      {allFixCommits.length > 0 && (
        <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
          <div className="mb-4">
            <h2 className="font-medium">修复提交记录</h2>
            <p className="mt-1 text-sm text-ink-400">{allFixCommits.length} 条 fix 提交</p>
          </div>
          <CommitList
            commits={allFixCommits}
            onCommitClick={setSelectedCommit}
            borderColor="border-dashed border-ink-200"
          />
        </section>
      )}

      <CommitDiffModal commit={selectedCommit} onClose={() => setSelectedCommit(null)} />
    </>
  );
}
