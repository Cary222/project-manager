export type PkmAttachment = {
  name: string;
  url: string;
  mimeType: string;
  size: number;
};

export const PKM_ATTACHMENT_MAX_COUNT = 8;
export const PKM_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;

export function isPkmAttachment(value: unknown): value is PkmAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const item = value as Record<string, unknown>;
  return (
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    typeof item.url === "string" &&
    item.url.trim().length > 0 &&
    typeof item.mimeType === "string" &&
    item.mimeType.trim().length > 0 &&
    typeof item.size === "number" &&
    Number.isFinite(item.size) &&
    item.size >= 0
  );
}

export function normalizePkmAttachments(input: unknown) {
  if (!Array.isArray(input)) return [] as PkmAttachment[];

  const seen = new Set<string>();
  const attachments: PkmAttachment[] = [];

  for (const value of input) {
    if (!isPkmAttachment(value)) continue;

    const name = value.name.trim();
    const url = value.url.trim();
    const mimeType = value.mimeType.trim();
    const size = Math.round(value.size);

    if (!name || !url || !mimeType || size < 0 || size > PKM_ATTACHMENT_MAX_SIZE) {
      continue;
    }

    const key = `${name}:${size}:${url.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    attachments.push({
      name,
      url,
      mimeType,
      size,
    });

    if (attachments.length >= PKM_ATTACHMENT_MAX_COUNT) {
      break;
    }
  }

  return attachments;
}
