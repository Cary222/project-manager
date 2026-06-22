"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  type TicketCreateUser,
  type ProgramPushDraft,
  type TicketCreateResponsibility,
  type PushRecordSnapshot,
  type BugRelation,
  type BugResolveResponse,
} from "@/entities/ticket/model/types";
import { CreateTicketForm } from "@/features/ticket/create";
import { fetchJson } from "@/shared/api/fetch-json";
import { STALE_SWR_OPTIONS } from "@/shared/api/swr-config";

type PushResolveMode = "bound" | "candidate" | "unbound";

type Props = {
  ticketNo: number;
  ticketId: string;
  projectId: string;
  creatorId: string;
  users: TicketCreateUser[];
  programResponsibility: TicketCreateResponsibility | null;
  bugResponsibility?: TicketCreateResponsibility | null;
  programPushDraft: ProgramPushDraft | null;
  onMessage: (msg: string) => void;
  color?: "emerald" | "rose";
  /** All modules from this project (across all responsibilities) for the create form dropdown */
  allProjectModules?: { id: string; name: string }[];
};

export function TicketPushPanel({
  ticketNo,
  ticketId,
  projectId,
  creatorId,
  users,
  programResponsibility,
  bugResponsibility = null,
  programPushDraft,
  onMessage,
  color = "emerald",
  allProjectModules,
}: Props) {
  const isBug = color === "rose";

  // ---- SWR data ----

  // Design ticket: push record
  const { data: pushRecordData, mutate: refreshPushRecord } = useSWR<{ record?: PushRecordSnapshot | null }>(
    !isBug ? `/api/tickets/${ticketNo}/push-record` : null,
    fetchJson,
    STALE_SWR_OPTIONS,
  );

  // Program ticket: bug bindings
  const { data: bugBindingsData, mutate: refreshBugBindings } = useSWR<{ bindings: BugRelation[] }>(
    isBug ? `/api/tickets/${ticketNo}/bug-relations` : null,
    fetchJson,
    STALE_SWR_OPTIONS,
  );

  // Derive push state from SWR data (design ticket)
  const pushRecord = pushRecordData?.record ?? null;
  const pushedTicket = pushRecord?.targetTicket ?? null;
  const isPushBound = !!pushRecord?.targetTicket;

  // Derive bug bindings from SWR data (program ticket)
  const bugBindings = bugBindingsData?.bindings ?? [];

  // ---- UI state ----
  const [showForm, setShowForm] = useState(false);
  const [showBugForm, setShowBugForm] = useState(false);

  // Design ticket: interactive form state
  const [pushResolveMode, setPushResolveMode] = useState<PushResolveMode>(
    isPushBound ? "bound" : "unbound",
  );
  const [candidateTicket, setCandidateTicket] = useState<{ id: string; ticketNo: number; title: string } | null>(null);
  const [retryDraft, setRetryDraft] = useState<ProgramPushDraft | null>(null);

  // Program ticket: interactive form state
  const [bugCandidateTicket, setBugCandidateTicket] = useState<{ id: string; ticketNo: number; title: string } | null>(null);
  const [bugDraft, setBugDraft] = useState<ProgramPushDraft | null>(null);
  const [bugSearchMissed, setBugSearchMissed] = useState(false);
  const [fixCommitInfo, setFixCommitInfo] = useState<{
    count: number;
    fixCommitIds: string[];
    commits: { id: string; commitSha: string; subject: string; author: string; committedAt: string }[];
  } | null>(null);

  // Sync push resolve mode when SWR data changes
  const draft = retryDraft ?? programPushDraft;

  const badgeStyles = isBug
    ? { badge: "bg-rose-100 text-rose-700", label: "Bug 单", label2: "Bug 绑定" }
    : { badge: "bg-emerald-100 text-emerald-700", label: "程序单", label2: "程序单" };

  // ---- Design ticket handlers ----

  async function openPushForm() {
    try {
      const res = await fetch(`/api/tickets/${ticketNo}/push-record/resolve`);
      if (!res.ok) throw new Error("查询失败");
      const data = await res.json() as {
        mode: PushResolveMode;
        targetTicket?: { id: string; ticketNo: number; title: string };
        candidateTicket?: { id: string; ticketNo: number; title: string };
        record?: PushRecordSnapshot;
      };
      if (data.mode === "bound" && data.targetTicket) {
        setPushResolveMode("bound");
        setRetryDraft(data.record ? {
          title: data.record.draftTitle,
          description: data.record.draftDescription || "",
          designAssigneeIds: data.record.designAssigneeIds,
          programAssigneeIds: data.record.programAssigneeIds,
        } : null);
        // Trigger SWR revalidation so pushedTicket/pushRecord update from cache
        await refreshPushRecord();
      } else if (data.mode === "candidate" && data.candidateTicket) {
        setPushResolveMode("candidate");
        setCandidateTicket(data.candidateTicket);
        if (data.record) {
          setRetryDraft({
            title: data.record.draftTitle,
            description: data.record.draftDescription || "",
            designAssigneeIds: data.record.designAssigneeIds,
            programAssigneeIds: data.record.programAssigneeIds,
          });
        }
      } else {
        setPushResolveMode("unbound");
        setShowForm(true);
      }
    } catch {
      setPushResolveMode("unbound");
      setShowForm(true);
    }
  }

  async function handleBindCandidate() {
    if (!candidateTicket || !retryDraft) return;
    const res = await fetch(`/api/tickets/${ticketNo}/push-record/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetTicketId: candidateTicket.id,
        draftTitle: retryDraft.title,
        draftDescription: retryDraft.description,
        programAssigneeIds: retryDraft.programAssigneeIds,
        designAssigneeIds: retryDraft.designAssigneeIds,
      }),
    });
    if (!res.ok) { onMessage("绑定失败"); return; }
    const data = await res.json() as { record: PushRecordSnapshot };
    await refreshPushRecord();
    setPushResolveMode("bound");
    setCandidateTicket(null);
    onMessage(`已绑定 ${badgeStyles.label} #${candidateTicket.ticketNo}`);
  }

  async function handleCreateTicket(payload: {
    ticket: { id: string; ticketNo: number; title: string };
    programAssigneeIds: string[];
    designAssigneeIds: string[];
    title: string;
    description: string;
  }) {
    const res = await fetch(`/api/tickets/${ticketNo}/push-record/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "SUCCEEDED",
        draftTitle: payload.title,
        draftDescription: payload.description,
        programAssigneeIds: payload.programAssigneeIds,
        designAssigneeIds: payload.designAssigneeIds,
        targetTicketId: payload.ticket.id,
      }),
    });
    if (!res.ok) { onMessage("创建失败"); return; }
    const data = await res.json() as { record: PushRecordSnapshot };
    await refreshPushRecord();
    setPushResolveMode("bound");
    setShowForm(false);
    onMessage(`${badgeStyles.label} #${payload.ticket.ticketNo} 已创建并绑定`);
  }

  // ---- Program ticket handlers ----

  useEffect(() => {
    if (!bugSearchMissed) return;
    const timer = setTimeout(() => setBugSearchMissed(false), 3000);
    return () => clearTimeout(timer);
  }, [bugSearchMissed]);

  async function openBugSearch() {
    try {
      setBugSearchMissed(false);
      const res = await fetch(`/api/tickets/${ticketNo}/bug-relations/resolve`);
      if (!res.ok) throw new Error("查询失败");
      const data = await res.json() as BugResolveResponse;

      setFixCommitInfo(data.fixCommitCount && data.fixCommitCount > 0
        ? {
            count: data.fixCommitCount ?? 0,
            fixCommitIds: data.fixCommitIds ?? [],
            commits: data.fixCommits ?? [],
          }
        : null);

      if (data.mode === "candidate" && data.candidateTicket) {
        setBugCandidateTicket(data.candidateTicket);
        setBugSearchMissed(false);
        setBugDraft(programPushDraft ?? {
          title: data.candidateTicket.title,
          description: "",
          designAssigneeIds: [],
          programAssigneeIds: [],
        });
      } else if (data.shouldAutoCreate && data.fixCommits && data.fixCommits.length > 0) {
        const fixDescription = data.fixCommits.length === 1
          ? `## Fix 信息\n\n- 提交: \`${data.fixCommits[0].commitSha}\`\n- 主题: ${data.fixCommits[0].subject}\n- 作者: ${data.fixCommits[0].author}\n- 时间: ${new Date(data.fixCommits[0].committedAt).toLocaleString()}\n- 仓库: ${data.fixCommits[0].repoPath}\n`
          : `## Fix 信息（${data.fixCommits.length} 条）\n\n${data.fixCommits.map((c, i) => `${i + 1}. \`${c.commitSha}\` - ${c.subject}`).join("\n")}\n`;

        setBugCandidateTicket(null);
        setBugSearchMissed(false);
        setShowBugForm(true);
        setBugDraft(programPushDraft ? {
          ...programPushDraft,
          description: programPushDraft.description
            ? `${programPushDraft.description}\n\n${fixDescription}`
            : fixDescription,
        } : {
          title: "",
          description: fixDescription,
          designAssigneeIds: [],
          programAssigneeIds: [],
        });
      } else {
        // 没有候选 Bug 单，且没有 fix 提交引导：只提示，不主动拉出新建表单
        setBugCandidateTicket(null);
        setBugSearchMissed(true);
        setBugDraft(programPushDraft ?? {
          title: "",
          description: "",
          designAssigneeIds: [],
          programAssigneeIds: [],
        });
      }
    } catch {
      setBugCandidateTicket(null);
      setBugSearchMissed(true);
    }
  }

  function openBugForm() {
    setBugCandidateTicket(null);
    setFixCommitInfo(null);
    setShowBugForm(true);
    setBugDraft(programPushDraft ?? {
      title: "",
      description: "",
      designAssigneeIds: [],
      programAssigneeIds: [],
    });
  }

  async function handleBindBugCandidate() {
    if (!bugCandidateTicket) return;

    const res = await fetch(`/api/tickets/${ticketNo}/bug-relations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bugTicketId: bugCandidateTicket.id,
        draftTitle: bugCandidateTicket.title,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      onMessage(err.error || "绑定失败");
      return;
    }

    onMessage(`已绑定 Bug 单 #${bugCandidateTicket.ticketNo}`);
    setBugCandidateTicket(null);
    setFixCommitInfo(null);
    setBugSearchMissed(false);
    await refreshBugBindings();
  }

  // `createBugTicketAction` already creates the BugProgramBinding inside its
  // transaction, so this callback only needs to update local UI state and
  // revalidate the bug bindings list — no extra fetch to /bug-relations.
  async function handleBindNewBug(payload: {
    ticket: { id: string; ticketNo: number; title: string };
    title: string;
    description: string;
  }) {
    onMessage(`Bug 单 #${payload.ticket.ticketNo} 已创建并绑定`);
    setShowBugForm(false);
    setBugCandidateTicket(null);
    setFixCommitInfo(null);
    setBugSearchMissed(false);
    await refreshBugBindings();
  }

  async function handleUnbindBug(bindingId: string) {
    const res = await fetch(`/api/tickets/${ticketNo}/bug-relations/actions?bindingId=${encodeURIComponent(bindingId)}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      onMessage("解绑失败");
      return;
    }

    onMessage("已解绑 Bug 单");
    await refreshBugBindings();
  }

  // ---- Render: Program ticket (rose) ----
  if (isBug) {
    return (
      <>
        {/* Bug bindings list */}
        <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">Bug 绑定</h2>
              <p className="mt-1 text-sm text-ink-500">
                {bugBindings.length > 0
                  ? `已绑定 ${bugBindings.length} 个 Bug 单`
                  : "暂未绑定任何 Bug 单"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={openBugSearch}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                检索 Bug 单
              </button>
              <button
                onClick={openBugForm}
                className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100"
              >
                创建新 Bug 单
              </button>
            </div>
          </div>

          {bugSearchMissed && (
            <p className="mb-4 text-sm bg-rose-100 text-ink-500">未检索到对应的 Bug 单</p>
          )}

          {bugBindings.length > 0 ? (
            <div className="space-y-3">
              {bugBindings.map((binding) => (
                <div
                  key={binding.id}
                  className="group flex items-center justify-between rounded-lg border border-ink-100 bg-white px-4 py-3"
                >
                  <Link
                    href={`/tickets/${binding.bugTicket.id}`}
                    scroll={false}
                    className="flex flex-1 min-w-0 items-center gap-2 -my-3 -px-4 rounded-lg py-3 px-4 hover:bg-ink-50"
                  >
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs text-rose-700 shrink-0">
                      #{binding.bugTicket.ticketNo}
                    </span>
                    <span className="text-sm font-medium text-brand-600 group-hover:text-brand-700 truncate">
                      {binding.draftTitle}
                    </span>
                    <p className="text-xs text-ink-500">
                      由 {binding.boundBy.name || binding.boundBy.email} 绑定于{" "}
                      {new Date(binding.createdAt).toLocaleDateString("zh-CN")}
                    </p>
                  </Link>
                  <button
                    onClick={() => handleUnbindBug(binding.id)}
                    className="ml-3 shrink-0 rounded-lg border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:bg-ink-50"
                  >
                    解绑
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-400">暂无绑定的 Bug 单</p>
          )}
        </section>

        {/* Bug candidate */}
        {bugCandidateTicket && (
          <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-6">
            <div className="space-y-3">
              <div>
                <p className="text-sm text-ink-700">
                  检索到 Bug 单 <span className="font-medium text-brand-600">#{bugCandidateTicket.ticketNo}</span>
                  {bugCandidateTicket.title && ` - ${bugCandidateTicket.title}`}，可直接绑定
                </p>
                {fixCommitInfo && fixCommitInfo.count > 0 && (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <p className="text-xs font-medium text-rose-700">
                      发现 {fixCommitInfo.count} 个 fix 提交
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {fixCommitInfo.commits.map((commit, idx) => (
                        <div key={idx} className="text-xs text-rose-600">
                          <span className="font-mono text-rose-500">[{commit.commitSha}]</span>{" "}
                          <span className="truncate">{commit.subject}</span>
                          <span className="ml-2 text-rose-400">by {commit.author}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleBindBugCandidate}
                  className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  绑定 #{bugCandidateTicket.ticketNo}
                </button>
                <button
                  onClick={() => {
                    setBugSearchMissed(false);
                    openBugForm();
                  }}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100"
                >
                  创建新 Bug 单
                </button>
                <button
                  onClick={() => {
                    setBugCandidateTicket(null);
                    setFixCommitInfo(null);
                  }}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm hover:bg-ink-100"
                >
                  取消
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Fix commit info banner */}
        {!bugCandidateTicket && fixCommitInfo && fixCommitInfo.count > 0 && !showBugForm && (
          <section className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-rose-100 p-1.5">
                <svg className="h-4 w-4 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-rose-700">
                  发现 {fixCommitInfo.count} 个 fix 提交，但未匹配到可绑定的 Bug 单
                </p>
                <div className="mt-2 space-y-1.5">
                  {fixCommitInfo.commits.map((commit, idx) => (
                    <div key={idx} className="text-xs text-rose-600">
                      <span className="font-mono text-rose-500">[{commit.commitSha}]</span>{" "}
                      <span className="truncate">{commit.subject}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setFixCommitInfo(null);
                    setShowBugForm(true);
                  }}
                  className="mt-3 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
                >
                  创建新 Bug 单
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Bug form */}
        {showBugForm && bugResponsibility && bugDraft && (
          <section className="rounded-xl border border-ink-200 bg-white p-6">
            <CreateTicketForm
              projectId={projectId}
              responsibility={bugResponsibility}
              users={users}
              currentUserId={creatorId}
              showDesignAssignees
              editableDesignAssignees
              initialValues={bugDraft}
              submitLabel="创建并绑定 Bug 单"
              submitMode="create"
              onMessage={onMessage}
              onCreated={handleBindNewBug}
              allProjectModules={allProjectModules}
              onCancel={() => {
                setShowBugForm(false);
                setBugCandidateTicket(null);
              }}
              className="grid gap-3 rounded-xl border border-ink-100 bg-ink-100/40 p-4"
              bugTicketMode={true}
              sourceTicketId={ticketId}
            />
          </section>
        )}
      </>
    );
  }

  // ---- Render: Design ticket (emerald) ----
  return (
    <>
      {/* Push bound card */}
      {isPushBound && pushedTicket && (
        <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">推单绑定</h2>
              <p className="mt-1 text-sm text-ink-500">已推送 {badgeStyles.label2}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-xs ${badgeStyles.badge}`}>
              已绑定 #{pushedTicket.ticketNo}
            </span>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm">
              <p className="font-medium text-ink-800">{badgeStyles.label}信息</p>
              <p className="mt-1 text-ink-600"><span className="font-medium">单号：</span>#{pushedTicket.ticketNo}</p>
              <p className="mt-1 text-ink-600"><span className="font-medium">标题：</span>{pushRecord?.draftTitle || pushedTicket.title}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/tickets/${pushedTicket.id}`}
                className="inline-flex justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                查看 {badgeStyles.label}
              </Link>
              <button
                onClick={() => setShowForm(true)}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                在原单上继续推单
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Push flow */}
      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">推单流程</h2>
            <p className="mt-1 text-sm text-ink-500">
              {pushResolveMode === "bound"
                ? "已完成推单绑定"
                : pushResolveMode === "candidate"
                ? `程序目录下已找到 ${badgeStyles.label} #${candidateTicket?.ticketNo}`
                : "检索或创建推单"}
            </p>
          </div>
        </div>

        {pushResolveMode === "candidate" && candidateTicket && (
          <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <p className="text-sm text-ink-700">检索到程序目录下已有单子 #{candidateTicket.ticketNo}，可直接绑定。</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleBindCandidate} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                绑定 #{candidateTicket.ticketNo}
              </button>
              <button onClick={() => { setCandidateTicket(null); setShowForm(true); }} className="rounded-lg border border-ink-200 px-3 py-2 text-sm hover:bg-ink-100">
                创建新{badgeStyles.label}
              </button>
            </div>
          </div>
        )}

        {showForm && programResponsibility && draft && (
          <CreateTicketForm
            projectId={projectId}
            responsibility={programResponsibility}
            users={users}
            currentUserId={creatorId}
            showDesignAssignees
            editableDesignAssignees
            initialValues={draft}
            submitLabel={pushedTicket ? "更新程序单" : "创建并绑定程序单"}
            submitMode={pushedTicket ? "edit" : "create"}
            onMessage={onMessage}
            onCreated={handleCreateTicket}
            onCancel={() => setShowForm(false)}
            className="grid gap-3 rounded-xl border border-ink-100 bg-ink-100/40 p-4"
            allProjectModules={allProjectModules}
          />
        )}

        {pushResolveMode === "unbound" && !showForm && (
          <button onClick={openPushForm} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            检索或创建推单
          </button>
        )}
      </section>
    </>
  );
}
