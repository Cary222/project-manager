/** 图片附件上传路线的设计文档。

# 路线 A：图片 → /api/upload → DB → /api/upload/[id] 代理
- 客户端：`uploadImage(file)`（见本文件）
- 服务端：`POST app/api/upload/route.ts`，接 multipart，写 `UploadedFile` 表（bytes BYTEA）
- 返回：`{ url, id, name, mimeType, size }`，url 形如 `/api/upload/<cuid>`
- 浏览器渲染：`GET app/api/upload/[id]/route.ts` 从 DB 读 bytes 返回
- 用途：ticket 备注图片 / 描述图片 / PKM 笔记内嵌图，避免 textarea 里塞 base64

# 路线 B：PKM 附件 → /api/pkm/notes + data URL
- 客户端：`uploadAttachmentAsNote(file, projectId, router)`（见本文件）
- 服务端：现有的 `POST /api/pkm/notes`，attachments[].url 是 data URL
- 用途：PKM 笔记附件（PDF / Word / Excel / 图片 / Markdown 等）
- 保留 data URL 是历史设计：本项目当前没有对象存储，把附件 base64 内嵌到 PKM 笔记里
  能避免依赖 OSS；代价是 PKM 笔记体积大，未来接 OSS 时再统一切到路线 A。

# 为什么把图片存 DB 而不是 `public/uploads/`
- 生产环境数据库是远端 PostgreSQL，多实例部署没有共享磁盘
- 存 DB 让 `GET /api/upload/[id]` 从任一实例都能取到，URL 也不依赖 `NEXT_PUBLIC_BASE_URL`

# 两条路线的关系
- 不重复：路线 A 是「图片快速上传并由服务端代理读取」，路线 B 是「PKM 笔记附件内嵌」。
- 当前 PR scope 内统一所有 *图片* 到路线 A；路线 B（PKM 多类型附件）暂留。
*/

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

export type UploadedImage = {
  /** 服务端返回的相对 URL（不含 origin），形如 `/uploads/xxx.png`。 */
  url: string;
  name: string;
  mimeType: string;
  size: number;
};

/**
 * 把图片文件上传到服务端 `POST /api/upload`，返回相对 URL。
 * 客户端如果需要 absolute URL 自己拼 `window.location.origin`。
 * @throws 文件超 10MB、非图片类型、网络错误、上传返回非 2xx 时抛出 Error。
 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  if (file.size > MAX_SIZE) {
    throw new Error(`文件不能超过 ${formatBytes(MAX_SIZE)}`);
  }
  if (file.size === 0) {
    throw new Error("文件不能为空");
  }
  if (!IMAGE_TYPES.has(file.type)) {
    throw new Error(`不支持的图片类型：${file.type || "未知"}`);
  }
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as Partial<UploadedImage> & {
    error?: string;
  };
  if (!res.ok || !body.url) {
    throw new Error(body.error || `上传失败 HTTP ${res.status}`);
  }
  return {
    url: body.url,
    name: body.name ?? file.name,
    mimeType: body.mimeType ?? file.type,
    size: body.size ?? file.size,
  };
}

/** 将 File 转成 data URL（base64）。 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** 把 `File` 包装成新 `File`，保留原 mimeType 但用新文件名（用于压缩后改名）。 */
export function renameFile(file: Blob, name: string, mimeType: string): File {
  return new File([file], name, { type: mimeType });
}

/** 把 server 端的 `/api/upload/<id>` 转成浏览器可访问的绝对 URL。 */
export function toAbsoluteUploadUrl(urlOrPath: string): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  if (typeof window === "undefined") return urlOrPath;
  return `${window.location.origin}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

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
      content: `通过项目文档上传：${file.name}`,
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
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || "上传失败");
  router.refresh();
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}