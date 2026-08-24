"use client";

import { useEffect, useState } from "react";
import { getProfileAction, updatePreferredAiModelAction } from "@/features/admin/settings";
import { ConfigPanelModelSelect } from "@/features/ai/ui/model-select";
import { ProjectHubModelSettings } from "./project-hub-model-settings";

/**
 * AI 模型配置面板 — 入口组件（Stage 6）
 *
 * 统一的 ProjectHub AI Settings：
 *   - 顶部：对话总结用模型偏好（User.preferredAiModel，保留兼容）
 *   - 主体：ProjectHubModelSettings（Pi 风格 UI + ProjectHub DB/CredentialService）
 *
 * 旧 ModelConfigPanel 已被替代，确认无引用后删除。
 */
export function AiModelConfigPanel() {
  const [preferredAiModel, setPreferredAiModel] = useState<string | null | undefined>(undefined);
  const [selectedPreferredModel, setSelectedPreferredModel] = useState<string>("");
  const [preferredFlash, setPreferredFlash] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [preferredSaving, setPreferredSaving] = useState(false);

  useEffect(() => {
    getProfileAction().then((profile) => {
      const value = profile?.preferredAiModel ?? null;
      setPreferredAiModel(value);
      setSelectedPreferredModel(value ?? "");
    }).catch(() => {
      setPreferredAiModel(null);
    });
  }, []);

  if (preferredAiModel === undefined) return null;

  async function handlePreferredModelSave() {
    setPreferredSaving(true);
    setPreferredFlash(null);
    // 空字符串表示使用默认（Agnes）
    const modelToSave = selectedPreferredModel === "" ? null : selectedPreferredModel;
    const result = await updatePreferredAiModelAction(modelToSave);
    setPreferredSaving(false);
    if (result.error) {
      setPreferredFlash({ type: "error", message: result.error });
    } else {
      setPreferredFlash({ type: "success", message: "AI 模型偏好已保存" });
    }
  }

  return (
    <div className="space-y-5">
      {/* 对话总结用 AI 模型偏好 */}
      <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">对话总结模型</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ConfigPanelModelSelect
              value={selectedPreferredModel === "default" ? "" : selectedPreferredModel}
              onChange={(modelRef) => setSelectedPreferredModel(modelRef)}
            />
          </div>
          <button
            type="button"
            onClick={() => void handlePreferredModelSave()}
            disabled={preferredSaving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {preferredSaving ? "保存中…" : "保存"}
          </button>
        </div>
        {preferredFlash && (
          <p
            className={`mt-2 rounded-md border px-3 py-2 text-xs ${
              preferredFlash.type === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {preferredFlash.message}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-500">
          {selectedPreferredModel === "default" || selectedPreferredModel === ""
            ? "使用系统默认的 Agnes 模型进行对话总结"
            : "使用选中的模型进行对话总结"}
        </p>
      </div>

      {/* 统一 Model Settings（Pi UX + ProjectHub DB） */}
      <ProjectHubModelSettings />
    </div>
  );
}
