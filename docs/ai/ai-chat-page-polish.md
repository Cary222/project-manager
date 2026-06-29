# AI 对话页"默认选中 / 画像可编辑 / 标签可删除"复现手册

> 适用：`project-manager` 仓库（Next.js 16 + React 19 + Prisma 6 + Tailwind 4）
> 目标：拿到这份文档 + 仓库 commit 后，能完整复现本次对 `/ai` 页面的三处增强。
> 配套阅读：[`docs/ai/ai-module-full-chain.md`](./ai-module-full-chain.md)（整体模块背景）

---

## 1. 目标 & 背景

### 1.1 旧版的问题

- 进入 `/ai`（无 `?c=`）看到的是空聊天页 + 侧边栏列表，**得自己手动点一条**才开始工作。
- "用户画像摘要"下拉框是**只读**的，看得到但改不了。
- 侧边栏对话没有任何**分类标签**机制，几十条对话挤在一起找不动。

### 1.2 这次的结论

1. **默认选中最近对话**：进入 `/ai`（无 `?c=`）时，bootstrap 拉一次列表，自动选中 `lastMessageAt` 最新的那条；列表为空则自动新建并触发问候。
2. **画像可编辑**：6 个字段（角色/兴趣/专业领域/项目/近期话题/preferences）每个 tag 右上角都有 `×` 删；底部 input + `+` 添加；右上角铅笔按钮进入编辑模式，底部 `保存修改 / 取消` 写入。
3. **对话标签可删除**：每条对话卡片下方显示自己的 `tags`，每个 tag 右上角 `×` 单独删。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `prisma/schema.prisma` | 修改 | `AiConversation` 新增 `tags String[] @default([])` |
| `app/api/ai/profile/route.ts` | 修改 | 新增 `PATCH` 方法，全量替换 profile JSON |
| `app/api/ai/conversations/[id]/route.ts` | 修改 | `PATCH` 扩 schema 支持 `tags` 字段（保持 `title` 兼容） |
| `features/ai/ui/AiChatPage.tsx` | 修改 | 新增 `bootstrapped` 状态 + bootstrap effect 拉列表自动选最近；空则调 `handleNewConversation` |
| `features/ai/ui/AiConversationSidebar.tsx` | 修改 | `ConversationSummary` 加 `tags?`；新增 `handleRemoveTag`；在每条卡片标题下渲染 tag chip + × |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | `UserProfilePanel` 升级为可编辑（新增 `EditableProfileField` + 编辑模式 + 保存/取消），重写 header 避免 button 嵌套 |
| `scripts/ai-chat-polish-smoke.ts` | 新增 | 纯 store 层 smoke test（无需登录） |
| `e2e/ai-chat-polish.spec.ts` | 新增 | Playwright 端到端：登录→自动选中→tag 删除→画像编辑模式 |

---

## 3. 核心实现

### 3.1 Schema 改动（`prisma/schema.prisma`）

```538:554:prisma/schema.prisma
model AiConversation {
  id             String   @id @default(cuid())
  userId         String
  title          String
  summary        Json?
  tags           String[] @default([])   // 新增
  messageCount   Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  lastMessageAt  DateTime @default(now())
  ...
}
```

**为什么这样写**：`String[]` 配 `@default([])` 避免老数据缺字段报错；放在 `AiConversation` 而非新表，避免一次关联查询（侧边栏列表用 `findMany` 一次拉完 tags 即可）。

### 3.2 默认选中最近对话（`features/ai/ui/AiChatPage.tsx`）

```40:74:features/ai/ui/AiChatPage.tsx
const [bootstrapped, setBootstrapped] = useState(false);
const handleNewConversationRef = useRef<(() => Promise<void>) | null>(null);

useEffect(() => {
  if (bootstrapped) return;
  if (searchParams.get("c")) { setBootstrapped(true); return; }
  void (async () => {
    try {
      const res = await fetch("/api/ai/conversations");
      if (!res.ok) { setBootstrapped(true); return; }
      const json = await res.json();
      const list: Array<{ id: string }> = Array.isArray(json?.data) ? json.data : [];
      if (list.length > 0) {
        setActiveConversationId(list[0].id);    // list[0] 已是 lastMessageAt desc
      } else {
        await handleNewConversationRef.current?.();   // 空 → 新建 + 问候
      }
    } catch (err) { console.error("[AiChatPage] bootstrap error:", err); }
    finally { setBootstrapped(true); }
  })();
}, [bootstrapped]);
```

