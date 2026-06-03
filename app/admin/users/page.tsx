"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  getUsersAction,
  updateUserRoleAction,
  banUserAction,
  unbanUserAction,
  UserSummary,
} from "@/actions/admin";
import { UserRole } from "@prisma/client";
import { useAdminRole } from "../context";

const PAGE_SIZE = 20;

export default function AdminUsersPage() {
  const adminRole = useAdminRole();
  const { data: session } = useSession();
  const isRoot = adminRole === "ROOT" || session?.user?.role === "ROOT";

  const [users, setUsers] = useState<UserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "">("");
  const [initialized, setInitialized] = useState(false);
  const [msg, setMsg] = useState("");

  const [dialog, setDialog] = useState<{
    type: "role" | "ban" | "unban";
    userId: string;
    userName: string;
  } | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [acting, setActing] = useState(false);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const load = useCallback(
    async (p: number, s: string, r: UserRole | "") => {
      const result = await getUsersAction({
        page: p,
        search: s,
        role: r || undefined,
      });
      setUsers(result.users);
      setTotal(result.total);
      setInitialized(true);
    },
    []
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(page, search, roleFilter);
  }, [load, page, search, roleFilter]);

  const loading = !initialized;

  function showMsg(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(""), 3000);
  }

  async function handleDialogConfirm() {
    if (!dialog) return;
    setActing(true);

    let result: { success?: boolean; error?: string };

    if (dialog.type === "role") {
      result = await updateUserRoleAction(dialog.userId, dialogValue as UserRole);
    } else if (dialog.type === "ban") {
      result = await banUserAction(dialog.userId, dialogValue || undefined);
    } else {
      result = await unbanUserAction(dialog.userId);
    }

    setActing(false);
    setDialog(null);
    setDialogValue("");

    if (result.error) {
      showMsg(result.error);
    } else {
      showMsg("操作成功");
      load(page, search, roleFilter);
    }
  }

  function openRoleDialog(user: UserSummary) {
    setDialogValue(user.role);
    setDialog({ type: "role", userId: user.id, userName: user.name || user.email });
  }

  function openBanDialog(user: UserSummary) {
    setDialogValue("");
    setDialog({ type: "ban", userId: user.id, userName: user.name || user.email });
  }

  function openUnbanDialog(user: UserSummary) {
    setDialog({ type: "unban", userId: user.id, userName: user.name || user.email });
  }

  function renderDialog() {
    if (!dialog) return null;
    const { type, userName } = dialog;

    let title = "";
    let confirmLabel = "";
    let danger = false;

    if (type === "role") {
      title = "修改用户角色";
      confirmLabel = "确认修改";
    } else if (type === "ban") {
      title = "封禁用户";
      confirmLabel = "确认封禁";
      danger = true;
    } else {
      title = "解封用户";
      confirmLabel = "确认解封";
    }

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-80 rounded-xl bg-white p-5 shadow-xl">
          <h3 className="mb-2 text-base font-semibold">{title}</h3>
          {type === "role" ? (
            <>
              <p className="mb-4 text-sm text-zinc-600">
                将「{userName}」的角色变更为：
              </p>
              <select
                className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                value={dialogValue}
                onChange={(e) => setDialogValue(e.target.value)}
              >
                <option value={UserRole.USER}>USER</option>
                <option value={UserRole.ROOT}>ROOT</option>
              </select>
            </>
          ) : type === "ban" ? (
            <>
              <p className="mb-4 text-sm text-zinc-600">
                确定要封禁「{userName}」吗？该用户将无法登录。
              </p>
              <input
                className="mb-4 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
                placeholder="封禁原因（可选）"
                value={dialogValue}
                onChange={(e) => setDialogValue(e.target.value)}
              />
            </>
          ) : (
            <p className="mb-4 text-sm text-zinc-600">
              确定要解封「{userName}」吗？该用户将可以重新登录。
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDialog(null);
                setDialogValue("");
              }}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleDialogConfirm}
              disabled={acting}
              className={`rounded-md px-3 py-1.5 text-sm text-white disabled:opacity-50 ${
                danger
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-zinc-900 hover:bg-zinc-800"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          placeholder="搜索姓名或邮箱"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as UserRole | "");
            setPage(1);
          }}
        >
          <option value="">全部角色</option>
          <option value={UserRole.ROOT}>ROOT</option>
          <option value={UserRole.USER}>USER</option>
        </select>
        <span className="text-sm text-zinc-500">共 {total} 人</span>
      </div>

      {msg ? (
        <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : users.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center text-zinc-500">
          暂无用户
        </p>
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50 text-left">
                  <th className="px-4 py-3 font-medium text-zinc-500">用户</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">角色</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">状态</th>
                  <th className="px-4 py-3 font-medium text-zinc-500">注册时间</th>
                  {isRoot && (
                    <th className="px-4 py-3 font-medium text-zinc-500">操作</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {user.name || <span className="text-zinc-400">未命名</span>}
                      </p>
                      <p className="text-xs text-zinc-400">{user.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                          user.role === "ROOT"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-zinc-100 text-zinc-600"
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {user.bannedAt ? (
                        <span className="inline-flex items-center rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                          已封禁
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                          正常
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                    </td>
                    {isRoot && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/admin/users/${user.id}`}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            查看单子
                          </Link>
                          <button
                            type="button"
                            onClick={() => openRoleDialog(user)}
                            className="text-xs text-zinc-500 hover:text-zinc-900"
                          >
                            改角色
                          </button>
                          {user.bannedAt ? (
                            <button
                              type="button"
                              onClick={() => openUnbanDialog(user)}
                              className="text-xs text-emerald-600 hover:text-emerald-700"
                            >
                              解封
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openBanDialog(user)}
                              className="text-xs text-red-600 hover:text-red-700"
                            >
                              封禁
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-sm text-zinc-500">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}

      {renderDialog()}

      {acting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <p className="text-sm text-zinc-600">处理中…</p>
        </div>
      )}
    </div>
  );
}
