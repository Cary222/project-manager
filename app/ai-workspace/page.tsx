/**
 * AI Workspace - 基于 pi-web 重构
 */

import { cookies, headers } from "next/headers";
import { resolveBrowserLocale } from "@/lib/i18n/registry";
import { AiWorkspaceClient } from "./client";

export const metadata = {
  title: 'AI Workspace - ProjectHub',
  description: 'AI 助手工作区'
};

const LOCALE_COOKIE_NAME = "pi-locale";

export default async function AiWorkspacePage() {
  const initialLocale = await resolveServerLocale();
  return <AiWorkspaceClient initialLocale={initialLocale} />;
}

/**
 * 计算 SSR 用的 locale：
 * 1. 用户显式选择过的 cookie（最高优先级——保证刷新后保留偏好）
 * 2. 浏览器 Accept-Language 头（首次访问按用户语言）
 * 3. 默认 en（Accept-Language 缺失或解析失败时）
 *
 * 必须让 server 和 client 拿到同一个值，否则 hydration mismatch。
 */
async function resolveServerLocale(): Promise<"en" | "zh-CN" | "zh-TW"> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (cookieValue === "en" || cookieValue === "zh-CN" || cookieValue === "zh-TW") {
    return cookieValue;
  }

  try {
    const headerStore = await headers();
    const acceptLanguage = headerStore.get("accept-language");
    if (acceptLanguage) {
      const parsed = resolveBrowserLocale(
        acceptLanguage
          .split(",")
          .map((part) => part.split(";")[0]?.trim() ?? "")
          .filter(Boolean),
      );
      return parsed;
    }
  } catch {
    // 解析失败时退化到默认 locale。
  }

  return "en";
}
