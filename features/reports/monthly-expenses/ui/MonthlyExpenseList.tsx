"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import type { MonthlyExpenseWithUser, ExpenseType } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import { EXPENSE_TYPE_LABELS } from "@/features/reports/monthly-expenses/lib/monthly-expense-store";
import type { FileAttachment } from "@/features/knowledge/lib/pkm";

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
}

function UserAvatar({ user }: { user: { name: string | null; email: string; image: string | null } }) {
  const initials = user.name?.slice(0, 1) ?? user.email.slice(0, 1);
  return (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-[10px] font-medium">
      {user.image ? (
        <img src={user.image} alt={user.name ?? user.email} className="h-full w-full rounded-full object-cover" />
      ) : (
        initials.toUpperCase()
      )}
    </div>
  );
}

export function MonthlyExpenseList({ initialExpenses }: { initialExpenses: MonthlyExpenseWithUser[] }) {
  const router = useRouter();
  const [expenses, setExpenses] = useState(initialExpenses);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    if (!window.confirm("确定删除这条报销记录吗？此操作不可撤销。")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/reports/monthly-expenses/${id}`, { method: "DELETE" });
      if (res.ok) {
        setExpenses((prev) => prev.filter((e) => e.id !== id));
        toast.success("报销已删除");
        router.refresh();
      } else {
        toast.error("删除失败，请重试");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeletingId(null);
    }
  }

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
        <div className="rounded-full bg-ink-100 p-3 text-ink-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="mt-4 text-sm font-semibold text-ink-900">还没有报销记录</h3>
        <p className="mt-1 text-sm text-ink-500">开始记录你的第一笔报销吧</p>
        <Link
          href="/reports/monthly-expenses/new"
          className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          新建报销
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3 pm-fade-in">
      {expenses.map((expense) => {
        const shares = expense.shares ?? [];
        // 过滤掉创建者，只保留其他关联用户（避免重复显示）
        const otherShares = shares.filter((s) => s.userId !== expense.userId);
        const participantCount = 1 + otherShares.length; // 创建者 + 其他用户
        // 计算本人的分摊金额
        const myShare = shares.find((s) => s.userId === expense.userId);
        const myShareAmount = myShare?.shareAmount ?? (participantCount > 0 ? expense.amount / participantCount : expense.amount);

        return (
          <div
            key={expense.id}
            className="group rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-ink-300 hover:shadow lg:p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/reports/monthly-expenses/${expense.id}`} className="block">
                    <h3 className="text-base font-medium text-ink-900 hover:text-brand-600">
                      {formatAmount(myShareAmount)}
                    </h3>
                  </Link>
                  <ExpenseTypeBadge type={expense.expenseType} customType={expense.customType} />
                </div>

                <p className="mt-1.5 line-clamp-2 text-sm text-ink-600">
                  {expense.description}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink-400">
                  <span>总金额 {formatAmount(expense.amount)}</span>
                  {participantCount > 1 && <span>{participantCount}人分摊</span>}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                  <span>{expense.month}</span>
                  <span>{formatDate(expense.createdAt)}</span>
                  {/* 参与者 */}
                  <div className="flex items-center gap-1">
                    <div className="flex -space-x-1">
                      <UserAvatar user={expense.user!} />
                      {otherShares.slice(0, 3).map((s) => (
                        <UserAvatar key={s.id} user={s.user} />
                      ))}
                    </div>
                  </div>
                  {Array.isArray(expense.attachments) && expense.attachments.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      {expense.attachments.length}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/reports/monthly-expenses/${expense.id}`}
                  className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
                >
                  查看
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(expense.id)}
                  disabled={deletingId === expense.id}
                  className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deletingId === expense.id ? "删除中..." : "删除"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
