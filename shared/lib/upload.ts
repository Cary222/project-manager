/** 将 File 转成 data URL（base64）。 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * 将文件作为 PKM 笔记附件上传到指定项目。
 * 自动以文件名作为笔记标题，上传到 /api/pkm/notes 后刷新路由。
 * @throws 文件超限或 API 返回错误时抛出 Error。
 */
export async function uploadAttachmentAsNote(
  file: File,
  projectId: string,
  router: { refresh: () => void },
): Promise<void> {
  if (file.size > MAX_SIZE) {
    throw new Error(`文件不能超过 ${formatBytes(MAX_SIZE)}`);
  }
  const url = await fileToDataUrl(file);
  const title = file.name.replace(/\.[^.]+$/, "") || "无标题文档";
  const res = await fetch("/api/pkm/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content: "",
      tags: [],
      projectId,
      isPublic: true,
      attachments: [
        {
          name: file.name,
          url,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
        },
      ],
    }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "上传失败");
  router.refresh();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
