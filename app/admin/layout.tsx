import Link from "next/link";
import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { isRoot } from "@/lib/permissions";
import { AppShell } from "@/components/AppShell";
import { IconChevronRight, IconSettings } from "@/components/icons";
import { AdminRoleProvider } from "./AdminRoleProvider";

const ADMIN_NAV_ITEMS = [
  { href: "/settings", label: "设置中心" },
  { href: "/admin/users", label: "用户管理" },
  { href: "/admin/moderation", label: "审计日志" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!isRoot(session.user.role)) redirect("/");

  return (
    <AdminRoleProvider role={session.user.role}>
      <AppShell
        header={
          <div className="min-w-0">
            <div className="mt-1 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <IconSettings className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold leading-tight text-ink-900">
                  设置与管理
                </h1>
                <p className="truncate text-xs text-ink-400">
                  Settings Center · 账号、安全、系统配置与管理员能力入口
                </p>
              </div>
            </div>
          </div>
        }
      >
        <div className="space-y-6 pm-fade-in">
          <section className="rounded-2xl border border-ink-200 bg-white p-4 shadow-soft sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-ink-900">
                  {session.user.name || session.user.email}
                </p>
                <p className="mt-1 text-sm text-ink-500">
                  你当前拥有 ROOT 管理权限，可访问系统设置、用户管理与审计日志。
                </p>
              </div>
              <nav className="flex flex-wrap gap-2">
                {ADMIN_NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-lg border border-ink-200 bg-ink-100/70 px-3 py-2 text-sm font-medium text-ink-600 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </section>

          {children}
        </div>
      </AppShell>
    </AdminRoleProvider>
  );
}
