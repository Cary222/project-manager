/**
 * wanx.ts — 通义万相（Tongyi Wanx）图片生成 Provider
 *
 * 文档：https://help.aliyun.com/zh/dashscope/api/image-generation/tongyi-wanx-wanx
 *
 * 模型映射：
 *   "wanx-v1"        → text-to-image（默认）
 *   "wanx-plus"      → plus 版（有更高质量）
 *
 * 流程：POST /v1/images/generations
 *       → 拿到 task_id
 *       →轮询 GET /v1/images/generations/{task_id} 直到 task_status === "SUCCESS"
 *       → 从 output.images[0].url 下载 bytes
 */

import type { GenerateImageParams, GeneratedImage } from "../image-generator";

const WANX_API_BASE = "https://dashscope.aliyuncs.com/api/v1";
const WANX_TIMEOUT_MS = 120_000; // 通义万相任务最长 2 分钟

const MODEL_MAP: Record<string, string> = {
  "wanx-v1": "wanx-v1",
  "wanx-plus": "wanx-plus",
  // 后备：modelRef 含 wanx 字样直接用
};

const SIZE_MAP: Record<string, string> = {
  "1024x1024": "1024*1024",
  "512x512": "512*512",
  "768x768": "768*768",
  "1024x576": "1024*576", // 16:9
  "576x1024": "576*1024", // 9:16
};

interface WanxTaskResponse {
  output: {
    task_id: string;
    task_status: "PENDING" | "RUNNING" | "SUCCESS" | "FAIL";
    task_metrics?: {
      TOTAL: string;
      FAILED: string;
    };
    images?: Array<{
      index: number;
      url: string;
    }>;
  };
  request_id: string;
}

interface WanxError {
  code: string;
  message: string;
}

function resolveModel(modelRef?: string): string {
  if (modelRef && MODEL_MAP[modelRef]) return MODEL_MAP[modelRef];
  if (modelRef?.toLowerCase().includes("wanx")) return modelRef;
  return "wanx-v1"; // 默认用基础版
}

function resolveSize(size?: string): string {
  return size && SIZE_MAP[size] ? SIZE_MAP[size] : "1024*1024";
}

async function wanxRequest(
  apiKey: string,
  path: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? WANX_TIMEOUT_MS);

  try {
    const res = await fetch(`${WANX_API_BASE}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...fetchOptions.headers,
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 轮询任务状态，直到 SUCCESS 或 FAIL
 */
async function pollTaskStatus(
  apiKey: string,
  taskId: string,
  onProgress?: (status: string) => void
): Promise<WanxTaskResponse["output"]> {
  const start = Date.now();
  const maxAttempts = 60; // 最多轮询 60 次 × 2s = 2 分钟

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await wanxRequest(apiKey, `/images/generations/${taskId}`, {
      method: "GET",
      timeoutMs: 10_000,
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as WanxError;
      throw new Error(`Wanx poll failed: ${err.message ?? res.statusText}`);
    }

    const data = (await res.json()) as WanxTaskResponse;
    const status = data.output.task_status;

    onProgress?.(`[Wanx] 任务状态: ${status} (${Math.round((Date.now() - start) / 1000)}s)`);

    if (status === "SUCCESS") {
      if (!data.output.images?.length) {
        throw new Error("Wanx 返回成功但无图片数据");
      }
      return data.output;
    }

    if (status === "FAIL") {
      throw new Error(`Wanx 生图失败: ${JSON.stringify(data.output.task_metrics)}`);
    }

    // PENDING / RUNNING：等 2s 再轮询
    await new Promise((r) => setTimeout(r, 2000));
  }

  throw new Error("Wanx 生图超时（超过 2 分钟）");
}

/**
 * 下载图片 bytes
 */
async function downloadImage(url: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载图片失败: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  const mimeType = res.headers.get("content-type") ?? "image/png";
  return { bytes: Buffer.from(arrayBuffer), mimeType };
}

export interface WanxResult {
  images: GeneratedImage[];
  model: string;
  provider: string;
}

export async function generateWithWanx(
  params: GenerateImageParams,
  apiKey: string
): Promise<WanxResult> {
  const { prompt, modelRef, n = 1, size } = params;
  const model = resolveModel(modelRef);
  const outputSize = resolveSize(size);

  console.log(`[wanx] 发起生图请求: model=${model}, n=${n}, prompt="${prompt}"`);

  // Step 1: 提交任务
  const submitRes = await wanxRequest(
    apiKey,
    "/images/generations",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        input: { prompt },
        parameters: {
          n,
          size: outputSize,
        },
      }),
      timeoutMs: 10_000,
    }
  );

  if (!submitRes.ok) {
    const err = (await submitRes.json().catch(() => ({}))) as WanxError;
    throw new Error(`Wanx 提交任务失败: ${err.code} - ${err.message}`);
  }

  const submitData = (await submitRes.json()) as WanxTaskResponse;
  const taskId = submitData.output.task_id;
  console.log(`[wanx] 任务已提交, task_id=${taskId}, request_id=${submitData.request_id}`);

  // Step 2: 轮询等待完成
  const output = await pollTaskStatus(apiKey, taskId, (status) => {
    console.log(status);
  });

  // Step 3: 下载图片
  const images: GeneratedImage[] = await Promise.all(
    output.images!.map(async (img) => {
      const { bytes, mimeType } = await downloadImage(img.url);
      return { bytes, mimeType };
    })
  );

  return { images, model, provider: "wanx" };
}
