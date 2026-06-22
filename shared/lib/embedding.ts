import { createHash } from "node:crypto";

const DEFAULT_EMBEDDING_DIMENSION = 1024;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 30000;

export function getEmbeddingApiUrl() {
  const value = process.env.EMBEDDING_API_URL?.trim();
  if (!value) {
    throw new Error("EMBEDDING_API_URL_MISSING");
  }
  return value.replace(/\/$/, "");
}

function getExpectedEmbeddingDimension() {
  const raw = process.env.EMBEDDING_DIMENSIONS?.trim();
  if (!raw) return DEFAULT_EMBEDDING_DIMENSION;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("EMBEDDING_DIMENSIONS_INVALID");
  }
  return value;
}

function getEmbeddingTimeoutMs() {
  const raw = process.env.EMBEDDING_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_EMBEDDING_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("EMBEDDING_TIMEOUT_MS_INVALID");
  }
  return value;
}

export function normalizeEmbeddingText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function buildEmbeddingHash(text: string) {
  return createHash("sha256").update(normalizeEmbeddingText(text), "utf8").digest("hex");
}

export function validateEmbedding(vector: unknown): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error("EMBEDDING_VECTOR_INVALID");
  }

  const numbers = vector.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("EMBEDDING_VECTOR_INVALID");
    }
    return value;
  });

  const expected = getExpectedEmbeddingDimension();
  if (numbers.length !== expected) {
    throw new Error(`EMBEDDING_DIMENSION_MISMATCH:${numbers.length}`);
  }

  return numbers;
}

export async function fetchEmbedding(text: string) {
  const normalized = normalizeEmbeddingText(text);
  if (!normalized) {
    throw new Error("EMBEDDING_TEXT_EMPTY");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getEmbeddingTimeoutMs());

  try {
    const response = await fetch(`${getEmbeddingApiUrl()}/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: normalized }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`EMBEDDING_API_HTTP_${response.status}`);
    }

    const payload = (await response.json()) as { embedding?: unknown };
    return validateEmbedding(payload.embedding);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("EMBEDDING_API_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildEmbeddingInput(title: string, content: string) {
  return normalizeEmbeddingText(`${title}\n${content}`);
}
