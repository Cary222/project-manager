/**
 * Agnes LLM Provider — Dynamic factory based on DB credentials.
 *
 * Previously hardcoded OPENAI_API_KEY from env. Now reads SYSTEM Agnes
 * credentials from DB via resolveCredential(), matching user provider flow.
 */
import { resolveCredential } from "./credentials/api-key-store";
import { AGNES_API_BASE_URL, getProxyFetch } from "./proxy";
import { normalizeBaseURL } from "./providers/registry";

export const AGNES_PROVIDER = "agnes";

/**
 * Create an Agnes model instance using credentials from DB (SYSTEM provider).
 * Falls back to env vars if DB has no SYSTEM Agnes key.
 */
export async function createAgnesModel(
  modelName: string = "agnes-2.5-flash"
): Promise<ReturnType<typeof import("@ai-sdk/openai").createOpenAI> extends (name: string) => infer R ? R : never> {
  const { createOpenAI } = await import("@ai-sdk/openai");

  // Try DB first (SYSTEM provider)
  const cred = await resolveCredential("__system__", AGNES_PROVIDER);

  let apiKey: string;
  let baseURL: string;
  let transport: "proxy" | "direct" = "proxy";

  if (cred) {
    apiKey = cred.apiKey;
    baseURL = cred.baseURL;
    transport = cred.transport;
  } else {
    // Fallback to env vars (for migration/dev)
    apiKey = process.env.AGNES_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    baseURL = process.env.AGNES_API_URL ?? AGNES_API_BASE_URL;
    console.warn("[Agnes] SYSTEM provider not in DB, falling back to env AGNES_API_KEY");
  }

  if (!apiKey) {
    throw new Error(
      "Agnes API key not configured. ROOT can configure it in System Settings (API Key Management)."
    );
  }

  const normalizedBaseURL = normalizeBaseURL(baseURL);
  const rawFetch =
    transport === "proxy" ? (getProxyFetch() ?? globalThis.fetch) : globalThis.fetch;

  const openai = createOpenAI({
    baseURL: normalizedBaseURL,
    apiKey,
    fetch: rawFetch,
  });

  return openai(modelName) as ReturnType<typeof createOpenAI> extends (name: string) => infer R ? R : never;
}

/**
 * Agnes 2.5 flash model (primary)
 */
export async function getAgnesFlash25() {
  return createAgnesModel("agnes-2.5-flash");
}

/**
 * Agnes 2.0 flash model (fallback)
 */
export async function getAgnesFlash() {
  return createAgnesModel("agnes-2.0-flash");
}

/**
 * Backward-compatible: wraps a function that takes a model and returns T.
 * Calls createAgnesModel() each time to get fresh credentials.
 */
export async function withAgnesDynamicModel<T>(
  fn: (model: Awaited<ReturnType<typeof createAgnesModel>>) => T | Promise<T>
): Promise<T> {
  const model = await createAgnesModel("agnes-2.5-flash");
  try {
    return await fn(model);
  } catch (error) {
    if (isAbortError(error)) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Agnes] agnes-2.5-flash failed (${msg}), falling back to agnes-2.0-flash`
    );
    const fallback = await createAgnesModel("agnes-2.0-flash");
    return fn(fallback);
  }
}

/**
 * Stream variant: wraps a function that takes a model and returns T.
 * Creates model inside the try block so fallback can retry with different model.
 */
export async function withStreamAgnesDynamicModel<T>(
  fn: (model: Awaited<ReturnType<typeof createAgnesModel>>) => T
): Promise<T> {
  try {
    const model = await createAgnesModel("agnes-2.5-flash");
    return fn(model);
  } catch (error) {
    if (isAbortError(error)) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Agnes] agnes-2.5-flash stream failed (${msg}), falling back to agnes-2.0-flash`
    );
    const fallback = await createAgnesModel("agnes-2.0-flash");
    return fn(fallback);
  }
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error && cause.name === "AbortError";
  }
  return false;
}
