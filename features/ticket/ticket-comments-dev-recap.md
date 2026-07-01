# 工单评论功能开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + PostgreSQL）  
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**工单评论（含图片上传、@提及跳转个人主页）的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- 工单详情页原来**没有评论区**，协作靠线下沟通，无法追溯
- 用户 @ 提及后，名字点击跳到 `/login`（错误链接），而非 `/team/<userId>` 个人主页
- 图片只能通过粘贴 base64 data URL 上传，体积大且无法统一管理
- react-markdown 把 `@[name](email)` mention 语法渲染成 `<a href="email">`，email 不是合法 URL 导致行为异常

### 1.2 结论

- 新增**备注/讨论**面板（`TicketCommentsPanel`），支持 Markdown 文本、@提及（跳个人主页）、图片上传（DB 存储）
- `MarkdownContent` 新增 `mentionMap` props，精准区分 mention 链接和普通 mailto 链接
- 图片走 `UploadedFile` 表（BYTEA）而非 `public/uploads/`，适配多实例部署

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx` | 新增 | 工单备注/讨论 UI：列表 + 富文本编辑器 + mention 弹出 + emoji + 图片按钮 |
| `app/api/tickets/[id]/comments/route.ts` | 新增 | GET（查评论+被@用户信息）、POST（创建评论+提取 mentions+发通知） |
| `app/api/tickets/[id]/comments/[commentId]/route.ts` | 新增 | DELETE（删除评论，ROOT 或本人可删） |
| `shared/ui/MarkdownContent.tsx` | 修改 | 新增 `mentionMap` props；`<a>` override：mention→`/team/<id>`、纯 email→`mailto:`、其他外链 |
| `app/api/upload/route.ts` | 新增 | `POST /api/upload`，multipart 上传图片存 `UploadedFile` 表（BYTEA） |
| `app/api/upload/[id]/route.ts` | 新增 | `GET /api/upload/<id>`，从 DB 读 bytes 按原 mimeType 返回（图片代理） |
| `shared/lib/upload.ts` | 修改 | 新增 `uploadImage()` 客户端函数；`toAbsoluteUploadUrl()` 拼绝对 URL |
| `prisma/schema.prisma` | 修改 | 新增 `UploadedFile` model；`TicketComment.mentionedUserIds` 存被 @ 的 userId 列表 |
| `prisma/migrations/manual_add_uploaded_file/migration.sql` | 新增 | 手动 migration 建 `pm.UploadedFile` 表（BYTEA 存储图片） |

---

## 3. 核心实现

### 3.1 评论数据流

```
用户输入 @触发 → insertMention() → `@[displayName](email)` 写入 textarea
用户提交 → POST /api/tickets/:id/comments
  → extractMentionedIdentifiers() 提取 email 列表
  → validateMentionedIds() 查询真实 userId（防注入）
  → 存 TicketComment{content, mentionedUserIds[]}
  → buildMentionedNotification() 发通知
GET /api/tickets/:id/comments
  → 查评论列表 + author 信息
  → 一次性查所有 mentionedUserIds 对应的 user 信息（不改 schema！）
  → 返回 {comments: [{..., mentionedUsers: [{id,name,email}...]}]}
→ 前端 useMemo 构建 mentionMap（email小写 → {id,name}）
→ MarkdownContent(mentionMap) 渲染 @name 为跳 /team/<id> 的链接
```

### 3.2 评论 API（`app/api/tickets/[id]/comments/route.ts`）

```53:82:app/api/tickets/[id]/comments/route.ts
const comments = await prisma.ticketComment.findMany({
  where: { ticketId: ticket.id },
  orderBy: { createdAt: "desc" },
  take: 200,
  include: {
    author: { select: { id: true, name: true, email: true } },
  },
});

// 一次性查所有被 @ 的用户，构建 mentionedUsers 字段（email → {id, name}）
// 不改 schema：在响应层补充，前端 MarkdownContent 用它把 `@[name](email)`
// 渲染成跳 `/team/<id>` 的链接，而不是默认的 `<a href="email">`。
const allMentionedIds = [
  ...new Set(comments.flatMap((c) => c.mentionedUserIds ?? [])),
];
const mentionedUsers = allMentionedIds.length
  ? await prisma.user.findMany({
      where: { id: { in: allMentionedIds } },
      select: { id: true, name: true, email: true },
    })
  : [];
