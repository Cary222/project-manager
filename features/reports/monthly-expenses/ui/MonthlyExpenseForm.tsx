"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AttachmentEditor } from "@/shared/ui/AttachmentEditor";
import type { FileAttachment } from "@/shared/lib/pkm";
import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS, type ExpenseType } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";

interface MonthlyExpenseFormProps {
  mode?: "create" | "edit";
  initialId?: string;
  initialMonth?: string;
  initialExpenseType?: ExpenseType;
  initialCustomType?: string;
  initialAmount?: number;
  initialDescription?: string;
  initialAttachments?: FileAttachment[];
  onSaved?: () => void;
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
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
  const [loading, setLoading] = useState(false);

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
