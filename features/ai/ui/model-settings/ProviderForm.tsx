"use client";

/**
 * Shared Model Settings — Provider 配置表单（KEEP）
 *
 * 从 ModelsConfig.tsx 的 ProviderDetail 提取：名称/Base URL/API Key/API/Headers
 * + Model Discovery 面板。Discovery 经 ModelSettingsAdapter 注入。
 */

import { useEffect, useState } from "react";
import { useModelSettingsI18n } from "./i18n";
import { Field, SecretTextInput, SectionTitle, Select, TextInput } from "./form-controls";
import { HeaderListEditor } from "./ModelMetadata";
import { ModelDiscoveryPanel } from "./ModelDiscoveryPanel";
import { API_OPTIONS, type DiscoveredModel, type ProviderEntry } from "./types";

export function ProviderForm({
  name,
  provider,
  onChange,
  onRename,
  onDelete,
  onAddModels,
  readOnly = false,
}: {
  name: string;
  provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void;
  onRename: (n: string) => void;
  onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void;
  /** 继承自站点配置的 provider：只读提示，重命名/删除/保存不落库。 */
  readOnly?: boolean;
}) {
  const t = useModelSettingsI18n();
  const [editingName, setEditingName] = useState(name);
  useEffect(() => {
    // 外部重命名后同步编辑框（与原实现同语义）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditingName(name);
  }, [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {readOnly && (
        <div style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>
          此 Provider 继承自站点 AI 配置（用户/系统凭证），在此处仅供查看与测试；
          修改凭证请到 设置 → AI 模型配置。保存时不会写入当前存储。
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("i18n.provider")}</SectionTitle>
        <button onClick={onDelete}
          style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11 }}>
          {readOnly ? "从视图移除" : t("i18n.delete")}
        </button>
      </div>

      <Field label={t("i18n.providerName")}>
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {!readOnly && editingName !== name && editingName.trim() && (
          <button onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, padding: "3px 10px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, alignSelf: "flex-start" }}>
            {t("i18n.rename")}
          </button>
        )}
      </Field>

      <Field label="Base URL">
        <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1" mono />
      </Field>

      <Field label="API Key">
        <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
          placeholder="ENV_VAR_NAME, !shell-command, or literal key" mono />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          Prefix with <code style={{ fontFamily: "var(--font-mono)" }}>!</code> to run a shell command, or use an env var name
        </span>
      </Field>

      <Field label="API">
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      <Field label="Headers">
        <HeaderListEditor
          headers={provider.headers}
          onChange={(headers) => set("headers", headers)}
        />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          Added to every request from this provider (e.g. User-Agent). Useful for gateways with bot detection.
        </span>
      </Field>

      <ModelDiscoveryPanel
        providerName={name}
        provider={provider}
        existingModelIds={existingModelIds}
        onAddModels={onAddModels}
      />
    </div>
  );
}
