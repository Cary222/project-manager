"use client";

import { useCallback, useState, useEffect } from "react";
import { useIsMobile } from "./hooks/useIsMobile";
import { useI18n } from "./hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import type { RuleInfo, RuleScope } from "@/lib/api-types";

function shortenPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function Toggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      title={enabled ? t("i18n.visibleInPrompt") : t("i18n.hiddenFromPrompt")}
      style={{
        flexShrink: 0,
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "none",
        padding: 0,
        cursor: loading ? "wait" : "pointer",
        background: enabled ? "var(--accent)" : "var(--border)",
        position: "relative",
        transition: "background 0.18s",
        outline: "none",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: enabled ? 21 : 3,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--bg)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.22)",
          transition: "left 0.18s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </button>
  );
}

function RuleDetail({ rule }: { rule: RuleInfo }) {
  const chips: string[] = [];
  if (rule.alwaysApply) chips.push("alwaysApply");
  if (rule.globs) {
    const globs = Array.isArray(rule.globs) ? rule.globs : [rule.globs];
    if (globs.length > 0 && globs[0] !== "")
      chips.push(`globs: ${globs.join(", ")}`);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 3,
            flexShrink: 0,
            background:
              rule.scope === "project"
                ? "rgba(99,102,241,0.12)"
                : "rgba(120,120,120,0.12)",
            color:
              rule.scope === "project"
                ? "rgba(99,102,241,0.8)"
                : "var(--text-dim)",
          }}
        >
          {rule.scope}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {shortenPath(rule.path)}
        </span>
      </div>
      {(rule.description || chips.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rule.description && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                lineHeight: 1.5,
              }}
            >
              {rule.description}
            </div>
          )}
          {chips.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {chips.map((chip) => (
                <span
                  key={chip}
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 3,
                    fontFamily: "var(--font-mono)",
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    color: "var(--text-dim)",
                  }}
                >
                  {chip}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          borderTop: "1px solid var(--border)",
          paddingTop: 14,
        }}
      >
        <MarkdownBody>{rule.content}</MarkdownBody>
      </div>
    </div>
  );
}

