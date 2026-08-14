export interface VideoProviderConfig {
  apiKey: string;
  baseURL: string;
}

export interface VideoGenerationInput {
  prompt: string;
  model: string;
  imageUrl?: string;
  duration?: number;
  aspectRatio?: string;
}

/**
 * Provider 返回结果。
 * 注意 providerVideoUrl 命名——明确区分"Provider 临时 URL"和"存储层 key"。
 */
export interface VideoProviderResult {
  providerVideoUrl: string;
  duration?: number;
  mimeType: string;
  /** 文件大小（字节），undefined 表示未知，不要写 0 */
  size?: number;
}

/**
 * onProgress 是 Worker 内部回调，用于更新 DB metadata。
 * 不是 SSE 推送（Worker 独立进程，跨进程 globalThis 无效）。
 */
export interface VideoProvider {
  readonly name: string;
  readonly displayName: string;
  generate(
    input: VideoGenerationInput,
    config: VideoProviderConfig,
    onProgress?: (percent: number, detail: string) => void
  ): Promise<VideoProviderResult>;
}
