import { redirect } from "next/navigation";
import { ReactNode } from "react";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { IconSettings } from "@/components/common/icons";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session?.user) redirect("/login");

  return (
    <AppShell
      header={
        <div className="min-w-0">
          <div className="mt-1 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <IconSettings className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight text-ink-900">
                个人设置
              </h1>
              <p className="truncate text-xs text-ink-400">
                Settings Center · 账号资料、安全设置与个人偏好
              </p>
            </div>
          </div>
        </div>
      }
    >
      <div className="pm-fade-in">{children}</div>
    </AppShell>
  );
}
