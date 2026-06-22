"use client";

import { useMemo, useState } from "react";
import { type Ticket, type TicketCreateUser, type TicketCreateResponsibility, type PushRecordSnapshot } from "@/entities/ticket/model/types";
import { TicketPushPanel } from "./TicketPushPanel";
import { PushConfirmModal } from "@/features/ticket/ui/modal/PushConfirmModal";
import { CommitDiffModal, type CommitSummary } from "@/features/ticket/ui/modal/CommitDiffModal";
import { branchStyle, repoStyle } from "@/shared/ui/repo-style";

type Props = {
  ticket: Ticket;
  users: TicketCreateUser[];
  programResponsibility: TicketCreateResponsibility | null;
  onMessage: (msg: string) => void;
  showBugPushModal?: boolean;
  onDismissBugPushModal?: () => void;
  onBugPushSuccess?: () => void;
};

export function ProgramTicketDetail({
  ticket,
  users,
  programResponsibility,
  onMessage,
  showBugPushModal,
  onDismissBugPushModal,
  onBugPushSuccess,
}: Props) {
  const [selectedCommit, setSelectedCommit] = useState<CommitSummary | null>(null);
  const [internalShowModal, setInternalShowModal] = useState(false);

  const showModal = showBugPushModal !== undefined ? showBugPushModal : internalShowModal;
  const onDismiss = onDismissBugPushModal || (() => setInternalShowModal(false));

  const bugResponsibility = useMemo(
    () => (ticket.project.responsibilities.find((r) => r.kind === "BUG") as TicketCreateResponsibility | undefined) ?? null,
    [ticket.project.responsibilities],
  );

  const allProjectModules = useMemo(
    () => ticket.project.responsibilities.flatMap((r) => r.modules),
    [ticket.project.responsibilities],
  );

  async function handleBugPush(options: {
    title: string;
    description: string;
    moduleId: string;
    newModuleName: string;
    assigneeIds: string[];
  }) {
    const res = await fetch(`/api/tickets/${ticket.ticketNo}/bug-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string })?.error || "推送Bug单失败");
    }
    const data = await res.json() as { bugTicket: { id: string; ticketNo: number; title: string } };

    const bindRes = await fetch(`/api/tickets/${ticket.ticketNo}/bug-relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bugTicketId: data.bugTicket.id,
        draftTitle: options.title,
      }),
    });
    if (!bindRes.ok) {
      const err = await bindRes.json().catch(() => ({}));
      throw new Error((err as { error?: string })?.error || "绑定失败");
    }

    onMessage(`Bug单 #${data.bugTicket.ticketNo} 已创建并绑定`);
    onDismiss();

    // 推送 Bug 单后自动保存已交付状态
    const statusRes = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DELIVERED" }),
    });
    if (statusRes.ok) {
      onMessage("状态已保存");
    }
    onBugPushSuccess?.();
  }

  async function handleBugPushDone() {
    onDismiss();
    const res = await fetch(`/api/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DELIVERED" }),
    });
    if (res.ok) {
      onMessage("状态已保存");
      onBugPushSuccess?.();
    } else {
      onMessage("状态保存失败");
    }
  }

  return (
    <>
      <TicketPushPanel
        ticketNo={ticket.ticketNo}
        ticketId={ticket.id}
        projectId={ticket.project.id}
        creatorId={ticket.creatorId}
        users={users}
        programResponsibility={programResponsibility}
        bugResponsibility={bugResponsibility}
        programPushDraft={{
          title: ticket.title,
          description: ticket.description || "",
          designAssigneeIds: ticket.assignees.map((a) => a.id),
          programAssigneeIds: [],
          moduleId: ticket.module.id,
          sourceModuleName: ticket.module.name,
        }}
        onMessage={onMessage}
        color="rose"
        allProjectModules={allProjectModules}
      />

      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-medium">历史提交</h2>
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-500">{ticket.commits.length}</span>
        </div>
        {ticket.commits.length === 0 ? (
          <p className="rounded-lg border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">暂无关联提交</p>
        ) : (
          <div className="space-y-2">
            {ticket.commits.map((commit) => {
              const repo = repoStyle(commit.repoPath);
              return (
                <button
                  key={commit.id}
                  type="button"
                  onClick={() => setSelectedCommit(commit)}
                  className={`w-full rounded-lg border border-ink-100 border-l-4 ${repo.border} p-3 text-left text-sm transition hover:border-ink-300 ${repo.card}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${repo.badge}`}>{repo.name}</span>
                      <span className="font-mono text-xs text-ink-500">{commit.commitSha.slice(0, 7)}</span>
                    </div>
                    <span className="shrink-0 text-xs text-ink-400">{new Date(commit.committedAt).toLocaleString()}</span>
                  </div>
                  {commit.branches.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {commit.branches.map((branch) => (
                        <span key={branch} className={`rounded px-2 py-0.5 text-xs ${branchStyle(branch)}`}>{branch}</span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-ink-700">{commit.subject}</p>
                  <p className="mt-1 text-xs text-ink-400">{commit.author}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {showModal && bugResponsibility && (
        <PushConfirmModal
          mode="bug"
          sourceTicket={{
            id: ticket.id,
            ticketNo: ticket.ticketNo,
            title: ticket.title,
            description: ticket.description,
            moduleId: ticket.module.id,
            moduleName: ticket.module.name,
            assigneeIds: ticket.assignees.map((a) => a.id),
          }}
          programModules={programResponsibility?.modules ?? []}
          responsibility={bugResponsibility}
          users={users}
          initialAssigneeIds={ticket.assignees.map((a) => a.id)}
          onPush={handleBugPush}
          onDone={handleBugPushDone}
          onCancel={onDismiss}
        />
      )}

      <CommitDiffModal commit={selectedCommit} onClose={() => setSelectedCommit(null)} />
    </>
  );
}
