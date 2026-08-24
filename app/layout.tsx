import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Providers } from "@/shared/ui/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProjectHub · 项目管理平台",
  description: "项目、任务单与 Git 提交关联管理",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 服务端读取侧边栏折叠 cookie，使 SSR 首帧即渲染正确的折叠状态，
  // 避免客户端读 localStorage 导致的水合不一致与刷新闪烁。
  const cookieStore = await cookies();
  const initialSidebarCollapsed =
    cookieStore.get("app-sidebar-collapsed")?.value === "true";

  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-ink-100 text-ink-900">
        <Providers initialSidebarCollapsed={initialSidebarCollapsed}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
