"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AiModelConfigPanel } from "./components/ai-model-config-panel";
import {
  changePasswordAction,
  getProfileAction,
  getSystemSettingsAction,
  updateProfileAction,
  updateSystemSettingsAction,
  type SystemSettingSummary,
} from "@/features/admin/settings";
import {
  IconCheck,
  IconShield,
  IconSettings,
  IconTeam,
  IconTrend,
} from "@/shared/ui/icons";

type ProfileState = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  hasPassword: boolean;
};

type FlashTone = "success" | "error";

type FlashState = {
  type: FlashTone;
  message: string;
} | null;

function toneClass(type: FlashTone) {
  return type === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-red-200 bg-red-50 text-red-700";
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        {description && <p className="text-sm text-ink-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-ink-100 bg-ink-100/60 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-ink-900">{value}</p>
    </div>
  );
}

function AdminLinkCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-xl border border-ink-200 bg-ink-100/40 px-4 py-4 transition hover:border-brand-200 hover:bg-brand-50/50"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="mt-1 text-sm text-ink-500">{description}</p>
      </div>
    </Link>
  );
}

function PasswordModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [flash, setFlash] = useState<FlashState>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setFlash(null);

    const result = await changePasswordAction(oldPassword, newPassword, confirmPassword);
    setSaving(false);

    if (result.error) {
      setFlash({ type: "error", message: result.error });
      return;
    }

    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    onSuccess();
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-ink-900">修改密码</h3>
        <p className="mt-1 text-sm text-ink-500">请填写以下信息完成密码修改</p>

        {flash && (
          <p className={`mt-4 rounded-xl border px-3 py-2 text-sm ${toneClass(flash.type)}`}>
            {flash.message}
          </p>
        )}

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink-700">原密码</span>
            <input
              type="password"
              className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="输入当前密码"
              autoComplete="current-password"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink-700">新密码</span>
            <input
              type="password"
              className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete="new-password"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink-700">确认新密码</span>
            <input
              type="password"
              className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              autoComplete="new-password"
            />
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "更新中…" : "更新密码"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SettingsCenter() {
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";

  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [settings, setSettings] = useState<SystemSettingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileName, setProfileName] = useState("");
  const [profileFlash, setProfileFlash] = useState<FlashState>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  const [siteName, setSiteName] = useState("ProjectHub");
  const [siteDescription, setSiteDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [systemFlash, setSystemFlash] = useState<FlashState>(null);
  const [systemSaving, setSystemSaving] = useState(false);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const profileData = await getProfileAction();
        if (!active) return;
        setProfile(profileData);
        setProfileName(profileData.name);

        if (isRoot) {
          const systemData = await getSystemSettingsAction();
          if (!active) return;
          setSettings(systemData);
          if (systemData) {
            setSiteName(systemData.siteName);
            setSiteDescription(systemData.siteDescription);
            setLogoUrl(systemData.logoUrl);
            setWelcomeMessage(systemData.welcomeMessage);
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [isRoot]);

  async function handleProfileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileFlash(null);
    const result = await updateProfileAction(profileName);
    setProfileSaving(false);

    if (result.error) {
      setProfileFlash({ type: "error", message: result.error });
      return;
    }

    setProfile((current) => (current ? { ...current, name: profileName.trim() } : current));
    setProfileFlash({ type: "success", message: "个人资料已更新" });
  }

  async function handlePasswordSuccess() {
    setProfile((current) => (current ? { ...current, hasPassword: true } : current));
  }

  async function handleSystemSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSystemSaving(true);
    setSystemFlash(null);

    const result = await updateSystemSettingsAction({
      siteName,
      siteDescription,
      logoUrl,
      welcomeMessage,
    });

    setSystemSaving(false);

    if (result.error) {
      setSystemFlash({ type: "error", message: result.error });
      return;
    }

    const nextSettings = {
      id: settings?.id ?? "local",
      siteName: siteName.trim(),
      siteDescription: siteDescription.trim(),
      logoUrl: logoUrl.trim(),
      welcomeMessage: welcomeMessage.trim(),
      updatedAt: new Date().toISOString(),
    };
    setSettings(nextSettings);
    setSystemFlash({ type: "success", message: "系统设置已保存" });
  }

  return (
    <div className="space-y-6">
      {/* Hero + Admin Panel */}
      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        {/* Hero */}
        <div className="rounded-xl border border-ink-200 bg-gradient-to-br from-brand-600 to-brand-700 p-6 text-white shadow-sm">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-brand-100">Settings Center</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">统一管理账号、系统与安全能力</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-100">
            在一个页面中集中处理个人信息、安全凭据、系统品牌配置。
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs text-brand-100">
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{profile?.email ?? "加载中…"}</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{isRoot ? "ROOT 管理员" : "普通成员"}</span>
          </div>
        </div>

        {/* Admin Panel */}
        {!isRoot ? (
          <SectionCard title="管理员面板" description="升级管理员获取更多设置">
            <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-4 text-center">
              <p className="text-sm text-ink-500">联系系统管理员获取管理员权限后即可使用管理员面板。</p>
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="管理员面板" description="高频管理功能入口">
            <div className="space-y-3">
              <AdminLinkCard
                href="/admin/users"
                title="用户管理"
                description="管理角色、封禁状态、查看用户分配的单子"
                icon={<IconTeam className="h-5 w-5" />}
              />
              <AdminLinkCard
                href="/admin/moderation"
                title="审计日志"
                description="查看管理操作记录，支持追溯权限变化"
                icon={<IconTrend className="h-5 w-5" />}
              />
            </div>
          </SectionCard>
        )}
      </section>

      {/* Two-column layout: Profile + AI Config */}
      <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Profile + System Settings */}
          <div className="space-y-6">
            <SectionCard
              title="个人资料"
              description="管理昵称、资料与基础展示信息"
            >
              {profileFlash && (
                <p className={`mb-4 rounded-xl border px-3 py-2 text-sm ${toneClass(profileFlash.type)}`}>
                  {profileFlash.message}
                </p>
              )}
              <form className="space-y-4" onSubmit={handleProfileSubmit}>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink-700">昵称</span>
                  <input
                    className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="输入你的显示名称"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <InfoField label="邮箱" value={profile?.email ?? "—"} />
                  <InfoField label="角色" value={profile?.role ?? "—"} />
                  <InfoField
                    label="注册时间"
                    value={profile ? new Date(profile.createdAt).toLocaleDateString("zh-CN") : "—"}
                  />
                  <div className="flex flex-col rounded-xl border border-ink-100 bg-ink-100/60 px-3 py-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-400">登录密码</p>
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-sm font-medium text-ink-900">
                        {profile?.hasPassword ? "已设置" : "未设置"}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPasswordModalOpen(true)}
                        className="flex items-center gap-1 rounded-lg bg-ink-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-ink-700"
                      >
                        <IconShield className="h-3 w-3" />
                        {profile?.hasPassword ? "修改" : "设置"}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={profileSaving}
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {profileSaving ? "保存中…" : "保存"}
                  </button>
                </div>
              </form>
            </SectionCard>

            {isRoot && (
              <SectionCard
                title="系统设置"
                description="配置站点名称、品牌说明、Logo 与欢迎语"
              >
                {systemFlash && (
                  <p className={`mb-4 rounded-xl border px-3 py-2 text-sm ${toneClass(systemFlash.type)}`}>
                    {systemFlash.message}
                  </p>
                )}
                <form className="space-y-4" onSubmit={handleSystemSubmit}>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink-700">站点名称</span>
                    <input
                      className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                      value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      placeholder="ProjectHub"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink-700">站点描述</span>
                    <textarea
                      className="min-h-20 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                      value={siteDescription}
                      onChange={(e) => setSiteDescription(e.target.value)}
                      placeholder="一句话说明平台定位"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink-700">Logo 链接</span>
                    <input
                      className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      placeholder="https://example.com/logo.png"
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-ink-700">欢迎语</span>
                    <textarea
                      className="min-h-20 w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
                      value={welcomeMessage}
                      onChange={(e) => setWelcomeMessage(e.target.value)}
                      placeholder="展示在设置页或后台入口的欢迎文案"
                    />
                  </label>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={systemSaving}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {systemSaving ? "保存中…" : "保存"}
                    </button>
                  </div>
                </form>
              </SectionCard>
            )}
          </div>

          {/* Right: AI Config + Admin */}
          <div className="space-y-6">
            <SectionCard title="AI 模型配置" description="选择可用模型并配置 API Key">
              <AiModelConfigPanel />
            </SectionCard>
          </div>

        <PasswordModal
          open={passwordModalOpen}
          onClose={() => setPasswordModalOpen(false)}
          onSuccess={handlePasswordSuccess}
        />
      </div>
    </div>
  );
}
