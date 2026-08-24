/**
 * Model Discovery Auth — Pi SDK Provider Auth Parsing
 *
 * =============================================================================
 * 职责边界
 * =============================================================================
 * ✅ 负责：
 *   - Pi SDK 的 Auth Parsing（复用 Pi ModelRuntime）
 *   - 动态发现时的凭证解析
 *   - 临时 models.json 的创建与清理
 *
 * ❌ 不负责：
 *   - UserApiKey 的 CRUD（由 api-key-store.ts 提供）
 *   - 模型发现（由 registry.ts / model-discovery.ts 提供）
 *   - 模型价格元数据（由 model-catalog.ts 提供）
 *
 * =============================================================================
 * 为什么 Pi SDK 在这里属于合理复用
 * =============================================================================
 * Pi ModelRuntime 提供了 Provider Auth Parsing 能力：
 * - 支持 40+ Provider 的认证方式
 * - 包括 OpenAI Compatible、Anthropic、Google 等
 * - 支持自定义 headers、API key、Bearer token 等
 * - 经过充分验证的认证解析逻辑
 *
 * 本文件复用 Pi SDK 的理由：
 * 1. 不需要为每个 Provider 实现认证逻辑
 * 2. 与 Pi 命令行保持一致的认证行为
 * 3. Pi SDK 已经处理了各种边界情况
 * 4. 减少代码重复和维护成本
 *
 * =============================================================================
 * 工作原理
 * =============================================================================
 * 1. 创建临时 models.json，包含 provider 配置
 * 2. 使用 Pi ModelRuntime 加载配置
 * 3. 调用 modelRuntime.getAuth() 获取认证信息
 * 4. 清理临时文件
 *
 * 这种方式的优势：
 * - 复用 Pi 的认证解析逻辑
 * - 不需要了解每个 Provider 的认证细节
 * - 与 Pi 的配置格式保持一致
 *
 * =============================================================================
 * 使用场景
 * =============================================================================
 * /api/models-config/discover（动态模型发现）
 * - 用户配置 Provider 后，测试认证是否有效
 * - 获取 API Key 和 Headers 用于调用 Provider API
 *
 * =============================================================================
 * 安全性
 * =============================================================================
 * 临时文件安全：
 * - 在 tmpdir() 中创建临时目录
 * - 操作完成后立即删除（finally 块）
 * - 临时 models.json 不包含敏感信息
 *
 * 注意：Pi SDK 会读取 Provider 配置中的 API Key，请确保：
 * - Provider 配置中的 API Key 是可信的
 * - 不将敏感信息写入日志
 *
 * =============================================================================
 * 与 api-key-store.ts 的关系
 * =============================================================================
 * api-key-store.ts：UserApiKey DB 的 CRUD
 *   - 保存/读取用户配置的 API Key
 *   - 加密存储
 *   - 凭证解析（基于 DB 数据）
 *
 * 本文件：Pi SDK 的 Auth Parsing
 *   - 复用 Pi 的认证解析逻辑
 *   - 用于动态发现场景
 *   - 基于 Provider 配置
 *
 * 两者互补，不冲突。
 */

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface ModelDiscoveryAuth {
  apiKey?: string;
  headers: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function resolveModelDiscoveryAuth(
  providerName: string,
  provider: Record<string, unknown>,
): Promise<ModelDiscoveryAuth> {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  let tempDir: string | undefined;
  try {
    tempDir = mkdtempSync(join(tmpdir(), "pi-web-model-discovery-"));
    const modelsPath = join(tempDir, "models.json");
    const discoveryModelId = "__pi_web_model_discovery__";
    writeFileSync(modelsPath, JSON.stringify({
      providers: {
        [providerName]: {
          ...provider,
          models: [{ id: discoveryModelId }],
        },
      },
    }, null, 2), "utf8");

    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const loadError = modelRuntime.getError();
    if (loadError) throw new Error(loadError);
    const model = modelRuntime.getModel(providerName, discoveryModelId);
    if (!model) throw new Error(`Unable to load provider "${providerName}"`);

    const resolved = await modelRuntime.getAuth(model);
    if (resolved) {
      return {
        apiKey: resolved.auth.apiKey,
        headers: stringRecord(resolved.auth.headers),
      };
    }

    return {
      headers: stringRecord(modelRuntime.getCompatibilityRequestConfig(model).headers),
    };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
