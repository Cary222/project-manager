"use client";

/**
 * Shared Model Settings — i18n 桥接
 *
 * 共享组件不依赖 ai-workspace 的 I18nProvider：
 * - Pi Workspace 侧通过 ModelSettingsI18nProvider 注入自己的 t（跟随工作区 locale）；
 * - ProjectHub 侧不注入时，回退到独立的翻译函数（直接消费 @/lib/i18n 词表，
 *   locale 读取与 Pi 相同的 "pi-locale" key）。
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } from "@/lib/i18n/registry";
import { translateMessage } from "@/lib/i18n/format";
import type { Locale, TranslationParams } from "@/lib/i18n/types";

export type ModelSettingsTranslate = (key: string, params?: TranslationParams) => string;

const ModelSettingsI18nContext = createContext<ModelSettingsTranslate | null>(null);

const LOCALE_STORAGE_KEY = "pi-locale";

/** 注入翻译函数（Pi Workspace 侧传入其 useI18n 的 t）。 */
export function ModelSettingsI18nProvider({
  t,
  children,
}: {
  t: ModelSettingsTranslate;
  children: React.ReactNode;
}) {
  return (
    <ModelSettingsI18nContext.Provider value={t}>{children}</ModelSettingsI18nContext.Provider>
  );
}

function readInitialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "zh-CN") return stored;
  } catch {
    // 隐私模式或存储不可用时使用浏览器语言。
  }
  return resolveBrowserLocale(window.navigator.languages.length ? window.navigator.languages : [window.navigator.language]);
}

function useStandaloneTranslate(): ModelSettingsTranslate {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    // 挂载后读 localStorage/浏览器语言（避免 SSR hydration 不匹配，与原 useI18n 同策略）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocale(readInitialLocale());
  }, []);

  const messages = useMemo(() => {
    return Object.fromEntries(getSupportedLocales().flatMap((id) => {
      const plugin = getLocalePlugin(id);
      return plugin ? [[id, plugin.messages]] : [];
    }));
  }, []);

  return useCallback(
    (key: string, params?: TranslationParams) => translateMessage(locale, key, messages, params),
    [locale, messages],
  );
}

/** 获取共享 Model Settings 组件的翻译函数（注入优先，回退独立翻译）。 */
export function useModelSettingsI18n(): ModelSettingsTranslate {
  const injected = useContext(ModelSettingsI18nContext);
  const standalone = useStandaloneTranslate();
  return injected ?? standalone;
}
