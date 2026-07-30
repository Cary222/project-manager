/**
 * Agnes LLM Provider — Dynamic factory based on DB credentials.
 *
 * Credential resolution chain (system → user → env):
 *  1. SYSTEM Agnes provider (ROOT configured) — highest priority
 *  2. USER Agnes provider (personal) — fallback
 *  3. ENV vars (AGNES_API_KEY / AGNES_API_URL) — last resort
 */
import { resolveCredentialWithFallback } from "./credentials/api-key-store";
import { AGNES_API_BASE_URL, getProxyFetch } from "./proxy";
import { normalizeBaseURL } from "./providers/registry";

export const AGNES_PROVIDER = "agnes";

/**
 * Agnes env fallback map (last resort after DB lookups fail).
 */
function getAgnesEnvFallback(): { apiKey: string; baseURL: string } {
  return {
    apiKey: process.env.AGNES_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseURL: process.env.AGNES_API_URL ?? AGNES_API_BASE_URL,
  };
}

/**
 * Create an Agnes model instance.
 * Uses three-level fallback: SYSTEM → USER → ENV
 */
export async function createAgnesModel(
  modelName: string = "agnes-2.5-flash",
  userId?: string
): Promise<ReturnType<typeof import("@ai-sdk/openai").createOpenAI> extends (name: string) => infer R ? R : never> {
  const { createOpenAI } = await import("@ai-sdk/openai");

  // Resolve credential with three-level fallback
  const uid = userId ?? "__system__";
  const envFallback = getAgnesEnvFallback();
  const cred = await resolveCredentialWithFallback(uid, AGNES_PROVIDER, envFallback);

  if (!cred) {
    throw new Error(
      "Agnes API key not configured. ROOT can configure it in System Settings (API Key Management)."
    );
  }

  const normalizedBaseURL = normalizeBaseURL(cred.baseURL);
  const rawFetch =
    cred.transport === "proxy" ? (getProxyFetch() ?? globalThis.fetch) : globalThis.fetch;

  const openai = createOpenAI({
    baseURL: normalizedBaseURL,
    apiKey: cred.apiKey,
    fetch: rawFetch,
  });

  if (cred.ownerType !== "SYSTEM" && userId) {
    console.log(`[Agnes] using USER credential for user=${userId}`);
  }

  return openai(modelName) as ReturnType<typeof createOpenAI> extends (name: string) => infer R ? R : never;
}

/**
 * Agnes 2.5 flash model (primary)
 */
export async function getAgnesFlash25(userId?: string) {
  return createAgnesModel("agnes-2.5-flash", userId);
}

/**
 * Agnes 2.0 flash model (fallback)
 */
export async function getAgnesFlash(userId?: string) {
  return createAgnesModel("agnes-2.0-flash", userId);
}

/**
 * Wrapper: tries agnes-2.5-flash first, falls back to agnes-2.0-flash on error.
 * Uses three-level credential fallback for each attempt.
 */
export async function withAgnesDynamicModel<T>(
  fn: (model: Awaited<ReturnType<typeof createAgnesModel>>) => T | Promise<T>,
  userId?: string
): Promise<T> {
  try {
    const model = await createAgnesModel("agnes-2.5-flash", userId);
    return await fn(model);
  } catch (error) {
    if (isAbortError(error)) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Agnes] agnes-2.5-flash failed (${msg}), falling back to agnes-2.0-flash`
    );
    const fallback = await createAgnesModel("agnes-2.0-flash", userId);
    return fn(fallback);
  }
}

/**
 * Stream variant: tries agnes-2.5-flash first, falls back to agnes-2.0-flash.
 * Creates model inside try block so fallback can retry with different model.
 */
export async function withStreamAgnesDynamicModel<T>(
  fn: (model: Awaited<ReturnType<typeof createAgnesModel>>) => T,
  userId?: string
): Promise<T> {
  try {
    const model = await createAgnesModel("agnes-2.5-flash", userId);
    return fn(model);
  } catch (error) {
    if (isAbortError(error)) throw error;

    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[Agnes] agnes-2.5-flash stream failed (${msg}), falling back to agnes-2.0-flash`
    );
    const fallback = await createAgnesModel("agnes-2.0-flash", userId);
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
