"use client";

import { useEffect, useState } from "react";
import { ModerationAction } from "@prisma/client";

type TargetUser = {
  id: string;
  name: string | null;
  email: string;
} | null;

type ModerationLogEntry = {
  id: string;
  action: ModerationAction;
  targetId: string;
  targetType: string;
  reason: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    email: string;
    role: string;
  };
  target: TargetUser;
};

const ACTION_LABELS: Record<ModerationAction, string> = {
  BAN_USER: "封禁用户",
  UNBAN_USER: "解封用户",
  UPDATE_ROLE: "修改角色",
  DELETE_TICKET: "删除单子",
  CREATE_TICKET: "创建单子",
  CREATE_MODULE: "创建模块",
  UPDATE_MODULE: "更新模块",
  DELETE_MODULE: "删除模块",
  MERGE_MODULE: "合并模块",
  CREATE_PROJECT: "创建项目",
  DELETE_PROJECT: "删除项目",
  UPDATE_TICKET_STATUS: "修改状态",
  UPDATE_TICKET_ASSIGNEE: "修改指派",
  UPDATE_TICKET_PROGRESS: "修改进度",
  EDIT_TICKET: "编辑单子",
  CHANGE_TICKET_MODULE: "移动模块",
};

const ACTION_COLORS: Record<ModerationAction, string> = {
  BAN_USER: "text-red-600 bg-red-50",
  UNBAN_USER: "text-green-600 bg-green-50",
  UPDATE_ROLE: "text-blue-600 bg-blue-50",
  DELETE_TICKET: "text-orange-600 bg-orange-50",
  CREATE_TICKET: "text-emerald-600 bg-emerald-50",
  CREATE_MODULE: "text-green-600 bg-green-50",
  UPDATE_MODULE: "text-blue-600 bg-blue-50",
  DELETE_MODULE: "text-red-600 bg-red-50",
  MERGE_MODULE: "text-purple-600 bg-purple-50",
  CREATE_PROJECT: "text-green-600 bg-green-50",
  DELETE_PROJECT: "text-red-600 bg-red-50",
  UPDATE_TICKET_STATUS: "text-blue-600 bg-blue-50",
  UPDATE_TICKET_ASSIGNEE: "text-amber-600 bg-amber-50",
  UPDATE_TICKET_PROGRESS: "text-cyan-600 bg-cyan-50",
  EDIT_TICKET: "text-indigo-600 bg-indigo-50",
  CHANGE_TICKET_MODULE: "text-violet-600 bg-violet-50",
};

export default function AdminModerationPage() {
  const [logs, setLogs] = useState<ModerationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/moderation")
      .then((r) => r.json())
      .then((data) => {
        setLogs(data.logs ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">审计日志</h2>
        <p className="mt-1 text-sm text-zinc-500">
          记录所有管理操作，便于追溯和安全审计。
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : logs.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white py-12 text-center text-sm text-zinc-500">
          暂无操作记录
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-4 rounded-lg border border-zinc-200 bg-white p-4"
            >
              <div className="flex flex-shrink-0 flex-col items-center">
                <span
                  className={`mb-1 rounded px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[log.action]}`}
                >
                  {ACTION_LABELS[log.action]}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium text-zinc-900">
                    {log.actor.name ?? log.actor.email}
                  </span>
                  <span className="text-zinc-400">{log.actor.role}</span>
                  <span className="text-zinc-400">→</span>
                  {log.targetType === "User" && log.target ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium text-zinc-900">
                        {log.target.name || <span className="text-zinc-400">未命名</span>}
                      </span>
                      <span className="text-xs text-zinc-400">{log.target.email}</span>
                    </div>
                  ) : (
                    <span className="text-zinc-500">
                      {log.targetType} ({log.targetId.slice(0, 8)}…)
                    </span>
                  )}
                </div>
                {log.reason && (
                  <p className="mt-1 text-sm text-zinc-500">{log.reason}</p>
                )}
              </div>

              <time className="flex-shrink-0 text-xs text-zinc-400">
                {new Date(log.createdAt).toLocaleString("zh-CN", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
