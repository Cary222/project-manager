"use client";

import { useState } from "react";
import { IconX, IconSparkles, IconArrowRight } from "@/shared/ui/icons";
import type { WorkRoute } from "@/features/ai/agents/work/runtime/work-run-ref";

export interface SwitchToWorkModalProps {
  /** 弹窗是否开启 */
  isOpen: boolean;
  /** 初始需求提炼文本 */
  initialGoalPrompt: string;
  /** 推荐的工作流类型 */
  suggestedWorkflowType: string;
  /** 工作流名称 */
  workflowName?: string;
  /** 工作流说明 */
  description?: string;
  /** 用户确认切换：带入确认后的需求与目标路由 */
  onConfirm: (goalPrompt: string, targetRoute: WorkRoute | null) => void;
  /** 关闭/取消 */
  onDismiss: () => void;
}

const ROUTE_OPTIONS: Array<{ value: WorkRoute | null; label: string; desc: string }> = [
  { value: null, label: "智能自动分诊", desc: "由 Work Agent 根据目标自动推导执行路径" },
  { value: "weekly_report", label: "周报生成", desc: "汇总周报并支持审阅导出" },
  { value: "project_progress", label: "项目进展", desc: "4项关键指标与项目活跃工单大盘" },
  { value: "meeting_minutes", label: "会议纪要", desc: "拖拽录音转写与7要素提炼发布" },
  { value: "coding", label: "Coding开发", desc: "Pi Coding Agent 执行代码变更与审查" },
];

function normalizeRoute(type: string): WorkRoute | null {
  if (type === "weekly_report") return "weekly_report";
  if (type === "project_progress" || type === "project-progress") return "project_progress";
  if (type === "meeting_minutes") return "meeting_minutes";
  if (type === "coding") return "coding";
  return null;
}

export function SwitchToWorkModal(props: SwitchToWorkModalProps) {
  if (!props.isOpen) return null;
  return <SwitchToWorkModalContent {...props} />;
}

function SwitchToWorkModalContent({
  initialGoalPrompt,
  suggestedWorkflowType,
  workflowName,
  description,
  onConfirm,
  onDismiss,
}: SwitchToWorkModalProps) {
  const [goalPrompt, setGoalPrompt] = useState(initialGoalPrompt);
  const [selectedRoute, setSelectedRoute] = useState<WorkRoute | null>(() =>
    normalizeRoute(suggestedWorkflowType),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg rounded-2xl border border-ink-200 bg-white p-6 shadow-2xl transition-all"
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-work-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <IconSparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 id="switch-work-modal-title" className="text-base font-semibold text-ink-900">
                切换至工作台执行任务
              </h2>
              <p className="text-xs text-ink-500">
                {description ? `${description}（匹配：${workflowName || suggestedWorkflowType}）` : "AI 已提炼出任务目标，您可以确认或修改后切换至工作台。"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600 transition"
            aria-label="关闭"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="mt-5 space-y-4">
          {/* Target Route Selector */}
          <div>
            <label className="block text-xs font-medium text-ink-700 mb-1.5">
              预设工作流路由
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {ROUTE_OPTIONS.map((opt) => {
                const isSelected = selectedRoute === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => setSelectedRoute(opt.value)}
                    className={`flex flex-col items-start rounded-xl border p-2 text-left transition ${
                      isSelected
                        ? "border-brand-500 bg-brand-50/70 text-brand-900 ring-1 ring-brand-500"
                        : "border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50/50"
                    }`}
                  >
                    <span className="text-xs font-semibold">{opt.label}</span>
                    <span className="text-[10px] text-ink-400 line-clamp-1">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Goal Prompt Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="goal-prompt-input" className="block text-xs font-medium text-ink-700">
                确认任务需求描述
              </label>
              <span className="text-[11px] text-ink-400">将填入工作台输入框</span>
            </div>
            <textarea
              id="goal-prompt-input"
              rows={3}
              value={goalPrompt}
              onChange={(e) => setGoalPrompt(e.target.value)}
              placeholder="请输入清晰的任务目标或由对话提炼的指令..."
              className="w-full rounded-xl border border-ink-300 bg-white p-3 text-xs text-ink-900 leading-relaxed outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition"
            />
          </div>

          {/* Prompt Tip */}
          <div className="rounded-xl bg-ink-50 p-3 text-[11px] text-ink-600 border border-ink-100 flex items-start gap-2">
            <span className="text-brand-600 font-bold">提示:</span>
            <span>
              进入 Work 工作台后，您可以进一步调整任务参数，点击「创建任务」或「开始执行」开启流水线。
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-xl border border-ink-200 bg-white px-4 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50 transition"
          >
            留在对话中继续补充
          </button>
          <button
            type="button"
            onClick={() => onConfirm(goalPrompt.trim(), selectedRoute)}
            disabled={!goalPrompt.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 transition"
          >
            <span>确认并前往工作台</span>
            <IconArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
