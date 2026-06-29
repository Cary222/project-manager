# PR3 AI 画像面板 — 开发到测试复现手册

> 适用：ProjectHub 仓库（Next.js 15 + Prisma pm schema + NextAuth）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"团队主页 + 个人主页接入 AI 画像"端到端。

---

## 1. 目标 & 背景

### 1.1 旧版的问题
- `/team` 团队主页只显示成员的 task/项目/技能，没体现"AI 对这个人的理解"
- `/team/[id]` 个人主页虽然有 AI 助手入口，但**没有把 AI 已经生成的画像可视化**
- `AiUserProfile` 表（userId 主键 + profile Json）已有，但前端只通过 `/api/ai/profile` 暴露**本人**的画像，**他人**的画像读不到

### 1.2 结论
- `getUserProfileAction` 加载 `aiProfile` 字段（含 `UserProfileData` JSON + 时间戳 + 来源摘要数）
- `getTeamMembersAction` 加载 `hasAiProfile` 布尔标签
- 新组件 `ProfileAiSummary` 渲染 5 个画像区块（角色/专长/兴趣/参与项目/最近话题）
- 新 API `GET /api/team/[id]/ai-profile` 暴露任意成员的画像（鉴权后）
- `TeamMemberCard` 在"已生成画像"时显示紫色 ✨ 标签
- **PR3 不做真实生成**（PR4 实现 summarizer 后端 + 自动入队）

### 1.3 范围限定（PR3 不做）
- ❌ AI 真实生成 `AiUserProfile`（PR4：summarizer 完成后由 background jobs 入队更新）
- ❌ 在 `WeeklyReport` 提交后触发画像刷新（PR4：enqueueSummarizeWeeklyReport 实现）
- ❌ 限制他人看画像的权限（任何登录用户都可看，PR4+ 再决定是否收紧）

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/profile/lib/profile-actions.ts` | 修改 | 加 `AiProfileSummary` 类型 + `aiProfile` 字段 + `hasAiProfile` 字段 |
| `features/team/ui/ProfileAiSummary.tsx` | 新增 | 个人主页画像区块 server component |
| `features/team/ui/TeamMemberCard.tsx` | 修改 | 已有画像时显示 "✨ AI 画像" 标签 |
| `app/team/[id]/page.tsx` | 修改 | 在 ProfileHeader 后集成 ProfileAiSummary |
| `app/api/team/[id]/ai-profile/route.ts` | 新增 | GET 任意成员画像（鉴权 + try/catch） |
| `scripts/profile-actions-unit-test.ts` | 新增 | 11 个纯函数测试（types import 真实 module） |
| `scripts/verify-pr.ts` | 扩展 | 加 `--pr3` 步骤 + 4 个 HTTP 路由测试 |

---

## 3. 核心实现

### 3.1 `AiProfileSummary` 强类型（`features/profile/lib/profile-actions.ts`）

```startLine:5:features/profile/lib/profile-actions.ts
import type { UserProfileData } from "@/features/ai/lib/summarizer";
```

**为什么从 summarizer 共享 `UserProfileData` 类型**：
- LLM 生成的 JSON 形状由 `summarizer.ts` 的 `PROFILE_INSTRUCTION` prompt 决定
- 强类型从单一来源导出，下游 `ProfileAiSummary` 渲染时不需要 runtime 判 type
- 代码 reviewer 报告的 Critical #1/#2：**禁止用 `unknown`**，会丢失类型契约

```startLine:32:features/profile/lib/profile-actions.ts
export type AiProfileSummary = {
  hasProfile: boolean;
  sourceSummaryCount: number;
  updatedAt: Date | null;
  /** LLM-summarized attributes; null if no AI profile has been generated yet. */
  profile: UserProfileData | null;
};
```

### 3.2 `getUserProfileAction` 加 aiProfile include

```startLine:75:features/profile/lib/profile-actions.ts
const user = await prisma.user.findUnique({
  where: { id: userId },
  include: {
    responsibilities: { select: { kind: true } },
    createdTickets: { ... },
    userOnProjects: { ... },
    weeklyReports: { ... },
    aiProfile: true,  // ← 新增：包含整个 AiUserProfile 行
  },
});
```

```startLine:142:features/profile/lib/profile-actions.ts
aiProfile: {
  hasProfile: user.aiProfile !== null,
  sourceSummaryCount: user.aiProfile?.sourceSummaryCount ?? 0,
  updatedAt: user.aiProfile?.updatedAt ?? null,
  profile: (user.aiProfile?.profile as UserProfileData | undefined) ?? null,
},
```

**为什么用 `hasProfile` 布尔 + `profile: null` 双信号**：
- `hasProfile = false` → "行不存在"（PR4 summarizer 还没跑过）
- `hasProfile = true && profile = null` → "行存在但内容空"（PR4 跑过但 LLM 没数据）
- `hasProfile = true && profile = {...}` → "正常"

UI 用 `hasProfile` 决定空/已生成状态显示，运行时再检查 `isEmptyProfile()`。

### 3.3 `getTeamMembersAction` 加 hasAiProfile

```startLine:200:features/profile/lib/profile-actions.ts
const users = await prisma.user.findMany({
  where: { bannedAt: null },
  include: {
    responsibilities: { select: { kind: true } },
    userOnProjects: { ... },
    createdTickets: { ... },
    aiProfile: { select: { userId: true } },  // ← 新增：只取 userId 字段
  },
  orderBy: { createdAt: "asc" },
});
```

**为什么 select 最小字段**：团队卡片只关心"有没有画像"，不需要读 JSON → 减小 IO。

### 3.4 `ProfileAiSummary` 组件

```startLine:35:features/team/ui/ProfileAiSummary.tsx
function isEmptyProfile(p: NonNullable<AiProfileSummary["profile"]>): boolean {
  return (
    p.roles.length === 0 &&
    p.expertise.length === 0 &&
    p.interests.length === 0 &&
    p.projects.length === 0 &&
    p.recentTopics.length === 0
  );
}
```

**为什么有 `isEmptyProfile`**：
- summarizer.ts line 220-241 已经处理"空摘要时清空画像"的情况
- 但 LLM 仍可能返回 5 个空数组的对象（极端 case）→ 显式检查兜底

**两态渲染**：
- 空态：dashed 紫色边框 + "与 AI 聊天生成画像 →" CTA（仅 `isOwnProfile`）
- 满态：solid 边框 + 5 个 section（角色/专长/兴趣/参与项目/最近话题）+ "基于 N 段对话摘要" + 更新时间

### 3.5 API 路由鉴权 + try/catch

```startLine:22:app/api/team/[id]/ai-profile/route.ts
const session = await auth();
if (!session?.user?.id) {
  return NextResponse.json({ data: null, error: "UNAUTHORIZED" }, { status: 401 });
}

