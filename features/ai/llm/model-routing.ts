import type { TaskType, ModelCapability } from "./providers/types";

export function selectModel(
  taskType: TaskType,
  options?: {
    manualOverride?: string;
    defaults?: Partial<Record<TaskType, string>>;
    capabilities?: ModelCapability[];
  }
): { providerId: string; modelName: string } {
  // 1. 手动覆盖优先
  if (options?.manualOverride) {
    return parseModelRef(options.manualOverride);
  }

  // 2. 用户路由配置
  if (options?.defaults?.[taskType]) {
    return parseModelRef(options.defaults[taskType]!);
  }

  // 3. 系统默认值
  const defaults: Record<TaskType, string> = {
    quick: "agnes:agnes-2.5-flash",
    chat: "agnes:agnes-2.5-flash",
    search: "agnes:agnes-2.5-flash",
    rag: "agnes:agnes-2.5-flash",
    complex: "deepseek:deepseek-chat",
    // image/video/audio 使用专门的模型
    image: "agnes:agnes-image-2.1-flash",
    video: "agnes:agnes-video-2.0",
    audio: "agnes:agnes-2.5-flash",
  };

  return parseModelRef(defaults[taskType] ?? defaults.chat);
}

function parseModelRef(ref: string): { providerId: string; modelName: string } {
  const [providerId, modelName] = ref.split(":");
  return { providerId, modelName };
}
