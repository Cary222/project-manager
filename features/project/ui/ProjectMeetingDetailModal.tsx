"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  type MeetingSummaryData,
  type MeetingActionItem,
} from "@/features/ai/llm/meeting-summarizer";
import { useToast } from "@/shared/lib/use-toast";

export interface MeetingItem {
  id: string;
  projectId: string;
  creatorId: string;
  title: string;
  meetingDate: string;
  status:
    | "UPLOADING"
    | "TRANSCRIBING"
    | "SUMMARIZING"
    | "PENDING_REVIEW"
    | "PUBLISHED"
    | "FAILED";
  audioFileAssetId?: string | null;
  audioDuration?: number | null;
  rawTranscript?: string | null;
  aiSummary?: MeetingSummaryData | null;
  draftSummary?: MeetingSummaryData | null;
  publishedSummary?: string | null;
  documentFileAssetId?: string | null;
  publishedAt?: string | null;
  errorMessage?: string | null;
  failedStep?: string | null;
  creator?: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  audioFileAsset?: {
    id: string;
    originalName: string;
    size: number;
    mimeType: string;
  } | null;
}

interface Props {
  projectId: string;
  meetingId: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function ProjectMeetingDetailModal({
  projectId,
  meetingId,
  onClose,
  onUpdated,
}: Props) {
  const [meeting, setMeeting] = useState<MeetingItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "draft" | "transcript" | "ai_original" | "published"
  >("draft");

  // 编辑态草稿表单
  const [draft, setDraft] = useState<MeetingSummaryData>({
    summary: "",
    progress: [],
    discussions: [],
    decisions: [],
    actionItems: [],
    risks: [],
    nextPlans: [],
  });

  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [showPublishConfirm, setShowPublishConfirm] = useState(false);

  const { toast } = useToast();

  const fetchMeeting = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/meetings/${meetingId}`,
      );
      const json = await res.json();
      if (json.data) {
        setMeeting(json.data);
        const dataToEdit: MeetingSummaryData = json.data.draftSummary ||
          json.data.aiSummary || {
            summary: "",
            progress: [],
            discussions: [],
            decisions: [],
            actionItems: [],
            risks: [],
            nextPlans: [],
          };
        setDraft(dataToEdit);
        if (json.data.status === "PUBLISHED") {
          setActiveTab("published");
        }
      }
    } catch {
      toast.error("获取会议详情失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, meetingId, toast]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/meetings/${meetingId}`,
        );
        const json = await res.json();
        if (!ignore && json.data) {
          setMeeting(json.data);
          const dataToEdit: MeetingSummaryData = json.data.draftSummary ||
            json.data.aiSummary || {
              summary: "",
              progress: [],
              discussions: [],
              decisions: [],
              actionItems: [],
              risks: [],
              nextPlans: [],
            };
          setDraft(dataToEdit);
          if (json.data.status === "PUBLISHED") {
            setActiveTab("published");
          }
        }
      } catch {
        if (!ignore) toast.error("获取会议详情失败");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [projectId, meetingId, toast]);

  // 处理轮询
  useEffect(() => {
    if (!meeting) return;
    if (
      meeting.status === "TRANSCRIBING" ||
      meeting.status === "SUMMARIZING" ||
      meeting.status === "UPLOADING"
    ) {
      const timer = setInterval(() => {
        fetchMeeting();
      }, 3000);
      return () => clearInterval(timer);
    }
  }, [meeting, fetchMeeting]);

  // 保存草稿
  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/meetings/${meetingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftSummary: draft }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "保存失败");
      }
      toast.success("草稿已保存");
      setMeeting(json.data);
      onUpdated();
    } catch (err) {
      toast.error(
        `保存草稿失败: ${err instanceof Error ? err.message : "网络异常"}`,
      );
    } finally {
      setSaving(false);
    }
  };

  // 确认发布
  const handlePublish = async () => {
    setPublishing(true);
    try {
      // 先保存草稿
      await fetch(`/api/projects/${projectId}/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftSummary: draft }),
      });

      const res = await fetch(
        `/api/projects/${projectId}/meetings/${meetingId}/publish`,
        {
          method: "POST",
        },
      );
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "发布失败");
      }
      toast.success("周会纪要已正式发布并进入知识库 RAG 索引！");
      setShowPublishConfirm(false);
      await fetchMeeting();
      onUpdated();
    } catch (err) {
      toast.error(
        `发布失败: ${err instanceof Error ? err.message : "网络异常"}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  // 失败重试
  const handleRetry = async (step?: "TRANSCRIBE" | "SUMMARIZE") => {
    setRetrying(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/meetings/${meetingId}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "重试请求失败");
      toast.success("已启动重试任务");
      await fetchMeeting();
      onUpdated();
    } catch (err) {
      toast.error(
        `重试失败: ${err instanceof Error ? err.message : "网络异常"}`,
      );
    } finally {
      setRetrying(false);
    }
  };

  // 辅助编辑函数
  const updateDraftField = <K extends keyof MeetingSummaryData>(
    field: K,
    val: MeetingSummaryData[K],
  ) => {
    setDraft((prev) => ({ ...prev, [field]: val }));
  };

  const handleArrayItemChange = (
    field: "progress" | "discussions" | "decisions" | "risks" | "nextPlans",
    idx: number,
    val: string,
  ) => {
    setDraft((prev) => {
      const arr = [...prev[field]];
      arr[idx] = val;
      return { ...prev, [field]: arr };
    });
  };

  const handleAddArrayItem = (
    field: "progress" | "discussions" | "decisions" | "risks" | "nextPlans",
  ) => {
    setDraft((prev) => ({ ...prev, [field]: [...prev[field], ""] }));
  };

  const handleRemoveArrayItem = (
    field: "progress" | "discussions" | "decisions" | "risks" | "nextPlans",
    idx: number,
  ) => {
    setDraft((prev) => {
      const arr = prev[field].filter((_, i) => i !== idx);
      return { ...prev, [field]: arr };
    });
  };

  const handleActionItemChange = (
    idx: number,
    key: keyof MeetingActionItem,
    val: string,
  ) => {
    setDraft((prev) => {
      const arr = [...prev.actionItems];
      arr[idx] = { ...arr[idx], [key]: val };
      return { ...prev, actionItems: arr };
    });
  };

  const handleAddActionItem = () => {
    setDraft((prev) => ({
      ...prev,
      actionItems: [
        ...prev.actionItems,
        { task: "", assignee: "", dueDate: "" },
      ],
    }));
  };

  const handleRemoveActionItem = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      actionItems: prev.actionItems.filter((_, i) => i !== idx),
    }));
  };

  if (loading || !meeting) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="flex h-64 w-96 items-center justify-center rounded-2xl bg-white shadow-2xl">
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
            <p className="text-sm font-medium text-ink-600">
              加载周会详情中...
            </p>
          </div>
        </div>
      </div>
    );
  }

  const isPublished = meeting.status === "PUBLISHED";
  const isProcessing =
    meeting.status === "TRANSCRIBING" || meeting.status === "SUMMARIZING";
  const isFailed = meeting.status === "FAILED";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm sm:p-6">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-ink-900">
        {/* 顶部 Header */}
        <div className="flex items-center justify-between border-b border-ink-200 px-6 py-4 dark:border-ink-800">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-ink-900 dark:text-ink-50">
              {meeting.title}
            </h3>
            <span className="text-xs text-ink-400">
              {new Date(meeting.meetingDate).toISOString().slice(0, 10)}
            </span>
            <StatusBadge status={meeting.status} />
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-600 dark:hover:bg-ink-800"
          >
            ✕
          </button>
        </div>

        {/* 阶段进度条指示器 */}
        <div className="border-b border-ink-100 bg-ink-50/50 px-6 py-2.5 dark:border-ink-800/50 dark:bg-ink-800/20">
          <div className="flex items-center justify-between text-xs font-medium">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${meeting.audioFileAssetId ? "bg-emerald-500 text-white" : "bg-ink-300 text-white"}`}
              >
                1
              </span>
              <span
                className={
                  meeting.audioFileAssetId
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-ink-400"
                }
              >
                音频上传
              </span>
            </div>
            <div className="h-0.5 w-8 bg-ink-200 dark:bg-ink-700" />
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${meeting.rawTranscript ? "bg-emerald-500 text-white" : meeting.status === "TRANSCRIBING" ? "animate-pulse bg-amber-500 text-white" : "bg-ink-300 text-white"}`}
              >
                2
              </span>
              <span
                className={
                  meeting.rawTranscript
                    ? "text-emerald-700 dark:text-emerald-400"
                    : meeting.status === "TRANSCRIBING"
                      ? "text-amber-600 font-semibold"
                      : "text-ink-400"
                }
              >
                语音转文字
              </span>
            </div>
            <div className="h-0.5 w-8 bg-ink-200 dark:bg-ink-700" />
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${meeting.aiSummary ? "bg-emerald-500 text-white" : meeting.status === "SUMMARIZING" ? "animate-pulse bg-purple-500 text-white" : "bg-ink-300 text-white"}`}
              >
                3
              </span>
              <span
                className={
                  meeting.aiSummary
                    ? "text-emerald-700 dark:text-emerald-400"
                    : meeting.status === "SUMMARIZING"
                      ? "text-purple-600 font-semibold"
                      : "text-ink-400"
                }
              >
                AI 7要素总结
              </span>
            </div>
            <div className="h-0.5 w-8 bg-ink-200 dark:bg-ink-700" />
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${isPublished ? "bg-emerald-500 text-white" : meeting.status === "PENDING_REVIEW" ? "bg-blue-500 text-white" : "bg-ink-300 text-white"}`}
              >
                4
              </span>
              <span
                className={
                  isPublished
                    ? "text-emerald-700 dark:text-emerald-400"
                    : meeting.status === "PENDING_REVIEW"
                      ? "text-blue-600 font-semibold"
                      : "text-ink-400"
                }
              >
                专员审核草稿
              </span>
            </div>
            <div className="h-0.5 w-8 bg-ink-200 dark:bg-ink-700" />
            <div className="flex items-center gap-2">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${isPublished ? "bg-emerald-500 text-white" : "bg-ink-300 text-white"}`}
              >
                5
              </span>
              <span
                className={
                  isPublished
                    ? "text-emerald-700 font-bold dark:text-emerald-400"
                    : "text-ink-400"
                }
              >
                正式文档 & RAG
              </span>
            </div>
          </div>
        </div>

        {/* 失败告警条 */}
        {isFailed && (
          <div className="flex items-center justify-between bg-rose-50 px-6 py-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <div className="flex items-center gap-2">
              <span className="font-semibold">⚠️ 处理失败：</span>
              <span>{meeting.errorMessage || "任务执行异常"}</span>
              <span className="text-xs text-rose-500">
                （阶段: {meeting.failedStep || "未知"}）
              </span>
            </div>
            <div className="flex gap-2">
              {meeting.failedStep === "TRANSCRIBE" ? (
                <button
                  onClick={() => handleRetry("TRANSCRIBE")}
                  disabled={retrying}
                  className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  重试转录
                </button>
              ) : (
                <button
                  onClick={() => handleRetry("SUMMARIZE")}
                  disabled={retrying}
                  className="rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  重试生成纪要
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tab 切换栏 */}
        <div className="flex border-b border-ink-200 px-6 dark:border-ink-800">
          <button
            onClick={() => setActiveTab("draft")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "draft"
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400"
            }`}
          >
            {isPublished ? "纪要内容" : "草稿编辑 (7要素)"}
          </button>
          <button
            onClick={() => setActiveTab("transcript")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "transcript"
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400"
            }`}
          >
            原始转写文本{" "}
            {meeting.rawTranscript ? `(${meeting.rawTranscript.length}字)` : ""}
          </button>
          <button
            onClick={() => setActiveTab("ai_original")}
            className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "ai_original"
                ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400"
            }`}
          >
            AI 原始提取
          </button>
          {isPublished && (
            <button
              onClick={() => setActiveTab("published")}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === "published"
                  ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                  : "border-transparent text-ink-500 hover:text-ink-700 dark:text-ink-400"
              }`}
            >
              正式 Markdown 预览
            </button>
          )}
        </div>

        {/* 内容主体区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 状态处理中占位 */}
          {isProcessing && (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
              <p className="text-base font-semibold text-ink-800 dark:text-ink-100">
                {meeting.status === "TRANSCRIBING"
                  ? "正在进行语音识别转写中..."
                  : "AI 正在提取 7 要素结构化纪要..."}
              </p>
              <p className="text-xs text-ink-400">
                后台 Worker 正在处理，系统将自动刷新最新进度。
              </p>
            </div>
          )}

          {/* TAB 1: 7 要素草稿编辑区 */}
          {!isProcessing && activeTab === "draft" && (
            <div className="space-y-6">
              {/* 1. 会议摘要 */}
              <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
                <label className="mb-2 flex items-center justify-between text-sm font-bold text-ink-800 dark:text-ink-100">
                  <span>📋 1. 会议摘要 (Summary)</span>
                </label>
                <textarea
                  disabled={isPublished}
                  value={draft.summary}
                  onChange={(e) => updateDraftField("summary", e.target.value)}
                  rows={4}
                  placeholder="概括本次周会的核心背景、总体进展与关键共识..."
                  className="w-full rounded-lg border border-ink-300 p-3 text-sm text-ink-900 focus:border-indigo-500 focus:outline-none disabled:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
                />
              </div>

              {/* 2. 本周进展 */}
              <ArraySection
                title="🚀 2. 本周进展 (Progress)"
                items={draft.progress}
                disabled={isPublished}
                onChange={(idx, val) =>
                  handleArrayItemChange("progress", idx, val)
                }
                onAdd={() => handleAddArrayItem("progress")}
                onRemove={(idx) => handleRemoveArrayItem("progress", idx)}
                placeholder="例如：完成订单模块结算接口联调..."
              />

              {/* 3. 讨论事项 */}
              <ArraySection
                title="💬 3. 讨论事项 (Discussions)"
                items={draft.discussions}
                disabled={isPublished}
                onChange={(idx, val) =>
                  handleArrayItemChange("discussions", idx, val)
                }
                onAdd={() => handleAddArrayItem("discussions")}
                onRemove={(idx) => handleRemoveArrayItem("discussions", idx)}
                placeholder="例如：针对异步任务超时的幂等重试方案探讨..."
              />

              {/* 4. 决策事项 */}
              <ArraySection
                title="⚖️ 4. 决策事项 (Decisions)"
                items={draft.decisions}
                disabled={isPublished}
                onChange={(idx, val) =>
                  handleArrayItemChange("decisions", idx, val)
                }
                onAdd={() => handleAddArrayItem("decisions")}
                onRemove={(idx) => handleRemoveArrayItem("decisions", idx)}
                placeholder="例如：确定采用 Token Plan 异步 ASR 作为长音频方案..."
              />

              {/* 5. 待办事项 Action Items */}
              <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
                <div className="mb-3 flex items-center justify-between">
                  <label className="text-sm font-bold text-ink-800 dark:text-ink-100">
                    📌 5. 待办事项 (Action Items)
                  </label>
                  {!isPublished && (
                    <button
                      onClick={handleAddActionItem}
                      className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300"
                    >
                      + 添加待办
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {draft.actionItems.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-3">
                      <input
                        type="text"
                        disabled={isPublished}
                        value={item.task}
                        onChange={(e) =>
                          handleActionItemChange(idx, "task", e.target.value)
                        }
                        placeholder="具体待办任务内容..."
                        className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 focus:border-indigo-500 focus:outline-none disabled:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
                      />
                      <input
                        type="text"
                        disabled={isPublished}
                        value={item.assignee || ""}
                        onChange={(e) =>
                          handleActionItemChange(
                            idx,
                            "assignee",
                            e.target.value,
                          )
                        }
                        placeholder="负责人 (@张三)"
                        className="w-32 rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 focus:border-indigo-500 focus:outline-none disabled:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
                      />
                      <input
                        type="text"
                        disabled={isPublished}
                        value={item.dueDate || ""}
                        onChange={(e) =>
                          handleActionItemChange(idx, "dueDate", e.target.value)
                        }
                        placeholder="截止日期 (YYYY-MM-DD)"
                        className="w-36 rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 focus:border-indigo-500 focus:outline-none disabled:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
                      />
                      {!isPublished && (
                        <button
                          onClick={() => handleRemoveActionItem(idx)}
                          className="p-1 text-ink-400 hover:text-rose-500"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  {draft.actionItems.length === 0 && (
                    <p className="text-xs text-ink-400">暂无待办条目</p>
                  )}
                </div>
              </div>

              {/* 6. 风险预警 */}
              <ArraySection
                title="⚠️ 6. 风险预警 (Risks)"
                items={draft.risks}
                disabled={isPublished}
                onChange={(idx, val) =>
                  handleArrayItemChange("risks", idx, val)
                }
                onAdd={() => handleAddArrayItem("risks")}
                onRemove={(idx) => handleRemoveArrayItem("risks", idx)}
                placeholder="例如：第三方短信通道下周可能进行维护..."
              />

              {/* 7. 下周计划 */}
              <ArraySection
                title="🎯 7. 下周计划 (Next Plans)"
                items={draft.nextPlans}
                disabled={isPublished}
                onChange={(idx, val) =>
                  handleArrayItemChange("nextPlans", idx, val)
                }
                onAdd={() => handleAddArrayItem("nextPlans")}
                onRemove={(idx) => handleRemoveArrayItem("nextPlans", idx)}
                placeholder="例如：完成周会纪要前端验收测试与发布..."
              />
            </div>
          )}

          {/* TAB 2: 原始语音转录 */}
          {activeTab === "transcript" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-400">
                  {meeting.audioFileAsset?.originalName}（
                  {meeting.audioDuration
                    ? `${Math.round(meeting.audioDuration)}秒`
                    : "未知时长"}
                  ）
                </span>
                {meeting.rawTranscript && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        meeting.rawTranscript || "",
                      );
                      toast.success("已复制转录文本");
                    }}
                    className="text-xs font-medium text-indigo-600 hover:underline"
                  >
                    复制全篇文本
                  </button>
                )}
              </div>
              <div className="rounded-xl border border-ink-200 bg-ink-50 p-4 font-mono text-sm leading-relaxed text-ink-800 dark:border-ink-800 dark:bg-ink-800/40 dark:text-ink-200">
                {meeting.rawTranscript || "（暂无转录文本）"}
              </div>
            </div>
          )}

          {/* TAB 3: AI 原始版本 */}
          {activeTab === "ai_original" && (
            <div className="space-y-4">
              <p className="text-xs text-ink-400">
                这是 AI 初次根据语音与项目周报提取的原始 7
                要素备份（只读，不会被专员草稿覆盖）：
              </p>
              <div className="rounded-xl border border-ink-200 bg-ink-50 p-4 dark:border-ink-800 dark:bg-ink-800/40">
                <pre className="whitespace-pre-wrap text-xs text-ink-700 dark:text-ink-300">
                  {JSON.stringify(meeting.aiSummary, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: 正式 Markdown 预览 */}
          {activeTab === "published" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span>
                  ✅ 本周会已确认发布为正式项目文档，并已建立 RAG 向量索引。
                </span>
                {meeting.documentFileAssetId && (
                  <Link
                    href={`/projects/${projectId}/documents/${meeting.documentFileAssetId}`}
                    className="font-bold underline hover:opacity-80"
                  >
                    查看正式文档 →
                  </Link>
                )}
              </div>
              <div className="rounded-xl border border-ink-200 bg-white p-6 font-sans text-sm leading-relaxed text-ink-900 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-100">
                <pre className="whitespace-pre-wrap">
                  {meeting.publishedSummary}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between border-t border-ink-200 bg-ink-50/50 px-6 py-4 dark:border-ink-800 dark:bg-ink-800/30">
          <div className="text-xs text-ink-400">
            {isPublished && meeting.publishedAt && (
              <span>
                发布时间：{new Date(meeting.publishedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
            >
              关闭
            </button>

            {!isPublished && !isProcessing && (
              <>
                <button
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                >
                  {saving ? "保存中..." : "保存草稿"}
                </button>
                <button
                  onClick={() => setShowPublishConfirm(true)}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700"
                >
                  确认发布
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 确认发布二次确认弹窗 */}
      {showPublishConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-ink-900">
            <h4 className="text-lg font-bold text-ink-900 dark:text-ink-50">
              确认发布正式周会纪要？
            </h4>
            <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-ink-400">
              发布后将执行以下动作：
              <br />• 将当前草稿生成正式 Markdown 项目文档；
              <br />• 自动投递 IndexJob 并进入知识库 RAG 向量检索流程；
              <br />• 锁定当前纪要状态为「已发布」。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowPublishConfirm(false)}
                disabled={publishing}
                className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300"
              >
                取消
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {publishing ? "正在发布与构建索引..." : "确定发布"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ArraySection({
  title,
  items,
  disabled,
  onChange,
  onAdd,
  onRemove,
  placeholder,
}: {
  title: string;
  items: string[];
  disabled?: boolean;
  onChange: (idx: number, val: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  placeholder?: string;
}) {
  return (
    <div className="rounded-xl border border-ink-200 p-4 dark:border-ink-800">
      <div className="mb-3 flex items-center justify-between">
        <label className="text-sm font-bold text-ink-800 dark:text-ink-100">
          {title}
        </label>
        {!disabled && (
          <button
            onClick={onAdd}
            className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-300"
          >
            + 添加条目
          </button>
        )}
      </div>
      <div className="space-y-2.5">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <input
              type="text"
              disabled={disabled}
              value={item}
              onChange={(e) => onChange(idx, e.target.value)}
              placeholder={placeholder}
              className="flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-900 focus:border-indigo-500 focus:outline-none disabled:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
            />
            {!disabled && (
              <button
                onClick={() => onRemove(idx)}
                className="p-1 text-ink-400 hover:text-rose-500"
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-ink-400">暂无条目</p>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: MeetingItem["status"] }) {
  switch (status) {
    case "UPLOADING":
      return (
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          上传中
        </span>
      );
    case "TRANSCRIBING":
      return (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 animate-pulse">
          转录中...
        </span>
      );
    case "SUMMARIZING":
      return (
        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700 animate-pulse">
          生成纪要中...
        </span>
      );
    case "PENDING_REVIEW":
      return (
        <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
          待审核
        </span>
      );
    case "PUBLISHED":
      return (
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          已发布
        </span>
      );
    case "FAILED":
      return (
        <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
          失败
        </span>
      );
    default:
      return null;
  }
}
