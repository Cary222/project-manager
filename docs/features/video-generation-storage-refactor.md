# 视频生成架构重构：REMOTE_URL 存储 + Storage Layer

> 适用：project-manager 仓库（Next.js + Prisma + BackgroundWorker）
> 目标：让任何同事拿到这份文档 + 仓库 commit 后，能完整复现"视频生成链路"的架构设计与验证过程。
> 工单：#10206

---

## 1. 目标 & 背景

### 1.1 旧版问题

- **现象**：视频生成 100% 后，消息显示"完成"但播放器无法播放，Worker 日志无错误
- **根因**：`video.handler.ts` 在生成完成后尝试将 10-50MB 视频 bytes 写入 PostgreSQL 的 `AiFileAsset.bytes` 字段。PostgreSQL 对单行数据大小有限制（默认 8KB），写入失败但错误未被正确捕获，导致文件记录为空
- **次生问题**：`emitMessageDelta()`（SSE 推送）在 Background Worker 独立进程中无效，跨进程 `globalThis` 无法传递事件

### 1.2 结论

- Agnes Provider **只返回 URL，不下载 bytes**
- `AiFileAsset` 存储类型改为 `REMOTE_URL`：`storageKey = providerVideoUrl`，`bytes = null`
- `/file-assets/:id` API 安全校验后 302 重定向到 Provider URL
- 进度更新只走 DB + 前端轮询，移除 SSE 推送

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `prisma/schema.prisma` | 修改 | `AiFileStorageType` 枚举增加 `REMOTE_URL` |
| `features/ai/llm/video-generator.ts` | 修改 | `GeneratedVideo` 接口改为返回 `url` 而非 `bytes`；Agnes 不再 fetch 下载视频 |
| `worker/background/handlers/video.handler.ts` | 修改 | 使用 `saveVideoAsset()` 接口，移除 `emitMessageDelta` 和直接 `prisma.aiFileAsset.create()` |
| `app/api/ai/file-assets/[id]/route.ts` | 修改 | 增加 `REMOTE_URL` 分支：https + 域名白名单校验后 302 重定向 |
| `features/ai/llm/video-providers/storage.ts` | 新增 | Storage Layer 接口：`saveVideoAsset()` |
| `features/ai/llm/video-providers/types.ts` | 新增 | `VideoProvider` 接口抽象 |
| `features/ai/llm/video-providers/agnes.ts` | 新增 | Agnes Provider 实现 |

---

## 3. 核心实现

### 3.1 Storage Layer 接口（`storage.ts`）

```startLine:1:26:features/ai/llm/video-providers/storage.ts
export async function saveVideoAsset(params: {
  providerVideoUrl: string;
  mimeType: string;
  size?: number;
}): Promise<AiFileAsset> {
  return prisma.aiFileAsset.create({
    data: {
      storageType: "REMOTE_URL",
      storageKey: providerVideoUrl,
      mimeType,
      size: size ?? null,
      // bytes 必须为 null（REMOTE_URL 模式）
    },
  });
}
```

**为什么这样写**：Handler 通过接口调用存储，未来的对象存储迁移只需改此函数内部，Handler/Provider/UI 不动。

### 3.2 VideoProvider 接口（`types.ts`）

```startLine:1:38:features/ai/llm/video-providers/types.ts
export interface VideoProviderResult {
  providerVideoUrl: string;
  duration?: number;
  mimeType: string;
  size?: number; // undefined 表示未知，不要写 0
}

export interface VideoProvider {
  readonly name: string;
  readonly displayName: string;
  generate(
    input: VideoGenerationInput,
    config: VideoProviderConfig,
    onProgress?: (percent: number, detail: string) => void
  ): Promise<VideoProviderResult>;
}
```

**为什么 `onProgress` 只是 Worker 内部回调**：Worker 是独立进程，`globalThis` 跨进程无效，之前的 `emitMessageDelta` SSE 推送实际上从未生效。

### 3.3 Agnes Provider 实现（`agnes.ts`）

```startLine:171:176:features/ai/llm/video-providers/agnes.ts
// 只返回 URL，不下载 bytes
return {
  providerVideoUrl: videoUrl,
  mimeType: "video/mp4",
  size: undefined, // Agnes 未返回确切 size
};
```

**为什么 `size = undefined` 而非 `size = 0`**：`0 bytes` 表示空文件；`undefined` 表示未知。语义更准确。

### 3.4 video.handler.ts（调用 Storage Layer）

```startLine:89:94:worker/background/handlers/video.handler.ts
const video = result.videos[0];
const asset = await saveVideoAsset({
  providerVideoUrl: video.url,
  mimeType: video.mimeType,
  size: video.size,
});
```

**为什么删除了所有 `emitMessageDelta`**：Worker 独立进程，跨进程 SSE 无效。进度更新只写 DB，前端轮询读取。

### 3.5 file-assets API 安全校验（`[id]/route.ts`）

```startLine:46:68:app/api/ai/file-assets/[id]/route.ts
// REMOTE_URL: 安全校验后 302 重定向
if (asset.storageType === "REMOTE_URL" && asset.storageKey) {
  let url: URL;
  try {
    url = new URL(asset.storageKey);
  } catch {
    return NextResponse.json({ error: "Invalid storage URL" }, { status: 400 });
  }

  // 只允许 https
  if (url.protocol !== "https:") {
    return NextResponse.json({ error: "Invalid URL protocol" }, { status: 400 });
  }

  // 只允许已知 Provider 域名
  const ALLOWED_DOMAINS = ["apihub.agnes-ai.com", "agnes-ai.com"];
  const isAllowed = ALLOWED_DOMAINS.some(
    (d) => url.hostname === d || url.hostname.endsWith(`.${d}`)
  );
  if (!isAllowed) {
    return NextResponse.json({ error: "Provider domain not allowed" }, { status: 400 });
  }

  return NextResponse.redirect(asset.storageKey, 302);
}
```

