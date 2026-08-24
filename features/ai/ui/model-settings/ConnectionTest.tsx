"use client";

/**
 * Shared Model Settings — Connection Test（ADAPT）
 *
 * 从 ModelsConfig.tsx ModelDetail 内的测试按钮 + 状态摘要提取。
 * test 能力经 ModelSettingsAdapter 注入（Pi: /api/models-config/test；
 * ProjectHub: /api/ai/providers/test），服务端核心共用 lib/model-connection-test.ts。
 */

import { useCallback, useEffect, useState } from "react";
import { useModelSettingsAdapter } from "./adapter";
import { useModelSettingsI18n } from "./i18n";
import type { ModelEntry, ModelTestState, ProviderEntry } from "./types";

export function ConnectionTest({
  providerName,
  provider,
  model,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
}) {
  const adapter = useModelSettingsAdapter();
  const t = useModelSettingsI18n();
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });

  useEffect(() => {
    // 输入变化时重置测试结果（与原实现同语义）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const outcome = await adapter.test({ providerName, provider, model });
      if (!outcome.ok) {
        setTestState({
          phase: "error",
          message: outcome.error ?? "Test failed",
          latencyMs: outcome.latencyMs,
          status: outcome.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: outcome.latencyMs,
        status: outcome.status,
        responseText: outcome.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [adapter, model, provider, providerName, testState.phase]);

  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return t("i18n.testingModel");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return [t("i18n.connected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
    return [t("i18n.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {testSummary && (
        <span
          title={testSummary}
          style={{
            maxWidth: 260,
            height: 24,
            padding: "0 8px",
            border: `1px solid ${testState.phase === "error" ? "#fecaca" : testState.phase === "success" ? "#bbf7d0" : "var(--border)"}`,
            borderRadius: 4,
            background: testState.phase === "error" ? "#fee2e2" : testState.phase === "success" ? "#dcfce7" : "#e5e7eb",
            color: "#111827",
            fontSize: 11,
            display: "inline-flex",
            alignItems: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            boxSizing: "border-box",
          }}
        >
          {testSummary}
        </span>
      )}
      <button
        onClick={handleTest}
        disabled={!model.id.trim() || testState.phase === "testing"}
        title={t("i18n.testConnection")}
        style={{
          height: 24,
          padding: "0 8px",
          background: testState.phase === "success" ? "#16a34a" : "none",
          border: `1px solid ${testState.phase === "success" ? "#16a34a" : "var(--border)"}`,
          borderRadius: 4,
          color: testState.phase === "success" ? "#fff" : (!model.id.trim() || testState.phase === "testing") ? "var(--text-dim)" : "var(--text-muted)",
          cursor: (!model.id.trim() || testState.phase === "testing") ? "not-allowed" : "pointer",
          fontSize: 11,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          boxSizing: "border-box",
          gap: 5,
        }}
      >
        {testState.phase === "success" && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {testState.phase === "testing" ? t("i18n.checking") : testState.phase === "success" ? t("common.ok") : t("i18n.test")}
      </button>
    </div>
  );
}
