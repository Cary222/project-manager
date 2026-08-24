"use client";

/**
 * Shared Model Settings — 主面板壳（REFACTOR）
 *
 * 从 ModelsConfig.tsx 主组件提取：左树（托管凭证区 + 自定义 Provider/Model 树）
 * + 右侧详情路由 + 底部保存栏 + Provider Picker。
 *
 * 全部数据能力经 ModelSettingsAdapter 注入；托管凭证区（OAuth / API Key）经
 * sections render props 注入。共享壳本身不依赖 Prisma / models.json / Pi Runtime /
 * Route Handler。
 */

import { useCallback, useEffect, useState } from "react";
import { ModelSettingsAdapterProvider, type ModelSettingsAdapter } from "./adapter";
import { useModelSettingsI18n } from "./i18n";
import { ProviderForm } from "./ProviderForm";
import { ModelDetail } from "./ModelMetadata";
import { ProviderPicker } from "./ProviderPicker";
import { ProviderIcon } from "./provider-icons";
import type { ApiKeyProvider, DiscoveredModel, ModelEntry, ModelsJson, OAuthProvider, ProviderEntry, Selection } from "./types";

export interface ManagedProviderSections {
  oauth?: {
    providers: OAuthProvider[];
    renderDetail: (provider: OAuthProvider) => React.ReactNode;
  };
  apikey?: {
    providers: ApiKeyProvider[];
    renderDetail: (provider: ApiKeyProvider) => React.ReactNode;
  };
}

