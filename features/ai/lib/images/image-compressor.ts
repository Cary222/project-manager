/**
 * AI 参考图压缩工具
 *
 * 策略：
 * 1. 超过 1024px 时缩放
 * 2. 统一转 JPEG quality 0.8（I2I/I2V 不需要透明通道）
 * 3. 压缩后大小保护：超过 5MB 降到 quality 0.6，仍超提示用户
 *
 * 直接返回完整的 data:image/jpeg;base64,... 字符串
 */

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export class ImageCompressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageCompressionError";
  }
}

/**
 * 压缩图片并转为 Base64 data URI
 * @param file - 原始图片文件
 * @returns 完整的 data:image/jpeg;base64,... 字符串
 * @throws ImageCompressionError 如果图片无法压缩到限制内
 */
export async function compressImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new ImageCompressionError("只支持图片文件");
  }

  const image = await loadImage(file);

  let targetWidth = image.naturalWidth;
  let targetHeight = image.naturalHeight;

  if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(targetWidth, targetHeight);
    targetWidth = Math.round(targetWidth * scale);
    targetHeight = Math.round(targetHeight * scale);
  }

  let dataUri = await drawAndCompress(image, targetWidth, targetHeight, JPEG_QUALITY);
  let compressedSize = estimateBase64Size(dataUri);

  // 大小保护：降级到 quality 0.6
  if (compressedSize > MAX_SIZE_BYTES) {
    dataUri = await drawAndCompress(image, targetWidth, targetHeight, 0.6);
    compressedSize = estimateBase64Size(dataUri);

    if (compressedSize > MAX_SIZE_BYTES) {
      throw new ImageCompressionError(
        `图片压缩后仍有 ${formatBytes(compressedSize)}，请选择更小的图片`
      );
    }
  }

  if (!dataUri || typeof dataUri !== "string" || !dataUri.startsWith("data:image/")) {
    throw new ImageCompressionError("Canvas 输出格式异常");
  }

  return dataUri;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new ImageCompressionError("图片加载失败"));
    };
    img.src = objectUrl;
  });
}

function drawAndCompress(
  image: HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
  quality: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new ImageCompressionError("无法创建 canvas context"));
      return;
    }

    // JPEG 不支持透明，填充白色背景
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    resolve(dataUrl);
  });
}

/** 从 data URI 估算实际字节大小 */
function estimateBase64Size(dataUrl: string): number {
  const base64Data = dataUrl.split(",")[1];
  if (!base64Data) return 0;
  const padding = (base64Data.match(/=/g) ?? []).length;
  return Math.floor((base64Data.length * 3) / 4) - padding;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
