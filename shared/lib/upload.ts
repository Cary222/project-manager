/** 文件上传路线的设计文档。

# 路线 A：文件上传 → /api/upload → DB → /api/upload/[id] 代理
- 客户端：`uploadFile(file)`（见本文件），会先算 sha256 hash 作为 hint
- 服务端：`POST app/api/upload/route.ts`，接 multipart，写 `FileAsset` 表（bytes BYTEA）
- 服务端重算 sha256：客户端 hash 仅作 hint，服务端必须重新计算作为权威值
- 返回：`{ url, fileId, name, mimeType, size, hash }`，url 形如 `/api/upload/<fileId>`
- 浏览器渲染：`GET app/api/upload/[id]/route.ts` 从 DB 读 bytes 返回
- 支持任意文件类型（最大 10MB）
- 用途：ticket 备注附件 / 工单附件 / PKM 附件，避免 base64 内嵌

# 路线 B：PKM 附件 → /api/pkm/notes + data URL（历史遗留）
- 客户端：`uploadAttachmentAsNote(file, projectId, router)`（见本文件）
- 服务端：现有的 `POST /api/pkm/notes`，attachments[].url 是 data URL
- 用途：PKM 笔记附件（PDF / Word / Excel / 图片 / Markdown 等）
- 保留 data URL 是历史设计：未来接 OSS 时统一切到路线 A。

# 为什么把文件存 DB 而不是 `public/uploads/`
- 生产环境数据库是远端 PostgreSQL，多实例部署没有共享磁盘
- 存 DB 让 `GET /api/upload/[id]` 从任一实例都能取到，URL 也不依赖 `NEXT_PUBLIC_BASE_URL`

# 两条路线的关系
- 路线 A 是「文件上传并由服务端代理读取」（PR10 新增）
- 路线 B 是「PKM 笔记附件内嵌」（历史遗留）
*/

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

import { sha256File } from "./hash";

export type UploadedFileResult = {
  /** 服务端返回的相对 URL（不含 origin），形如 `/api/upload/<fileId>`。 */
  url: string;
  /** 服务端返回的 fileId（对应 FileAsset.id）。 */
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  /** 服务端权威 hash（客户端 hint 用于优化，服务端会重算）。 */
  hash: string;
  /**  true = 服务端发现 hash 命中，直接返回已有 fileId。 */
  deduplicated?: boolean;
};

/**
 * 把图片/文件上传到服务端 `POST /api/upload`，返回相对 URL。
 * 支持任意文件类型（最大 10MB）。
 * 客户端先计算 hash 作为 hint；服务端会重新计算作为权威值。
 * 客户端如果需要 absolute URL 自己拼 `window.location.origin`。
 * @throws 文件超 10MB、空文件、网络错误、上传返回非 2xx 时抛出 Error。
 */
export async function uploadFile(file: File): Promise<UploadedFileResult> {
  if (file.size > MAX_SIZE) {
    throw new Error(`文件不能超过 ${formatBytes(MAX_SIZE)}`);
  }
  if (file.size === 0) {
    throw new Error("文件不能为空");
  }

  // 客户端先算 hash 作为 hint（服务端会重算）
  const clientHash = await sha256File(file);

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("clientHash", clientHash);

  const res = await fetch("/api/upload", { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as Partial<UploadedFileResult> & {
    error?: string;
  };
  if (!res.ok || !body.url) {
    throw new Error(body.error || `上传失败 HTTP ${res.status}`);
  }
  return {
    url: body.url,
    fileId: body.fileId ?? "",
    name: body.name ?? file.name,
    mimeType: body.mimeType ?? file.type,
    size: body.size ?? file.size,
    hash: body.hash ?? clientHash,
    deduplicated: body.deduplicated,
  };
}

/**
 * @deprecated 请使用 `uploadFile`。本函数保留以避免破坏现有调用。
 */
export const uploadImage = uploadFile;

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