export function ModelSettingsPanel({
  adapter,
  onClose,
  sections,
  title,
  subtitle,
  isMobile = false,
  reloadKey = 0,
}: {
  adapter: ModelSettingsAdapter;
  onClose: () => void;
  /** 托管凭证区（Pi Workspace：OAuth + API Key；ProjectHub 可不传或只传 apikey）。 */
  sections?: ManagedProviderSections;
  title: string;
  /** 头部副标题（如配置来源提示）。 */
  subtitle?: React.ReactNode;
  isMobile?: boolean;
  /** 递增触发 adapter.load() 重新加载（用于断开连接后清理占位 provider） */
  reloadKey?: number;
}) {
  const t = useModelSettingsI18n();
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    adapter.load()
      .then((loaded) => {
        const normalized = loaded.providers ? loaded : { ...loaded, providers: {} };
        setConfig(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      })
      .catch(() => setConfig({ providers: {} }))
      .finally(() => setLoading(false));
  }, [adapter, reloadKey]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback(async (name: string) => {
    const isInherited = adapter.isInherited?.(name) ?? false;
    const confirmMsg = isInherited
      ? `确定要从当前视图中移除继承的 Provider "${name}" 吗？\n（不会删除站点凭证，仅从本工作区隐藏）`
      : `确定要删除 Provider "${name}" 吗？\n此操作将永久删除该 Provider 及其凭证。`;
    if (!window.confirm(confirmMsg)) return;

    // 调用 adapter 持久化删除
    try {
      await adapter.remove?.(name);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return;
    }

    // 从本地状态移除
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setSelection((current) => {
      if (current && (
        (current.type === "provider" && current.name === name)
        || (current.type === "model" && current.providerName === name)
      )) {
        const remaining = Object.keys(config.providers ?? {}).filter((key) => key !== name);
        return remaining.length > 0 ? { type: "provider", name: remaining[0] } : null;
      }
      return current;
    });
  }, [adapter, config.providers]);

  const addModel = useCallback((providerName: string) => {
    const nextIndex = config.providers?.[providerName]?.models?.length ?? 0;
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setSelection({ type: "model", providerName, index: nextIndex });
  }, [config.providers]);

  const addDiscoveredModels = useCallback((providerName: string, discovered: DiscoveredModel[]) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      const existingIds = new Set(models.map((model) => model.id));
      for (const discoveredModel of discovered) {
        if (existingIds.has(discoveredModel.id)) continue;
        existingIds.add(discoveredModel.id);
        models.push({ id: discoveredModel.id, name: discoveredModel.name });
      }
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      // For Site providers, mark this model as dirty so the adapter
      // knows to persist its full record into model.json as an override.
      const providerWithMeta = provider as ProviderEntry & { __source?: string; __dirtyModelKeys?: string[] };
      const isSite = providerWithMeta.__source === "site";
      const dirtySet = new Set(providerWithMeta.__dirtyModelKeys ?? []);
      if (isSite && m.id) dirtySet.add(m.id);
      const nextProvider: ProviderEntry & { __dirtyModelKeys?: string[] } = isSite
        ? { ...provider, models, __dirtyModelKeys: Array.from(dirtySet) }
        : { ...provider, models };
      return {
        ...prev,
        providers: { ...(prev.providers ?? {}), [providerName]: nextProvider },
      };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      await adapter.save(config);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [adapter, config]);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = (sections?.oauth?.providers ?? []).filter((p) => p.loggedIn);
  const activeApiKey = (sections?.apikey?.providers ?? []).filter((p) => p.configured);

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = sections?.oauth?.providers.find((item) => item.id === selection.providerId);
      if (!p || !sections?.oauth) return null;
      return <div key={p.id}>{sections.oauth.renderDetail(p)}</div>;
    }
    if (selection.type === "apikey") {
      const p = sections?.apikey?.providers.find((item) => item.id === selection.providerId);
      if (!p || !sections?.apikey) return null;
      return <div key={p.id}>{sections.apikey.renderDetail(p)}</div>;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      // Site providers (marked with __source === "site") are read-only
      const isReadOnly = (provider as ProviderEntry & { __source?: string }).__source === "site";
      return (
        <ProviderForm
          key={selection.name}
          name={selection.name}
          provider={provider}
          readOnly={isReadOnly}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          onAddModels={(models) => addDiscoveredModels(selection.name, models)}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <ModelSettingsAdapterProvider adapter={adapter}>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          background: "rgba(0,0,0,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{title}</span>
              {subtitle}
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
          </div>

          {/* Body */}
          <div style={{ flex: 1, display: "flex", flexDirection: isMobile ? "column" : "row", overflow: "hidden" }}>

            {/* Left: tree */}
            <div style={{
              width: isMobile ? "100%" : 210,
              maxHeight: isMobile ? "40vh" : undefined,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
              display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)",
            }}>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
                {/* Active OAuth subscriptions */}
                {activeOAuth.map((p) => {
                  const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                      style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                    >
                      <ProviderIcon id={p.id} size={16} />
                      <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    </div>
                  );
                })}

                {/* Active API key providers */}
                {activeApiKey.map((p) => {
                  const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                      style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                    >
                      <ProviderIcon id={p.id} size={16} />
                      <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</span>
                    </div>
                  );
                })}

                {/* Divider before custom providers, only when there are active managed providers */}
                {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                  <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
                )}

                {/* Custom providers */}
                {loading ? (
                  <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>{t("i18n.loading")}</div>
                ) : providers.map(([pName, pData]) => {
                  const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                  const models = pData.models ?? [];
                  return (
                    <div key={pName} style={{ marginBottom: 2 }}>
                      {/* Provider row */}
                      <div
                        onClick={() => setSelection({ type: "provider", name: pName })}
                        style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 5, cursor: "pointer", background: isProviderSelected ? "var(--bg-selected)" : "none" }}
                        onMouseEnter={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "none"; }}
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                          <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                          <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                          <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                          <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                          <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                        </svg>
                        <span style={{ fontSize: 12, fontWeight: isProviderSelected ? 600 : 400, color: "var(--text)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {pName}
                        </span>
                      </div>

                      {/* Model rows */}
                      {models.map((m, i) => {
                        const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                        return (
                          <div
                            key={i}
                            onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                            style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 26px", borderRadius: 5, cursor: "pointer", background: isModelSelected ? "var(--bg-selected)" : "none" }}
                            onMouseEnter={(e) => { if (!isModelSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                            onMouseLeave={(e) => { if (!isModelSelected) e.currentTarget.style.background = "none"; }}
                          >
                            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: m.id ? "var(--text-muted)" : "var(--text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {m.id || t("i18n.newModel")}
                            </span>
                            {m.reasoning && (
                              <span style={{ fontSize: 9, padding: "1px 4px", background: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.8)", borderRadius: 3, flexShrink: 0 }}>T</span>
                            )}
                          </div>
                        );
                      })}

                      {/* Add model button */}
                      <div
                        onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px 4px 26px", borderRadius: 5, cursor: "pointer", color: "var(--text-dim)" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                      >
                        <span style={{ fontSize: 11 }}>+ {t("i18n.model")}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add provider */}
              <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px" }}>
                <button onClick={() => setPickerOpen(true)} style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  width: "100%", padding: "6px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 5,
                  color: "var(--text-muted)", cursor: "pointer", fontSize: 12,
                }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
                >
                  + {t("i18n.addProvider")}
                </button>
              </div>
            </div>

            {/* Right: detail */}
            <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
              {loading ? null : detailContent ?? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
                  {t("i18n.selectProviderModel")}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
            {saveError && <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{saveError}</span>}
            <button onClick={onClose} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
              {t("i18n.cancel")}
            </button>
            <button onClick={() => void handleSave()} disabled={saving || savedOk} style={{
              position: "relative",
              padding: "6px 16px",
              minWidth: 92,
              background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
              border: "none", borderRadius: 6,
              color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
              cursor: (saving || savedOk) ? "default" : "pointer", fontSize: 13, fontWeight: 600,
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
              transition: "background-color 0.2s ease, color 0.2s ease",
              animation: savedOk ? "saved-pop 0.45s ease" : undefined,
            }}>
              {savedOk && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
            </button>
          </div>
        </div>
      </div>
      {pickerOpen && (
        <ProviderPicker
          oauthProviders={sections?.oauth?.providers ?? []}
          apiKeyProviders={sections?.apikey?.providers ?? []}
          onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
          onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
          onAddCustom={addCustomProvider}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </ModelSettingsAdapterProvider>
  );
}