**为什么用 ref 调 `handleNewConversation`**：避免把 `handleNewConversation` 写进 dep，会触发 effect 反复跑；用 ref 拿最新版本。

### 3.3 画像可编辑（`features/ai/ui/AiChatPanel.tsx`）

新增 `EditableProfileField` 组件（line 79-159 附近）：

```96:158:features/ai/ui/AiChatPanel.tsx
function EditableProfileField({ label, value, onChange }: { ... }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const current = value ?? [];
    if (current.includes(trimmed)) { setDraft(""); return; }
    onChange([...current, trimmed]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {(value ?? []).map((item) => (
          <span key={item} className="group/etag inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700">
            {item}
            <button type="button" onClick={() => onChange((value ?? []).filter((x) => x !== item))} aria-label={`删除 ${item}`}>
              <IconX className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={...} placeholder={`添加${label}…`} maxLength={50} />
        <button onClick={commit} disabled={!draft.trim()}>+ 添加</button>
      </div>
    </div>
  );
}
```

`UserProfilePanel` 内部维护 `draft` / `editing` / `saving` / `saveError` 四个 state，header 改写避免 `<button>` 嵌套 `<button>`：

```240:286:features/ai/ui/AiChatPanel.tsx
return (
  <div className="border-b border-ink-100">
    <div className="flex w-full items-center justify-between px-5 py-3 transition hover:bg-ink-50">
      <button onClick={() => setCollapsed((c) => !c)} className="flex flex-1 items-center gap-2 text-left">
        <IconSparkles className="h-4 w-4 text-brand-500" />
        <span>用户画像摘要</span>
        {editing && <span>编辑中</span>}
      </button>
      <div className="flex items-center gap-1">
        {!editing && <button onClick={() => { setEditing(true); setCollapsed(false); }} aria-label="编辑画像">✎</button>}
        <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "展开画像" : "折叠画像"}>⇅</button>
      </div>
    </div>
    ...
  </div>
);
```

**为什么改 header**：外层 `<button>` 套内层 `<button>` 是 HTML 错误，浏览器控制台会警告且 click 行为不稳。改成外层 `<div>` + 内部两个独立 `<button>`。

### 3.4 标签 × 删除（`features/ai/ui/AiConversationSidebar.tsx`）

```177:204:features/ai/ui/AiConversationSidebar.tsx
const handleRemoveTag = useCallback(
  async (convId: string, tagToRemove: string) => {
    const target = conversations.find((c) => c.id === convId);
    if (!target) return;
    const nextTags = (target.tags ?? []).filter((t) => t !== tagToRemove);
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, tags: nextTags } : c)));
    try {
      const res = await fetch(`/api/ai/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) { console.error("[AiConversationSidebar] remove tag error:", err); }
  },
  [conversations]
);
```

```339:374:features/ai/ui/AiConversationSidebar.tsx
{conv.tags && conv.tags.length > 0 && (
  <div className="mt-1.5 flex flex-wrap gap-1">
    {conv.tags.map((tag) => (
      <span key={tag} className="group/tag inline-flex items-center gap-0.5 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
        {tag}
        <button type="button" onClick={(e) => { e.stopPropagation(); void handleRemoveTag(conv.id, tag); }}
          className="ml-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full text-brand-400 opacity-0 transition hover:bg-brand-200 hover:text-danger group-hover/tag:opacity-100"
          aria-label={`删除标签 ${tag}`}>
          <IconX className="h-2.5 w-2.5" />
        </button>
      </span>
    ))}
  </div>
)}
```

**为什么用乐观更新**：删 tag 是高频操作，立刻反映在 UI 上让交互更顺；失败时只是 console.error，下一次列表刷新会自愈。

### 3.5 PATCH 接口改动

`app/api/ai/profile/route.ts`：

```21:54:app/api/ai/profile/route.ts
export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const body = await request.json();
    const profile = body?.profile;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      return NextResponse.json({ data: null, error: "INVALID_PROFILE" }, { status: 400 });
    }
    const record = await upsertProfile(session.user.id, profile, 0);
    return NextResponse.json({ data: { profile: record.profile }, error: null });
  } catch (err) { ... }
}
```

`app/api/ai/conversations/[id]/route.ts`：

```11:18:app/api/ai/conversations/[id]/route.ts
const patchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
  })
  .refine((data) => data.title !== undefined || data.tags !== undefined, {
    message: "Must provide at least one of: title, tags",
  });
