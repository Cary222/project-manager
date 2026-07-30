"use client";

import { ModelConfigPanel } from "@/features/ai/ui/model-select";

/**
 * AI 模型配置面板 — 入口组件
 *
 * 内部委托给 features/ai/ui/model-select/ModelConfigPanel，
 * 该组件：
 *   - 从 /api/ai/models 获取模型列表（服务端 API，客户端无 node:net 错误）
 *   - 用 ModelSelectionContext + localStorage 管理用户偏好
 *   - 提供厂商/类别筛选、模型勾选、API Key 本地配置
 */
export function AiModelConfigPanel() {
  return <ModelConfigPanel />;
}
