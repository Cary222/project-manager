"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  getNotificationsAction,
  getUnreadNotificationCountAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  type NotificationListItem,
} from "@/actions/notifications";
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
    href: "/settings",
    label: "设置",
    icon: IconSettings,
    match: (p) => p === "/settings",
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

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

export function AppShell({
  children,
  header,
}: {
  children: ReactNode;
  header?: ReactNode;
}) {
  const pathname = usePathname() || "/";
  const { data: session } = useSession();
  const isRoot = session?.user?.role === "ROOT";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);

  const visibleNav = NAV_ITEMS.filter((item) => !item.rootOnly || isRoot);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (notificationRef.current && !notificationRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadNotifications() {
    setLoadingNotifications(true);
    try {
      const [items, count] = await Promise.all([
        getNotificationsAction(),
        getUnreadNotificationCountAction(),
      ]);
      setNotifications(items);
      setUnreadCount(count);
      setNotificationsLoaded(true);
    } finally {
      setLoadingNotifications(false);
    }
  }

  const unreadItems = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  async function handleOpenNotifications() {
    const nextOpen = !notificationsOpen;
    setNotificationsOpen(nextOpen);
    setUserMenuOpen(false);
    if (nextOpen && !notificationsLoaded) {
      await loadNotifications();
    }
  }

  async function handleMarkOneRead(id: string) {
    await markNotificationReadAction(id);
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnreadCount((current) => Math.max(0, current - 1));
  }

  async function handleMarkAllRead() {
    await markAllNotificationsReadAction();
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
  }

  return (
    <div className="flex min-h-screen bg-ink-100 text-ink-900">
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

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

          <div className="relative" ref={notificationRef}>
            <button
              type="button"
              onClick={handleOpenNotifications}
              className="relative rounded-lg p-2 text-ink-500 transition hover:bg-ink-100"
              aria-label="通知"
            >
              <IconBell />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-semibold leading-4 text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </button>

            {notificationsOpen ? (
              <div className="absolute right-0 top-12 z-30 w-[360px] rounded-2xl border border-ink-200 bg-white shadow-elevated pm-fade-in">
                <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">通知中心</p>
                    <p className="text-xs text-ink-400">{unreadItems} 条未读消息</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={unreadItems === 0}
                    className="text-xs font-medium text-brand-600 transition hover:text-brand-700 disabled:cursor-not-allowed disabled:text-ink-300"
                  >
                    全部已读
                  </button>
                </div>
                <div className="max-h-[420px] overflow-y-auto p-2">
                  {loadingNotifications ? (
                    <p className="px-3 py-10 text-center text-sm text-ink-400">加载中…</p>
                  ) : notifications.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-ink-200 bg-ink-100/40 px-4 py-10 text-center text-sm text-ink-400">
                      暂无通知，新的派单与交付动态会显示在这里。
                    </div>
                  ) : (
                    notifications.map((item) => {
                      const href = item.ticketNo ? `/${item.ticketNo}` : "/tasks";
                      return (
                        <div
                          key={item.id}
                          className={`mb-2 rounded-xl border px-3 py-3 transition ${
                            item.read
                              ? "border-ink-100 bg-white"
                              : "border-brand-100 bg-brand-50/60"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`mt-1 h-2.5 w-2.5 rounded-full ${item.read ? "bg-ink-200" : "bg-brand-500"}`} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-ink-900">{item.title}</p>
                                  <p className="mt-1 text-sm leading-5 text-ink-500">{item.content}</p>
                                </div>
                                <span className="whitespace-nowrap text-[11px] text-ink-400">
                                  {timeAgo(item.createdAt)}
                                </span>
                              </div>
                              <div className="mt-3 flex items-center justify-between gap-3">
                                <Link
                                  href={href}
                                  onClick={() => setNotificationsOpen(false)}
                                  className="text-xs font-medium text-brand-600 transition hover:text-brand-700"
                                >
                                  查看单子
                                </Link>
                                {!item.read ? (
                                  <button
                                    type="button"
                                    onClick={() => handleMarkOneRead(item.id)}
                                    className="text-xs font-medium text-ink-500 transition hover:text-ink-900"
                                  >
                                    标记已读
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => {
                setUserMenuOpen((current) => !current);
                setNotificationsOpen(false);
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-ink-100"
            >
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
            </button>

            {userMenuOpen ? (
              <div className="absolute right-0 top-12 z-30 w-48 rounded-2xl border border-ink-200 bg-white p-2 shadow-elevated pm-fade-in">
                <Link
                  href="/settings"
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
                >
                  <IconSettings className="text-ink-400" />
                  <span>个人设置</span>
                </Link>
                <button
                  type="button"
                  onClick={() => signOut({ redirectTo: "/login" })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-600 transition hover:bg-ink-100 hover:text-danger"
                >
                  <IconLogout className="text-ink-400" />
                  <span>退出登录</span>
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main className="flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
