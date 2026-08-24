/**
 * Model Connection Test — 共享核心（Stage 6）
 *
 * 从 app/api/models-config/test/route.ts 抽取，供两个路由共用同一份测试逻辑：
 * - /api/models-config/test（Pi Workspace Scope，契约不变）
 * - /api/ai/providers/test（ProjectHub User Scope）
 *
 * 实现方式：用 Pi ModelRuntime 解析 provider 配置与凭证（Pi Auth Parsing，
 * 不重新实现 Provider Auth），再对目标模型发一条最小补全请求。
 */

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { completeSimple, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

export const MODEL_TEST_TIMEOUT_MS = 20_000;

export interface ModelConnectionTestInput {
  providerName: string;
  /** provider 配置（baseUrl / api / apiKey / headers 等，models.json provider 形状）。 */
  provider: Record<string, unknown>;
  /** 模型配置，至少包含 id。 */
  model: Record<string, unknown> & { id: string };
}

export interface ModelConnectionTestResult {
  ok: boolean;
  error?: string;
  latencyMs?: number;
  status?: number;
  responseText?: string;
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * 执行模型连接测试。参数由调用方校验（providerName/provider/model.id 非空）。
 * 失败场景通过 result.ok=false + error 表达；基础设施异常才抛错。
 */
export async function runModelConnectionTest(
  input: ModelConnectionTestInput,
): Promise<ModelConnectionTestResult> {
  const { providerName, provider, model } = input;
  let tempDir: string | undefined;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "pi-web-model-test-"));
    const modelsPath = join(tempDir, "models.json");
    writeFileSync(modelsPath, JSON.stringify({
      providers: {
        [providerName]: {
          ...provider,
          models: [{ ...model, id: model.id }],
        },
      },
    }, null, 2), "utf8");

    const modelRuntime = await ModelRuntime.create({ modelsPath });
    const loadError = modelRuntime.getError();
    if (loadError) return { ok: false, error: loadError };

    const runtimeModel = modelRuntime.getModel(providerName, model.id);
    if (!runtimeModel) return { ok: false, error: `Model not found: ${providerName}/${model.id}` };

    const resolved = await modelRuntime.getAuth(runtimeModel);
    if (!resolved?.auth.apiKey) {
      return { ok: false, error: `No API key found for "${providerName}"` };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_TEST_TIMEOUT_MS);
    let status: number | undefined;
    const startedAt = Date.now();

    try {
      const message = await completeSimple(runtimeModel, {
        messages: [{
          role: "user",
          content: "Reply with OK only.",
          timestamp: Date.now(),
        }],
      }, {
        apiKey: resolved.auth.apiKey,
        headers: resolved.auth.headers,
        maxTokens: 16,
        timeoutMs: MODEL_TEST_TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
        signal: controller.signal,
        onResponse: (response) => { status = response.status; },
      });

      const latencyMs = Date.now() - startedAt;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        return {
          ok: false,
          error: message.errorMessage ?? (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
          latencyMs,
          status,
        };
      }

      return {
        ok: true,
        latencyMs,
        status,
        responseText: getAssistantText(message).slice(0, 300),
      };
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
