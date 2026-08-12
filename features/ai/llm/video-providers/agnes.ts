/**
 * Agnes Video Provider 实现
 *
 * 基于 video-generator.ts 中的 generateWithAgnes 逻辑，
 * 实现 VideoProvider 接口，只返回 URL 不下载 bytes。
 */

import type {
  VideoProvider,
  VideoProviderConfig,
  VideoGenerationInput,
  VideoProviderResult,
} from "./types";

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

async function pollVideoTask(
  taskId: string,
  videoId: string,
  apiKey: string,
  baseURL: string,
  timeoutMs: number = 300000,
  onProgress?: (percent: number, detail: string) => void
): Promise<{ url: string; size: string; seconds: string }> {
  const startTime = Date.now();
  const pollInterval = 5000;

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

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("视频生成超时（5 分钟）");
}

export class AgnesVideoProvider implements VideoProvider {
  readonly name = "agnes";
  readonly displayName = "Agnes Video";

  async generate(
    input: VideoGenerationInput,
    config: VideoProviderConfig,
    onProgress?: (percent: number, detail: string) => void
  ): Promise<VideoProviderResult> {
    const { prompt, model: modelRef, imageUrl } = input;
    const { apiKey, baseURL } = config;

    const modelName = modelRef || "agnes-video-v2.0";

    const endpoint = `${baseURL.replace(/\/$/, "")}/videos`;

    console.log(
      `[agnes-video] 发起视频生成: endpoint=${endpoint}, model=${modelName}, prompt="${prompt}", imageUrl=${imageUrl}`
    );

    // Step 1: 创建视频任务
    const controller = new AbortController();
    const createTimeout = setTimeout(() => controller.abort(), 60000);

    try {
      const requestBody: Record<string, unknown> = {
        model: modelName,
        prompt,
      };

      if (imageUrl) {
        requestBody.image = imageUrl;
      }

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

      if (onProgress) {
        onProgress(0, "任务已提交，等待模型处理...");
      }

      // Step 2: 轮询直到完成
      const { url: videoUrl, size } = await pollVideoTask(
        data.task_id,
        data.video_id,
        apiKey,
        baseURL,
        300000,
        onProgress
      );

      console.log(`[agnes-video] 视频生成完成: url=${videoUrl} size=${size}`);

      // 只返回 URL，不下载 bytes
      return {
        providerVideoUrl: videoUrl,
        mimeType: "video/mp4",
        size: undefined, // Agnes 未返回确切 size
      };
    } catch (error) {
      clearTimeout(createTimeout);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("创建视频任务超时（60s）");
      }
      throw error;
    }
  }
}