function useRulesState(cwd: string) {
  const [rules, setRules] = useState<RuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/rules?cwd=${encodeURIComponent(cwd)}`);
        const d = (await res.json()) as { rules?: RuleInfo[]; error?: string };
        if (!res.ok || d.error)
          throw new Error(d.error ?? `HTTP ${res.status}`);
        if (cancelled) return;
        setRules(d.rules ?? []);
        if ((d.rules ?? []).length > 0) setSelected(d.rules![0].path);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const toggleRule = useCallback(async (rule: RuleInfo) => {
    const next = !rule.disableModelInvocation;
    setToggling((s) => new Set(s).add(rule.path));
    setSaveError(null);
    try {
      const res = await fetch("/api/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: rule.path,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      setRules((prev) =>
        prev.map((r) =>
          r.path === rule.path ? { ...r, disableModelInvocation: next } : r,
        ),
      );
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(rule.path);
        return n;
      });
    }
  }, []);

  return {
    rules,
    loading,
    error,
    selected,
    setSelected,
    toggling,
    saveError,
    toggleRule,
  };
}

function RulesListPane({
  rules,
  loading,
  error,
  selected,
  setSelected,
  toggling,
  saveError,
  toggleRule,
}: {
  rules: RuleInfo[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  setSelected: (path: string) => void;
  toggling: Set<string>;
  saveError: string | null;
  toggleRule: (rule: RuleInfo) => Promise<void>;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();

  const groups: { label: RuleScope; items: RuleInfo[] }[] = (
    ["project", "global"] as RuleScope[]
  ).map((scope) => ({
    label: scope,
    items: rules.filter((r) => r.scope === scope),
  }));

  return (
    <div
      style={{
        width: isMobile ? "100%" : 210,
        maxHeight: isMobile ? "40vh" : undefined,
        borderRight: isMobile ? "none" : "1px solid var(--border)",
        borderBottom: isMobile ? "1px solid var(--border)" : "none",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        background: "var(--bg-panel)",
        position: "relative",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
        {loading ? (
          <div
            style={{
              padding: "10px 8px",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {t("i18n.loading")}
          </div>
        ) : error ? (
          <div
            style={{
              padding: "10px 8px",
              fontSize: 11,
              color: "#f87171",
            }}
          >
            {error}
          </div>
        ) : rules.length === 0 ? (
          <div
            style={{
              padding: "10px 8px",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            {t("i18n.noRules")}
          </div>
        ) : (
          groups
            .filter(({ items }) => items.length > 0)
            .map(({ label, items }) => (
              <div key={label} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    padding: "4px 8px 3px",
                    fontSize: 10,
                    fontWeight: 600,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}
                >
                  {label}
                </div>
                {items.map((rule) => {
                  const isSelected = selected === rule.path;
                  return (
                    <div
                      key={rule.path}
                      onClick={() => setSelected(rule.path)}
                      title={shortenPath(rule.path)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "8px 8px",
                        borderRadius: 5,
                        cursor: "pointer",
                        background: isSelected
                          ? "var(--bg-selected)"
                          : "none",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected)
                          e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected)
                          e.currentTarget.style.background = "none";
                      }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: rule.alwaysApply
                            ? "var(--accent)"
                            : "var(--border)",
                          boxShadow: rule.alwaysApply
                            ? "0 0 4px var(--accent)"
                            : "none",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: isSelected ? 600 : 400,
                          color: rule.disableModelInvocation
                            ? "var(--text-dim)"
                            : "var(--text)",
                          fontFamily: "var(--font-mono)",
                          flex: 1,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {rule.name}
                      </span>
                      <Toggle
                        enabled={!rule.disableModelInvocation}
                        loading={toggling.has(rule.path)}
                        onToggle={(e) => {
                          e.stopPropagation();
                          void toggleRule(rule);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ))
        )}
      </div>
      {saveError && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 11,
            color: "#f87171",
            whiteSpace: "nowrap",
          }}
        >
          {saveError}
        </div>
      )}
    </div>
  );
}

export function EmbeddedRulesConfig({ cwd }: { cwd: string }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const {
    rules,
    loading,
    error,
    selected,
    setSelected,
    toggling,
    saveError,
    toggleRule,
  } = useRulesState(cwd);

  const selectedRule = rules.find((r) => r.path === selected) ?? null;

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        overflow: "hidden",
        minHeight: 0,
        position: "relative",
      }}
    >
      <RulesListPane
        rules={rules}
        loading={loading}
        error={error}
        selected={selected}
        setSelected={setSelected}
        toggling={toggling}
        saveError={saveError}
        toggleRule={toggleRule}
      />

      {/* Right: detail */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loading ? null : selectedRule ? (
          <RuleDetail key={selectedRule.path} rule={selectedRule} />
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-dim)",
              fontSize: 13,
            }}
          >
            {t("i18n.selectRule")}
          </div>
        )}
      </div>
    </div>
  );
}

export function RulesConfig({
  cwd,
  onClose,
  embedded = false,
}: {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const {
    rules,
    loading,
    error,
    selected,
    setSelected,
    toggling,
    saveError,
    toggleRule,
  } = useRulesState(cwd);

  if (embedded) {
    return <EmbeddedRulesConfig cwd={cwd} />;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("common.rules")}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(860px, calc(100vw - 16px))",
          height: "min(78vh, calc(100dvh - 16px))",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}
            >
              {t("common.rules")}
            </span>
            <code
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                maxWidth: 320,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
              padding: "2px 6px",
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <RulesListPane
            rules={rules}
            loading={loading}
            error={error}
            selected={selected}
            setSelected={setSelected}
            toggling={toggling}
            saveError={saveError}
            toggleRule={toggleRule}
          />

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {loading ? null : rules.find((r) => r.path === selected) ? (
              <RuleDetail
                key={selected}
                rule={rules.find((r) => r.path === selected)!}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                {t("i18n.selectRule")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
            {loading
              ? t("i18n.loading")
              : `${rules.length} ${
                  rules.length === 1 ? t("i18n.rule") : t("i18n.rules")
                }`}
          </span>
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
