# Ticket 评论图片上传全链路 — 开发到测试复现手册

> 适用：project-manager 仓库（Next.js 16 + Prisma + PostgreSQL）
> 目标：让团队任何成员拿到这份文档 + 仓库 commit 后，能完整复现"工单评论附件上传"功能的端到端过程。
> 读者：团队新人 + 未来自己

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- **旧版**：工单评论只支持纯文本，用户想贴截图 / 图片只能靠外部图床或 base64 内嵌
- **痛点**：`TicketComment` 表没有附件字段，UI 层没有上传入口
- **业务影响**：讨论时无法直观展示截图，信息碎片化

### 1.2 结论

- 新增 `TicketComment.attachments` JSON 字段，存 `FileAttachment[]` 结构
- 新增 `FileAsset` 表（`UploadedFile` map 表）统一存储上传文件二进制（BYTES）
- `POST /api/upload` → DB → `GET /api/upload/[id]` 代理渲染，替代 `public/uploads/`
- `TicketCommentsPanel` 编辑器 toolbar 增加上传按钮，支持多图选择

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `prisma/schema.prisma` | 修改 | 新增 `FileAsset` / `FileReference` / `Document` 模型，`TicketComment.attachments` Json 字段，`IndexJobTargetType` 枚举 |
| `prisma/migrations/manual_add_ticket_comment_attachments/migration.sql` | 新增 | 手动 SQL 补加 `attachments` 列（Prisma migrate 之外的备用迁移） |
| `app/api/upload/route.ts` | 新增/修改 | `POST /api/upload` multipart 上传入口，计算 sha256，去重写入 `FileAsset` |
| `app/api/upload/[id]/route.ts` | 新增/修改 | `GET /api/upload/[id]` 代理，从 DB 读 bytes 返回图片 |
| `app/api/tickets/[id]/comments/route.ts` | 修改 | 支持 `attachments` 参数，`extractFileAttachmentsFromLegacy` + `recordFileReference` 双写 |
| `app/api/tickets/[id]/comments/[commentId]/route.ts` | 修改 | 支持删除评论（附件 FileReference 随 comment 级联删除） |
| `app/api/tickets/[id]/route.ts` | 修改 | GET 时通过 FileReference 查出所有附件，PATCH 返回 `allAttachments` |
| `features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx` | 新增 | 评论面板 UI，内含编辑器 toolbar（上传按钮、表情按钮、@ 提及、附件预览、Markdown 渲染） |
| `features/ticket/ui/ticket-detail/TicketDetail.tsx` | 修改 | 挂载 `TicketCommentsPanel`，Props 传 `ticketId` + `ticketNumericId` |
| `shared/lib/upload.ts` | 修改 | `uploadFile()` + `uploadImage()` + `toAbsoluteUploadUrl()` + `fileToDataUrl()` + `uploadAttachmentAsNote()` |
| `shared/lib/file-reference.ts` | 新增 | `recordFileReference` / `removeFileReferences` / `getFileReferences` / `countActiveReferences` |
| `shared/lib/hash.ts` | 修改 | 新增 `sha256File()` 浏览器端 Web Crypto API hash |
| `shared/ui/AttachmentEditor.tsx` | 修改 | 重构为 `uploadFile` 路线，支持 `FileAttachment` 结构 |
| `shared/ui/AttachmentItem.tsx` | 修改 | 支持 `fileId` 模式渲染，URL 走 `/api/upload/[fileId]` |
| `shared/lib/pkm.ts` | 修改 | `extractFileAttachmentsFromLegacy()` 支持旧 data URL 格式迁移 |

---

## 3. 核心实现

### 3.1 `POST /api/upload`（`app/api/upload/route.ts`）

