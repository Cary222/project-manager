"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  ProjectMeetingDetailModal,
  type MeetingItem,
} from "./ProjectMeetingDetailModal";
import { useToast } from "@/shared/lib/use-toast";
import { IconBook } from "@/shared/ui/icons";

interface Props {
  project: {
    id: string;
    name: string;
  };
}

export function ProjectMeetingTab({ project }: Props) {
  const [meetings, setMeetings] = useState<MeetingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(
    null,
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDeleteMeeting = async (meetingId: string, title: string) => {
    if (!window.confirm(`确定要删除周会「${title}」吗？删除后录音关联与纪要内容将被清除。`)) {
      return;
    }
    setDeletingId(meetingId);
    try {
      const res = await fetch(`/api/projects/${project.id}/meetings/${meetingId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "删除失败");
      }
      toast.success("周会记录已成功删除");
      fetchMeetings();
      if (selectedMeetingId === meetingId) {
        setSelectedMeetingId(null);
      }
    } catch (err) {
      toast.error(`删除失败: ${err instanceof Error ? err.message : "网络异常"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const { toast } = useToast();

  const fetchMeetings = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/meetings`);
      const json = await res.json();
      if (json.data) {
        setMeetings(json.data);
      }
    } catch {
      toast.error("获取周会列表失败");
    } finally {
      setLoading(false);
    }
  }, [project.id, toast]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${project.id}/meetings`);
        const json = await res.json();
        if (!ignore && json.data) {
          setMeetings(json.data);
        }
      } catch {
        if (!ignore) toast.error("获取周会列表失败");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [project.id, toast]);
  // 当列表中有转录或生成中的任务时，自动 4s 轮询一次
  useEffect(() => {
    const hasPending = meetings.some(
      (m) =>
        m.status === "TRANSCRIBING" ||
        m.status === "SUMMARIZING" ||
        m.status === "UPLOADING",
    );
    if (!hasPending) return;

    const timer = setInterval(() => {
      fetchMeetings();
    }, 4000);
    return () => clearInterval(timer);
  }, [meetings, fetchMeetings]);

  return (
    <div className="space-y-6">
      {/* 头部操作栏 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-ink-900 dark:text-ink-50">
            项目周会 AI 纪要
          </h2>
          <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">
            上传周会录音，通过 AI 自动转录并提炼 7
            要素纪要，支持人工审核修改并沉淀为正式项目文档与知识库索引。
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 transition-colors"
        >
          <span>+</span>
          <span>新建周会纪要</span>
        </button>
      </div>

      {/* 列表区域 */}
      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
          <div className="flex items-center gap-2 text-sm text-ink-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
            <span>加载周会记录中...</span>
          </div>
        </div>
      ) : meetings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 bg-white py-16 text-center dark:border-ink-700 dark:bg-ink-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
            <IconBook className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-sm font-bold text-ink-900 dark:text-ink-100">
            暂无周会纪要
          </h3>
          <p className="mt-1 text-xs text-ink-500 max-w-sm">
            点击右上角「新建周会纪要」，上传录音文件，AI
            将自动为你梳理会议摘要、进展、决策与待办事项。
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-5 rounded-lg bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300"
          >
            上传并创建
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xs dark:border-ink-800 dark:bg-ink-900">
          <div className="divide-y divide-ink-100 dark:divide-ink-800">
            {meetings.map((meeting) => (
              <div
                key={meeting.id}
                onClick={() => setSelectedMeetingId(meeting.id)}
                className="group flex flex-col gap-3 p-5 transition-colors hover:bg-ink-50/70 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-ink-800/40 cursor-pointer"
              >
                <div className="flex items-start gap-4">
                  <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
                    <IconBook className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h4 className="text-sm font-bold text-ink-900 group-hover:text-indigo-600 dark:text-ink-50 dark:group-hover:text-indigo-400">
                        {meeting.title}
                      </h4>
                      <MeetingListStatusBadge status={meeting.status} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500 dark:text-ink-400">
                      <span>
                        📅{" "}
                        {new Date(meeting.meetingDate)
                          .toISOString()
                          .slice(0, 10)}
                      </span>
                      {meeting.audioFileAsset && (
                        <span>
                          🎵 {meeting.audioFileAsset.originalName} (
                          {meeting.audioDuration
                            ? `${Math.round(meeting.audioDuration)}s`
                            : `${(meeting.audioFileAsset.size / (1024 * 1024)).toFixed(1)}MB`}
                          )
                        </span>
                      )}
                      <span>
                        👤{" "}
                        {meeting.creator?.name ||
                          meeting.creator?.email.split("@")[0]}
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  className="flex items-center gap-3 sm:shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  {meeting.status === "PUBLISHED" &&
                    meeting.documentFileAssetId && (
                      <Link
                        href={`/projects/${project.id}/documents/${meeting.documentFileAssetId}`}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        正式文档 →
                      </Link>
                    )}
                  <button
                    onClick={() => setSelectedMeetingId(meeting.id)}
                    className="rounded-lg border border-ink-200 px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                  >
                    {meeting.status === "PUBLISHED" ? "查看详情" : "审核与编辑"}
                  </button>
                  <button
                    onClick={() => handleDeleteMeeting(meeting.id, meeting.title)}
                    disabled={deletingId === meeting.id}
                    className="rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    title="删除周会记录"
                  >
                    {deletingId === meeting.id ? "删除中..." : "删除"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 详情与审核弹窗 */}
      {selectedMeetingId && (
        <ProjectMeetingDetailModal
          projectId={project.id}
          meetingId={selectedMeetingId}
          onClose={() => setSelectedMeetingId(null)}
          onUpdated={() => fetchMeetings()}
        />
      )}

      {/* 新建周会弹窗 */}
      {showCreateModal && (
        <CreateMeetingModal
          projectId={project.id}
          onClose={() => setShowCreateModal(false)}
          onCreated={(newMeetingId) => {
            setShowCreateModal(false);
            fetchMeetings();
            setSelectedMeetingId(newMeetingId);
          }}
        />
      )}
    </div>
  );
}

function CreateMeetingModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (meetingId: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState(
    `${new Date().getFullYear()}年第${getWeekNumber(new Date())}周 项目周例会`,
  );
  const [meetingDate, setMeetingDate] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const selected = e.dataTransfer.files[0];
      validateAndSetFile(selected);
    }
  };

  const validateAndSetFile = (f: File) => {
    const validExts = [".mp3", ".wav", ".m4a", ".webm", ".mp4"];
    const lowerName = f.name.toLowerCase();
    const isValid =
      validExts.some((ext) => lowerName.endsWith(ext)) ||
      f.type.startsWith("audio/");
    if (!isValid) {
      toast.error("仅支持 .mp3, .wav, .m4a 格式音频文件");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      toast.error("音频文件大小不能超过 100MB");
      return;
    }
    setFile(f);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("请填写会议主题");
      return;
    }
    if (!file) {
      toast.error("请选择或上传会议音频文件");
      return;
    }

    setUploading(true);
    setUploadProgress(20);

    try {
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("meetingDate", meetingDate);
      formData.append("file", file);

      setUploadProgress(60);

      const res = await fetch(`/api/projects/${projectId}/meetings`, {
        method: "POST",
        body: formData,
      });

      setUploadProgress(100);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "创建周会失败");
      }

      toast.success("周会已创建，后台已启动语音转录与 AI 纪要提取！");
      onCreated(json.data.id);
    } catch (err) {
      toast.error(
        `上传创建失败: ${err instanceof Error ? err.message : "网络异常"}`,
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl dark:bg-ink-900">
        <div className="flex items-center justify-between border-b border-ink-100 pb-3 dark:border-ink-800">
          <h3 className="text-base font-bold text-ink-900 dark:text-ink-50">
            新建项目周会 AI 纪要
          </h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-bold text-ink-700 dark:text-ink-300">
              周会主题 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：2026年第35周 项目周例会"
              className="mt-1.5 w-full rounded-xl border border-ink-300 px-3.5 py-2.5 text-sm text-ink-900 focus:border-indigo-500 focus:outline-none dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-700 dark:text-ink-300">
              会议日期 <span className="text-rose-500">*</span>
            </label>
            <input
              type="date"
              required
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-ink-300 px-3.5 py-2.5 text-sm text-ink-900 focus:border-indigo-500 focus:outline-none dark:border-ink-700 dark:bg-ink-800 dark:text-ink-100"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-700 dark:text-ink-300">
              会议录音音频 <span className="text-rose-500">*</span>
            </label>
            <input
              type="file"
              ref={fileInputRef}
              accept=".mp3,.wav,.m4a,audio/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) validateAndSetFile(e.target.files[0]);
              }}
            />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`mt-1.5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
                file
                  ? "border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
                  : "border-ink-300 hover:border-indigo-500 hover:bg-indigo-50/30 dark:border-ink-700"
              }`}
            >
              {file ? (
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-xl">🎵</span>
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    {file.name}
                  </p>
                  <p className="text-xs text-emerald-600/80">
                    {(file.size / (1024 * 1024)).toFixed(2)} MB（点击可更换）
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-xl">🎙️</span>
                  <p className="text-sm font-medium text-ink-700 dark:text-ink-200">
                    点击选择或将音频文件拖拽至此处
                  </p>
                  <p className="text-xs text-ink-400">
                    支持 mp3 / wav / m4a 格式，最大 100MB
                  </p>
                </div>
              )}
            </div>
          </div>

          {uploading && (
            <div className="space-y-1.5 pt-2">
              <div className="flex justify-between text-xs text-ink-500">
                <span>上传并创建任务中...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                <div
                  className="h-full bg-indigo-600 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="rounded-xl border border-ink-300 px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {uploading ? "上传处理中..." : "开始创建与转录"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MeetingListStatusBadge({ status }: { status: MeetingItem["status"] }) {
  switch (status) {
    case "UPLOADING":
      return (
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
          上传中
        </span>
      );
    case "TRANSCRIBING":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-600" />
          转录中
        </span>
      );
    case "SUMMARIZING":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-purple-600" />
          AI 生成纪要中
        </span>
      );
    case "PENDING_REVIEW":
      return (
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">
          待审核草稿
        </span>
      );
    case "PUBLISHED":
      return (
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
          已发布正式文档
        </span>
      );
    case "FAILED":
      return (
        <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
          处理失败
        </span>
      );
    default:
      return null;
  }
}

function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
