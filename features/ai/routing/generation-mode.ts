/**
 * Generation mode types - 区分文本输入 vs 图片参考输入
 */
export type ImageGenerationMode = "TEXT_TO_IMAGE" | "IMAGE_TO_IMAGE";
export type VideoGenerationMode = "TEXT_TO_VIDEO" | "IMAGE_TO_VIDEO";
export type GenerationMode = ImageGenerationMode | VideoGenerationMode;

/**
 * 根据任务类型和输入资源决定生成模式
 *
 * 设计原则：
 * - Task Router 负责"用户想干什么"（chat/image/video）
 * - 本函数负责"具体生成模式"（T2I/I2I/T2V/I2V）
 */
export function resolveGenerationMode(
  category: "image" | "video",
  inputFileIds: string[] | undefined
): GenerationMode {
  const hasImages = inputFileIds && inputFileIds.length > 0;

  if (category === "image") {
    return hasImages ? "IMAGE_TO_IMAGE" : "TEXT_TO_IMAGE";
  }

  return hasImages ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";
}