```30:52:app/api/upload/route.ts
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "NO_FILE" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) { /* 413 */ }
    if (!IMAGE_TYPES.has(file.type)) { /* 415 */ }

    // 服务端权威 hash 重算
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = sha256Hex(bytes);

    // hash + size 去重
    const existing = await prisma.fileAsset.findUnique({
      where: { hash_size: { hash, size: file.size } },
    });
    if (existing) {
      return NextResponse.json({ url: `/api/upload/${existing.id}`, fileId: existing.id, deduplicated: true });
    }

    const record = await prisma.fileAsset.create({
      data: { uploaderId: session.user.id, originalName: file.name, mimeType: file.type, size: file.size, bytes, hash, status: "ACTIVE" },
    });
    return NextResponse.json({ url: `/api/upload/${record.id}`, fileId: record.id, deduplicated: false });
  } catch (error) {
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**设计意图**：
- 文件存 DB（`bytes BYTEA`）而不是 `public/uploads/`，因为生产环境多实例部署无共享磁盘
- hash 去重：客户端先算 hash 作为 hint，服务端重算作为权威值，避免客户端 hash 被篡改
- 返回 `deduplicated: true` 时前端可跳过附件预览（同一文件不重复上传）

### 3.2 `GET /api/upload/[id]`（`app/api/upload/[id]/route.ts`）

```app/api/upload/[id]/route.ts
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.fileAsset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return new NextResponse(asset.bytes, {
    headers: { "Content-Type": asset.mimeType, "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
```

**设计意图**：`Cache-Control: immutable` 让浏览器长期缓存上传的图片，避免重复下载。

### 3.3 `TicketCommentsPanel` toolbar（`features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx`）

```449:472:features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx
<div className="flex items-center justify-between gap-2 border-t border-ink-100 px-2 py-1.5">
  <div className="flex items-center gap-1">
    {/* 图片/文件 */}
    <button
      type="button"
      title="上传附件"
      onClick={() => fileInputRef.current?.click()}
      className="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-700"
    >
      <IconFile className="h-4 w-4" />
    </button>
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => {
        const files = e.target.files;
        if (!files) return;
        for (const file of Array.from(files)) appendAttachment(file);
        e.currentTarget.value = "";
      }}
    />
    {/* Emoji */}
    {/* ... */}
  </div>
  <div className="flex items-center gap-2">
    {/* 发布按钮 */}
  </div>
</div>
```

**设计意图**：`accept="image/*" multiple` 允许一次选多张图；`e.currentTarget.value = ""` 允许重复选同一张图；`appendAttachment()` 异步调用 `uploadFile()` 并将 `FileAttachment` 追加到 `draftAttachments[]` 状态。

### 3.4 评论附件存储（`app/api/tickets/[id]/comments/route.ts` POST 部分）

```161:194:app/api/tickets/[id]/comments/route.ts
// PR10 F5: 处理附件，转换旧格式 + 提取 FileAttachment[]
const { attachments: extractedAttachments } =
  await extractFileAttachmentsFromLegacy(body.attachments, session.user.id);

const created = await prisma.$transaction(async (tx) => {
  const comment = await tx.ticketComment.create({
    data: { ticketId: ticket.id, authorId: session.user.id, content, mentionedUserIds: validatedMentionedIds },
  });
  // 再更新 attachments 字段（raw update 避免类型限制）
  if (extractedAttachments.length > 0) {
    await tx.ticketComment.update({
      where: { id: comment.id },
      data: { attachments: extractedAttachments as any },
    });
  }
  // 双写 FileReference（只处理有 fileId 的附件）
  for (const att of extractedAttachments) {
    if (!att.fileId) continue;
    await recordFileReference(tx, {
      fileAssetId: att.fileId,
      sourceType: "TICKET_COMMENT",
      sourceId: comment.id,
    });
  }
  return comment;
});
```

**设计意图**：`FileReference` 是未来 PR11 做引用计数 / 软删除的伏笔；当前评论附件查询走 `FileReference`（`app/api/tickets/[id]/route.ts` GET），不直接查 `attachments` Json 字段。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `DATABASE_URL` | `postgresql://community:community@192.168.1.14:5432/community?options=-c%20search_path%3Dpm,public` | PostgreSQL，schema `pm` + `public` |
| 端口 | `3003` | `npm run dev` 默认 |
| 数据库 schema | `pm` | 所有模型都在 `pm` schema |
| `FileAsset` map 表名 | `UploadedFile`（`@@map("UploadedFile")`） | Prisma 逻辑名 `fileAsset`，DB 物理名 `UploadedFile` |
| 图片大小上限 | `10 MB` | 客户端 + 服务端双重校验 |
| 支持图片类型 | `image/jpeg, image/png, image/gif, image/webp, image/svg+xml` | multipart `content-type` 检测 |
| hash 算法 | `sha256` | 客户端 Web Crypto API + 服务端 Node.js `crypto` |

---

## 5. 启动 / 部署

```bash
# 1. 数据库迁移（已有手动 SQL，需要时执行）
# 路径: /Users/vastgui/Desktop/project-manager
# 方式一：Prisma migrate（推荐开发环境）
cd /Users/vastgui/Desktop/project-manager
npx prisma migrate deploy

# 方式二：手动 SQL（如果 Prisma migrate 失败）
psql "postgresql://community:community@192.168.1.14:5432/community" \
  -c "ALTER TABLE \"pm\".\"TicketComment\" ADD COLUMN IF NOT EXISTS \"attachments\" JSONB NOT NULL DEFAULT '[]';"

# 2. 确认数据库连接正常
psql "postgresql://community:community@192.168.1.14:5432/community" \
  -c "SELECT 1;"

# 3. 生成 Prisma Client（schema 变更后必须）
cd /Users/vastgui/Desktop/project-manager
npx prisma generate

# 4. 启动开发服务
npm run dev

# 5. 确认服务存活
curl -sI http://localhost:3003/api/auth/session | head -1
# 期望: HTTP/1.1 200 OK 或 HTTP/1.1 400 Bad Request（400 是正常，session 400 是因为没带 cookie）

# 6. 测试上传端点（需要先登录获取 cookie）
# 查看当前 cookie:
# browser DevTools > Application > Cookies > http://localhost:3003
curl -v -X POST http://localhost:3003/api/upload \
  -H "Cookie: authjs.session-token=YOUR_TOKEN" \
  -F "file=@/path/to/test.png" \
  -F "clientHash=abc123" 2>&1 | tail -20
```

---

## 6. 测试 & 验证

### 6.1 文件上传 API

```bash
# 准备测试图片
curl -s -o /tmp/test-upload.png "https://via.placeholder.com/100.png"

# 获取 session token（浏览器 DevTools > Application > Cookies）
AUTH_TOKEN="替换为你的 authjs.session-token 值"

# 上传测试
curl -X POST http://localhost:3003/api/upload \
  -H "Cookie: authjs.session-token=${AUTH_TOKEN}" \
  -F "file=@/tmp/test-upload.png" \
  -F "clientHash=$(shasum -a 256 /tmp/test-upload.png | cut -d' ' -f1)"
```

**期望输出**：
```json
{
  "url": "/api/upload/cmr1xxxx",
  "fileId": "cmr1xxxx",
  "name": "test-upload.png",
  "mimeType": "image/png",
  "size": 726,
  "hash": "<64-char-sha256>",
  "deduplicated": false
}
```

### 6.2 获取上传文件

```bash
# 用上一步返回的 fileId 替换
curl -sI http://localhost:3003/api/upload/cmr1xxxx | grep -E "Content-Type|Cache-Control"
```

**期望输出**：
```
Content-Type: image/png
Cache-Control: public, max-age=31536000, immutable
```

### 6.3 评论附件端到端

1. 打开浏览器，访问 `http://localhost:3003/tickets/<任意工单ID>`
2. 滚动到页面底部"备注 / 讨论"面板
3. 在编辑器 toolbar 左侧找 📎 图标按钮
4. 点击 → 选择一张图片 → 观察草稿区出现附件预览（文件名 + 删除按钮）
5. 点击"发布" → 观察评论列表出现图片
6. 点击图片 → 新窗口打开 `/api/upload/[fileId]`

**期望**：图片在新标签页正常渲染，无 404/500。

### 6.4 hash 去重验证

```bash
# 同一张图上传两次，第二次 deduplicated 应为 true
curl -X POST http://localhost:3003/api/upload \
  -H "Cookie: authjs.session-token=${AUTH_TOKEN}" \
  -F "file=@/tmp/test-upload.png" \
  -F "clientHash=$(shasum -a 256 /tmp/test-upload.png | cut -d' ' -f1)"
```

**期望**：`"deduplicated": true`，`fileId` 与第一次相同（未重复写入 DB）。

---

## 7. 复现 Checklist

- [ ] 数据库迁移已执行（`attachments` JSONB 列存在）
- [ ] `npx prisma generate` 已运行（Prisma Client 包含 `FileAsset` / `FileReference`）
- [ ] `npm run dev` 已启动，端口 `3003` 可访问
- [ ] 用浏览器登录（cookie 有效）
- [ ] 打开任意工单详情页
- [ ] 滚动到"备注 / 讨论"面板
- [ ] toolbar 左侧有 📎 上传按钮
- [ ] 点击按钮 → 选择图片 → 草稿区出现附件预览
- [ ] 点击发布 → 评论列表出现图片
- [ ] 点击图片 → 新窗口正常渲染
- [ ] 同一张图再次上传 → `deduplicated: true`（DB 未重复写入）
- [ ] `GET /api/tickets/[id]` 响应包含 `allAttachments` 字段

---

## 8. 踩坑记录

### 坑 1：Prisma `@@map` 导致 Prisma Client 生成错误的表名查询

**现象**：`prisma.fileAsset.findUnique()` 报 `relation "pm.FileAsset" does not exist`，实际 DB 表名是 `pm."UploadedFile"`（`@@map("UploadedFile")`）。

**原因**：Prisma `@@map` 在 schema 中把逻辑模型名映射到 DB 物理表名，但 Prisma Client API 用的是逻辑模型名 `fileAsset`，而不是物理表名。

**解法**：在 `prisma/schema.prisma` 中，`model FileAsset` 上加 `@@map("UploadedFile")`，之后 Prisma Client 的 `prisma.fileAsset.*` 查询会自动翻译成 `SELECT FROM "pm"."UploadedFile"`。使用时不需要关心物理表名。

### 坑 2：`FileAsset` 查询报错 `relation "pm"."UploadedFile" does not exist`

**现象**：`prisma generate` 后查询报错，DB 里找不到表。

**原因**：`prisma migrate dev` 没有正确执行，或者本地 DB 没有连上远程 PostgreSQL。

**解法**：
```bash
# 确认 DB 可达
nc -z -w3 192.168.1.14 5432

# 如果 migrate 有问题，手动执行 SQL
psql "postgresql://community:community@192.168.1.14:5432/community" -c "\dt pm.\""
```

### 坑 3：`sha256File` 在 Turbopack 下 TypeError

**现象**：`TypeError: Cannot read properties of undefined (reading 'digest')`，`crypto` 模块在 Turbopack bundling 时报错。

**原因**：`crypto` 是 Node.js 内置模块，Turbopack 在 client bundle 时无法解析。

**解法**：用 Web Crypto API 替代（`shared/lib/hash.ts` 中的 `sha256File` 函数），仅在需要调用 `sha256Hex`（Node.js 环境）时使用 `node:crypto`。

### 坑 4：开发数据库连接偶发失败（Prisma 连接池超时）

**现象**：`Can't reach database server at 192.168.1.14:5432`，但 `nc` 测试网络可达。

**原因**：Prisma 连接池在高并发/空闲超时后未正确重连。

**解法**：重启 dev server（杀掉进程后重新 `npm run dev`），Prisma 会重新建立连接池。

### 坑 5：`index.ts` worker 报 `crypto.createHash is not a function`

**现象**：`worker/index.ts` 在 Node.js 环境运行时报 `crypto` 相关错误。

**原因**：`worker/index.ts` 在 Node.js 环境运行，但 `node:crypto` 导入方式在高版本 Node 中需要显式 `import { createHash } from 'node:crypto'`。

**解法**：在 worker 中使用 ES module 语法导入：
```typescript
import { createHash } from "node:crypto";
```
或确保 `tsconfig.json` 的 `module` 和 `moduleResolution` 设置为 `NodeNext` / `Node16`。

### 坑 6：`TicketCommentsPanel` toolbar 按钮未渲染

**现象**：DOM 里 toolbar div 存在但没有子元素（左侧的上传 icon 按钮消失）。

**原因**：可能是 `sha256File` 导入的 `crypto.subtle` 在 SSR 时静默失败，导致组件渲染中断；或热加载未正确刷新新文件。

**解法**：
1. 重启 dev server（`lsof -ti:3003 | xargs kill -9 && npm run dev`）
2. 硬刷新浏览器（Cmd+Shift+R）
3. 检查 DevTools Console 有无 JS 报错

### 坑 7：`FileReference` `@@unique` 约束导致 upsert 偶发 `Unique constraint failed`

**现象**：`recordFileReference` upsert 时偶尔报 `Unique constraint failed on the fields: (fileAssetId, sourceType, sourceId)`。

**原因**：在并发场景下（如同一评论快速发多条附件），两个 upsert 同时检查不存在，然后同时尝试插入，第二个被唯一约束拦下。

**解法**：`shared/lib/file-reference.ts` 的 upsert 用 `where` 条件确保原子性：
```typescript
await tx.fileReference.upsert({
  where: { fileAssetId_sourceType_sourceId: { fileAssetId, sourceType, sourceId } },
  create: { fileAssetId, sourceType, sourceId },
  update: { deletedAt: null }, // 已存在则软删除恢复
});
```
Prisma upsert 底层是 `ON CONFLICT DO UPDATE`，在事务内原子执行，不会被唯一约束拦下。

---

*文档生成：dev-to-doc-recap skill，2026-07-01*
