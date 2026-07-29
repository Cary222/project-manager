"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AttachmentEditor } from "@/shared/ui/AttachmentEditor";
import type { FileAttachment } from "@/features/knowledge/lib/pkm";
import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS, type ExpenseType } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { fetchJson } from "@/shared/api/fetch-json";

interface User {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

interface ShareUser {
  userId: string;
  shareAmount: number;
}

interface MonthlyExpenseFormProps {
  mode?: "create" | "edit";
  initialId?: string;
  initialMonth?: string;
  initialExpenseType?: ExpenseType;
  initialCustomType?: string;
  initialAmount?: number;
  initialDescription?: string;
  initialAttachments?: FileAttachment[];
  initialShares?: ShareUser[];
  onSaved?: () => void;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatAmount(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

export function MonthlyExpenseForm({
  mode: propMode,
  initialId,
  initialMonth,
  initialExpenseType,
  initialCustomType,
  initialAmount,
  initialDescription,
  initialAttachments,
  initialShares,
  onSaved,
}: MonthlyExpenseFormProps) {
  const router = useRouter();
  const mode = propMode ?? "create";

  const [month, setMonth] = useState(initialMonth ?? getCurrentMonth());
  const [expenseType, setExpenseType] = useState<ExpenseType | "">(initialExpenseType ?? "");
  const [customType, setCustomType] = useState(initialCustomType ?? "");
  const [amount, setAmount] = useState(initialAmount?.toString() ?? "");
  const [description, setDescription] = useState(initialDescription ?? "");
  const [attachments, setAttachments] = useState<FileAttachment[]>(initialAttachments ?? []);
  const [shares, setShares] = useState<ShareUser[]>(initialShares ?? []);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);

  // 获取用户列表
  useEffect(() => {
    fetchJson<{ users: User[] }>("/api/users").then((data) => {
      setUsers(data.users ?? []);
    }).catch(() => {});
  }, []);

  // 计算均分金额
  const totalAmount = parseFloat(amount) || 0;
  const shareCount = shares.length + 1; // +1 是创建者自己
  const equalShare = shareCount > 0 ? Math.round((totalAmount / shareCount) * 100) / 100 : 0;

  function addShareUser(userId: string) {
    if (shares.some((s) => s.userId === userId)) return;
    setShares([...shares, { userId, shareAmount: equalShare }]);
  }

  function removeShareUser(userId: string) {
    setShares(shares.filter((s) => s.userId !== userId));
  }

  function updateShareAmount(userId: string, shareAmount: number) {
    setShares(shares.map((s) => s.userId === userId ? { ...s, shareAmount } : s));
  }

  function getUserName(userId: string): string {
    const user = users.find((u) => u.id === userId);
    return user?.name ?? user?.email ?? "未知用户";
  }

  function validate(): string | null {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return "请选择月份";
    if (!expenseType) return "请选择报销类型";
    if (expenseType === "OTHER" && !customType.trim()) return "选择「其他」类型时必须填写具体说明";
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return "金额必须大于 0";
    if (!description.trim()) return "请填写描述";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        month,
        expenseType: expenseType as ExpenseType,
        customType: expenseType === "OTHER" ? customType : undefined,
        amount: parseFloat(amount),
        description: description.trim(),
        attachments: attachments.length > 0 ? attachments : undefined,
        shares: shares.map((s) => ({ userId: s.userId, shareAmount: s.shareAmount })),
      };

      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/reports/monthly-expenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/reports/monthly-expenses/${initialId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `操作失败 (HTTP ${res.status})`);
      }

      toast.success(mode === "create" ? "报销已提交" : "报销已更新");
      if (onSaved) {
        onSaved();
      } else {
        router.push("/reports/monthly-expenses");
        router.refresh();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "操作失败，请重试";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* 月份 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">月份</label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
      </div>

      {/* 报销类型 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">报销类型</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {EXPENSE_TYPES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setExpenseType(value);
                setCustomType("");
              }}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                expenseType === value
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 其他类型说明 */}
        {expenseType === "OTHER" && (
          <div className="mt-2">
            <input
              type="text"
              value={customType}
              onChange={(e) => setCustomType(e.target.value)}
              placeholder="请填写具体报销类型"
              maxLength={50}
              className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        )}
      </div>

      {/* 金额 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">金额</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-500">¥</span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            min="0.01"
            step="0.01"
            className="w-full rounded-lg border border-ink-300 py-2 pl-7 pr-3 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
        {totalAmount > 0 && shareCount > 1 && (
          <p className="mt-1 text-xs text-ink-400">
            当前 {shareCount} 人分摊，每人约 {formatAmount(equalShare)}
          </p>
        )}
      </div>

      {/* 关联用户 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">
          关联分摊用户（可选）
        </label>
        <p className="mb-2 text-xs text-ink-400">
          添加关联用户后，报销将同时展示在双方的个人报销页。金额默认均分，也可手动调整。
        </p>

        {/* 已关联用户列表 */}
        {shares.length > 0 && (
          <div className="mb-2 space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
            <p className="text-xs font-medium text-ink-600">已关联用户（不含创建者）</p>
            {shares.map((share) => (
              <div key={share.userId} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-ink-700">{getUserName(share.userId)}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-ink-500">¥</span>
                  <input
                    type="number"
                    value={share.shareAmount}
                    onChange={(e) => updateShareAmount(share.userId, parseFloat(e.target.value) || 0)}
                    className="w-24 rounded border border-ink-300 px-2 py-1 text-sm text-ink-900"
                    min="0"
                    step="0.01"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeShareUser(share.userId)}
                  className="rounded p-1 text-ink-400 hover:bg-ink-200 hover:text-danger"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 添加用户下拉 */}
        <div className="relative">
          <select
            onChange={(e) => {
              if (e.target.value) {
                addShareUser(e.target.value);
                e.target.value = "";
              }
            }}
            className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-700"
            value=""
          >
            <option value="">+ 添加关联用户</option>
            {users.map((user) => (
              <option key={user.id} value={user.id} disabled={shares.some((s) => s.userId === user.id)}>
                {user.name ?? user.email} {user.role === "ROOT" ? "(管理员)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 描述 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="简要说明这笔报销的用途..."
          rows={3}
          maxLength={500}
          className="w-full resize-none rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        />
        <p className="mt-1 text-xs text-ink-400">{description.length}/500</p>
      </div>

      {/* 附件 */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink-700">附件（可选）</label>
        <AttachmentEditor
          attachments={attachments}
          onChange={setAttachments}
          onError={(msg) => toast.error(msg)}
          compact
        />
      </div>

      {/* 提交按钮 */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-ink-300 bg-white px-5 py-2.5 text-sm font-medium text-ink-700 transition hover:bg-ink-50"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "提交中..." : mode === "create" ? "提交报销" : "保存修改"}
        </button>
      </div>
    </form>
  );
}
