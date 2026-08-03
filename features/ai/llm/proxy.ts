/**
 * Agnes API base URL. In production this is the Cloudflare Worker URL;
 * in development it points directly at apihub.agnes-ai.com.
 */
export const AGNES_API_BASE_URL =
  process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1";

export const AGNES_API_CHAT_URL = `${AGNES_API_BASE_URL}/chat/completions`;

export const AGNES_PROVIDER_ID = "agnes";

/**
 * Builds a fetch function that routes Agnes API calls through the configured proxy.
 * External providers (DeepSeek, OpenRouter, etc.) bypass the proxy and connect directly.
 *
 * Rationale: The proxy (Clash Verge) is intended for Agnes/internal services only.
 * Routing all external traffic through it causes timeout errors when the proxy's
 *分流 rules don't include the target domain.
 */
export function buildProxyAwareFetch(): typeof fetch | undefined {
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (!proxyUrl) return undefined;

  // Dynamic import: undici is Node.js only, never runs in browser
  const { ProxyAgent } = require("undici") as typeof import("undici");
  const proxyAgent = new ProxyAgent({ uri: proxyUrl });

  return async function proxiedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : String(input);

    const { request } = await import("undici");
    const response = await request(urlStr, {
      ...init,
      dispatcher: proxyAgent,
    } as Parameters<typeof request>[1]);

    const normalizedHeaders = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") {
        normalizedHeaders.append(key, value);
      } else if (Array.isArray(value)) {
        for (const v of value) normalizedHeaders.append(key, v);
      }
    }

    // Collect raw body bytes
    const bodyChunks: Uint8Array[] = [];
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      bodyChunks.push(chunk);
    }
    const rawBody = Buffer.concat(bodyChunks).toString("utf-8");

    // Agnes (Responses API) returns "object":"response" with
    // { prompt_tokens, completion_tokens } — AI SDK schema expects
    // { input_tokens, output_tokens }. Normalize here so downstream
    // Zod parsing succeeds regardless of provider variant.
    const normalizedBody = rawBody.replaceAll(
      /"prompt_tokens":(\d+)/g,
      '"input_tokens":$1'
    ).replaceAll(
      /"completion_tokens":(\d+)/g,
      '"output_tokens":$1'
    );

    return new Response(normalizedBody, {
      status: response.statusCode,
      headers: normalizedHeaders,
    });
  };
}

// Lazy singleton — only built once per process lifetime
let _proxyFetch: ReturnType<typeof buildProxyAwareFetch> | undefined;
export function getProxyFetch(): typeof fetch | undefined {
  if (_proxyFetch === undefined) {
    _proxyFetch = buildProxyAwareFetch();
  }
  return _proxyFetch;
}

/**
 * Agnes-only proxy-aware fetch. Returns a proxy-fetch when HTTPS_PROXY is set,
 * undefined otherwise. External providers should NOT use this — call proxyFetch
 * for Agnes or globalThis.fetch directly for user providers.
 */
export async function proxyFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const fn = getProxyFetch();
  return fn
    ? fn(input, init)
    : globalThis.fetch(input, init);
}

/**
 * Builds the appropriate fetch for a specific provider.
 * Agnes API (apihub.agnes-ai.com) always routes through proxy if configured.
 * All other providers (user-configured DeepSeek, OpenRouter, etc.) connect directly.
 */
export function buildProviderFetch(providerId: string): typeof fetch | undefined {
  // Agnes uses "openai" as its provider ID (for createOpenAI compatibility)
  // but we identify it by its baseURL, not the providerId string.
  // When the baseURL matches Agnes API, route through the proxy.
  const isAgnsAPI = AGNES_API_BASE_URL
    ? (baseURL: string | undefined) => {
        if (!baseURL) return false;
        try {
          return new URL(baseURL).origin === new URL(AGNES_API_BASE_URL).origin;
        } catch {
          return false;
        }
      }
    : () => false;

  // Agnes API — always proxy if available
  if (isAgnsAPI(AGNES_API_BASE_URL)) {
    return getProxyFetch() ?? globalThis.fetch;
  }
  // User providers (DeepSeek, OpenRouter, etc.) — connect directly
  return undefined;
}

/**
 * Get the appropriate fetch for Agnes API calls.
 * Routes through HTTPS_PROXY when configured (for Clash Verge etc.).
 */
export function getAgnesFetch(): typeof fetch {
  return getProxyFetch() ?? globalThis.fetch;
}
