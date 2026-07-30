"use client";

import useSWR, { mutate } from "swr";
import type { ProviderApiKeys } from "./types";

export interface UserKeyInfo {
  id: string;
  provider: string;
  name: string;
  baseURL: string | null;
  keyLast4: string;
  lastUsedAt: string | null;
  createdAt: string;
  ownerType: string;
  transport?: string;
  apiFormat?: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * 加载/保存用户 API Keys（SWR 缓存全局共享）
 * - 加载：GET /api/ai/providers（用户 keys + ROOT 系统 keys）
 * - 保存：POST /api/ai/providers → invalidate 缓存自动触发 revalidate
 * - 删除：DELETE /api/ai/providers → invalidate 缓存
 */
export function useApiKeys() {
  const { data, isLoading } = useSWR<{
    data: { userKeys: UserKeyInfo[]; systemKeys: UserKeyInfo[] };
  }>("/api/ai/providers", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  const userKeys = data?.data?.userKeys ?? [];
  const systemKeys = data?.data?.systemKeys ?? [];

  // 保存 API Key（保存后 invalidate SWR cache）
  const saveApiKey = async (
    provider: string,
    name: string,
    apiKey: string,
    baseURL?: string,
    options?: { transport?: string; apiFormat?: string; ownerType?: "USER" | "SYSTEM" }
  ): Promise<boolean> => {
    try {
      const res = await fetch("/api/ai/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, name, apiKey, baseURL, ...options }),
      });
      const json = await res.json();
      if (!res.ok) {
        return false;
      }
      // Invalidate SWR cache → 所有 useApiKeys 实例自动 revalidate
      mutate("/api/ai/providers");
      // Signal model catalog to refresh
      localStorage.setItem("__modelCatalogRefresh", Date.now().toString());
      return true;
    } catch {
      return false;
    }
  };

  // 测试 API Key
  const testApiKey = async (
    provider: string,
    apiKey: string,
    baseURL?: string
  ): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await fetch("/api/ai/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey, baseURL }),
      });
      const json = await res.json();
      if (!res.ok) {
        return { success: false, message: json.error ?? "测试失败" };
      }
      return json.data ?? { success: false, message: "未知错误" };
    } catch (e) {
      return {
        success: false,
        message: e instanceof Error ? e.message : "连接失败",
      };
    }
  };

  // 删除 API Key
  const deleteApiKey = async (
    provider: string,
    ownerType: "USER" | "SYSTEM" = "USER"
  ): Promise<boolean> => {
    try {
      const res = await fetch("/api/ai/providers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ownerType }),
      });
      if (!res.ok) return false;
      mutate("/api/ai/providers");
      return true;
    } catch {
      return false;
    }
  };

  const hasKey = (provider: string): boolean => userKeys.some((k) => k.provider === provider);
  const hasSystemKey = (provider: string): boolean =>
    systemKeys.some((k) => k.provider === provider);
  const getKeyLast4 = (provider: string): string | undefined =>
    userKeys.find((k) => k.provider === provider)?.keyLast4;
  const getSystemKeyLast4 = (provider: string): string | undefined =>
    systemKeys.find((k) => k.provider === provider)?.keyLast4;

  return {
    userKeys,
    systemKeys,
    apiKeys: {} as ProviderApiKeys,
    isLoaded: !isLoading,
    isSaving: false,
    error: null,
    saveApiKey,
    testApiKey,
    deleteApiKey,
    hasKey,
    hasSystemKey,
    getKeyLast4,
    getSystemKeyLast4,
    reload: () => mutate("/api/ai/providers"),
  };
}
