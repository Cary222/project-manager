"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AttachmentEditor } from "@/shared/ui/AttachmentEditor";
import type { FileAttachment } from "@/shared/lib/pkm";
import type { MonthlyExpenseWithUser, ExpenseType } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";

interface MonthlyExpenseDetailClientProps {
  expense: MonthlyExpenseWithUser;
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

export function MonthlyExpenseDetailClient({ expense }: MonthlyExpenseDetailClientProps) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "edit">("view");

  const [month, setMonth] = useState(expense.month);
  const [expenseType, setExpenseType] = useState<ExpenseType>(expense.expenseType as ExpenseType);
  const [customType, setCustomType] = useState(expense.customType ?? "");
  const [amount, setAmount] = useState(expense.amount.toString());
  const [description, setDescription] = useState(expense.description);
  const [attachments, setAttachments] = useState<FileAttachment[]>(
    (expense.attachments as FileAttachment[] | null | undefined) ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function validate(): string | null {
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return "请选择月份";
    if (!expenseType) return "请选择报销类型";
    if (expenseType === "OTHER" && !customType.trim()) return "选择「其他」类型时必须填写具体说明";
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) return "金额必须大于 0";
    if (!description.trim()) return "请填写描述";
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
          month,
          expenseType,
          customType: expenseType === "OTHER" ? customType : undefined,
          amount: parseFloat(amount),
          description: description.trim(),
          attachments: attachments.length > 0 ? attachments : undefined,
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

  return (
    <div className="space-y-6">
      {/* 报销详情卡片 */}
      <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
        <div className="flex items-start justify-between">
          <div>
            <ExpenseTypeBadge type={expense.expenseType} customType={expense.customType} />
            <div className="mt-3 text-3xl font-bold text-ink-900">{formatAmount(expense.amount)}</div>
            <div className="mt-1 text-sm text-ink-500">{expense.month}</div>
          </div>
          <div className="text-xs text-ink-400">
            提交于 {formatDate(expense.createdAt)}
          </div>
        </div>

        <div className="mt-6 border-t border-ink-100 pt-4">
          <h3 className="text-sm font-medium text-ink-700">描述</h3>
          {mode === "view" ? (
            <p className="mt-1.5 text-sm text-ink-600">{expense.description}</p>
          ) : (
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1.5 w-full resize-none rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          )}
        </div>

        {/* 附件 */}
        {(attachments.length > 0 || mode === "edit") && (
          <div className="mt-4 border-t border-ink-100 pt-4">
            <h3 className="mb-2 text-sm font-medium text-ink-700">附件</h3>
            <AttachmentEditor
              attachments={attachments}
              onChange={setAttachments}
              onError={(msg) => toast.error(msg)}
            />
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-6 flex justify-end gap-3 border-t border-ink-100 pt-4">
          {mode === "view" ? (
            <>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? "删除中..." : "删除"}
              </button>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
              >
                编辑
              </button>
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

      {/* 编辑模式表单 */}
      {mode === "edit" && (
        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-soft">
          <h3 className="mb-4 text-sm font-semibold text-ink-700">编辑报销信息</h3>
          <div className="space-y-4">
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
