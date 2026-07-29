import { createOpenAI } from "@ai-sdk/openai";
import { ProxyAgent } from "undici";

function buildProxyFetch() {
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY;
  if (!proxyUrl) return undefined;

  const proxyAgent = new ProxyAgent({ uri: proxyUrl });

  return async function proxyFetch(
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

    return new Response(response.body as unknown as BodyInit, {
      status: response.statusCode,
      headers: normalizedHeaders,
    });
  };
}

export const agnes = createOpenAI({
  baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "",
  fetch: buildProxyFetch(),
});

export const agnesFlash25 = agnes.chat("agnes-2.5-flash");
export const agnesFlash = agnes.chat("agnes-2.0-flash");

const PRIMARY_MODEL = agnesFlash25;
const FALLBACK_MODEL = agnesFlash;

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error && cause.name === "AbortError";
  }
  return false;
}

/**
 * Wrapper for generateText: tries agnes-2.5-flash first, falls back to agnes-2.0-flash on error.
 * Does NOT fall back on user-initiated abort (AbortError).
 */
export async function withAgnetModelFallback<T>(
  fn: (model: ReturnType<typeof agnes.chat>) => Promise<T>
): Promise<T> {
  try {
    return await fn(PRIMARY_MODEL);
  } catch (error) {
    if (isAbortError(error)) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Agnes] agnes-2.5-flash failed (${msg}), falling back to agnes-2.0-flash`
    );
    return fn(FALLBACK_MODEL);
  }
}

/**
 * Wrapper for streamText (synchronous call, non-Promise return): tries agnes-2.5-flash first,
 * falls back to agnes-2.0-flash if the stream creation throws.
 * Does NOT fall back on user-initiated abort (AbortError).
 */
export function withStreamTextFallback<T>(fn: (model: ReturnType<typeof agnes.chat>) => T): T {
  try {
    return fn(PRIMARY_MODEL);
  } catch (error) {
    if (isAbortError(error)) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Agnes] agnes-2.5-flash stream failed (${msg}), falling back to agnes-2.0-flash`
    );
    return fn(FALLBACK_MODEL);
  }
}
