/**
 * image-generator.ts — AI 图片生成抽象
 *
 * 支持 providers：
 * - openai-compatible：OpenAI 兼容端点（如 token-plan），支持 wan2.7-image / dall-e-3 等
 * - wanx：通义万相原生 DashScope API（异步轮询）
 * - placeholder：本地占位（开发调试用）
 *
 * 调用方式：
 *   const result = await generateImages({ prompt, modelRef, apiKey, baseURL });
 */
import { generateWithWanx } from "./providers/wanx";

export interface GenerateImageParams {
  prompt: string;
  modelRef?: string;
  n?: number;
  size?: string;
  apiKey?: string;
  baseURL?: string; // OpenAI 兼容端点需要此字段
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface GenerateImageResult {
  images: GeneratedImage[];
  model: string;
  provider: string;
}

/**
 * 根据 modelRef 和 baseURL 判断使用哪个 provider
 *
 * dashscope-wan: maas.aliyuncs.com 上的 wan2.x 系列，需走 multimodal-generation 专用端点
 * openai-compatible: 标准 OpenAI /images/generations 兼容端点
 * wanx: 原生 DashScope 异步轮询 API（dashscope.aliyuncs.com）
 * placeholder: 兜底
 */
function detectProvider(
  modelRef?: string,
  baseURL?: string
): "dashscope-wan" | "openai-compatible" | "wanx" | "placeholder" {
  const ref = (modelRef ?? "").toLowerCase();
  const url = (baseURL ?? "").toLowerCase();

  // maas.aliyuncs.com 上的 wan2.x 模型 → DashScope multimodal-generation 专用端点
  if (url.includes("maas.aliyuncs.com") && (ref.includes("wan2") || ref.includes("wan2.7"))) {
    return "dashscope-wan";
  }

  // 原生 DashScope 异步 API
  if (url.includes("dashscope.aliyuncs.com") || ref.includes("wanx-v1")) {
    return "wanx";
  }

  // OpenAI 兼容端点（openrouter / apophis / compatible-mode 非 wan 模型等）
  if (
    url.includes("compatible-mode") ||
    url.includes("openrouter") ||
    url.includes("apophis") ||
    ref.includes("dall") ||
    ref.includes("flux")
  ) {
    return "openai-compatible";
  }

  return "placeholder";
}

/**
 * 通过 DashScope maas.aliyuncs.com 的 multimodal-generation 端点生成 wan2.x 图片（同步）
 */
async function generateWithDashScopeWan(
  params: GenerateImageParams,
  apiKey: string,
  baseURL: string
): Promise<GenerateImageResult> {
  const { prompt, modelRef = "wan2.7-image", n = 1, size = "2K" } = params;
  const [_provider, modelName] = modelRef.includes(":") ? modelRef.split(":") : ["", modelRef];

  // 从 compatible-mode baseURL 推导 multimodal-generation 端点
  // https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
  // → https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
  const endpoint = baseURL.replace(/\/compatible-mode\/v1.*$/, "/api/v1/services/aigc/multimodal-generation/generation");

  console.log(`[dashscope-wan] 发起生图: endpoint=${endpoint}, model=${modelName}, prompt="${prompt}"`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 120s 超时

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelName,
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: prompt }],
            },
          ],
        },
        parameters: {
          size,
          n,
        },
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[dashscope-wan] HTTP ${res.status}:`, errText);
      throw new Error(`DashScope Wan 生图失败: ${res.status} ${errText}`);
    }

    const data = await res.json();
    console.log(`[dashscope-wan] 响应:`, JSON.stringify(data, null, 2));

    // 类型断言
    const typedData = data as {
      output: {
        choices: Array<{
          message: {
            content: Array<{ type: string; image?: string }>;
          };
        }>;
      };
    };

    if (!typedData.output?.choices?.[0]?.message?.content) {
      throw new Error("DashScope Wan 返回数据为空");
    }

    // 提取图片 URL 并下载
    const images: GeneratedImage[] = await Promise.all(
      typedData.output.choices[0].message.content
        .filter((item) => item.type === "image" && item.image)
        .map(async (item) => {
          const imgRes = await fetch(item.image!);
          if (!imgRes.ok) throw new Error(`下载图片失败: ${imgRes.statusText}`);
          const arrayBuffer = await imgRes.arrayBuffer();
          const mimeType = imgRes.headers.get("content-type") ?? "image/png";
          return { bytes: Buffer.from(arrayBuffer), mimeType };
        })
    );

    return { images, model: modelName, provider: "dashscope-wan" };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("DashScope Wan 生图超时（120s）");
    }
    throw error;
  }
}

/**
 * 通过 OpenAI 兼容端点生成图片（同步 API，无需轮询）
 */
async function generateWithOpenAI(
  params: GenerateImageParams,
  apiKey: string,
  baseURL: string
): Promise<GenerateImageResult> {
  const { prompt, modelRef = "dall-e-3", n = 1, size = "1024x1024" } = params;
  const [_provider, modelName] = modelRef.includes(":") ? modelRef.split(":") : ["", modelRef];

  const endpoint = `${baseURL}/images/generations`;
  const requestBody = { model: modelName, prompt, n, size };
  console.log(`[openai-compat] 发起生图: endpoint=${endpoint}, body=`, JSON.stringify(requestBody));

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelName,
      prompt,
      n,
      size,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI 生图失败: ${res.status} ${errText}`);
  }

  const data = await res.json() as {
    created: number;
    data: Array<{ url?: string; b64_json?: string }>;
  };

  if (!data.data || data.data.length === 0) {
    throw new Error("OpenAI 返回数据为空");
  }

  // 下载图片
  const images: GeneratedImage[] = await Promise.all(
    data.data.map(async (item) => {
      if (item.b64_json) {
        const bytes = Buffer.from(item.b64_json, "base64");
        return { bytes, mimeType: "image/png" };
      }
      if (item.url) {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) throw new Error(`下载图片失败: ${imgRes.statusText}`);
        const arrayBuffer = await imgRes.arrayBuffer();
        const mimeType = imgRes.headers.get("content-type") ?? "image/png";
        return { bytes: Buffer.from(arrayBuffer), mimeType };
      }
      throw new Error("OpenAI 返回数据无 url 或 b64_json");
    })
  );

  return { images, model: modelName, provider: "openai-compatible" };
}

