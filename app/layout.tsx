import type { Metadata } from "next";
import { Providers } from "@/shared/ui/Providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProjectHub · 项目管理平台",
  description: "项目、任务单与 Git 提交关联管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col bg-ink-100 text-ink-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
