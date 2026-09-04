"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";

export interface MeetingSummaryData {
  summary: string;
  progress?: string[];
  discussions?: string[];
  decisions?: string[];
  actionItems?: Array<{ task: string; assignee?: string; dueDate?: string }>;
  risks?: string[];
  nextPlans?: string[];
}

export interface ProjectMeetingDetail {
  id: string;
  projectId: string;
  title: string;
  meetingDate: string;
  status:
    | "UPLOADING"
    | "TRANSCRIBING"
    | "SUMMARIZING"
    | "PENDING_REVIEW"
    | "PUBLISHED"
    | "FAILED";
  audioDuration?: number | null;
  rawTranscript?: string | null;
  aiSummary?: MeetingSummaryData | null;
  draftSummary?: MeetingSummaryData | null;
  publishedSummary?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string };
  audioFileAsset?: {
    id: string;
    originalName: string;
    size: number;
    mimeType: string;
  } | null;
}

interface MeetingMinutesWorkflowProps {
  initialMeetingId?: string;
  initialProjectId?: string;
  onBack: () => void;
  onDelete?: () => void;
  onMeetingCreated?: (meetingId: string, projectId: string) => void;
}

export function MeetingMinutesWorkflow({
  initialMeetingId,
  initialProjectId,
  onBack,
  onDelete,
  onMeetingCreated,
}: MeetingMinutesWorkflowProps) {
  // ─── 状态 ──────────────────────────────────────────────────────────────────
  const [meetingId, setMeetingId] = useState<string | null>(
    initialMeetingId ?? null,
  );
  const [projectId, setProjectId] = useState<string | null>(
    initialProjectId ?? null,
  );
  const [meeting, setMeeting] = useState<ProjectMeetingDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(
    Boolean(initialMeetingId),
  );

  // 新建表单字段
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [formTitle, setFormTitle] = useState(
    () => `研发周例会 - ${new Date().toLocaleDateString()}`,
  );
  const [formDate, setFormDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // 执行与编辑状态
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [saveSuccessHint, setSaveSuccessHint] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRawTranscript, setShowRawTranscript] = useState(false);

  // 草稿编辑状态（7 元素）
  const [draftSummaryText, setDraftSummaryText] = useState("");
  const [draftProgressText, setDraftProgressText] = useState("");
  const [draftDiscussionsText, setDraftDiscussionsText] = useState("");
  const [draftDecisionsText, setDraftDecisionsText] = useState("");
  const [draftActionItems, setDraftActionItems] = useState<
    Array<{ task: string; assignee: string; dueDate: string }>
  >([]);
  const [draftRisksText, setDraftRisksText] = useState("");
  const [draftNextPlansText, setDraftNextPlansText] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasNotifiedDoneRef = useRef(false);
  const onMeetingCreatedRef = useRef(onMeetingCreated);

  useEffect(() => {
    onMeetingCreatedRef.current = onMeetingCreated;
  }, [onMeetingCreated]);

  // ─── 1. 加载项目列表（用于下拉选择） ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function loadProjects() {
      setIsLoadingProjects(true);
      try {
        const res = await fetch("/api/projects");
        if (res.ok && !cancelled) {
          const json = await res.json();
          const list = (json.projects ?? json.data ?? []) as Array<{
            id: string;
            name: string;
          }>;
          setProjects(list);
          if (list.length > 0 && !projectId) {
            setProjectId(list[0].id);
          }
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setIsLoadingProjects(false);
      }
    }
    void loadProjects();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ─── 2. 加载会议详情与轮询 ──────────────────────────────────────────────────
  const fetchMeetingDetail = useCallback(
    async (pId: string | null, mId: string) => {
      try {
        const url = pId
          ? `/api/projects/${pId}/meetings/${mId}`
          : `/api/ai/work/meetings/${mId}`;
        let res = await fetch(url);
        if (!res.ok) {
          res = await fetch(`/api/ai/work/meetings/${mId}`);
        }
        if (!res.ok) return null;
        const json = await res.json();
        return json.data as ProjectMeetingDetail;
      } catch {
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!meetingId) return;

    let isMounted = true;
    async function poll() {
      if (!meetingId) return;
      const data = await fetchMeetingDetail(projectId, meetingId);
      if (!isMounted) return;

      if (!data) {
        setIsLoadingDetail(false);
        setErrorMessage("会议纪要记录不存在或已被删除");
        return;
      }

      setMeeting(data);
      if (data.projectId && (!projectId || projectId !== data.projectId)) {
        setProjectId(data.projectId);
      }
      setIsLoadingDetail(false);

      // 如果仍在转写或生成中，继续轮询 (2.5s 间隔)
      if (
        data.status === "TRANSCRIBING" ||
        data.status === "SUMMARIZING" ||
        data.status === "UPLOADING"
      ) {
        pollTimerRef.current = setTimeout(() => {
          void poll();
        }, 2500);
      } else {
        // 转写完成或状态更新时，仅通知父级刷新任务列表一次
        if (!hasNotifiedDoneRef.current) {
          hasNotifiedDoneRef.current = true;
          onMeetingCreatedRef.current?.(data.id, data.projectId);
        }
      }
    }

    void poll();

    return () => {
      isMounted = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [meetingId, projectId, fetchMeetingDetail]);

  // ─── 3. 进入编辑模式并初始化表单 ──────────────────────────────────────────────
  const handleStartEdit = useCallback(() => {
    const data = (meeting?.draftSummary ||
      meeting?.aiSummary) as MeetingSummaryData | null;
    setDraftSummaryText(data?.summary || "");
    setDraftProgressText((data?.progress || []).join("\n"));
    setDraftDiscussionsText((data?.discussions || []).join("\n"));
    setDraftDecisionsText((data?.decisions || []).join("\n"));
    setDraftActionItems(
      (data?.actionItems || []).map((item) => ({
        task: item.task || "",
        assignee: item.assignee || "",
        dueDate: item.dueDate || "",
      })),
    );
    setDraftRisksText((data?.risks || []).join("\n"));
    setDraftNextPlansText((data?.nextPlans || []).join("\n"));
    setIsEditing(true);
    setSaveSuccessHint(false);
  }, [meeting]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
  }, []);

  // ─── 4. 保存草稿修改 ────────────────────────────────────────────────────────
  const handleSaveDraft = useCallback(async () => {
    const currentPid = projectId || meeting?.projectId;
    if (!currentPid || !meetingId) return;

    setIsSavingDraft(true);
    try {
      const updatedSummaryData: MeetingSummaryData = {
        summary: draftSummaryText.trim(),
        progress: draftProgressText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        discussions: draftDiscussionsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        decisions: draftDecisionsText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        actionItems: draftActionItems
          .map((item) => ({
            task: item.task.trim(),
            assignee: item.assignee.trim() || undefined,
            dueDate: item.dueDate.trim() || undefined,
          }))
          .filter((item) => Boolean(item.task)),
        risks: draftRisksText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        nextPlans: draftNextPlansText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };

      const res = await fetch(
        `/api/projects/${currentPid}/meetings/${meetingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftSummary: updatedSummaryData }),
        },
      );

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "保存草稿失败");
      }

      setMeeting((prev) =>
        prev
          ? {
              ...prev,
              draftSummary: updatedSummaryData,
            }
          : null,
      );
      setIsEditing(false);
      setSaveSuccessHint(true);
      setTimeout(() => setSaveSuccessHint(false), 3000);
    } catch (err) {
      alert(`保存失败: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setIsSavingDraft(false);
    }
  }, [
    projectId,
    meeting?.projectId,
    meetingId,
    draftSummaryText,
    draftProgressText,
    draftDiscussionsText,
    draftDecisionsText,
    draftActionItems,
    draftRisksText,
    draftNextPlansText,
  ]);

  // ─── 5. 提交音频上传并创建会议 ──────────────────────────────────────────────
  const handleStartWorkflow = useCallback(async () => {
    if (!projectId) {
      setErrorMessage("请选择关联的项目");
      return;
    }
    if (!formTitle.trim()) {
      setErrorMessage("请输入会议主题");
      return;
    }
    if (!selectedFile) {
      setErrorMessage("请选择或拖拽上传会议录音文件");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("title", formTitle.trim());
      formData.append("meetingDate", formDate);
      formData.append("file", selectedFile);

      const res = await fetch(`/api/projects/${projectId}/meetings`, {
        method: "POST",
        body: formData,
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "创建会议失败");
      }

      const created = json.data as ProjectMeetingDetail;
      setMeetingId(created.id);
      setMeeting(created);
      onMeetingCreated?.(created.id, projectId);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "提交失败");
    } finally {
      setIsSubmitting(false);
    }
  }, [projectId, formTitle, formDate, selectedFile, onMeetingCreated]);

  // ─── 6. 一键正式发布 ────────────────────────────────────────────────────────
  const handlePublish = useCallback(async () => {
    const currentPid = projectId || meeting?.projectId;
    if (!currentPid || !meetingId) return;
    setIsPublishing(true);
    try {
      const res = await fetch(
        `/api/projects/${currentPid}/meetings/${meetingId}/publish`,
        {
          method: "POST",
        },
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "发布失败");
      }
      // 重新拉取最新数据
      const updated = await fetchMeetingDetail(currentPid, meetingId);
      if (updated) {
        setMeeting(updated);
        onMeetingCreatedRef.current?.(updated.id, currentPid);
      }
    } catch (err) {
      alert(`发布失败: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setIsPublishing(false);
    }
  }, [projectId, meeting?.projectId, meetingId, fetchMeetingDetail]);

  // ─── 7. 重新生成 ────────────────────────────────────────────────────────────
  const handleRetry = useCallback(async () => {
    const currentPid = projectId || meeting?.projectId;
    if (!currentPid || !meetingId) return;
    setIsRetrying(true);
    try {
      const res = await fetch(
        `/api/projects/${currentPid}/meetings/${meetingId}/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "ALL" }),
        },
      );
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "重试失败");
      }
      setMeeting((prev) => (prev ? { ...prev, status: "TRANSCRIBING" } : null));
    } catch (err) {
      alert(`重试失败: ${err instanceof Error ? err.message : "未知错误"}`);
    } finally {
      setIsRetrying(false);
    }
  }, [projectId, meeting?.projectId, meetingId]);

  // ─── 状态 Badge 渲染 ────────────────────────────────────────────────────────
  const renderStatusBadge = (status?: string) => {
    switch (status) {
      case "PUBLISHED":
        return (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            ✓ 已发布为正式文档
          </span>
        );
      case "PENDING_REVIEW":
        return (
          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            ⏳ 待审阅确认
          </span>
        );
      case "TRANSCRIBING":
        return (
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            🎙️ 录音转写中…
          </span>
        );
      case "SUMMARIZING":
        return (
          <span className="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700">
            🤖 AI 7 元素提炼中…
          </span>
        );
      case "FAILED":
        return (
          <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">
            ❌ 处理失败
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center rounded-full border border-ink-200 bg-ink-50 px-2.5 py-0.5 text-xs font-medium text-ink-700">
            准备中
          </span>
        );
    }
  };

  const summaryData = (meeting?.draftSummary ||
    meeting?.aiSummary) as MeetingSummaryData | null;

  if (isLoadingDetail && !meeting) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex w-fit items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-800"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
          返回列表
        </button>
        <div className="flex items-center gap-2">
          {onDelete && meetingId && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>删除会议及产物</span>
            </button>
          )}
          {renderStatusBadge(meeting?.status)}
        </div>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-ink-900">
          {meeting ? meeting.title : "智能会议纪要工作流"}
        </h1>
        <p className="mt-1 text-xs text-ink-500">
          {meeting
            ? `会议日期：${new Date(meeting.meetingDate).toLocaleDateString()} · 更新时间：${new Date(meeting.updatedAt).toLocaleString()}`
            : "录音上传 → Whisper 语音转写 → 7 元素智能摘要 → 审阅与一键入库"}
        </p>
      </header>

      {/* ─── 场景 A：创建/上传界面 ─── */}
      {!meetingId && (
        <div className="space-y-6 rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-ink-700">
                关联项目 <span className="text-red-500">*</span>
              </label>
              <select
                value={projectId || ""}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={isLoadingProjects || isSubmitting}
                className="mt-1 w-full rounded-lg border border-ink-300 bg-white p-2.5 text-sm outline-none focus:border-brand-500"
              >
                {isLoadingProjects ? (
                  <option value="">加载项目列表中...</option>
                ) : projects.length === 0 ? (
                  <option value="">暂无可选项目</option>
                ) : (
                  projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-700">
                会议日期 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                disabled={isSubmitting}
                className="mt-1 w-full rounded-lg border border-ink-300 bg-white p-2.5 text-sm outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink-700">
              会议主题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="例如：2026/09/01 研发周例会"
              disabled={isSubmitting}
              className="mt-1 w-full rounded-lg border border-ink-300 bg-white p-2.5 text-sm outline-none focus:border-brand-500"
            />
          </div>

          {/* 录音上传 Dropzone */}
          <div>
            <label className="block text-xs font-semibold text-ink-700">
              会议录音文件 (.mp3, .wav, .m4a, .webm){" "}
              <span className="text-red-500">*</span>
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.[0]) {
                  setSelectedFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all ${
                isDragOver
                  ? "border-brand-500 bg-brand-50/50"
                  : selectedFile
                    ? "border-emerald-400 bg-emerald-50/40"
                    : "border-ink-300 bg-ink-50/50 hover:border-brand-400 hover:bg-ink-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.webm,.mp4"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    setSelectedFile(e.target.files[0]);
                  }
                }}
                className="hidden"
              />
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </div>
              {selectedFile ? (
                <div className="mt-3 text-center">
                  <p className="text-sm font-semibold text-emerald-800">
                    {selectedFile.name}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-600">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB ·
                    点击可更换文件
                  </p>
                </div>
              ) : (
                <div className="mt-3 text-center">
                  <p className="text-sm font-medium text-ink-700">
                    点击或将录音文件拖拽至此处
                  </p>
                  <p className="mt-1 text-xs text-ink-400">
                    支持 mp3, wav, m4a, webm 格式，最大 100MB
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => void handleStartWorkflow()}
              disabled={isSubmitting || !selectedFile || !projectId}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>上传并启动中…</span>
                </>
              ) : (
                <>
                  <span>🚀 开始自动转写与纪要生成</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ─── 场景 B：转写与提炼进度流水线 ─── */}
      {meeting &&
        (meeting.status === "UPLOADING" ||
          meeting.status === "TRANSCRIBING" ||
          meeting.status === "SUMMARIZING") && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
                <p className="font-semibold text-blue-900">
                  {meeting.status === "TRANSCRIBING"
                    ? "🎙️ 正在进行语音识别与转写…"
                    : meeting.status === "SUMMARIZING"
                      ? "🤖 正在提炼 7 元素智能结构化纪要…"
                      : "📤 音频上传处理中…"}
                </p>
              </div>
              <span className="font-mono text-xs text-blue-600">处理中</span>
            </div>

            {/* 步骤条 */}
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="rounded-lg bg-white p-3 shadow-xs">
                <p className="text-xs font-semibold text-emerald-700">
                  ✓ 1. 音频解析
                </p>
                <p className="mt-1 text-[11px] text-ink-500">
                  {meeting.audioFileAsset?.originalName || "录音文件已就绪"}
                </p>
              </div>
              <div
                className={`rounded-lg p-3 shadow-xs ${meeting.status === "TRANSCRIBING" ? "bg-blue-100/80 border border-blue-300" : "bg-white"}`}
              >
                <p
                  className={`text-xs font-semibold ${meeting.status === "TRANSCRIBING" ? "text-blue-800" : "text-ink-500"}`}
                >
                  {meeting.status === "TRANSCRIBING"
                    ? "🔄 2. 语音转文字 (Whisper)"
                    : "2. 语音转文字"}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">
                  识别多方对话与发言
                </p>
              </div>
              <div
                className={`rounded-lg p-3 shadow-xs ${meeting.status === "SUMMARIZING" ? "bg-purple-100/80 border border-purple-300" : "bg-white"}`}
              >
                <p
                  className={`text-xs font-semibold ${meeting.status === "SUMMARIZING" ? "text-purple-800" : "text-ink-500"}`}
                >
                  {meeting.status === "SUMMARIZING"
                    ? "🔄 3. 7 元素提炼"
                    : "3. 7 元素提炼"}
                </p>
                <p className="mt-1 text-[11px] text-ink-500">
                  议题、决议、待办、风险
                </p>
              </div>
            </div>
          </div>
        )}

      {/* ─── 场景 C：失败重试 ─── */}
      {meeting && meeting.status === "FAILED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6">
          <p className="font-semibold text-red-900">❌ 处理过程中发生异常</p>
          <p className="mt-1 text-sm text-red-700">
            {meeting.errorMessage || "语音转写或 AI 摘要提取失败"}
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
              className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {isRetrying ? "重试中…" : "🔄 重新尝试转写与提取"}
            </button>
          </div>
        </div>
      )}

      {/* ─── 场景 D：转写完成，展示 7 元素摘要、编辑与一键发布 ─── */}
      {meeting &&
        (meeting.status === "PENDING_REVIEW" ||
          meeting.status === "PUBLISHED") && (
          <div className="space-y-6">
            {saveSuccessHint && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                ✓ 草稿修改已成功保存
              </div>
            )}

            {/* 7 元素结构化卡片 */}
            {summaryData ? (
              <div className="space-y-5 rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
                {/* 卡片头部与编辑切换按钮 */}
                <div className="flex items-center justify-between border-b border-ink-100 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-purple-50 text-purple-600">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </span>
                    <h2 className="text-sm font-semibold text-ink-900">
                      {isEditing
                        ? "编辑会议纪要草稿 (7 元素)"
                        : "会议纪要智能提炼 (7 元素)"}
                    </h2>
                  </div>
                  {meeting.status === "PENDING_REVIEW" && (
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            disabled={isSavingDraft}
                            className="rounded-lg border border-ink-200 bg-white px-3 py-1 text-xs font-medium text-ink-600 transition hover:bg-ink-50"
                          >
                            取消编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleSaveDraft()}
                            disabled={isSavingDraft}
                            className="rounded-lg bg-brand-600 px-3.5 py-1 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
                          >
                            {isSavingDraft ? "保存中…" : "💾 保存草稿修改"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={handleStartEdit}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50/70 px-3 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          <span>✏️ 编辑草稿</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* ── 编辑模式 ── */}
                {isEditing ? (
                  <div className="space-y-5 text-xs">
                    {/* 1. 会议综述 */}
                    <div>
                      <label className="block font-semibold text-ink-800 mb-1">
                        📌 会议综述
                      </label>
                      <textarea
                        value={draftSummaryText}
                        onChange={(e) => setDraftSummaryText(e.target.value)}
                        rows={4}
                        className="w-full rounded-lg border border-ink-300 bg-white p-2.5 text-xs text-ink-800 outline-none focus:border-brand-500"
                        placeholder="输入会议综述概要..."
                      />
                    </div>

                    {/* 2. 进展回顾 */}
                    <div>
                      <label className="block font-semibold text-ink-800 mb-1">
                        🚀 进展回顾 (每行一条)
                      </label>
                      <textarea
                        value={draftProgressText}
                        onChange={(e) => setDraftProgressText(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-ink-300 bg-white p-2.5 text-xs text-ink-800 outline-none focus:border-brand-500"
                        placeholder="每行输入一条进展..."
                      />
                    </div>

                    {/* 3. 核心讨论 */}
                    <div>
                      <label className="block font-semibold text-ink-800 mb-1">
                        💬 核心讨论 (每行一条)
                      </label>
                      <textarea
                        value={draftDiscussionsText}
                        onChange={(e) =>
                          setDraftDiscussionsText(e.target.value)
                        }
                        rows={3}
                        className="w-full rounded-lg border border-ink-300 bg-white p-2.5 text-xs text-ink-800 outline-none focus:border-brand-500"
                        placeholder="每行输入一条讨论焦点..."
                      />
                    </div>

                    {/* 4. 达成决议 */}
                    <div>
                      <label className="block font-semibold text-ink-800 mb-1">
                        ✅ 达成决议 (每行一条)
                      </label>
                      <textarea
                        value={draftDecisionsText}
                        onChange={(e) => setDraftDecisionsText(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-ink-300 bg-white p-2.5 text-xs text-ink-800 outline-none focus:border-brand-500"
                        placeholder="每行输入一条明确决议..."
                      />
                    </div>

                    {/* 5. 待办行动项 */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="font-semibold text-ink-800">
                          📋 待办行动项 (Action Items)
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setDraftActionItems((prev) => [
                              ...prev,
                              { task: "", assignee: "", dueDate: "" },
                            ])
                          }
                          className="rounded border border-ink-200 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-600 hover:bg-brand-50"
                        >
                          + 添加待办项
                        </button>
                      </div>
                      <div className="space-y-2">
                        {draftActionItems.map((item, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="text"
                              value={item.task}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDraftActionItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, task: val } : it,
                                  ),
                                );
                              }}
                              placeholder="任务内容 *"
                              className="flex-1 rounded-md border border-ink-300 bg-white p-1.5 text-xs outline-none focus:border-brand-500"
                            />
                            <input
                              type="text"
                              value={item.assignee}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDraftActionItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, assignee: val } : it,
                                  ),
                                );
                              }}
                              placeholder="负责人"
                              className="w-24 rounded-md border border-ink-300 bg-white p-1.5 text-xs outline-none focus:border-brand-500"
                            />
                            <input
                              type="text"
                              value={item.dueDate}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDraftActionItems((prev) =>
                                  prev.map((it, i) =>
                                    i === idx ? { ...it, dueDate: val } : it,
                                  ),
                                );
                              }}
                              placeholder="截止日 (YYYY-MM-DD)"
                              className="w-32 rounded-md border border-ink-300 bg-white p-1.5 text-xs outline-none focus:border-brand-500"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setDraftActionItems((prev) =>
                                  prev.filter((_, i) => i !== idx),
                                )
                              }
                              className="rounded p-1 text-ink-400 hover:text-red-600"
                              title="删除此项"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 6. 风险与阻塞 */}
                    <div>
                      <label className="block font-semibold text-ink-800 mb-1">
                        ⚠️ 风险与阻塞 (每行一条)
                      </label>
                      <textarea
                        value={draftRisksText}
                        onChange={(e) => setDraftRisksText(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-ink-300 bg-white p-2.5 text-xs text-ink-800 outline-none focus:border-brand-500"
                        placeholder="每行输入一条潜在风险或阻塞..."
                      />
                    </div>

                    {/* 7. 后续安排 */}
                    <div>
                      <label className="block font-semibold text-ink-800 mb-1">
                        ⏭️ 后续安排与下次重点 (每行一条)
                      </label>
                      <textarea
                        value={draftNextPlansText}
                        onChange={(e) => setDraftNextPlansText(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-ink-300 bg-white p-2.5 text-xs text-ink-800 outline-none focus:border-brand-500"
                        placeholder="每行输入一条计划..."
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-100">
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={isSavingDraft}
                        className="rounded-lg border border-ink-200 bg-white px-4 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveDraft()}
                        disabled={isSavingDraft}
                        className="rounded-lg bg-brand-600 px-5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                      >
                        {isSavingDraft ? "保存中…" : "💾 保存草稿修改"}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── 查看渲染模式 ── */
                  <div className="space-y-4">
                    {/* 1. 会议概述 */}
                    {summaryData.summary && (
                      <div className="border-b border-ink-100 pb-4">
                        <h3 className="text-sm font-semibold text-ink-900">
                          📌 会议综述
                        </h3>
                        <p className="mt-2 text-sm leading-relaxed text-ink-700">
                          {summaryData.summary}
                        </p>
                      </div>
                    )}

                    {/* 2. 进展回顾 */}
                    {summaryData.progress &&
                      summaryData.progress.length > 0 && (
                        <div className="border-b border-ink-100 pb-4">
                          <h3 className="text-sm font-semibold text-ink-900">
                            🚀 进展回顾
                          </h3>
                          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-ink-700">
                            {summaryData.progress.map((p, i) => (
                              <li key={i}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {/* 3. 核心讨论点 */}
                    {summaryData.discussions &&
                      summaryData.discussions.length > 0 && (
                        <div className="border-b border-ink-100 pb-4">
                          <h3 className="text-sm font-semibold text-ink-900">
                            💬 核心讨论
                          </h3>
                          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-ink-700">
                            {summaryData.discussions.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {/* 4. 明确决议 */}
                    {summaryData.decisions &&
                      summaryData.decisions.length > 0 && (
                        <div className="border-b border-ink-100 pb-4">
                          <h3 className="text-sm font-semibold text-emerald-800">
                            ✅ 达成决议
                          </h3>
                          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-emerald-900">
                            {summaryData.decisions.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    {/* 5. 待办行动项 */}
                    {summaryData.actionItems &&
                      summaryData.actionItems.length > 0 && (
                        <div className="border-b border-ink-100 pb-4">
                          <h3 className="text-sm font-semibold text-blue-900">
                            📋 待办行动项 (Action Items)
                          </h3>
                          <div className="mt-2 divide-y divide-ink-100">
                            {summaryData.actionItems.map((item, i) => (
                              <div
                                key={i}
                                className="flex items-center justify-between py-2 text-xs"
                              >
                                <span className="font-medium text-ink-800">
                                  · {item.task}
                                </span>
                                <div className="flex items-center gap-2 text-[11px] text-ink-500">
                                  {item.assignee && (
                                    <span>负责人: {item.assignee}</span>
                                  )}
                                  {item.dueDate && (
                                    <span>截止: {item.dueDate}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    {/* 6. 风险与阻塞 */}
                    {summaryData.risks && summaryData.risks.length > 0 && (
                      <div className="border-b border-ink-100 pb-4">
                        <h3 className="text-sm font-semibold text-amber-800">
                          ⚠️ 风险与阻塞
                        </h3>
                        <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-900">
                          {summaryData.risks.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 7. 后续安排 */}
                    {summaryData.nextPlans &&
                      summaryData.nextPlans.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold text-ink-900">
                            ⏭️ 后续安排与下次重点
                          </h3>
                          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-ink-700">
                            {summaryData.nextPlans.map((np, i) => (
                              <li key={i}>{np}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                  </div>
                )}
              </div>
            ) : meeting.publishedSummary ? (
              <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
                <MarkdownContent content={meeting.publishedSummary} />
              </div>
            ) : null}

            {/* 原始转录文本 (可折叠) */}
            {meeting.rawTranscript && (
              <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink-800">
                    📜 录音原始转写全文
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowRawTranscript((s) => !s)}
                    className="text-xs text-brand-600 hover:underline"
                  >
                    {showRawTranscript ? "收起全文" : "展开全文"}
                  </button>
                </div>
                {showRawTranscript && (
                  <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-700">
                    {meeting.rawTranscript}
                  </div>
                )}
              </div>
            )}

            {/* 底部操作条：一键发布 */}
            <div className="flex items-center justify-between rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
              <div>
                {meeting.status === "PUBLISHED" ? (
                  <p className="text-xs font-semibold text-emerald-700">
                    ✓ 该周会纪要已正式发布并进入项目知识库检索 (RAG
                    向量化已完成)
                  </p>
                ) : (
                  <p className="text-xs text-ink-500">
                    审阅或编辑无误后，点击右侧按钮将纪要正式固化为项目文档并构建向量索引
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {meeting.status === "PENDING_REVIEW" && !isEditing && (
                  <button
                    type="button"
                    onClick={() => void handlePublish()}
                    disabled={isPublishing}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isPublishing ? "发布中…" : "✓ 一键正式发布为项目文档"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