```

```59:97:app/api/ai/conversations/[id]/route.ts
if (parsed.tags !== undefined) {
  const updated = await prisma.aiConversation.update({ where: { id }, data: { tags: parsed.tags } });
  return NextResponse.json({ data: updated, error: null });
}
if (parsed.title !== undefined) {
  const conversation = await renameConversation(id, session.user.id, parsed.title);
  return NextResponse.json({ data: conversation, error: null });
}
```

**为什么两个分支**：`renameConversation` 已带 ownership 校验（防 404 落到别人 conv）；tags 分支先做一次 `findUnique` 校验 owner，再 update，避免一个恶意 PATCH 能给别人的 conv 改 tags。

---

## 4. 环境与配置

无新增 env 变量。无新增依赖。

**数据库变更**：schema 加了 `tags` 列（PG `text[]`），需要 `prisma db push` 同步。

**服务进程**：
- `next dev`（端口 3003）：改完自动 HMR，但**改了 schema 后必须重启**（Prisma client 缓存）。
- `pnpm worker`：本次变更不涉及 worker，但如果 worker 跑着也要重启一次以加载新 Prisma client。

---

## 5. 启动 / 部署

```bash
cd /Users/vastgui/Desktop/project-manager

# 1. 推送 schema（必须）
set -a && source .env.local && set +a
npx prisma db push --skip-generate
npx prisma generate

# 2. 重启 next dev（必须 — Prisma client 重新加载）
#    如果是 pnpm/npm run dev 跑在 IDE 终端里：
#      Ctrl+C 那个终端，再 npm run dev
#    或者直接 kill 进程：
#      pkill -f "next dev" && nohup npm run dev > /tmp/next-dev.log 2>&1 &

# 3. （可选）worker 也要重启
# pkill -f "tsx worker" && nohup pnpm worker > /tmp/worker.log 2>&1 &
```

**验证服务活着**：

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3003/api/auth/session
# 期望：HTTP 200
```

---

## 6. 测试 & 验证

### 6.1 Store 层 smoke（无需登录，最快验证 DB + 业务函数）

```bash
cd /Users/vastgui/Desktop/project-manager
set -a && source .env.local && set +a
npx tsx scripts/ai-chat-polish-smoke.ts
```

**期望输出**：

```
=== Test 1: listConversations returns tags field ===
first conv tags field: []
PASS

=== Test 2: upsertProfile updates full profile ===
PASS — profile.roles = [ '__smoke_<timestamp>' ]
(cleaned up smoke marker)

=== Test 3: prisma.aiConversation.update tags array ===
PASS — tags now = [ '__smoke_tag_<timestamp>' ]
(restored original tags)

All smoke tests passed.
```

### 6.2 Playwright 端到端（验证 UI 行为）

需要先建一个 smoke 用户：

```bash
# 一次性创建 smoke@test.local / test123456
set -a && source .env.local && set +a
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash('test123456', 10);
  await p.user.upsert({
    where: { email: 'smoke@test.local' },
    update: { passwordHash: hash, bannedAt: null },
    create: { email: 'smoke@test.local', name: 'smoke', passwordHash: hash, role: 'USER' }
  });
  // 给 smoke 用户种一条对话，否则测试会 skip
  const u = await p.user.findUnique({ where: { email: 'smoke@test.local' } });
  await p.aiConversation.upsert({
    where: { id: 'smoke-conv-fixed-id' },
    update: {},
    create: { id: 'smoke-conv-fixed-id', userId: u.id, title: 'smoke conv', tags: [] }
  });
  console.log('seeded');
  await p.\$disconnect();
})();
"
```

跑测试：

```bash
set -a && source .env.local && set +a
TEST_EMAIL=smoke@test.local TEST_PASSWORD=test123456 \
  npx playwright test e2e/ai-chat-polish.spec.ts --reporter=list
```

