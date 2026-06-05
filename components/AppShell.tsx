"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState, type ReactNode } from "react";
import {
  IconBell,
  IconChevronDown,
  IconDashboard,
  IconKnowledge,
  IconLogout,
  IconMenu,
  IconPkm,
  IconProject,
  IconReport,
  IconRepo,
  IconSearch,
  IconSettings,
  IconTask,
  IconTeam,
} from "@/components/icons";

type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => ReactNode;
  match?: (path: string) => boolean;
  rootOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "工作台", icon: IconDashboard, match: (p) => p === "/" },
  {
    href: "/projects",
    label: "项目",
    icon: IconProject,
    match: (p) => p.startsWith("/projects"),
  },
  {
    href: "/tasks",
    label: "任务",
    icon: IconTask,
    match: (p) => p.startsWith("/tasks") || /^\/\d+$/.test(p),
  },
  { href: "/pkm", label: "PKM", icon: IconPkm, match: (p) => p.startsWith("/pkm") },
  {
    href: "/knowledge",
    label: "知识库",
    icon: IconKnowledge,
    match: (p) => p.startsWith("/knowledge"),
  },
  {
    href: "/repos",
    label: "代码仓库",
    icon: IconRepo,
    match: (p) => p.startsWith("/repos"),
  },
  { href: "/team", label: "团队", icon: IconTeam, match: (p) => p.startsWith("/team") },
  {
    href: "/reports",
    label: "报表",
    icon: IconReport,
    match: (p) => p.startsWith("/reports"),
  },
  {
    href: "/admin/users",
    label: "设置",
    icon: IconSettings,
    match: (p) => p.startsWith("/admin"),
    rootOnly: true,
  },
];

function Avatar({ name }: { name?: string | null }) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
      {initial}
    </div>
  );
}

export function AppShell({
  children,
  header,
}: {
  children: ReactNode;
  /** 可选：页面级自定义头部内容（标题/操作），渲染在顶栏左侧 */
  header?: ReactNode;
}) {
  const pathname = usePathname() || "/";
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [mobileOpen, setMobileOpen] = useState(false);

  const visibleNav = NAV_ITEMS.filter((item) => !item.rootOnly || isRoot);

  return (
    <div className="flex min-h-screen bg-ink-100 text-ink-900">
      {/* 移动端遮罩 */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      {/* 侧边栏 */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-ink-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </div>
          <span className="text-base font-semibold tracking-tight">ProjectHub</span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {visibleNav.map((item) => {
            const active = item.match
              ? item.match(pathname)
              : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                }`}
              >
                <Icon className={active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-700"} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-ink-200 p-3">
          <button
            type="button"
            onClick={() => signOut({ redirectTo: "/login" })}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-ink-500 transition hover:bg-ink-100 hover:text-danger"
          >
            <IconLogout className="text-ink-400" />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      {/* 右侧主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="打开菜单"
          >
            <IconMenu />
          </button>

          <div className="min-w-0 flex-1">{header}</div>

          <div className="hidden items-center gap-2 rounded-lg border border-ink-200 bg-ink-100 px-3 py-1.5 text-sm text-ink-400 md:flex">
            <IconSearch className="h-4 w-4" />
            <span>全局搜索</span>
          </div>
          <button className="relative rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="通知">
            <IconBell />
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />
          </button>
          <div className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-ink-100">
            <Avatar name={session?.user?.name} />
            <div className="hidden text-left sm:block">
              <p className="text-sm font-medium leading-tight">
                {session?.user?.name || "用户"}
              </p>
              <p className="text-xs leading-tight text-ink-400">
                {session?.user?.role === "ROOT" ? "管理员" : "成员"}
              </p>
            </div>
            <IconChevronDown className="hidden h-4 w-4 text-ink-400 sm:block" />
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
