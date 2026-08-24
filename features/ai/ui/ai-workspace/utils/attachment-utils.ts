/**
 * Attachment utilities - format file size and check data URIs
 */

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Check if a string is a data URI
 */
export function isDataUri(str: string): boolean {
  return str.startsWith("data:");
}

/**
 * Extract MIME type from data URI
 */
export function getDataUriMimeType(dataUri: string): string | null {
  const match = dataUri.match(/^data:([^;]+);/);
  return match ? match[1] : null;
}

/**
 * Extract base64 content from data URI
 */
export function getDataUriContent(dataUri: string): string | null {
  const match = dataUri.match(/^data:[^;]+;base64,(.+)$/);
  return match ? match[1] : null;
}
