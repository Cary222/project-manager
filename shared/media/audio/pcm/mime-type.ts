/**
 * 获取浏览器支持的音频 MIME 类型
 * 按优先级尝试，返回第一个被支持的类型
 */
export function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/wav",
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return "audio/webm";
}
