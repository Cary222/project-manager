"use client";

/**
 * Shared Model Settings — Credential 表单（MERGE）
 *
 * 从 ModelsConfig.tsx 的 ApiKeyDetail 提取通用层：API Key 输入 / 保存 / 断开。
 * 持久化端点经 props 注入：
 * - Pi Workspace：POST/DELETE /api/auth/api-key/:id（Pi 文件凭证）
 * - ProjectHub：POST/DELETE /api/ai/providers（UserApiKey DB，经 CredentialService）
 */

import { useCallback, useEffect, useState } from "react";
import { useModelSettingsI18n } from "./i18n";
import { Field, SecretTextInput, SectionTitle } from "./form-controls";
import type { ApiKeyProvider } from "./types";

export function CredentialForm({
  provider,
  onSave,
  onRemove,
}: {
  provider: ApiKeyProvider;
  /** 保存 API Key；失败时抛 Error（message 展示给用户）。 */
  onSave: (apiKey: string) => Promise<void>;
  /** 断开（删除凭证）；不提供则不显示断开按钮。 */
  onRemove?: () => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const t = useModelSettingsI18n();

  // Reset state when provider changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      await onSave(apiKey.trim());
      setApiKey("");
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, onSave]);

  const handleRemove = useCallback(async () => {
    if (!onRemove) return;
    setRemoving(true);
    setError(null);
    try {
      await onRemove();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }, [onRemove]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>API Key</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.configured ? "#4ade80" : "var(--text-dim)" }}>
            {provider.configured ? t("i18n.configured") : t("i18n.notConfigured")}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? `API key is stored. Enter a new key below to replace it, or disconnect to remove it.`
          : `Enter your ${provider.displayName} API key to enable ${provider.modelCount} model${provider.modelCount !== 1 ? "s" : ""}.`}
      </p>

      <Field label="API Key">
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) void handleSave(); }}
            placeholder={provider.configured ? "Enter new key to replace…" : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={() => void handleSave()}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "#16a34a" : apiKey.trim() ? "var(--accent)" : "var(--bg-panel)",
              border: "none", borderRadius: 5,
              color: (apiKey.trim() || savedOk) ? "#fff" : "var(--text-dim)",
              cursor: (saving || !apiKey.trim() || savedOk) ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {savedOk && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{error}</p>}

      {provider.configured && onRemove && (
        <button
          onClick={() => void handleRemove()}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5, color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 12,
          }}
        >
          {removing ? t("i18n.removing") : t("i18n.disconnect")}
        </button>
      )}
    </div>
  );
}