**为什么必须校验**：防止数据库中 `storageKey = http://evil-site.com` 时变成开放重定向漏洞。

---

## 4. 环境与配置

| 变量 | 值 | 说明 |
|------|----|------|
| Prisma Schema | `pm` schema | `AiFileStorageType` 枚举在 `pm` 下 |
| Worker 端口 | 通过 `BG_WORKER_*` 环境变量 | 独立进程，不走 Next.js |
| Agnes API | `AGNES_API_KEY` + `AGNES_BASE_URL` | 从 DB SYSTEM/USER provider 读取 |
| 允许域名 | `apihub.agnes-ai.com`、`agnes-ai.com` | 可在 `ALLOWED_DOMAINS` 扩展 |

---

## 5. 启动 / 部署

```bash
# 1. 更新 Prisma schema（REMOTE_URL 枚举）
cd /Users/vastgui/Desktop/project-manager
npx prisma db push

# 2. 生成 Prisma Client
npx prisma generate

# 3. 重启 Next.js 服务（端口 3003）
npm run dev

# 4. 重启 Background Worker（独立进程）
npm run worker
```

---

## 6. 测试 & 验证

### 6.1 Schema 验证

```bash
PGPASSWORD=community psql -d community -h localhost -U community -c \
  "SELECT enumlabel FROM pg_enum WHERE enumlabel = 'REMOTE_URL';"
```

**期望输出**：有 `REMOTE_URL` 行

### 6.2 端到端验证

前端发起视频生成请求后：

```bash
# 检查文件记录：storageType=REMOTE_URL, bytes=null
PGPASSWORD=community psql -d community -h localhost -U community -c \
  "SELECT id, \"storageType\", \"storageKey\", \"bytes\", \"mimeType\" \
   FROM pm.\"AiFileAsset\" ORDER BY \"createdAt\" DESC LIMIT 3;"

# 检查消息状态流转
PGPASSWORD=community psql -d community -h localhost -U community -c \
  "SELECT id, \"executionStatus\", metadata FROM pm.\"AiChatMessage\" ORDER BY \"createdAt\" DESC LIMIT 1;"

# 测试 302 重定向（替换 <assetId>）
curl -I "http://localhost:3003/api/ai/file-assets/<assetId>"
```

**期望输出**：

- `storageType = REMOTE_URL`
- `bytes = null`（不是 `size = 0`，是 bytes 字段本身为空）
- `curl -I` 返回 `HTTP/2 302`，`Location` 头为 `https://apihub.agnes-ai.com/...`

### 6.3 浏览器播放验证

```bash
# 用浏览器打开 video 元素，src 指向：
# /api/ai/file-assets/<assetId>
#
# 期望链路：
# 1. /api/ai/file-assets/:id → 302
# 2. → Agnes Provider URL
# 3. ← 200 video/mp4
# 4. 视频正常播放
```

---

## 7. 复现 Checklist

- [ ] `npx prisma db push` 成功，有 `REMOTE_URL` 枚举
- [ ] `npx tsc --noEmit` 无相关错误
- [ ] `npm run build` 成功
- [ ] 重启 Next.js 和 Worker
- [ ] 前端发起视频生成请求
- [ ] DB 中 `storageType = REMOTE_URL`
- [ ] DB 中 `bytes = null`
- [ ] `curl -I` 返回 302 到 https 域名
- [ ] 浏览器 `<video>` 元素能播放
- [ ] `executionStatus` 从 `PROCESSING` 变为 `COMPLETED`

---

## 8. 架构演进路径

```
当前（Phase 1）：
Agnes → VideoProviderResult { providerVideoUrl }
      → saveVideoAsset()
      → AiFileAsset { storageType: REMOTE_URL, storageKey: url }
      → /file-assets/:id → 302 → Browser

未来（对象存储）：
Agnes → VideoProviderResult { providerVideoUrl }
      → saveVideoAsset()           ← 只改这一行内部
      → AiFileAsset { storageType: OBJECT_STORAGE, storageKey: s3://... }
      → /file-assets/:id → redirect/proxy → Browser

上层 VideoProvider / Worker / Message / UI 都不用改。
```

---

## 9. 踩坑记录

### 坑 1：PostgreSQL bytes 字段大小限制

**现象**：视频生成完成后播放器无法播放，Worker 日志无报错。

**原因**：`AiFileAsset.bytes` 字段为 PostgreSQL `Bytes` 类型，单行数据受 `max_row_size` 限制（默认 8KB），视频 10-50MB 写入直接失败。

**解法**：改用 `REMOTE_URL` 模式，不存 bytes，只存 Provider URL。

### 坑 2：跨进程 SSE 推送无效

**现象**：`emitMessageDelta()` 调用后前端从未收到进度更新。

**原因**：Background Worker 是独立 Node.js 进程，`globalThis` 和 Next.js 主进程不共享，SSE 推送对象在 Worker 中无法传递给主进程。

**解法**：删除所有 `emitMessageDelta`，进度更新只走 DB + 前端轮询。
