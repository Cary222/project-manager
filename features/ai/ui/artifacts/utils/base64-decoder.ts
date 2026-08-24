/**
 * Base64 解码工具（Pdf/Excel/Docx 共用）
 */

/**
 * Base64 字符串转 ArrayBuffer
 * 支持带 data URL 前缀的格式（如 data:application/pdf;base64,xxx）
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  let base64Data = base64;

  if (base64.startsWith('data:')) {
    const base64Match = base64.match(/base64,(.+)/);
    if (base64Match) {
      base64Data = base64Match[1];
    }
  }

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Base64 字符串转 Uint8Array
 * 支持带 data URL 前缀的格式（如 data:application/pdf;base64,xxx）
 */
export function decodeBase64(content: string): Uint8Array {
  let base64Data = content;

  if (content.startsWith('data:')) {
    const base64Match = content.match(/base64,(.+)/);
    if (base64Match) {
      base64Data = base64Match[1];
    }
  }

  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
