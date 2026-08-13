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
  /** 已有 Agnes task_id，跳过 POST /videos 直接轮询该任务 */
  agnesTaskId?: string;
  /** 已有 Agnes video_id，需配合 agnesTaskId 使用 */
  agnesVideoId?: string;
}

export interface GeneratedVideo {
  /** Provider 返回的视频 URL（REMOTE_URL 模式） */
  url: string;
  mimeType: string;
  /** 文件大小（字节），undefined 表示未知 */
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
      // 精确探测各可能 URL 字段，打印完整结构供调试
      const possibleUrl =
        data.metadata?.url ||
        (data as unknown as { url?: string }).url ||
        (data as unknown as { video_url?: string }).video_url ||
        (data as unknown as { output?: { url?: string } }).output?.url ||
        (data as unknown as { result?: { url?: string } }).result?.url ||
        (data as unknown as { data?: { url?: string } }).data?.url;

      console.log("[agnes-video] completed 原始响应结构:", {
        topLevel: Object.keys(data),
        metadata: data.metadata ? Object.keys(data.metadata) : null,
        url: possibleUrl ? "FOUND" : "MISSING",
        raw: {
          id: data.id,
          video_id: data.video_id,
          task_id: data.task_id,
          status: data.status,
          progress: data.progress,
          seconds: data.seconds,
          size: data.size,
          metadataUrl: data.metadata?.url,
        },
      });

      if (!possibleUrl) {
        throw new Error(`视频生成完成但无 URL - metadata: ${JSON.stringify(data.metadata)}`);
      }
      return {
        url: possibleUrl,
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
    agnesTaskId: existingTaskId,
    agnesVideoId: existingVideoId,
  } = params;
  const [, modelName] = modelRef.includes(":")
    ? modelRef.split(":")
    : ["", modelRef];

  // Agnes 视频端点：POST /v1/videos
  const endpoint = `${baseURL.replace(/\/$/, "")}/videos`;

  let taskId: string;
  let videoId: string;

  // 已有 Agnes task_id → 直接跳到轮询阶段（不重复创建）
  if (existingTaskId && existingVideoId) {
    console.log(
      `[agnes-video] 复用已有任务: taskId=${existingTaskId} videoId=${existingVideoId} prompt="${prompt}"`
    );
    taskId = existingTaskId;
    videoId = existingVideoId;
  } else {
    console.log(
      `[agnes-video] 发起视频生成: endpoint=${endpoint}, model=${modelName}, prompt="${prompt}", imageUrl=${imageUrl}`
    );

    // Step 1: 创建视频任务（503 时指数退避重试）
    const MAX_RETRIES = 5;
    const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000]; // 5s ~ 2min
    const PER_TRY_TIMEOUT_MS = 60_000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const createTimeout = setTimeout(() => controller.abort(), PER_TRY_TIMEOUT_MS);

      try {
        const requestBody: Record<string, unknown> = {
          model: modelName,
          prompt,
        };

        if (imageUrl) {
          requestBody.image = imageUrl;
        }

        // 默认参数：5 秒视频，num_frames: 121 (8*15+1), frame_rate: 24
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

        if (res.ok) {
          const createData = (await res.json()) as AgnesTaskResponse;
          console.log(
            `[agnes-video] 任务创建成功: task_id=${createData.task_id} video_id=${createData.video_id} status=${createData.status}`
          );

          if (createData.status === "failed") {
            throw new Error(`视频任务创建失败: ${createData.error?.message ?? "未知错误"}`);
          }

          taskId = createData.task_id;
          videoId = createData.video_id;
          break; // 成功，跳出重试循环
        }

        const errText = await res.text().catch(() => "");
        console.error(`[agnes-video] HTTP ${res.status}:`, errText);

        if (res.status === 503 && attempt < MAX_RETRIES) {
          const waitMs = BACKOFF_MS[attempt] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
          console.warn(`[agnes-video] 队列满，第 ${attempt + 1} 次重试，等待 ${waitMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        throw new Error(`创建视频任务失败: ${res.status} ${errText}`);
      } catch (error) {
        clearTimeout(createTimeout);
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("创建视频任务超时（60s）");
        }
        throw error;
      }
    }
  }

  // 触发排队阶段进度
  if (onProgress) {
    onProgress(0, "任务已提交，等待模型处理...");
  }

  // Step 2: 轮询直到完成
  const { url: videoUrl, size, seconds } = await pollVideoTask(
    taskId!,
    videoId!,
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

  // Step 3: 返回 URL（REMOTE_URL 模式，不下载 bytes）
  const videos: GeneratedVideo[] = [
    {
      url: videoUrl,
      mimeType: "video/mp4",
      size: undefined,
    },
  ];

  return { videos, model: modelName, provider: "agnes" };
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

  const videos: GeneratedVideo[] = [
    {
      url: "",
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