**期望**：

```
Running 1 test using 1 worker
  ✓  1 e2e/ai-chat-polish.spec.ts:22:7 › AI chat page polish › auto-selects most recent conversation + tags × + profile edit form (2.5s)
  1 passed (3.0s)
```

**测试覆盖**：

1. 登录 → 跳到 `/ai`
2. 进入 `/ai`（无 `?c=`）→ URL 自动加 `?c=...`（bootstrap 成功）
3. 侧边栏渲染了 PATCH 写入的 tag chip
4. 点 × → tag 消失
5. 画像 panel 展开 → 点编辑 → 看到 `保存修改` 按钮和 `添加角色…` 输入框

**清理 smoke 用户**（测完跑）：

```bash
set -a && source .env.local && set +a
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const u = await p.user.findUnique({ where: { email: 'smoke@test.local' } });
  if (u) {
    await p.aiConversation.deleteMany({ where: { userId: u.id } });
    await p.aiUserProfile.deleteMany({ where: { userId: u.id } });
    await p.user.delete({ where: { id: u.id } });
    console.log('cleaned');
  }
  await p.\$disconnect();
})();
"
```

### 6.3 浏览器手测 checklist

```bash
open http://localhost:3003/ai
```

1. 看到右侧**自动**加载了最近一条对话
2. 没有任何对话时，刷新 → 自动新建并出现 AI 问候
3. 侧边栏某条对话 `tags` 为空时，不渲染 tag 区域
4. 侧边栏某条对话有 tag 时，每个 tag 右侧 hover 出 `×`，点 × 标签消失
5. 用户画像右上角点铅笔 → 进入编辑模式 → 每个 tag 出现 `×`，字段底部出现 `添加<field>…` 输入框
6. 加一个 tag → `保存修改` → 刷新页面 tag 还在
7. 点 `取消` → 草稿丢弃，UI 回到原样

---

## 7. 复现 Checklist

- [ ] 确认 `DATABASE_URL` 在 `.env.local` 里
- [ ] `npx prisma db push --skip-generate` 推送 `tags` 字段
- [ ] `npx prisma generate` 重生 Prisma client
- [ ] 重启 `next dev`（必须 — Prisma client 重新加载）
- [ ] `curl http://localhost:3003/api/auth/session` 验证 200
- [ ] 创建 smoke user + 一条 conv（见 6.2 步骤）
- [ ] 跑 `npx tsx scripts/ai-chat-polish-smoke.ts` 看到 3/3 PASS
- [ ] 跑 `npx playwright test e2e/ai-chat-polish.spec.ts` 看到 1 passed
- [ ] 浏览器打开 `/ai` 验证 3 个 UI 场景
- [ ] 清理 smoke user

---

## 8. 踩坑记录

### 坑 1：Prisma client 在 Next dev 进程里不自动重新生成

**现象**：跑 `prisma db push` + `prisma generate` 后，HTTP 响应里仍然没有 `tags` 字段（虽然 DB 里有）。

**原因**：`prisma generate` 只重写 `node_modules/@prisma/client` 里的文件，但**已经在 Next dev 进程里加载的 client 对象没换**。dev 的 hot reload 只重编译源码，**不重 import Prisma client**。

**解法**：改 schema 后**必须**重启 `next dev`。如果用户不能停 dev，让用户 Ctrl+C 再 `npm run dev`；或者用 `pkill -f "next dev" && nohup npm run dev > /tmp/log 2>&1 &`。

### 坑 2：`<button>` 套 `<button>` 浏览器警告

**现象**：dev 日志 / 浏览器控制台报警 `<button> cannot contain a nested <button>`。

**原因**：旧的 `UserProfilePanel` header 整体是 `<button>`（点击展开/折叠），里面又放了一个 `<button>`（编辑入口）。

**解法**：把外层换成 `<div>`，内部用两个独立的 `<button>`（一个负责展开 label，一个负责编辑图标）。点击 label 区域用 `flex-1` 撑开，编辑图标固定在右侧。

### 坑 3：`page.request.patch` 在 Playwright 里看似调用但实际没生效

**现象**：测试里 `await page.request.patch(...)` 看似 200，但紧接着 `verify.json()` 拿不到新写入的 tags。

