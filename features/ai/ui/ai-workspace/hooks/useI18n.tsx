"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  getLocalePlugin,
  getSupportedLocales,
} from "../lib/i18n/registry";
import { translateMessage } from "../lib/i18n/format";
import type { Locale, LocalePlugin, TranslationParams } from "../lib/i18n/types";

const LOCALE_STORAGE_KEY = "pi-locale";
const LOCALE_COOKIE_NAME = "pi-locale";
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year
const defaultLocale: Locale = "en";

function writeLocaleCookie(next: Locale) {
  // SSR 无法写入 cookie，但 cookie 写入发生在用户点切换之后（已完成 hydrate），
  // 仅影响下次访问的 SSR 渲染——不会触发本次 hydration mismatch。
  try {
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
  } catch {
    // 隐私模式或 cookie 被禁用时静默忽略，下次访问会退化到 defaultLocale。
  }
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  supportedLocales: LocalePlugin[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getMessages(): Record<string, Record<string, string>> {
  return Object.fromEntries(
    getSupportedLocales().flatMap((id) => {
      const plugin = getLocalePlugin(id);
      return plugin ? [[id, plugin.messages]] : [];
    }),
  );
}

/**
 * 提供 ai-workspace 的界面语言状态和翻译能力。
 *
 * `initialLocale` 应由 server 组件通过 cookie（或 Accept-Language fallback）
 * 计算后传入，使 SSR 和 client 首次渲染拿到同一个 locale——彻底避免 hydration
 * mismatch（之前依赖 localStorage 在 mount 时切换，会导致 server HTML 与
 * client DOM 不一致，特别是按钮 title / aria-label 等属性）。
 *
 * @param props React 子节点和初始 locale
 * @returns 包含语言上下文的 React 节点
 */
export function I18nProvider({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? defaultLocale);
  const supportedLocales = useMemo(
    () =>
      getSupportedLocales()
        .map((id) => getLocalePlugin(id))
        .filter((plugin): plugin is LocalePlugin => Boolean(plugin)),
    [],
  );
  const messages = useMemo(() => getMessages(), []);

  const setLocale = useCallback((next: Locale) => {
    if (!getLocalePlugin(next)) return;
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // 存储失败不影响当前页面内的语言切换。
    }
    writeLocaleCookie(next);
  }, []);

  const t = useCallback(
    (key: string, params?: TranslationParams) =>
      translateMessage(locale, key, messages, params),
    [locale, messages],
  );
  const value = useMemo(
    () => ({ locale, setLocale, t, supportedLocales }),
    [locale, setLocale, t, supportedLocales],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 获取当前组件树中的国际化能力。
 * @returns 当前 locale、翻译函数、语言切换函数和支持的语言列表
 * @throws 当组件不在 I18nProvider 内时抛出异常
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
