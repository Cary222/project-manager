"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  changePasswordAction,
  getProfileAction,
  getSystemSettingsAction,
  updateProfileAction,
  updateSystemSettingsAction,
  type SystemSettingSummary,
} from "@/actions/settings";
import {
  IconCheck,
  IconClock,
  IconEdit,
  IconSettings,
  IconShield,
  IconTag,
  IconTeam,
  IconTrend,
} from "@/components/icons";

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

function StatCard({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "brand" | "amber" | "purple" | "danger";
  icon: React.ReactNode;
}) {
  const toneMap = {
    brand: "bg-brand-50 text-brand-600",
    amber: "bg-amber-50 text-warning",
    purple: "bg-violet-50 text-purple",
    danger: "bg-red-50 text-danger",
  } as const;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-soft transition hover:shadow-base">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ink-500">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-ink-900">{value}</p>
          <p className="mt-1 text-xs text-ink-400">{hint}</p>
        </div>
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${toneMap[tone]}`}>
          {icon}
        </span>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft sm:p-6">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        <p className="text-sm text-ink-500">{description}</p>
      </div>
      {children}
    </section>
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

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordFlash, setPasswordFlash] = useState<FlashState>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [siteName, setSiteName] = useState("ProjectHub");
  const [siteDescription, setSiteDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [systemFlash, setSystemFlash] = useState<FlashState>(null);
  const [systemSaving, setSystemSaving] = useState(false);

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

  const stats = useMemo(() => {
    const profileComplete = profile?.name ? "100%" : "75%";
    const securityState = profile?.hasPassword ? "已启用" : "待设置";
    const systemCount = settings ? "4项" : isRoot ? "未初始化" : "—";
    const adminTools = isRoot ? "2项" : "—";
    return { profileComplete, securityState, systemCount, adminTools };
  }, [isRoot, profile, settings]);

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

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordFlash(null);

    const result = await changePasswordAction(oldPassword, newPassword, confirmPassword);
    setPasswordSaving(false);

    if (result.error) {
      setPasswordFlash({ type: "error", message: result.error });
      return;
    }

    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setProfile((current) => (current ? { ...current, hasPassword: true } : current));
    setPasswordFlash({ type: "success", message: "密码已更新" });
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
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-ink-200 bg-gradient-to-br from-brand-600 to-brand-700 p-6 text-white shadow-base lg:col-span-2">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-brand-100">
            Settings Center
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">统一管理账号、系统与安全能力</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-100">
            保持与主页面一致的后台体验，在一个页面中集中处理个人信息、安全凭据、系统品牌配置，以及管理员常用入口。
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs text-brand-100">
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{profile?.email ?? "加载中…"}</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">{isRoot ? "ROOT 管理员" : "普通成员"}</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1">风格已对齐 ProjectHub 首页</span>
          </div>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-5 shadow-soft">
          <p className="text-sm font-medium text-ink-500">本页能力</p>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-100/60 px-3 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <IconSettings className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink-900">账号与偏好</p>
                <p className="text-xs text-ink-400">管理昵称、资料与基础展示信息</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-100/60 px-3 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-danger">
                <IconShield className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-ink-900">安全与登录</p>
                <p className="text-xs text-ink-400">修改密码，强化账户访问控制</p>
              </div>
            </div>
            {isRoot ? (
              <div className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-100/60 px-3 py-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-purple">
                  <IconTeam className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm font-medium text-ink-900">管理员功能</p>
                  <p className="text-xs text-ink-400">系统配置、用户管理、审计日志</p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="资料完整度"
          value={loading ? "—" : stats.profileComplete}
          hint="优先复用现有用户字段"
          tone="brand"
          icon={<IconEdit className="h-5 w-5" />}
        />
        <StatCard
          label="安全状态"
          value={loading ? "—" : stats.securityState}
          hint="基于登录密码校验"
          tone="danger"
          icon={<IconShield className="h-5 w-5" />}
        />
        <StatCard
          label="系统配置"
          value={loading ? "—" : stats.systemCount}
          hint="ROOT 可配置站点品牌与说明"
          tone="purple"
          icon={<IconTag className="h-5 w-5" />}
        />
        <StatCard
          label="管理入口"
          value={loading ? "—" : stats.adminTools}
          hint="用户管理与审计日志"
          tone="amber"
          icon={<IconTrend className="h-5 w-5" />}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-6">
          <SectionCard
            title="个人资料"
            description="复用当前 User 模型，首版仅开放昵称编辑，邮箱与角色用于展示。"
          >
            {profileFlash ? (
              <p className={`mb-4 rounded-xl border px-3 py-2 text-sm ${toneClass(profileFlash.type)}`}>
                {profileFlash.message}
              </p>
            ) : null}
            <form className="grid gap-4 md:grid-cols-2" onSubmit={handleProfileSubmit}>
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-sm font-medium text-ink-700">昵称</span>
                <input
                  className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="输入你的显示名称"
                />
              </label>
              <InfoField label="邮箱" value={profile?.email ?? "加载中…"} />
              <InfoField label="角色" value={profile?.role ?? "加载中…"} />
              <InfoField
                label="注册时间"
                value={profile ? new Date(profile.createdAt).toLocaleDateString("zh-CN") : "加载中…"}
              />
              <InfoField label="登录密码" value={profile?.hasPassword ? "已设置" : "未设置"} />
              <div className="md:col-span-2 flex justify-end">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {profileSaving ? "保存中…" : "保存个人资料"}
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard
            title="安全设置"
            description="支持修改登录密码，沿用现有 passwordHash 机制。"
          >
            {passwordFlash ? (
              <p className={`mb-4 rounded-xl border px-3 py-2 text-sm ${toneClass(passwordFlash.type)}`}>
                {passwordFlash.message}
              </p>
            ) : null}
            <form className="grid gap-4" onSubmit={handlePasswordSubmit}>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-ink-700">原密码</span>
                <input
                  type="password"
                  className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="输入当前密码"
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink-700">新密码</span>
                  <input
                    type="password"
                    className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少 6 位"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-ink-700">确认新密码</span>
                  <input
                    type="password"
                    className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入新密码"
                  />
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <IconClock className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p>当前版本暂不提供双因素认证，首版先完善密码安全与系统访问控制。</p>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {passwordSaving ? "更新中…" : "更新密码"}
                </button>
              </div>
            </form>
          </SectionCard>

          {isRoot ? (
            <SectionCard
              title="系统设置"
              description="新增系统配置表，承载站点名称、品牌说明、Logo 与欢迎语等后台管理信息。"
            >
              {systemFlash ? (
                <p className={`mb-4 rounded-xl border px-3 py-2 text-sm ${toneClass(systemFlash.type)}`}>
                  {systemFlash.message}
                </p>
              ) : null}
              <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSystemSubmit}>
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-ink-700">站点名称</span>
                  <input
                    className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    placeholder="ProjectHub"
                  />
                </label>
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-ink-700">站点描述</span>
                  <textarea
                    className="min-h-24 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                    value={siteDescription}
                    onChange={(e) => setSiteDescription(e.target.value)}
                    placeholder="一句话说明平台定位"
                  />
                </label>
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-ink-700">Logo 链接</span>
                  <input
                    className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                  />
                </label>
                <label className="flex flex-col gap-2 md:col-span-2">
                  <span className="text-sm font-medium text-ink-700">欢迎语</span>
                  <textarea
                    className="min-h-24 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm text-ink-900 outline-none transition focus:border-brand-300 focus:ring-4 focus:ring-brand-100"
                    value={welcomeMessage}
                    onChange={(e) => setWelcomeMessage(e.target.value)}
                    placeholder="展示在设置页或后台入口的欢迎文案"
                  />
                </label>
                <div className="md:col-span-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={systemSaving}
                    className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {systemSaving ? "保存中…" : "保存系统设置"}
                  </button>
                </div>
              </form>
            </SectionCard>
          ) : null}
        </div>

        <div className="space-y-6">
          {isRoot ? (
            <SectionCard
              title="管理员面板"
              description="将高频管理功能收敛到设置中心，便于从统一入口进入。"
            >
              <div className="space-y-3">
                <AdminLinkCard
                  href="/admin/users"
                  title="用户管理"
                  description="管理角色、封禁状态、查看用户分配的单子。"
                  icon={<IconTeam className="h-5 w-5" />}
                />
                <AdminLinkCard
                  href="/admin/moderation"
                  title="审计日志"
                  description="查看管理操作记录，支持追溯角色与权限变化。"
                  icon={<IconTrend className="h-5 w-5" />}
                />
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="当前策略"
            description="本次设置页优先保证低风险落地，尽量复用现有字段与权限模型。"
          >
            <ul className="space-y-3 text-sm text-ink-600">
              <PolicyItem>邮箱暂时只读，避免影响当前登录标识与认证流程。</PolicyItem>
              <PolicyItem>密码修改沿用现有 `passwordHash` 逻辑，不引入额外认证依赖。</PolicyItem>
              <PolicyItem>系统设置新增独立表，避免污染项目、任务和用户主模型。</PolicyItem>
              <PolicyItem>管理员能力通过卡片入口整合，不破坏已有用户管理与审计页面。</PolicyItem>
            </ul>
          </SectionCard>

          <SectionCard
            title="运行状态"
            description="帮助管理员快速判断配置是否完成。"
          >
            <div className="space-y-3">
              <StatusRow label="资料已配置" ok={Boolean(profile?.name)} />
              <StatusRow label="密码已启用" ok={Boolean(profile?.hasPassword)} />
              <StatusRow label="系统设置已初始化" ok={Boolean(settings || !isRoot)} />
              <StatusRow label="管理员入口可用" ok={isRoot} />
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
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

function PolicyItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <IconCheck className="h-3.5 w-3.5" />
      </span>
      <span>{children}</span>
    </li>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-ink-100 bg-ink-100/50 px-4 py-3 text-sm">
      <span className="text-ink-600">{label}</span>
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
          ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
        }`}
      >
        {ok ? "已完成" : "待完善"}
      </span>
    </div>
  );
}