const mentionedUserById = new Map(mentionedUsers.map((u) => [u.id, u]));
const enriched = comments.map((c) => ({
  ...c,
  mentionedUsers: (c.mentionedUserIds ?? [])
    .map((id) => mentionedUserById.get(id))
    .filter((u): u is { id: string; name: string | null; email: string } => Boolean(u)),
}));

return NextResponse.json({ comments: enriched });
```

**为什么这样写**：不在 schema 加 `@relation` 多对多字段（避免 migration 复杂度），而在 API 响应层做 join——Prisma 一次 `findMany` 查所有评论，再用 Set 去重 email 列表，一次 `findMany` 查出所有被 @ 用户，时间复杂度 O(n)，N+1 问题在 API 层消解。

### 3.3 MarkdownContent mention 渲染（`shared/ui/MarkdownContent.tsx`）

```171:216:shared/ui/MarkdownContent.tsx
a: ({ href, children, ...rest }) => {
  const hrefStr = typeof href === "string" ? href : "";
  if (!hrefStr) return <>{children}</>;

  // mention 语法 @[name](email) → 跳个人主页
  if (mentionMap && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hrefStr)) {
    const mapped = mentionMap[hrefStr.toLowerCase()];
    if (mapped) {
      return (
        <Link
          href={`/team/${mapped.id}`}
          className="rounded bg-brand-50 px-1 text-brand-700 hover:bg-brand-100 hover:text-brand-800"
          {...rest}
        >
          {children}
        </Link>
      );
    }
  }

  // 纯文本 email（react-markdown 因 remark-gfm 把它识别为 autolink）→ mailto
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hrefStr)) {
    return (
      <a
        href={`mailto:${hrefStr}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-600 underline decoration-dotted underline-offset-2 hover:text-brand-700"
        {...rest}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={hrefStr}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-600 underline decoration-dotted underline-offset-2 hover:text-brand-700"
      {...rest}
    >
      {children}
    </a>
  );
},
```

**为什么这样写**：`react-markdown` 会把 markdown link `@[name](email)` 解析为 `<a href="email">`，但 `email` 不是合法 URL（`new URL("1284566797@qq.com")` 抛错）。`safeUrlTransform` 的 catch 分支把原始 email 字符串原样返回，最终 react-markdown 渲染成链接——但 href 就是纯文本 email。

解决方案：`<a>` override 三段式判断：
1. `mentionMap` 有此 email → `Link` 跳 `/team/<id>`（带品牌色 chip 样式）
2. 纯 email 但不在 mentionMap → `mailto:` 链接（防止 href="email" 导致 404 跳转）
3. 其他 URL → `target="_blank"` 外链

### 3.4 图片上传全链路

```
客户端：uploadImage(File) → POST /api/upload (multipart)
服务端：route.ts → 校验大小/mimeType → buffer → prisma.uploadedFile.create(bytes BYTEA)
返回：{ url: "/api/upload/<cuid>", id, name, mimeType, size }
markdown 中：![name](/api/upload/<cuid>)
GET /api/upload/<id>：从 DB 读 bytes → NextResponse(new Uint8Array(bytes))
```

**为什么存 DB 而非 `public/uploads/`**：生产环境 PostgreSQL 是远端，多实例部署没有共享磁盘；存 DB 让 `GET /api/upload/<id>` 从任意实例都能读到，URL 也不依赖 `NEXT_PUBLIC_BASE_URL`。

### 3.5 评论作者名跳转（`TicketCommentsPanel.tsx`）

```331:336:features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx
<Link
  href={`/team/${c.author.id}`}
  className="font-medium text-ink-700 hover:text-brand-600 hover:underline"
>
  {c.author.name || c.author.email}
</Link>
```

评论区的作者名直接 `<Link>` 到 `/team/<userId>`（而非 `/login`），hover 显示下划线。

### 3.6 mentionMap 前端构建（`TicketCommentsPanel.tsx`）

```293:305:features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx
// 合并所有评论里出现过的 mention 用户，构建 email → {id, name} 映射
// 用于 MarkdownContent 把 `@[name](email)` 渲染成跳转到 `/team/<id>` 的链接
const mentionMap = useMemo<Record<string, { id: string; name: string }>>(() => {
  const map: Record<string, { id: string; name: string }> = {};
  for (const c of commentsSortedAsc) {
    if (!c.mentionedUsers) continue;
    for (const u of c.mentionedUsers) {
      const email = u.email.trim().toLowerCase();
      if (email) map[email] = { id: u.id, name: u.name || u.email };
    }
  }
  return map;
}, [commentsSortedAsc]);
```

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 端口 | 3003 | Next.js dev server |
| 图片最大尺寸 | 10 MB | `MAX_SIZE` 常量，客户端/服务端一致 |
| 支持图片类型 | jpeg/png/gif/webp/svg+xml | `IMAGE_TYPES` Set |
| DB schema | `pm` | Prisma schema 名 |
| 图片存储 | `pm.UploadedFile` (BYTEA) | 不依赖共享磁盘 |
| mention 语法 | `@[name](email)` | 插入时 `insertMention()` 生成，解析用 `MENTION_PATTERN` |

---

## 5. 启动 / 部署

```bash
# 1. 确保本地数据库已运行（PostgreSQL）
# 2. 如果 UploadedFile 表不存在，执行 manual migration：
psql "$DATABASE_URL" -f prisma/migrations/manual_add_uploaded_file/migration.sql

# 3. 确认 migration 已落地
psql "$DATABASE_URL" -c "SELECT id, \"originalName\" FROM pm.\"UploadedFile\" LIMIT 1;"

# 4. 启动 dev server
cd /Users/vastgui/Desktop/project-manager
npm run dev

# 5. 确认服务存活
curl -s http://localhost:3003 | head -1
```

---

## 6. 测试 & 验证

### 6.1 登录鉴权（必须先登录）

```bash
# 登录获取 session cookie（示例 curl，实际用浏览器登录）
curl -c cookies.txt -X POST http://localhost:3003/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"xxx@example.com","password":"xxx"}'
```

### 6.2 图片上传 API

```bash
# 上传一张测试图片
curl -b cookies.txt -X POST http://localhost:3003/api/upload \
  -F "file=@/tmp/test.png"

# 期望输出（示例）：
# {"url":"/api/upload/clxxxxxxxxxxxxxx","id":"clxxxxxxxxxxxxxx","name":"test.png","mimeType":"image/png","size":12345}
```

### 6.3 图片代理 GET

```bash
# 用上一步返回的 id 访问
curl -I http://localhost:3003/api/upload/clxxxxxxxxxxxxxx

# 期望：
# HTTP/1.1 200
# content-type: image/png
# cache-control: public, max-age=31536000, immutable
# content-length: 12345
```

### 6.4 评论发布（带 mention + 图片）

1. 打开工单详情页（任意工单）
2. 在评论区输入 `@` 触发 mention 弹出，选择一个用户
3. 插入一张图片（工具栏图片按钮）
4. 按 `⌘/Ctrl + Enter` 发布

**期望**：
- 评论出现在列表顶部
- 作者名可点击 → 跳 `/team/<userId>`
- `@[name](email)` 渲染为品牌色 chip，可点击 → 跳 `/team/<userId>`
- 图片点击 → 打开 lightbox

### 6.5 评论删除

- ROOT 用户：任意评论右侧显示"删除"按钮
- 普通用户：只能删除自己的评论

**期望**：删除后评论从列表消失，数据库记录已删除。

---

## 7. 复现 Checklist

- [ ] `npm install` 依赖完整
- [ ] PostgreSQL 数据库运行中，`DATABASE_URL` 环境变量已配置
- [ ] `psql "$DATABASE_URL" -f prisma/migrations/manual_add_uploaded_file/migration.sql` 执行成功
- [ ] `npm run dev` 启动在 3003 端口
- [ ] 浏览器登录项目账号
- [ ] 打开任意工单详情页，确认右下角有"备注/讨论"面板
- [ ] 在编辑器输入 `@`，确认出现团队成员下拉列表
- [ ] 选择一个成员，确认 textarea 中出现 `@[名字](email)` 语法
- [ ] 点击图片按钮上传一张 PNG/JPG，确认图片出现在草稿预览中
- [ ] `⌘/Ctrl + Enter` 发布，确认评论出现在列表
- [ ] 点击评论区的作者名，确认跳转到 `/team/<userId>` 个人主页
- [ ] 点击评论中的 `@名字`，确认跳转到 `/team/<userId>`
- [ ] 点击评论中的图片，确认打开 lightbox 大图预览
- [ ] 用 ROOT 账号登录，确认任意评论旁出现"删除"按钮
- [ ] 点击删除，确认评论消失

---

## 8. 踩坑记录

### 坑 1：`safeUrlTransform` 对 email 无效导致 mention 链接错误

**现象**：评论中 `@[许敏捷](1284566797@qq.com)` 被渲染成 `<a href="1284566797@qq.com">`，点击跳到 `/login`（`new URL("1284566797@qq.com")` 抛 `ERR_INVALID_URL`，react-markdown fallthrough）。

**原因**：`safeUrlTransform` 的 catch 分支直接返回原字符串，react-markdown 接受了这个 href 并渲染成普通链接。

**解法**：在 `<a>` override 里判断 href 是否为 email 格式（`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`），命中则查 `mentionMap` → `Link` 跳 `/team/<id>`；不在 mentionMap 则加 `mailto:` 前缀。不在 transform 层处理。

### 坑 2：手动 migration `manual_add_uploaded_file` 需要单独执行

**现象**：`npx prisma migrate dev` 不会自动识别手写的 SQL migration 文件。

**原因**：Prisma 标准 migrate 由 CLI 管理，手动 SQL 文件不会进入 migration history。

**解法**：用 `psql "$DATABASE_URL" -f prisma/migrations/manual_add_uploaded_file/migration.sql` 手动执行，并在 README/文档中注明此步骤。

### 坑 3：`CommentUser` 类型在 TicketCommentsPanel 中重复定义

**现象**：TSC 报错 `Duplicate identifier 'CommentUser'`，TypeScript 认为同一作用域有两个同名 type。

**原因**：编辑过程中两次 StrReplace 操作目标字符串不完全匹配，导致在文件中追加了新定义而非覆盖旧定义。

**解法**：删除重复的 type 块，确保只有一个 `CommentUser` 定义。

### 坑 4：`mentionedUsers` Prisma relation 在 schema 中不存在

**现象**：TSC 报错 `Object literal may only specify known properties, and 'mentionedUsers' does not exist in type 'TicketCommentInclude'`。

**原因**：`TicketComment` 的 `mentionedUserIds` 是 `String[]` 裸字段，不是 `@relation` 字段，Prisma 无法做 relation include。

**解法**：不改 schema，在 API 响应层用 `mentionedUserIds[]` 查对应 user 信息，补充到返回对象里。前端 `CommentItem` 类型手动加 `mentionedUsers?: CommentUser[]`。

### 坑 5：`extractMentionedIdentifiers` 用 `lastIndex` 导致 mention 解析错位

**现象**：`/@\[([^\]]+)\]\(([^\)]+)\)/g` 的 `lastIndex` 在循环中累积，`exec()` 后 lastIndex 不归零导致漏匹配。

**原因**：正则全局标志 `g` 配合 `exec()` 需要手动 `lastIndex = 0`，但循环体里没有做。

**解法**：在 while 循环开头加 `MENTION_PATTERN.lastIndex = 0;` 重置状态。

---

## 附录：相关文件路径

```
features/ticket/ui/ticket-detail/TicketCommentsPanel.tsx   ← 评论 UI
app/api/tickets/[id]/comments/route.ts                   ← 评论 GET/POST
app/api/tickets/[id]/comments/[commentId]/route.ts        ← 评论 DELETE
app/api/upload/route.ts                                  ← 图片上传入口
app/api/upload/[id]/route.ts                             ← 图片代理 GET
shared/lib/upload.ts                                     ← uploadImage() 客户端
shared/ui/MarkdownContent.tsx                            ← Markdown 渲染（含 mention 链接）
prisma/schema.prisma                                     ← UploadedFile model
prisma/migrations/manual_add_uploaded_file/migration.sql ← 图片表手动 migration
```
