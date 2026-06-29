"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type Props = {
  reportId: string;
};

/**
 * 周报详情页的「刷新画像」按钮。
 * 调用 POST /api/reports/weekly-reports/[id]/regenerate，
 * 使用 sonner toast 反馈，成功后 refresh 页面更新 aiSummary。
 */
export function WeeklyReportRegenerateButton({ reportId }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleRegenerate() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/weekly-reports/${reportId}/regenerate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast.success("AI 总结已入队，预计 5-30 秒后完成");
        router.refresh();
      } else if (res.status === 401) {
        toast.error("请先登录");
      } else if (res.status === 403) {
        toast.error("无权操作此周报");
      } else if (res.status === 404) {
        toast.error("周报不存在");
      } else {
        toast.error(`操作失败 (${res.status})`);
      }
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRegenerate}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-ink-50 hover:border-ink-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg
        className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      {loading ? "刷新中…" : "刷新画像"}
    </button>
  );
}
