/**
 * Re-export image-attachments utilities from the ai-workspace feature
 */
export {
  validateAgentImages,
  isBase64ImageWithinLimits,
  getBase64DecodedByteLength,
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  type Base64ImageAttachment,
} from "@/features/ai/ui/ai-workspace/lib/image-attachments";
