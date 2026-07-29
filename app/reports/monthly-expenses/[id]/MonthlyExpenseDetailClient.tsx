"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AttachmentEditor, type PreviewableFile } from "@/shared/ui/AttachmentEditor";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";
import type { FileAttachment } from "@/features/knowledge/lib/pkm";
import type { MonthlyExpenseWithUser, ExpenseType } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { fetchJson } from "@/shared/api/fetch-json";

interface MonthlyExpenseDetailClientProps {
  expense: MonthlyExpenseWithUser;
  isCreator?: boolean;
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAmount(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

function ExpenseTypeBadge({ type, customType }: { type: string; customType?: string | null }) {
  const label = type === "OTHER" && customType ? customType : EXPENSE_TYPE_LABELS[type as ExpenseType] ?? type;
  const colorMap: Record<string, string> = {
    TRANSPORT: "bg-blue-100 text-blue-700",
    MEAL: "bg-orange-100 text-orange-700",
    TRAVEL: "bg-purple-100 text-purple-700",
    OFFICE: "bg-green-100 text-green-700",
    OTHER: "bg-gray-100 text-gray-700",
  };
  const colorClass = colorMap[type] ?? "bg-gray-100 text-gray-700";

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function UserAvatar({ user, size = "sm" }: { user: { name: string | null; email: string; image: string | null }; size?: "sm" | "md" }) {
  const initials = user.name?.slice(0, 1) ?? user.email.slice(0, 1);
  const sizeClass = size === "sm" ? "h-6 w-6 text-xs" : "h-8 w-8 text-sm";
  return (
    <div className={`flex items-center justify-center rounded-full bg-brand-100 text-brand-700 font-medium ${sizeClass}`}>
      {user.image ? (
        <img src={user.image} alt={user.name ?? user.email} className="h-full w-full rounded-full object-cover" />
      ) : (
        initials.toUpperCase()
      )}
    </div>
  );
}

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export function MonthlyExpenseDetailClient({ expense, isCreator = false }: MonthlyExpenseDetailClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  // 编辑状态
  const [editMonth, setEditMonth] = useState(expense.month);
  const [editExpenseType, setEditExpenseType] = useState<ExpenseType>(expense.expenseType as ExpenseType);
  const [editCustomType, setEditCustomType] = useState(expense.customType ?? "");
  const [editAmount, setEditAmount] = useState(expense.amount.toString());
  const [editDescription, setEditDescription] = useState(expense.description);
  const [editAttachments, setEditAttachments] = useState<FileAttachment[]>(
    (expense.attachments as FileAttachment[] | null | undefined) ?? [],
  );
  // 分摊用户列表（不含创建者）
  const [editShares, setEditShares] = useState<{ userId: string; shareAmount: number }[]>(
    (expense.shares ?? [])
      .filter((s) => s.userId !== expense.userId) // 过滤掉创建者
      .map((s) => ({ userId: s.userId, shareAmount: s.shareAmount })),
  );
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 静态数据
  const shares = expense.shares ?? [];

  // 获取创建者在 shares 中的分摊记录（如果有的话）
  const creatorShare = shares.find((s) => s.userId === expense.userId);
  const creatorShareAmount = creatorShare?.shareAmount ?? expense.amount;

  // 计算预览模式下各参与者的分摊金额（按均分处理）
  function getPreviewShareAmount(total: number, participantCount: number): number {
    return participantCount > 0 ? Math.round((total / participantCount) * 100) / 100 : total;
  }

  // 预览模式下的报销人员（过滤掉创建者避免重复显示）
  const previewShares = shares.filter((s) => s.userId !== expense.userId);
  const totalParticipants = 1 + previewShares.length;
  const previewParticipants = [
    {
      user: expense.user!,
      shareAmount: creatorShare ? creatorShare.shareAmount : getPreviewShareAmount(expense.amount, totalParticipants),
      isCreator: true,
    },
    ...previewShares.map((s) => ({
      user: s.user,
      shareAmount: s.shareAmount,
      isCreator: false,
    })),
  ];

  // 获取用户列表
  useEffect(() => {
    fetchJson<{ users: User[] }>("/api/users").then((data) => {
      setUsers(data.users ?? []);
    }).catch(() => {});
  }, []);

  // 进入编辑模式时初始化表单
  useEffect(() => {
    if (mode === "edit") {
      setEditMonth(expense.month);
      setEditExpenseType(expense.expenseType as ExpenseType);
      setEditCustomType(expense.customType ?? "");
      setEditAmount(expense.amount.toString());
      setEditDescription(expense.description);
      setEditAttachments((expense.attachments as FileAttachment[] | null | undefined) ?? []);
      setEditShares(
        (expense.shares ?? [])
          .filter((s) => s.userId !== expense.userId) // 过滤掉创建者
          .map((s) => ({ userId: s.userId, shareAmount: s.shareAmount })),
      );
    }
  }, [mode, expense]);

  function getUserName(userId: string): string {
    const user = users.find((u) => u.id === userId);
    return user?.name ?? user?.email ?? userId;
  }

  function getTotalAmount(): number {
    return parseFloat(editAmount) || 0;
  }

  // 计算均分金额（包括创建者）
  function getEqualShare(): number {
    const total = getTotalAmount();
    const shareCount = 1 + editShares.length; // 创建者 + 其他分摊用户
    return shareCount > 0 ? Math.round((total / shareCount) * 100) / 100 : 0;
  }

  function addShareUser(userId: string) {
    if (editShares.some((s) => s.userId === userId)) return;
    setEditShares([...editShares, { userId, shareAmount: getEqualShare() }]);
  }

  function removeShareUser(userId: string) {
    setEditShares(editShares.filter((s) => s.userId !== userId));
  }

  function updateShareAmount(userId: string, shareAmount: number) {
    setEditShares(editShares.map((s) => s.userId === userId ? { ...s, shareAmount } : s));
  }

  function handlePreview(file: PreviewableFile) {
    setPreviewFile(file);
  }

  function validate(): string | null {
    if (!editMonth || !/^\d{4}-\d{2}$/.test(editMonth)) return "请选择月份";
    if (!editExpenseType) return "请选择报销类型";
    if (editExpenseType === "OTHER" && !editCustomType.trim()) return "选择「其他」类型时必须填写具体说明";
    const amountNum = parseFloat(editAmount);
    if (isNaN(amountNum) || amountNum <= 0) return "金额必须大于 0";
    if (!editDescription.trim()) return "请填写描述";
    return null;
  }

  async function handleSave() {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/reports/monthly-expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: editMonth,
          expenseType: editExpenseType,
          customType: editExpenseType === "OTHER" ? editCustomType : undefined,
          amount: parseFloat(editAmount),
          description: editDescription.trim(),
          attachments: editAttachments.length > 0 ? editAttachments : undefined,
          shares: editShares.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `保存失败 (HTTP ${res.status})`);
      }

      toast.success("报销已更新");
      setMode("view");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败，请重试";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("确定删除这条报销记录吗？此操作不可撤销。")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/reports/monthly-expenses/${expense.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("报销已删除");
        router.push("/reports/monthly-expenses");
      } else {
        toast.error("删除失败，请重试");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleting(false);
    }
  }

