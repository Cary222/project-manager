/**
 * /api/auth/login/[provider] — OAuth 登录（SSE + 回调）
 *
 *   GET    启动 OAuth 流（SSE）。前端订阅 text/event-stream 接收事件；
 *          auth_url/device_code/prompt_request/select_request/success/error/cancelled。
 *   POST   处理 OAuth 回调：前端把外部回调拿到的 code + token 推回来，
 *          路由 resolve 对应 pending promise，让 GET 那条流的 prompt() 返回。
 *
 * 与 pi-web-ref 的差异：
 *   - 1. ModelRuntime 单例（getModelRuntime）
 *   - 2. invalidateModelsCache + invalidateUnifiedModelsCache + resetModelRuntime
 *   - 3. 导入 NextResponse（pi-web-ref 用 Response.json；项目习惯 NextResponse）
 */
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getModelRuntime, resetModelRuntime } from "@/lib/model-discovery";
import { invalidateUnifiedModelsCache } from "@/lib/unified-models-cache";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (!token || !code) {
    return NextResponse.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return NextResponse.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
  if (!token.startsWith(`${provider}-`)) {
    return NextResponse.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return NextResponse.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  // AbortController propagates client disconnect into ModelRuntime.login().
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const modelRuntime = await getModelRuntime();
      if (!modelRuntime.getProvider(provider)?.auth.oauth) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        controller.close();
        return;
      }

      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;

      const createClientInputRequest = () => {
        const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      try {
        await modelRuntime.login(provider, "oauth", {
          prompt: async (prompt: AuthPrompt) => {
            const request = prompt.type === "manual_code"
              ? getManualInputRequest()
              : createClientInputRequest();
            if (prompt.type === "select") {
              send(controller, {
                type: "select_request",
                message: prompt.message,
                options: prompt.options,
                token: request.token,
              });
            } else {
              send(controller, {
                type: "prompt_request",
                message: prompt.message,
                placeholder: prompt.placeholder ?? null,
                token: request.token,
              });
            }
            return request.promise;
          },
          notify: (event: AuthEvent) => {
            if (event.type === "auth_url") {
              const request = getManualInputRequest();
              send(controller, {
                type: "auth",
                url: event.url,
                instructions: event.instructions ?? null,
                token: request.token,
              });
            } else if (event.type === "device_code") {
              send(controller, {
                type: "device_code",
                userCode: event.userCode,
                verificationUri: event.verificationUri,
                intervalSeconds: event.intervalSeconds ?? null,
                expiresInSeconds: event.expiresInSeconds ?? null,
              });
            } else {
              send(controller, { type: "progress", message: event.message });
            }
          },
          signal: abort.signal,
        });

        invalidateModelsCache();
        invalidateUnifiedModelsCache();
        resetModelRuntime();
        send(controller, { type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send(controller, { type: "error", message: msg });
        } else {
          send(controller, { type: "cancelled" });
        }
      } finally {
        cleanup();
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
