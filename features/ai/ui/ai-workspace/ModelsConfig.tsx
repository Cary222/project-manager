"use client";

/**
 * ModelsConfig — Pi Workspace 模型配置对话框（Stage 6 薄壳）
 *
 * UI / 状态机 / Discovery / Catalog / Test / 持久化全部由共享套件
 * features/ai/ui/model-settings（ModelSettingsPanel + PiWorkspaceAdapter）承载；
 * 本文件仅保留 Pi Workspace 专属部分：
 * - OAuthDetail（OAuth 登录流程绑定 /api/auth/* 端点，凭证 DB 化属后续 Credential Schema Phase）
 * - ApiKeyDetail（CredentialForm + /api/auth/api-key/* 端点）
 * - OAuth / API Key 托管 provider 列表加载（/api/auth/oauth-providers、/api/auth/all-providers）
 *
 * models.json 仍是 Workspace Source of Truth，Pi Workspace 行为完全不变。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "./hooks/useIsMobile";
import { useI18n } from "./hooks/useI18n";
import { usePiWorkspaceAdapter } from "./models-config-adapter";
import {
  CredentialForm,
  ModelSettingsI18nProvider,
  ModelSettingsPanel,
  SectionTitle,
  type ApiKeyProvider,
  type ModelsJson,
  type OAuthProvider,
} from "@/features/ai/ui/model-settings";

// ── Types ─────────────────────────────────────────────────────────────────────

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

// ── OAuth detail（Pi Workspace 专属，保留在薄壳内）─────────────────────────────

/**
 * OAuth 登出请求（提取为顶层函数，便于独立测试）
 */
export async function logoutProvider(providerId: string): Promise<void> {
  await fetch(`/api/auth/logout/${encodeURIComponent(providerId)}`, { method: "POST" });
}

/**
 * API Key 删除请求（提取为顶层函数，便于独立测试）
 * 返回 Response 以便调用方检查错误。
 */
export async function removeApiKey(providerId: string): Promise<Response> {
  return fetch(`/api/auth/api-key/${encodeURIComponent(providerId)}`, { method: "DELETE" });
}

/** 刷新两个认证列表 */
export type RefreshListsFn = () => void;