  // 编辑模式下的均分信息
  const editEqualShare = getEqualShare();

  return (
    <div className="space-y-6">
      {/* 报销详情卡片 */}
      <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        {/* 顶部区域：类型+金额+月份 / 提交时间 */}
        <div className="flex items-start justify-between">
          {mode === "view" ? (
            <>
              <div>
                <ExpenseTypeBadge type={expense.expenseType} customType={expense.customType} />
                <div className="mt-3 text-3xl font-bold text-ink-900">{formatAmount(expense.amount)}</div>
                <div className="mt-1 text-sm text-ink-500">{expense.month}</div>
              </div>
              <div className="text-xs text-ink-400">
                提交于 {formatDate(expense.createdAt)}
              </div>
            </>
          ) : (
            <div className="flex-1 space-y-3">
              {/* 报销类型 */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-ink-700">报销类型</label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {EXPENSE_TYPES.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setEditExpenseType(value);
                        setEditCustomType("");
                      }}
                      className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        editExpenseType === value
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {editExpenseType === "OTHER" && (
                  <input
                    type="text"
                    value={editCustomType}
                    onChange={(e) => setEditCustomType(e.target.value)}
                    placeholder="请填写具体报销类型"
                    maxLength={50}
                    className="mt-2 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                )}
              </div>

              {/* 月份和金额 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-700">月份</label>
                  <input
                    type="month"
                    value={editMonth}
                    onChange={(e) => setEditMonth(e.target.value)}
                    className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-ink-700">金额</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">¥</span>
                    <input
                      type="number"
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      placeholder="0.00"
                      min="0.01"
                      step="0.01"
                      className="w-full rounded-lg border border-ink-300 py-2 pl-7 pr-3 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 报销人员 */}
        <div className="mt-6 border-t border-ink-100 pt-4">
          <h3 className="text-sm font-medium text-ink-700">
            报销人员
            {mode === "edit" && getTotalAmount() > 0 && (
              <span className="ml-2 text-xs font-normal text-ink-400">
                （{editShares.length + 1}人分摊）
              </span>
            )}
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {mode === "view" ? (
              // 预览模式：显示报销人员
              previewParticipants.map((p) => (
                <div key={p.user.id} className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
                  <UserAvatar user={p.user} />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-ink-700">
                      {p.user.name ?? p.user.email}
                      {p.isCreator && <span className="ml-1 text-xs text-brand-600">(创建者)</span>}
                    </span>
                    <span className="text-xs text-ink-500">
                      分摊 {formatAmount(p.shareAmount)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              // 编辑模式：显示创建者（均分）+ 可管理的关联用户
              <>
                {/* 创建者 */}
                <div className="flex items-center gap-2 rounded-lg border border-brand-300 bg-brand-50 px-3 py-2">
                  <UserAvatar user={expense.user!} />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-ink-700">
                      {expense.user!.name ?? expense.user!.email}
                      <span className="ml-1 text-xs text-brand-600">(创建者)</span>
                    </span>
                    <span className="text-xs text-ink-500">
                      分摊 {formatAmount(editEqualShare)}
                    </span>
                  </div>
                </div>
                {/* 已关联用户 */}
                {editShares.map((share) => (
                  <div key={share.userId} className="flex items-center gap-2 rounded-lg border border-ink-200 bg-ink-50 px-3 py-2">
                    <UserAvatar user={{ name: null, email: share.userId, image: null }} />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-ink-700">{getUserName(share.userId)}</span>
                      <span className="text-xs text-ink-500">
                        分摊 ¥
                        <input
                          type="number"
                          value={share.shareAmount}
                          onChange={(e) => updateShareAmount(share.userId, parseFloat(e.target.value) || 0)}
                          className="ml-1 w-16 rounded border border-ink-300 px-1 py-0.5 text-xs"
                          min="0"
                          step="0.01"
                        />
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeShareUser(share.userId)}
                      className="ml-1 rounded p-1 text-ink-400 hover:bg-ink-200 hover:text-danger"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {/* 添加用户 */}
                {editShares.length < users.length - 1 && (
                  <div className="flex items-center gap-2">
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          addShareUser(e.target.value);
                          e.target.value = "";
                        }
                      }}
                      className="rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-700"
                      value=""
                    >
                      <option value="">+ 添加关联用户</option>
                      {users
                        .filter((user) => user.id !== expense.userId && !editShares.some((s) => s.userId === user.id))
                        .map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.name ?? user.email} {user.role === "ROOT" ? "(管理员)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* 描述 */}
        <div className="mt-6 border-t border-ink-100 pt-4">
          <h3 className="text-sm font-medium text-ink-700">描述</h3>
          {mode === "view" ? (
            <p className="mt-1.5 text-sm text-ink-600">{expense.description}</p>
          ) : (
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1.5 w-full resize-none rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          )}
        </div>

        {/* 附件 */}
        {(mode === "edit" || editAttachments.length > 0) && (
          <div className="mt-4 border-t border-ink-100 pt-4">
            <h3 className="mb-2 text-sm font-medium text-ink-700">附件</h3>
            <AttachmentEditor
              attachments={editAttachments}
              onChange={setEditAttachments}
              onError={(msg) => toast.error(msg)}
              renderPreview={handlePreview}
            />
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-6 flex justify-end gap-3 border-t border-ink-100 pt-4">
          {mode === "view" ? (
            <>
              {isCreator && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting ? "删除中..." : "删除"}
                </button>
              )}
              {isCreator && (
                <button
                  type="button"
                  onClick={() => setMode("edit")}
                  className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
                >
                  编辑
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMode("view")}
                disabled={loading}
                className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100 disabled:opacity-60"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={loading}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "保存中..." : "保存修改"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 文档预览弹窗 */}
      <DocumentPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
