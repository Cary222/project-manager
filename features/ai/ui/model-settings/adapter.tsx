"use client";

/**
 * Shared Model Settings — Adapter 接口与 Context
 *
 * 共享 UI 通过 Adapter 访问持久化 / Discovery / Test / Catalog 能力：
 * - PiWorkspaceAdapter：/api/models-config* + /api/auth/*（models.json，Workspace Scope）
 * - ProjectHubAdapter：/api/ai/providers* + /api/ai/model-preferences（ProjectHub DB，User Scope）
 *
 * 共享组件本身不直接 fetch、不依赖 Prisma / models.json / Pi Runtime / Route Handler。
 */

import { createContext, useContext } from "react";
import type { DiscoveredModel, ModelCatalogRecommendation, ModelEntry, ModelsJson, ProviderEntry } from "./types";

export interface DiscoverResult {
  models: DiscoveredModel[];
  endpoint?: string;
}

export interface TestOutcome {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  status?: number;
  responseText?: string;
}

export interface CatalogQuery {
  query: string;
  provider: string;
  baseUrl?: string;
  limit?: number;
}

export interface CatalogResult {
  recommendation?: ModelCatalogRecommendation;
}

export interface ModelSettingsAdapter {
  /** 读取完整配置（Pi: models.json + 站点继承视图；ProjectHub: DB 视图合成）。 */
  load(): Promise<ModelsJson>;
  /** 保存完整配置（继承自站点的 provider 由 adapter 自行过滤，不写入 Workspace 存储）。 */
  save(config: ModelsJson): Promise<void>;
  /**
   * 删除指定 provider（持久化层）。
   * - ProjectHub: DELETE /api/ai/providers（DB）
   * - PiWorkspace: 从 models.json 移除 / 继承 provider 加入屏蔽集
   * 返回 true 表示成功删除，false 表示未找到或无需操作。
   */
  remove?(providerName: string): Promise<boolean>;
  /** 动态模型发现（失败时抛 Error，message 供 UI 展示）。 */
  discover(providerName: string, provider: ProviderEntry): Promise<DiscoverResult>;
  /** 模型连接测试（结构化结果，不抛错）。 */
  test(input: { providerName: string; provider: ProviderEntry; model: ModelEntry }): Promise<TestOutcome>;
  /** models.dev catalog 推荐查询（失败时抛 Error）。 */
  catalog(params: CatalogQuery): Promise<CatalogResult>;
  /** 可选：provider 是否继承自站点配置（站点侧只读，修改应去站点 Settings）。 */
  isInherited?: (providerName: string) => boolean;
}

const ModelSettingsAdapterContext = createContext<ModelSettingsAdapter | null>(null);

export function ModelSettingsAdapterProvider({
  adapter,
  children,
}: {
  adapter: ModelSettingsAdapter;
  children: React.ReactNode;
}) {
  return (
    <ModelSettingsAdapterContext.Provider value={adapter}>
      {children}
    </ModelSettingsAdapterContext.Provider>
  );
}

export function useModelSettingsAdapter(): ModelSettingsAdapter {
  const adapter = useContext(ModelSettingsAdapterContext);
  if (!adapter) {
    throw new Error("useModelSettingsAdapter must be used within a ModelSettingsAdapterProvider");
  }
  return adapter;
}
