/**
 * Agnes API base URL. In production this is the Cloudflare Worker URL;
 * in development it points directly at apihub.agnes-ai.com.
 */
export const AGNES_API_BASE_URL =
  process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1";

export const AGNES_API_CHAT_URL = `${AGNES_API_BASE_URL}/chat/completions`;

export const AGNES_PROVIDER_ID = "agnes";

/**
 * Convert AI SDK's ImagePart format to Agnes-compatible format.
 * 
 * AI SDK ImagePart: { type: "image", image: "data:image/png;base64,..." }
 * Agnes expects:     { type: "image_url", image_url: { url: "..." } }
 */
function convertRequestFormat(body: string): string {
  // Convert AI SDK ImagePart to Agnes format
  return body.replace(
    /"type":\s*"image",\s*"image":\s*"([^"]*)"/g,
    '"type": "image_url", "image_url": { "url": "$1" }'
  );
}

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

    // For Agnes API chat completions, convert AI SDK format to Agnes format
    const isAgnsChat = urlStr.includes("/chat/completions");
    let finalInit = init;
    if (isAgnsChat && init?.body) {
      const bodyStr = typeof init.body === "string" 
        ? init.body 
        : JSON.stringify(init.body);
      const convertedBody = convertRequestFormat(bodyStr);
      finalInit = {
        ...init,
        body: convertedBody,
      };
    }

    const { request } = await import("undici");
    const response = await request(urlStr, {
      ...finalInit,
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
  const fetchFn = fn ?? globalThis.fetch;
  
  // Get URL string for format conversion check
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : String(input);

  // For Agnes API chat completions, convert AI SDK format to Agnes format
  const isAgnsChat = urlStr.includes("/chat/completions");
  let finalInit = init;
  if (isAgnsChat && init?.body) {
    const bodyStr = typeof init.body === "string"
      ? init.body
      : JSON.stringify(init.body);
    
    // Step 1: Extract image URLs from __IMAGES__ marker
    let parsed: { messages?: Array<{ role?: string; content?: unknown }> } | undefined;
    try {
      parsed = JSON.parse(bodyStr);
      
      // Process each message to extract image URLs
      if (parsed?.messages && Array.isArray(parsed.messages)) {
        const messages: Array<{ role?: string; content?: any }> = parsed.messages;
        for (const msg of messages) {
          if (msg.role === "user" && typeof msg.content === "string") {
            const match = msg.content.match(/\n\n__IMAGES__:(\[.*\])$/);
            if (match) {
              const imageUrls: string[] = JSON.parse(match[1]);
              const textContent = msg.content.replace(/\n\n__IMAGES__:.*$/, "");
              
              // Convert to multimodal format
              const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
                { type: "text", text: textContent }
              ];
              
              for (const url of imageUrls) {
                contentParts.push({
                  type: "image_url",
                  image_url: { url }
                });
              }
              
              msg.content = contentParts;
              console.log('[PROXY] Converted __IMAGES__ marker to multimodal:', {
                imageCount: imageUrls.length,
                textLength: textContent.length
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('[PROXY] Failed to parse body for image extraction:', e);
    }
    
    // Step 2: Convert to Agnes format
    const convertedBody = convertRequestFormat(parsed ? JSON.stringify(parsed) : bodyStr);
    finalInit = {
      ...init,
      body: convertedBody,
    };
  }

  return fetchFn(input, finalInit);
}

/**
 * Builds the appropriate fetch for a specific provider.
 * Agnes API (apihub.agnes-ai.com) always routes through proxy if configured.
 * All other providers (user-configured DeepSeek, OpenRouter, etc.) connect directly.
 */
export function buildProviderFetch(_providerId: string): typeof fetch | undefined {
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
