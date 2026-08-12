/**
 * video-generator.ts — AI 视频生成抽象
 *
 * 支持 providers：
 * - agnes：apihub.agnes-ai.com 的视频生成 API（异步任务 + 轮询）
 * - placeholder：本地占位（开发调试用）
 *
 * Agnes Video V2.0 API 文档：https://wiki.agnes-ai.com/en/docs/agnes-video-v20.md
 *
 * 调用方式：
 *   const result = await generateVideos({ prompt, modelRef, apiKey, baseURL });
 *   const single = await generateSingleVideo({ prompt, modelRef, apiKey, baseURL });
 */

export interface GenerateVideoParams {
  prompt: string;
  modelRef?: string;
  apiKey?: string;
  baseURL?: string;
  imageUrl?: string; // 图生视频：输入图片 URL
  duration?: number; // 视频时长（秒）
}

export interface GeneratedVideo {
  bytes: Buffer;
  mimeType: string;
  size?: number;
}

export interface GenerateVideoResult {
  videos: GeneratedVideo[];
  model: string;
  provider: string;
}

/**
 * 根据 modelRef 和 baseURL 判断使用哪个 provider
 *
 * agnes: apihub.agnes-ai.com 的视频生成 API（异步任务）
 * placeholder: 兜底
 */
function detectProvider(
  modelRef?: string,
  baseURL?: string
): "agnes" | "placeholder" {
  const ref = (modelRef ?? "").toLowerCase();
  const url = (baseURL ?? "").toLowerCase();

  // Agnes 视频模型（agnes-video-*）→ apihub.agnes-ai.com
  if (ref.includes("agnes") && (ref.includes("video") || ref.includes("wan"))) {
    return "agnes";
  }

  // apihub.agnes-ai.com 直接匹配
  if (url.includes("apihub.agnes-ai.com")) {
    return "agnes";
  }

  return "placeholder";
}

/**
 * Agnes API 响应类型
 */
interface AgnesTaskResponse {
  id: string;
  task_id: string;
  video_id: string;
  object: string;
  model: string;
  status: string;
  progress: number;
  created_at: number;
  seconds: string;
  size: string;
  completed_at?: number;
  metadata?: {
    size_mapping?: Record<string, unknown>;
    url?: string;
  };
  error?: {
    message: string;
    code: string;
  };
}

/**
 * 轮询视频任务直到完成
 * @param onProgress 进度回调，接收 (percent: number, detail: string)
 */
async function pollVideoTask(
  taskId: string,
  videoId: string,
  apiKey: string,
  baseURL: string,
  timeoutMs: number = 300000, // 5 分钟超时
  onProgress?: (percent: number, detail: string) => void
): Promise<{ url: string; size: string; seconds: string }> {
  const startTime = Date.now();
  const pollInterval = 5000; // 5 秒轮询间隔

  // GET /agnesapi?video_id=xxx
  const queryURL = `${baseURL.replace(/\/$/, "")}/agnesapi?video_id=${encodeURIComponent(videoId)}`;

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(queryURL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`轮询视频状态失败: HTTP ${res.status} ${errText}`);
    }

    const data = (await res.json()) as AgnesTaskResponse;
    console.log(`[agnes-video] 轮询 video_id=${videoId}: status=${data.status} progress=${data.progress}%`);

    // 触发进度回调
    if (onProgress) {
      onProgress(data.progress ?? 0, `视频生成中 (${data.progress ?? 0}%)`);
    }

    if (data.status === "completed") {
      if (!data.metadata?.url) {
        throw new Error("视频生成完成但无 URL");
      }
      return {
        url: data.metadata.url,
        size: data.size,
        seconds: data.seconds,
      };
    }

    if (data.status === "failed") {
      const errMsg = data.error?.message ?? "视频生成失败";
      throw new Error(`视频生成失败: ${errMsg}`);
    }

    // queued / in_progress：继续轮询
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("视频生成超时（5 分钟）");
}

/**
 * 通过 apihub.agnes-ai.com 生成视频（异步任务 + 轮询）
 * 支持 agnes-video-v2.0 等视频模型
 * @param onProgress 进度回调，接收 (percent: number, detail: string)
 */
