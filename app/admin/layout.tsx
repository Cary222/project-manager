import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isRoot } from "@/lib/permissions";
import { signOut } from "@/lib/auth";
import { ReactNode } from "react";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();

  if (!session?.user) redirect("/login");
  if (!isRoot(session.user.role)) redirect("/");

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <aside className="w-44 flex-shrink-0 border-r border-zinc-200 bg-white">
        <div className="flex h-full flex-col">
          <div className="border-b border-zinc-200 px-4 py-4">
            <h2 className="text-sm font-semibold text-zinc-900">管理后台</h2>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-4">
            <NavLink href="/admin/users">用户管理</NavLink>
            <NavLink href="/admin/moderation">审计日志</NavLink>
          </nav>
          <div className="border-t border-zinc-200 px-4 py-4">
            <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-700">
              ← 返回首页
            </Link>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-900">
              首页
            </Link>
            <span className="text-zinc-300">/</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span>
              {session.user.name} · {session.user.role}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                退出
              </button>
            </form>
          </div>
        </header>

        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-md px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
    >
      {children}
    </Link>
  );
}