**原因**：`page.request` 用的是 `page` 自己的 cookie storage；如果 patch 调用前 `page` 还没完整登录（cookie 还没 settle），cookie 没带上。

**解法**：在 `page.request` 之前先 `await page.goto(BASE)` 或先 `await page.waitForResponse(...)` 一次以确保 session cookie 落定。**或者**像本文档那样先 `await page.request.get(BASE + '/api/ai/conversations')` 一次让 client 初始化 cookie 上下文。

### 坑 4：seed user 没有对话，e2e 自动 skip

**现象**：跑 `npx playwright test` 时显示 `1 skipped`，看似通过实际什么也没测。

**原因**：`e2e/ai-chat-polish.spec.ts` 依赖"当前用户至少有一条 conv"，否则 `conv = list[0]` 是 undefined。

**解法**：测试脚本里在登录后种一条 conv（`page.request.post` + upsert），或者像 6.2 那样手动 prisma seed smoke user + conv。

### 坑 5：用户编辑的 profile 会被后台 `updateUserProfile` 覆盖

**现象**：用户编辑画像保存后，下次和 AI 多聊几句，AI 自动总结的 `summarizeConversation` → `updateUserProfile` 会**全量覆盖**回 `profile` 字段，用户手动加的 tag 就没了。

**原因**：`upsertProfile` 是全量替换；`background-jobs.ts` 的 `doUpdateProfile` 不区分用户/AI 来源。

**解法（本次未做，记为 v2）**：
- 选项 A：给 `AiUserProfile` 加 `userEditedAt: DateTime?` 字段，后台 `doUpdateProfile` 看到非空就跳过整体更新，只 merge AI 推断的新字段。
- 选项 B：把 profile 拆成两张表（`ai_user_profile_ai` 自动 / `ai_user_profile_manual` 手动），前端展示 merge。
- 选项 C：手动编辑时给字段打 `source: "user"` 标记，AI 写入时只覆盖 `source: "ai"` 的字段。

本次 MVP 接受"用户的修改会被后台任务覆盖"这个限制——大多数用户场景是先聊几次，AI 画像成型后再人工微调，微调完短时间内不会再触发 summarizer（15 分钟冷却 + 4 条消息阈值）。

### 坑 6：prisma `db push` 在 sandbox 里找不到 `DATABASE_URL`

**现象**：直接 `npx prisma db push` 报 `Environment variable not found: DATABASE_URL`。

**原因**：shell 启动时没自动 source `.env.local`；prisma CLI 不读 Next.js 的 env loader。

**解法**：`set -a && source .env.local && set +a && npx prisma db push`。也可以写一个 `.env` 文件 prisma 会自动读（注意 `.env` 不是 `.env.local`）。

---

## 附录：相关文件路径

- 聊天主页壳：[`app/ai/page.tsx`](../../app/ai/page.tsx)
- 页面主组件：[`features/ai/ui/AiChatPage.tsx`](../../features/ai/ui/AiChatPage.tsx)
- 聊天面板：[`features/ai/ui/AiChatPanel.tsx`](../../features/ai/ui/AiChatPanel.tsx)
- 侧边栏：[`features/ai/ui/AiConversationSidebar.tsx`](../../features/ai/ui/AiConversationSidebar.tsx)
- 数据层：[`features/ai/lib/conversation-store.ts`](../../features/ai/lib/conversation-store.ts)
- 后台任务（AI 自动覆盖画像的源头）：[`features/ai/lib/background-jobs.ts`](../../features/ai/lib/background-jobs.ts)
- API 路由：
  - [`app/api/ai/conversations/route.ts`](../../app/api/ai/conversations/route.ts)
  - [`app/api/ai/conversations/[id]/route.ts`](../../app/api/ai/conversations/%5Bid%5D/route.ts)
  - [`app/api/ai/profile/route.ts`](../../app/api/ai/profile/route.ts)
- 测试：
  - [`scripts/ai-chat-polish-smoke.ts`](../../scripts/ai-chat-polish-smoke.ts)
  - [`e2e/ai-chat-polish.spec.ts`](../../e2e/ai-chat-polish.spec.ts)
- 整体模块背景：[`docs/ai/ai-module-full-chain.md`](./ai-module-full-chain.md)
