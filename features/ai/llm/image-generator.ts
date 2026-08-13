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
  /** 输入图片 URL 数组（I2I 模式） */
  imageUrls?: string[];
  /** 进度回调：接收 (percent: number, detail: string) */
  onProgress?: (percent: number, detail: string) => void;
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
 * agnes: apihub.agnes-ai.com 的图片生成 API（/v1/images/generations）
 * openai-compatible: 标准 OpenAI /images/generations 兼容端点
 * wanx: 原生 DashScope 异步轮询 API（dashscope.aliyuncs.com）
 * placeholder: 兜底
 */
function detectProvider(
  modelRef?: string,
  baseURL?: string
): "dashscope-wan" | "agnes" | "openai-compatible" | "wanx" | "placeholder" {
  const ref = (modelRef ?? "").toLowerCase();
  const url = (baseURL ?? "").toLowerCase();

  // maas.aliyuncs.com 上的 wan2.x 模型 → DashScope multimodal-generation 专用端点
  if (url.includes("maas.aliyuncs.com") && (ref.includes("wan2") || ref.includes("wan2.7"))) {
    return "dashscope-wan";
  }

  // Agnes 图片模型（agnes-image-*）→ apihub.agnes-ai.com/v1/images/generations
  if (ref.includes("agnes") && ref.includes("image")) {
    return "agnes";
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
  const { prompt, modelRef = "wan2.7-image", n = 1, size = "2K", imageUrls } = params;
  const [_provider, modelName] = modelRef.includes(":") ? modelRef.split(":") : ["", modelRef];

  // 从 compatible-mode baseURL 推导 multimodal-generation 端点
  // https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
  // → https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
  const endpoint = baseURL.replace(/\/compatible-mode\/v1.*$/, "/api/v1/services/aigc/multimodal-generation/generation");

  // 构建消息内容
  const content: Array<{ type: string; text?: string; image?: string }> = [];

  // I2I 模式：添加输入图片
  if (imageUrls && imageUrls.length > 0) {
    content.push({ type: "image", image: imageUrls[0] });
    console.log(`[dashscope-wan] I2I mode: using input image ${imageUrls[0]}`);
  }

  // 添加文本 prompt
  content.push({ type: "text", text: prompt });

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
              content,
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
 * 通过 apihub.agnes-ai.com/v1/images/generations 生成图片
 * 支持 agnes-image-2.1-flash / agnes-image-2.0-flash
 *
 * API 文档：https://wiki.agnes-ai.com/llms.txt
 *
 * 必填：model, prompt, size
 * 可选：ratio, image（图生图）, return_base64, extra_body.response_format
 */
async function generateWithAgnes(
  params: GenerateImageParams,
  apiKey: string,
  baseURL: string
): Promise<GenerateImageResult> {
  const { prompt, modelRef = "agnes-image-2.1-flash", n = 1, size = "1K", imageUrls } = params;
  const [_provider, modelName] = modelRef.includes(":") ? modelRef.split(":") : ["", modelRef];

  // Agnes 图片端点：apihub.agnes-ai.com/v1/images/generations
  // baseURL 通常是 apihub.agnes-ai.com/v1，构造完整端点
  const endpoint = `${baseURL.replace(/\/$/, "")}/images/generations`;

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    model: modelName,
    prompt,
    size,
    n,
  };

  // I2I 模式：传入输入图片 URL
  // Agnes API 要求图片放在 extra_body.image 中（文档：https://wiki.agnes-ai.com/en/docs/agnes-image-21-flash.md）
  if (imageUrls && imageUrls.length > 0) {
    requestBody.extra_body = {
      image: imageUrls,
      response_format: "url",
    };
    console.log(`[agnes-image] I2I mode: using input images ${JSON.stringify(imageUrls)}`);
  }

  console.log(`[agnes-image] 发起生图: endpoint=${endpoint}, model=${modelName}, prompt="${prompt}"`);

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
      body: JSON.stringify(requestBody),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[agnes-image] HTTP ${res.status}:`, errText);
      throw new Error(`Agnes 图片生成失败: ${res.status} ${errText}`);
    }

    const data = await res.json();
    console.log(`[agnes-image] 响应:`, JSON.stringify(data, null, 2));

    const responseData = data as {
      data: Array<{ url?: string | null; b64_json?: string | null }>;
    };

    if (!responseData.data || responseData.data.length === 0) {
      throw new Error("Agnes 返回数据为空");
    }

    // 处理图片数据
    const images: GeneratedImage[] = await Promise.all(
      responseData.data.map(async (item) => {
        if (item.b64_json) {
          return { bytes: Buffer.from(item.b64_json, "base64"), mimeType: "image/png" };
        }
        if (item.url) {
          const imgRes = await fetch(item.url);
          if (!imgRes.ok) throw new Error(`下载图片失败: ${imgRes.statusText}`);
          const arrayBuffer = await imgRes.arrayBuffer();
          const mimeType = imgRes.headers.get("content-type") ?? "image/png";
          return { bytes: Buffer.from(arrayBuffer), mimeType };
        }
        throw new Error("Agnes 返回数据无 url 或 b64_json");
      })
    );

    return { images, model: modelName, provider: "agnes" };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Agnes 图片生成超时（120s）");
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
  const { prompt, modelRef = "dall-e-3", n = 1, size, apiKey, baseURL, onProgress } = params;

  const provider = detectProvider(modelRef, baseURL);
  console.log(`[image-generator] detectProvider modelRef=${modelRef} baseURL=${baseURL} → provider=${provider}`);

  if (provider === "dashscope-wan") {
    if (!apiKey || !baseURL) {
      throw new Error("DashScope Wan 端点需要 apiKey 和 baseURL");
    }
    onProgress?.(10, "正在调用图片生成模型...");
    const result = await generateWithDashScopeWan(params, apiKey, baseURL);
    onProgress?.(80, "正在处理生成的图片...");
    return result;
  }

  if (provider === "agnes") {
    if (!apiKey || !baseURL) {
      throw new Error("Agnes 端点需要 apiKey 和 baseURL");
    }
    onProgress?.(10, "正在调用图片生成模型...");
    const result = await generateWithAgnes(params, apiKey, baseURL);
    onProgress?.(80, "正在处理生成的图片...");
    return result;
  }

  if (provider === "openai-compatible") {
    if (!apiKey || !baseURL) {
      throw new Error("OpenAI 兼容端点需要 apiKey 和 baseURL");
    }
    onProgress?.(10, "正在调用图片生成模型...");
    const result = await generateWithOpenAI(params, apiKey, baseURL);
    onProgress?.(80, "正在处理生成的图片...");
    return result;
  }

  if (provider === "wanx") {
    if (!apiKey) throw new Error("Wanx API key 未配置，请设置 DASHSCOPE_API_KEY");
    onProgress?.(10, "正在提交图片生成任务...");
    const result = await generateWithWanx({ prompt, modelRef, n, size }, apiKey);
    onProgress?.(80, "正在处理生成的图片...");
    return result;
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
  params: Omit<GenerateImageParams, "n">,
  onProgress?: (percent: number, detail: string) => void
): Promise<GeneratedImage> {
  const result = await generateImages({ ...params, n: 1, onProgress });
  return result.images[0];
}
