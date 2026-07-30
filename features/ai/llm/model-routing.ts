import type { TaskType } from "./providers/types";

export function selectModel(
  taskType: TaskType,
  userConfig?: { manualOverride?: string; defaults?: Record<TaskType, string> }
): { providerId: string; modelName: string } {
  // 1. 手动覆盖优先
  if (userConfig?.manualOverride) {
    return parseModelRef(userConfig.manualOverride);
  }

  // 2. 用户路由配置
  if (userConfig?.defaults?.[taskType]) {
    return parseModelRef(userConfig.defaults[taskType]);
  }

  // 3. 系统默认值
  const defaults: Record<TaskType, string> = {
    quick: "agnes:agnes-2.5-flash",
    chat: "agnes:agnes-2.5-flash",
    search: "agnes:agnes-2.5-flash",
    rag: "agnes:agnes-2.5-flash",
    complex: "deepseek:deepseek-chat",
  };

  return parseModelRef(defaults[taskType] ?? defaults.chat);
}

function parseModelRef(ref: string): { providerId: string; modelName: string } {
  const [providerId, modelName] = ref.split(":");
  return { providerId, modelName };
}