/**
 * 生成图片（路由到对应 provider）
 */
export async function generateImages(params: GenerateImageParams): Promise<GenerateImageResult> {
  const { prompt, modelRef = "dall-e-3", n = 1, size, apiKey, baseURL } = params;

  const provider = detectProvider(modelRef, baseURL);
  console.log(`[image-generator] detectProvider modelRef=${modelRef} baseURL=${baseURL} → provider=${provider}`);

  if (provider === "dashscope-wan") {
    if (!apiKey || !baseURL) {
      throw new Error("DashScope Wan 端点需要 apiKey 和 baseURL");
    }
    return generateWithDashScopeWan(params, apiKey, baseURL);
  }

  if (provider === "openai-compatible") {
    if (!apiKey || !baseURL) {
      throw new Error("OpenAI 兼容端点需要 apiKey 和 baseURL");
    }
    return generateWithOpenAI(params, apiKey, baseURL);
  }

  if (provider === "wanx") {
    if (!apiKey) throw new Error("Wanx API key 未配置，请设置 DASHSCOPE_API_KEY");
    return generateWithWanx({ prompt, modelRef, n, size }, apiKey);
  }

  // placeholder（默认 / 未配置 key 时）
  console.warn(`[image-generator] provider=${provider} 未实现或未配置，使用占位图`);
  const placeholderBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";
  const placeholderBytes = Buffer.from(placeholderBase64, "base64");

  const images: GeneratedImage[] = Array.from({ length: n }, () => ({
    bytes: placeholderBytes,
    mimeType: "image/png",
    width: 1,
    height: 1,
  }));

  return {
    images,
    model: modelRef,
    provider: "placeholder",
  };
}

/**
 * 生成单张图片（便捷函数）
 */
export async function generateSingleImage(
  params: Omit<GenerateImageParams, "n">
): Promise<GeneratedImage> {
  const result = await generateImages({ ...params, n: 1 });
  return result.images[0];
}
