"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/shared/lib/use-toast";
import { IconX } from "@/shared/ui/icons";

type MemberItem = {
  id: string;
  role: string;
  joinedAt: Date;
  user: { id: string; name: string | null; email: string };
};

type CandidateUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

type Props = {
  projectId: string;
  members: MemberItem[];
  currentUserId: string;
  isRoot: boolean;
  isOwner: boolean;
};

const BADGE = {
  OWNER: "bg-brand-50 text-brand-700",
  MEMBER: "bg-ink-100 text-ink-500",
} as const;

const ROLE_LABEL: Record<string, string> = {
  OWNER: "负责人",
  MEMBER: "成员",
};

function AddMemberModal({
  projectId,
  candidates,
  onClose,
  onSuccess,
}: {
  projectId: string;
  candidates: CandidateUser[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<"OWNER" | "MEMBER">("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [onClose]);

  async function handleAdd() {
    if (selected.size === 0) {
      toast.error("请至少选择一名成员");
      return;
    }
    setSubmitting(true);
    try {
      for (const userId of selected) {
        const res = await fetch(`/api/projects/${projectId}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, role }),
        });
        if (!res.ok) {
          const data = await res.json();
          if (data.error === "MEMBER_EXISTS") {
            toast.error("部分成员已在项目中");
          } else {
            toast.error(`添加失败: ${data.error}`);
          }
          return;
        }
      }
      toast.success("成员添加成功");
      onSuccess();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div
        ref={rootRef}
        className="w-full max-w-md rounded-xl border border-ink-200 bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">添加成员</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-600"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 space-y-3">
          <p className="text-sm text-ink-500">选择成员角色</p>
          <div className="flex gap-3">
            {(["MEMBER", "OWNER"] as const).map((r) => (
              <label key={r} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="accent-brand-600"
                />
                <span className="text-sm text-ink-700">{ROLE_LABEL[r]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-ink-200">
          {candidates.length === 0 ? (
            <p className="p-4 text-center text-sm text-ink-400">没有可添加的成员</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {candidates.map((user) => (
                <li key={user.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition hover:bg-ink-50">
                    <input
                      type="checkbox"
                      checked={selected.has(user.id)}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(user.id)) next.delete(user.id);
                          else next.add(user.id);
                          return next;
                        });
                      }}
                      className="rounded border-ink-300 accent-brand-600"
                    />
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-medium text-brand-700">
                      {user.name?.charAt(0) ?? user.email.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{user.name || "—"}</p>
                      <p className="truncate text-xs text-ink-400">{user.email}</p>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={selected.size === 0 || submitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "添加中…" : `添加${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectMemberTab({ projectId, members, currentUserId, isRoot, isOwner }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const canManage = isRoot || isOwner;

  const [showAddModal, setShowAddModal] = useState(false);
  const [candidates, setCandidates] = useState<CandidateUser[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function fetchCandidates() {
    const res = await fetch(`/api/projects/${projectId}/members`);
    if (!res.ok) return;
    const data = await res.json();
    setCandidates(data.candidates ?? []);
  }

  function openAddModal() {
    fetchCandidates();
    setShowAddModal(true);
  }

  async function handleRemove(userId: string, role: string, userName: string | null) {
    const isOwnerRole = role === "OWNER";
    const confirmed = window.confirm(
      isOwnerRole
        ? `「${userName ?? "此人"}」是项目负责人，确认移除？`
        : `确认移除「${userName ?? "此人"}」？`
    );
    if (!confirmed) return;

    setRemovingId(userId);
    try {
      const res = await fetch(`/api/projects/${projectId}/members?userId=${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "LAST_OWNER") {
          toast.error("至少保留一名负责人");
        } else {
          toast.error(`移除失败: ${data.error}`);
        }
        return;
      }
      toast.success("成员已移除");
      router.refresh();
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setRemovingId(null);
    }
  }

  async function handleRoleChange(userId: string, newRole: "OWNER" | "MEMBER") {
    try {
      const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "LAST_OWNER") {
          toast.error("至少保留一名负责人");
        } else {
          toast.error(`修改失败: ${data.error}`);
        }
        return;
      }
      toast.success("角色已更新");
      router.refresh();
    } catch {
      toast.error("网络错误，请重试");
    }
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink-900">项目成员</h2>
        {canManage && (
          <button
            type="button"
            onClick={openAddModal}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
          >
            添加成员
          </button>
        )}
      </div>

      {members.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-400">暂无成员</p>
      ) : (
        <ul className="space-y-3">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-medium text-brand-700">
                {m.user.name?.charAt(0) ?? m.user.email.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{m.user.name || "—"}</p>
                <p className="truncate text-xs text-ink-400">{m.user.email}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  BADGE[m.role as keyof typeof BADGE] ?? BADGE.MEMBER
                }`}
              >
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
              {canManage && (
                <div className="flex items-center gap-2">
                  <select
                    value={m.role}
                    onChange={(e) => handleRoleChange(m.user.id, e.target.value as "OWNER" | "MEMBER")}
                    className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700 outline-none transition focus:border-brand-400"
                  >
                    <option value="OWNER">负责人</option>
                    <option value="MEMBER">成员</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemove(m.user.id, m.role, m.user.name)}
                    disabled={removingId === m.user.id}
                    className="rounded-lg px-2 py-1 text-xs text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removingId === m.user.id ? "移除中…" : "移除"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showAddModal && (
        <AddMemberModal
          projectId={projectId}
          candidates={candidates}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