async function generateWithAgnes(
  params: GenerateVideoParams,
  apiKey: string,
  baseURL: string,
  onProgress?: (percent: number, detail: string) => void
): Promise<GenerateVideoResult> {
  const {
    prompt,
    modelRef = "agnes-video-v2.0",
    imageUrl,
  } = params;
  const [, modelName] = modelRef.includes(":")
    ? modelRef.split(":")
    : ["", modelRef];

  // Agnes 视频端点：POST /v1/videos
  const endpoint = `${baseURL.replace(/\/$/, "")}/videos`;

  console.log(
    `[agnes-video] 发起视频生成: endpoint=${endpoint}, model=${modelName}, prompt="${prompt}", imageUrl=${imageUrl}`
  );

  // Step 1: 创建视频任务
  const controller = new AbortController();
  const createTimeout = setTimeout(() => controller.abort(), 60000); // 创建任务 60s 超时

  try {
    const requestBody: Record<string, unknown> = {
      model: modelName,
      prompt,
    };

    // 图生视频：传入 image
    if (imageUrl) {
      requestBody.image = imageUrl;
    }

    // 默认参数：5 秒视频
    // num_frames: 121 (8*15+1), frame_rate: 24
    requestBody.num_frames = 121;
    requestBody.frame_rate = 24;

    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    clearTimeout(createTimeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[agnes-video] HTTP ${res.status}:`, errText);
      throw new Error(`创建视频任务失败: ${res.status} ${errText}`);
    }

    const data = (await res.json()) as AgnesTaskResponse;
    console.log(`[agnes-video] 任务创建成功: video_id=${data.video_id} status=${data.status}`);

    if (data.status === "failed") {
      throw new Error(`视频任务创建失败: ${data.error?.message ?? "未知错误"}`);
    }

    // 触发排队阶段进度
    if (onProgress) {
      onProgress(0, "任务已提交，等待模型处理...");
    }

    // Step 2: 轮询直到完成
    const { url: videoUrl, size, seconds } = await pollVideoTask(
      data.task_id,
      data.video_id,
      apiKey,
      baseURL,
      300000,
      onProgress
    );

    console.log(`[agnes-video] 视频生成完成: url=${videoUrl} size=${size} seconds=${seconds}`);

    // 触发下载阶段进度
    if (onProgress) {
      onProgress(100, "视频生成完成，正在下载...");
    }

    // Step 3: 下载视频
    const videoRes = await fetch(videoUrl);
    if (!videoRes.ok) {
      throw new Error(`下载视频失败: ${videoRes.statusText}`);
    }

    const arrayBuffer = await videoRes.arrayBuffer();
    const mimeType = videoRes.headers.get("content-type") ?? "video/mp4";

    const videos: GeneratedVideo[] = [
      {
        bytes: Buffer.from(arrayBuffer),
        mimeType,
        size: arrayBuffer.byteLength,
      },
    ];

    return { videos, model: modelName, provider: "agnes" };
  } catch (error) {
    clearTimeout(createTimeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("创建视频任务超时（60s）");
    }
    throw error;
  }
}

/**
 * 生成视频（路由到对应 provider）
 * @param onProgress 进度回调，接收 (percent: number, detail: string)
 */
export async function generateVideos(
  params: GenerateVideoParams,
  onProgress?: (percent: number, detail: string) => void
): Promise<GenerateVideoResult> {
  const { prompt, modelRef = "agnes-video-v2.0", apiKey, baseURL } = params;

  const provider = detectProvider(modelRef, baseURL);
  console.log(
    `[video-generator] detectProvider modelRef=${modelRef} baseURL=${baseURL} → provider=${provider}`
  );

  if (provider === "agnes") {
    if (!apiKey || !baseURL) {
      throw new Error("Agnes 端点需要 apiKey 和 baseURL");
    }
    return generateWithAgnes(params, apiKey, baseURL, onProgress);
  }

  // placeholder（默认 / 未配置 key 时）
  console.warn(
    `[video-generator] provider=${provider} 未实现或未配置，使用占位视频`
  );
  const placeholderBytes = Buffer.alloc(0);

  const videos: GeneratedVideo[] = [
    {
      bytes: placeholderBytes,
      mimeType: "video/mp4",
      size: 0,
    },
  ];

  return {
    videos,
    model: modelRef,
    provider: "placeholder",
  };
}

/**
 * 生成单个视频（便捷函数）
 * @param onProgress 进度回调，接收 (percent: number, detail: string)
 */
export async function generateSingleVideo(
  params: Omit<GenerateVideoParams, "duration">,
  onProgress?: (percent: number, detail: string) => void
): Promise<GeneratedVideo> {
  const result = await generateVideos(params, onProgress);
  return result.videos[0];
}