function OAuthDetail({
  provider,
  onRefresh,
  onAuthSuccess,
  onModelsChanged,
}: {
  provider: OAuthProvider;
  onRefresh: () => void;
  /** 仅在 OAuth 登录成功时触发：写入 models.json + 刷新列表 */
  onAuthSuccess: () => void;
  /** 登出后刷新 ChatInput 模型列表（触发 modelsRefreshKey 递增） */
  onModelsChanged: () => void;
}) {
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  /* eslint-disable react-hooks/set-state-in-effect -- 与原实现同语义 */
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onAuthSuccess();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: "Connection lost" });
    };
  }, [provider.id, onAuthSuccess]);

  const handleLogout = useCallback(async () => {
    await logoutProvider(provider.id);
    setLoginState({ phase: "idle" });
    onRefresh();
    onModelsChanged();
  }, [provider.id, onRefresh, onModelsChanged]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: "Verifying…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
    }
  }, [provider.id]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: "Continuing…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
    }
  }, [provider.id]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>{t("i18n.subscription")}</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.loggedIn ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.loggedIn ? "#4ade80" : "var(--text-dim)" }}>
            {provider.loggedIn ? t("i18n.connected") : t("i18n.notConnected")}
          </span>
        </div>
      </div>

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {provider.loggedIn ? "Already connected. You can re-login or disconnect." : `Connect your ${provider.name} account.`}
          </p>
        )}
        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{t("i18n.openingBrowser")}</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below."
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                If the browser window did not open,{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                  click here to open the login page
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? "Enter value…")}
                style={{ flex: 1, padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ padding: "6px 12px", background: inputValue.trim() ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 5, color: inputValue.trim() ? "#fff" : "var(--text-dim)", cursor: inputValue.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, flexShrink: 0 }}
              >
                {t("i18n.submit")}
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Open the verification page and enter this code:
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` Expires in ${Math.ceil(loginState.expiresInSeconds / 60)} minutes.` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 12, color: "#4ade80" }}>{t("i18n.connectedSuccessfully")}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8 }}>
        {isWorking ? (
          <button
            onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
          >
            {t("i18n.cancel")}
          </button>
        ) : (
          <>
            <button
              onClick={handleLogin}
              style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
            >
              {provider.loggedIn ? t("i18n.relogin") : t("i18n.login")}
            </button>
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{ padding: "5px 12px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 12 }}
              >
                {t("i18n.disconnect")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sync managed provider to models.json ────────────────────────────────────────

/**
 * 将已认证的托管 provider（OAuth / ApiKey）写入 models.json。
 *
 * 根因：OAuthDetail / ApiKeyDetail 认证成功后，凭证存入 auth.json，
 * 但 provider 名称从未写入 models.json。刷新后 registry 的 local 分支
 * 找不到该 provider，导致 UI 左侧树不显示。
 *
 * 修复：
 * 1. 读取本地 models.json（/api/models-config），而非统一 registry，
 *    避免将 site/inherited providers 错误写入本地。
 * 2. 只在认证成功 / API Key 保存时写入；登出 / 删除只刷新列表，不写入。
 * 3. 写入时以 { models: [] } 占位，模型列表由后续 Discovery 流程填充。
 */
async function syncManagedProviderToModelsJson(providerId: string): Promise<void> {
  try {
    const localRes = await fetch("/api/models-config");
    if (!localRes.ok) return;
    const localConfig = await localRes.json() as ModelsJson;

    if (localConfig.providers?.[providerId]) return;

    const updated: ModelsJson = {
      ...localConfig,
      providers: {
        ...(localConfig.providers ?? {}),
        [providerId]: { models: [] },
      },
    };

    const saveRes = await fetch("/api/models-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!saveRes.ok) {
      console.warn("[syncManagedProviderToModelsJson] failed to write:", saveRes.status);
    }
  } catch (err) {
    // 非阻塞：models.json 写入失败不影响认证流程
    console.warn("[syncManagedProviderToModelsJson] sync failed:", err instanceof Error ? err.message : String(err));
  }
}

// ── API Key detail（CredentialForm + Pi auth 端点）─────────────────────────────

function ApiKeyDetail({
  provider,
  onRefresh,
  onSaveSuccess,
  onModelsChanged,
  onAfterRemove,
}: {
  provider: ApiKeyProvider;
  onRefresh: () => void;
  /** 仅在 API Key 保存成功时触发：写入 models.json + 刷新列表 */
  onSaveSuccess: () => void;
  /** 删除凭证后刷新 ChatInput 模型列表（触发 modelsRefreshKey 递增） */
  onModelsChanged: () => void;
  /** 断开连接后清理 models.json 里的占位条目（syncManagedProviderToModelsJson 写入的空 provider） */
  onAfterRemove: (providerId: string) => Promise<void>;
}) {
  const handleSave = useCallback(async (apiKey: string) => {
    const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    const d = await res.json().catch(() => ({})) as { error?: string };
    if (!res.ok || d.error) throw new Error(d.error ?? `HTTP ${res.status}`);
    onSaveSuccess();
  }, [provider.id, onSaveSuccess]);

  const handleRemove = useCallback(async () => {
    const res = await removeApiKey(provider.id);
    const d = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
    if (!res.ok || d.error) {
      throw new Error(d.error ?? `HTTP ${res.status}`);
    }
    // 清理 models.json 里的占位条目（syncManagedProviderToModelsJson 保存 API key 时写入的）
    try {
      await onAfterRemove(provider.id);
    } catch { /* 占位清理失败不影响断开连接 */ }
    onRefresh();
    onModelsChanged();
  }, [provider.id, onRefresh, onModelsChanged, onAfterRemove]);

  return <CredentialForm provider={provider} onSave={handleSave} onRemove={handleRemove} />;
}

// ── Main component（薄壳）──────────────────────────────────────────────────────

export function ModelsConfig({ onClose, onModelsChanged }: { onClose: () => void; onModelsChanged: () => void }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const adapter = usePiWorkspaceAdapter();
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  // 断开连接后递增 → 触发 ModelSettingsPanel 重新加载 models.json（清理占位 provider 后 UI 同步）
  const [reloadKey, setReloadKey] = useState(0);

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/oauth-providers")
      .then((r) => r.json())
      .then((d: { providers?: OAuthProvider[] }) => {
        if (Array.isArray(d.providers)) setOauthProviders(d.providers);
      })
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers?: ApiKeyProvider[] }) => {
        if (Array.isArray(d.providers)) setApiKeyProviders(d.providers);
      })
      .catch(() => {});
  }, []);

  // 刷新两个认证列表（OAuth 登出、API Key 删除时调用 — 不写入 models.json）
  const refreshAuthProviders = useCallback(() => {
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders]);

  // OAuth 登录成功 / API Key 保存成功 → 写入 models.json + 刷新列表
  const handleAuthSuccess = useCallback((providerId: string) => {
    syncManagedProviderToModelsJson(providerId);
    loadOAuthProviders();
    loadApiKeyProviders();
    onModelsChanged();
  }, [loadOAuthProviders, loadApiKeyProviders, onModelsChanged]);

  // 断开连接成功后清理 models.json 里的占位条目，并触发 ModelSettingsPanel 重新加载 config
  const handleAfterRemove = useCallback(async (providerId: string) => {
    try {
      await adapter.remove?.(providerId);
    } finally {
      setReloadKey((k) => k + 1);
    }
  }, [adapter]);

  useEffect(() => {
    refreshAuthProviders();
  }, [refreshAuthProviders]);

  return (
    <ModelSettingsI18nProvider t={t}>
      <ModelSettingsPanel
        adapter={adapter}
        onClose={onClose}
        isMobile={isMobile}
        title={t("common.models")}
        subtitle={<code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>~/.pi/agent/models.json</code>}
        reloadKey={reloadKey}
        sections={{
          oauth: {
            providers: oauthProviders,
            renderDetail: (p) => <OAuthDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} onAuthSuccess={() => handleAuthSuccess(p.id)} onModelsChanged={onModelsChanged} />,
          },
          apikey: {
            providers: apiKeyProviders,
            renderDetail: (p) => <ApiKeyDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} onSaveSuccess={() => handleAuthSuccess(p.id)} onModelsChanged={onModelsChanged} onAfterRemove={handleAfterRemove} />,
          },
        }}
      />
    </ModelSettingsI18nProvider>
  );
}
