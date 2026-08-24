"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconChevronDown, IconEdit, IconPlus, IconSparkles, IconX } from "@/shared/ui/icons";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AiUserProfile {
  roles?: string[];
  interests?: string[];
  expertise?: string[];
  recentTopics?: string[];
  preferences?: Record<string, string>;
}

export interface UserProfilePanelProps {
  profile: AiUserProfile | null;
  onChange?: (next: AiUserProfile) => void;
}

// ─── ProfileField ─────────────────────────────────────────────────────────────

function ProfileField({ label, value }: { label: string; value?: string | string[] }) {
  if (!value || (Array.isArray(value) && value.length === 0)) return null;
  const items = Array.isArray(value) ? value : [value];
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── EditableProfileField ─────────────────────────────────────────────────────

function EditableProfileField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[] | undefined;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const current = value ?? [];
    if (current.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...current, trimmed]);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(value ?? []).map((item) => (
          <span
            key={item}
            className="group/etag inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700"
          >
            {item}
            <button
              type="button"
              onClick={() => onChange((value ?? []).filter((x) => x !== item))}
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-brand-400 transition hover:bg-brand-200 hover:text-danger"
              aria-label={`删除 ${item}`}
              title={`删除 ${item}`}
            >
              <IconX className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              setDraft("");
            }
          }}
          placeholder={`添加${label}…`}
          className="min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-900 outline-none transition focus:border-brand-400 focus:ring-1 focus:ring-brand-100"
          maxLength={50}
        />
        <button
          type="button"
          onClick={commit}
          disabled={!draft.trim()}
          className="inline-flex items-center gap-0.5 rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <IconPlus className="h-3 w-3" />
          添加
        </button>
      </div>
    </div>
  );
}

// ─── UserProfilePanel ─────────────────────────────────────────────────────────

export function UserProfilePanel({
  profile,
  onChange,
}: UserProfilePanelProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AiUserProfile>(profile ?? {});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(profile ?? {});
  }, [profile, editing]);

  const updateField = (field: keyof AiUserProfile, next: string[]) => {
    setDraft((d) => ({ ...d, [field]: next }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/ai/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: draft }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
      }
      const json = await res.json();
      const saved = json?.data?.profile ?? draft;
      onChange?.(saved as AiUserProfile);
      setEditing(false);
    } catch (err) {
      console.error("[UserProfilePanel] save error:", err);
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(profile ?? {});
    setEditing(false);
    setSaveError(null);
  };

  if (!profile) {
    return (
      <div className="border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3">
          <IconSparkles className="h-4 w-4 shrink-0 text-brand-400" />
          <p className="text-xs text-ink-400">
            还没有画像，多和小星聊几句后会自动生成
          </p>
        </div>
      </div>
    );
  }

  const hasAnyField =
    profile.roles?.length ||
    profile.interests?.length ||
    profile.expertise?.length ||
    profile.recentTopics?.length ||
    Object.keys(profile.preferences ?? {}).length > 0;

  if (!hasAnyField && !editing) {
    return (
      <div className="border-b border-ink-100 px-5 py-3">
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-ink-200 bg-ink-50/50 px-4 py-3">
          <IconSparkles className="h-4 w-4 shrink-0 text-brand-400" />
          <p className="text-xs text-ink-400">
            还没有画像，多和小星聊几句后会自动生成
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-ink-100">
      <div className="flex w-full items-center justify-between px-5 py-3 transition hover:bg-ink-50">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <IconSparkles className="h-4 w-4 text-brand-500" />
          <span className="text-xs font-medium text-ink-700">用户画像摘要</span>
          {editing && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              编辑中
            </span>
          )}
        </button>
        <div className="flex items-center gap-1">
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setCollapsed(false);
              }}
              className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              title="编辑画像"
              aria-label="编辑画像"
            >
              <IconEdit className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            title={collapsed ? "展开" : "折叠"}
            aria-label={collapsed ? "展开画像" : "折叠画像"}
          >
            <IconChevronDown
              className={`h-4 w-4 text-ink-400 transition ${collapsed ? "" : "rotate-180"}`}
            />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="max-h-64 overflow-y-auto px-5 pb-3">
          {editing ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <EditableProfileField
                label="角色"
                value={draft.roles}
                onChange={(next) => updateField("roles", next)}
              />
              <EditableProfileField
                label="兴趣"
                value={draft.interests}
                onChange={(next) => updateField("interests", next)}
              />
              <EditableProfileField
                label="专业领域"
                value={draft.expertise}
                onChange={(next) => updateField("expertise", next)}
              />
              <div className="col-span-2">
                <EditableProfileField
                  label="近期话题"
                  value={draft.recentTopics}
                  onChange={(next) => updateField("recentTopics", next)}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <ProfileField label="角色" value={profile.roles} />
              <ProfileField label="兴趣" value={profile.interests} />
              <ProfileField label="专业领域" value={profile.expertise} />
              <div className="col-span-2">
                <ProfileField label="近期话题" value={profile.recentTopics} />
              </div>
              {profile.preferences &&
                Object.entries(profile.preferences).map(([key, val]) => (
                  <ProfileField key={key} label={key} value={val} />
                ))}
            </div>
          )}

          {editing && (
            <div className="mt-3 flex items-center justify-end gap-2 border-t border-ink-100 pt-3">
              {saveError && (
                <p className="mr-auto text-xs text-danger">{saveError}</p>
              )}
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="rounded-md border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:bg-ink-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? (
                  "保存中…"
                ) : (
                  <>
                    <IconCheck className="h-3.5 w-3.5" />
                    保存修改
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