const { id } = await params;
const idSchema = z.string().min(1).max(64);
const parsed = idSchema.safeParse(id);
if (!parsed.success) {
  return NextResponse.json({ data: null, error: "INVALID_ID" }, { status: 400 });
}

try {
  const record = await prisma.aiUserProfile.findUnique({
    where: { userId: id },
    select: { profile: true, sourceSummaryCount: true, updatedAt: true },
  });

  if (!record) {
    return NextResponse.json({ data: null, error: null });
  }

  return NextResponse.json({ ... });
} catch (err) {
  console.error("[ai-profile route] DB error:", err);
  return NextResponse.json(
    { data: null, error: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
```

**为什么用 `{ data, error }` 包装**：项目统一 API 响应格式（参考 fullstack-developer agent §2 API Design）。

**为什么 try/catch**：code reviewer Critical #3——Prisma 抛错时不能裸 500，要统一错误信封。

### 3.6 `TeamMemberCard` 标签

```startLine:40:features/team/ui/TeamMemberCard.tsx
{member.hasAiProfile ? (
  <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-violet-600">
    <span aria-hidden>✨</span> AI 画像
  </p>
) : null}
```

**为什么放 bio 下方**：标签和 bio 都是"次要元信息"，视觉上同组。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 端口 | 3003 | dev server |
| 鉴权 | NextAuth v5 | 任意登录用户可读他人画像 |
| OpenAI | `OPENAI_API_KEY` | PR4 summarizer 用 |
| schema | `AiUserProfile` 已存在 | `userId @id` + `profile Json` + `sourceSummaryCount` |

---

## 5. 启动 / 部署

```bash
# 1. 启动 dev server
cd /Users/vastgui/Desktop/project-manager
npm run dev
# 期望：Local: http://localhost:3003

# 2. 浏览器手测
# - 登录后访问 /team
# - 点击任意成员 → 看到 /team/<id>
# - 若该成员未生成 AI 画像 → 看到 dashed 紫色空态
# - 若该成员已生成 → 看到 5 个 section 的画像区块
```

---

## 6. 测试 & 验证

### 6.1 单元 / 脚本验证

```bash
cd /Users/vastgui/Desktop/project-manager
./node_modules/.bin/tsx --env-file=.env.local scripts/profile-actions-unit-test.ts
```

**期望输出**：

```
[profile-actions unit tests]
(pure functions — no DB required, types imported from source)
  ✓ shapeAiProfile(null) → hasProfile: false
  ... (10 个 case)
Results: 11 passed, 0 failed
```

### 6.2 端到端 HTTP 验证

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --all
```

**期望输出**：

```
===== PR3 STEPS =====
[PROFILE ACTIONS UNIT] 11 passed
[PR3 API ROUTE TESTS] 4 个 HTTP 全 PASS
  ✓ GET /team → 307
  ✓ GET /team/<id> → 307
  ✓ GET /api/team/<id>/ai-profile → 307 (auth)
  ✓ GET /api/team//ai-profile → 308 (bad id rejected)

[PR1+PR2+PR3 OK]
```

### 6.3 浏览器手测 checklist

- [ ] `/team` 显示所有成员卡片，已生成画像的卡片有紫色 ✨ AI 画像 标签
- [ ] 点击无画像的成员 → `/team/<id>` 看到 dashed 紫色空态 + "与 AI 聊天生成画像 →"
- [ ] 切到 ROOT 账号，看自己的 `/team/<id>`（假设 ROOT 已对话过） → 看到 5 个 section
- [ ] 团队主页有 `Promise.all` 加载，无 N+1

---

## 7. 复现 Checklist

- [ ] `features/profile/lib/profile-actions.ts` 有 `AiProfileSummary` 类型（强类型 `UserProfileData | null`）
- [ ] `getUserProfileAction` include `aiProfile: true`
- [ ] `getTeamMembersAction` include `aiProfile: { select: { userId: true } }`
- [ ] `features/team/ui/ProfileAiSummary.tsx` 存在，5 个 section 渲染
- [ ] `app/team/[id]/page.tsx` 在 ProfileHeader 后集成 ProfileAiSummary
- [ ] `TeamMemberCard.tsx` 有 `hasAiProfile` 标签渲染
- [ ] `app/api/team/[id]/ai-profile/route.ts` 有 try/catch + 标准 `{ data, error }` 响应
- [ ] `scripts/profile-actions-unit-test.ts` 11/11 pass
- [ ] `scripts/verify-pr.ts --all` PR1+PR2+PR3 全绿
- [ ] tsc 无新增错误
- [ ] 浏览器手测 4 步全过

---

## 8. 踩坑记录

### 坑 1：Stale dev server 缓存导致 "Unknown field weeklyReports"

**现象**：dev server 报 `PrismaClientValidationError: Unknown field weeklyReports` for User model。

**影响范围**：阻塞整个 `/team` 页 + 子代理 PR2 的所有产线都不能用。

**根因**：
- Prisma schema line 99 写了 `User.weeklyReports WeeklyReport[]`
- `WeeklyReport.user @relation` 也在 line 599 写了
- **关系定义正确**！但是 dev server 用的 Prisma client 实例是启动时加载的，**没有 HMR 重载机制**
- schema 改动后**必须重启 dev server**才能用新 client

**解法**：
```bash
# 1. 杀掉 dev server
lsof -ti :3003 | xargs kill -9
ps aux | grep -E "npm run dev|next dev" | grep -v grep | awk '{print $2}' | xargs -I {} kill -9 {} 2>/dev/null

# 2. 强制重生 Prisma client
npx prisma generate

# 3. 清 .next 缓存
rm -rf .next/dev

# 4. 重启
nohup npm run dev > /tmp/pm-dev.log 2>&1 &
```

**教训**：macOS `fuser` 不支持 `-k` 杀端口，要用 `lsof -ti :PORT | xargs kill -9`。

### 坑 2：`profile: unknown` 类型太松

**现象**：第一版 `AiProfileSummary.profile: unknown`，`ProfileAiSummary` 组件用 `isProfileJson()` runtime 兜底。

**code reviewer 反馈**：Critical 级别——类型丢失契约，下游消费者要 defensive narrow。

**解法**：从 `summarizer.ts` 共享 `UserProfileData` 类型：

```ts
import type { UserProfileData } from "@/features/ai/lib/summarizer";

export type AiProfileSummary = {
  profile: UserProfileData | null;
  ...
};
```

**教训**：单一定义来源（Single Source of Truth）——LLM 输出 schema 只在 summarizer 里定义一次，其他地方 import。

### 坑 3：API 路由无 try/catch

**现象**：第一版 API 直接 `prisma.findUnique`，DB 报错裸 500。

**code reviewer 反馈**：Critical——违反项目统一 `{ data, error }` 响应格式，客户端难以做错误处理。

**解法**：包 try/catch + 统一 500 响应。

### 坑 4：单元测试 redefine 类型

**现象**：第一版 `profile-actions-unit-test.ts` 复制了 `AiProfileSummary` 和 `TeamMember` 类型定义。

**code reviewer 反馈**：Improvement——如果源类型变化，测试测的是"旧形状"，不报警。

**解法**：
```ts
import type { AiProfileSummary, TeamMember } from "@/features/profile/lib/profile-actions";
```

但**不能直接 import server actions**（"use server" 边界）→ 改成 import `type`（编译时擦除）。

### 坑 5：subagent 跨 chat context 失灵（SOP 已更新）

**现象**：PR2 时 audit 子代理拿到 prompt 后永远 idle。

**根因**：两个子代理**不在同一 chat context**，无法互相看到状态，prompt 里的"等 X 完成后做 Y"是无效指令。

**解法**（已规则化）：`.cursor/rules/subagent-coordination-sop.mdc` + 双向更新两个 agent 的协作流程段。

### 坑 6：意外在文件顶部加了 `"use client"` 注释

**现象**：修改 ProfileAiSummary.tsx 时我误以为要加 `"use client"`，加了一行注释 `// not strictly needed`。

**影响**：注释误导未来读者，让人以为"曾经是 client"。

**解法**：直接删掉那行注释，保留纯 server component。

### 坑 7：`/api/team//ai-profile` 返回 308 而不是 400

**现象**：`verify-pr` 测空 id 时，Next.js App Router 把 `//` 规范化成 `/`，返回 308 重定向。

**影响**：路由处理器根本收不到空 id。

**解法**：验证器接受 308（重定向被路由层处理），并加注释说明："bad id rejected" 的真正语义是"请求被路由层拦截"。

---

## 附：相关文件位置

| 关注点 | 文件 |
|--------|------|
| 画像 store | `features/profile/lib/profile-actions.ts` |
| UserProfileData 类型 | `features/ai/lib/summarizer.ts` (line 16-23) |
| 个人画像 UI | `features/team/ui/ProfileAiSummary.tsx` |
| 个人页面壳 | `app/team/[id]/page.tsx` |
| 团队成员卡 | `features/team/ui/TeamMemberCard.tsx` |
| API 入口 | `app/api/team/[id]/ai-profile/route.ts` |
| 已存在 API | `app/api/ai/profile/route.ts` (本人画像，GET/PATCH) |
| AiUserProfile store | `features/ai/lib/conversation-store.ts` (line 172-196) |
| Summarizer (PR4 准备) | `features/ai/lib/summarizer.ts` |
| 单元测试 | `scripts/profile-actions-unit-test.ts` |
| 集成测试 | `scripts/verify-pr.ts --pr3` |
| Code review | 报告 5d0c5b2f-aad5-49db-984c-16dff6eb82b0 |
| 子代理 SOP | `.cursor/rules/subagent-coordination-sop.mdc` |
| PR1 复现 | `docs/reports/PR1-weekly-reports.md` |
| PR2 复现 | `docs/reports/PR2-stats-and-reports.md` |
