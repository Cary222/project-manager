# PR5 周报 AI 总结 + Toast + 详情页 — 开发到测试复现手册

> 适用：ProjectHub 仓库（Next.js 15 + Prisma pm schema + NextAuth v5 + sonner）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"周报提交/更新后自动生成 AI 总结 + 画像面板自动更新 + 真 toast"端到端。

---

## 1. 目标 & 背景

### 1.1 旧版的问题（PR1-PR4 后）

- PR1 schema 预留了 `WeeklyReport.aiSummary` 字段，但**一直是 null**
- PR4 周报提交后只刷新 `AiUserProfile`，周报本身没 AI 总结
- `updateUserProfile` 直接读对话摘要原始内容喂 LLM（token 浪费）
- 周报详情页 `/reports/weekly-reports/[id]` 是 PR2 占位（dashed border + "PR2 填满"）
- "刷新画像"按钮用 `alert()` 阻塞主线程，UX 差

### 1.2 结论（PR5 实施）

- **周报 aiSummary 自动生成**：POST/PATCH 触发 `enqueueSummarizeWeeklyReport` → 写 partial=true → 调 callAgnes 读 content → 写 aiSummary → 触发画像刷新
- **updateUserProfile 改读 aiSummary**：第二数据源 `weeklyReport.aiSummary[]`（最近 10 周），减少 LLM 输入 token
- **alert() → sonner toast**：`WeeklyReportRegenerateButton` 用 `toast.success / toast.error`，AppShell 全局 `<Toaster />`
- **详情页填满**：完整 title/metadata/content/attachments/aiSummary 三态展示
- **router.refresh()**：刷新画像成功后自动重拉 server component 数据

### 1.3 范围限定（PR5 不做）

- ❌ 周报重复提交 LLM 去重（follow-up）
- ❌ Integration test 覆盖 prisma 真实写（PR6 一起做）
- ❌ AiSummaryPanel "折叠"功能（顾问建议但 PR5 决定"始终展开"更符合场景）
- ❌ `setTimeout(500ms)` 删除或调整（保留作为分布式防御）

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/reports/weekly-reports/lib/summarize.ts` | 新增 | 周报 AI 总结生成（LLM 调用 + 状态机） |
| `features/reports/weekly-reports/lib/background-jobs.ts` | 修改 | `enqueueSummarizeWeeklyReport` 改为 `setTimeout` + `summarizeWeeklyReport` |
| `features/ai/lib/summarizer.ts` | 修改 | `updateUserProfile` 增加读 weeklyReport.aiSummary 数据源 |
| `app/reports/weekly-reports/[id]/page.tsx` | 重写 | 完整详情页 + AiSummaryPanel 三态 + XSS escape |
| `features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx` | 修改 | alert() → sonner toast + router.refresh() |
| `shared/ui/AppShell.tsx` | 修改 | 全局 `<Toaster position="top-right" richColors />` |
| `package.json` / `package-lock.json` | 修改 | 新增 sonner 依赖 |
| `scripts/weekly-report-bg-job-unit-test.ts` | 修改 | 新增 Test 9（content 空）+ Test 10（LLM 失败） |
| `scripts/verify-pr.ts` | 修改 | 加 `--pr5` 选项 + PR5 STEPS 块 |

**不变更**：
- `prisma/schema.prisma`（字段已预留）
- 3 个 API route 调用点（保留 `void enqueueSummarizeWeeklyReport(reportId)`）
- `features/ai/lib/background-jobs.ts`（enqueueUpdateProfile 已完整）

---

## 3. 核心实现

### 3.1 summarizeWeeklyReport 状态机

```startLine:63:features/reports/weekly-reports/lib/summarize.ts
export async function summarizeWeeklyReport(reportId: string): Promise<void> {
  try {
    const report = await prisma.weeklyReport.findUnique({
      where: { id: reportId },
      select: { id: true, userId: true, title: true, content: true },
    });
    if (!report) return;

    if (!report.content || report.content.trim() === "") {
      // content 为空，不调 LLM，直接触发画像刷新
      enqueueUpdateProfile(report.userId);
      return;
    }

    // Step 1: 写 partial 状态 → UI 显示"生成中"
    await prisma.weeklyReport.update({
      where: { id: reportId },
      data: { aiSummaryPartial: true },
    });

    // Step 2: 调 LLM（content 截断到 8000 字）
    const truncatedContent =
      report.content.length > MAX_CONTENT_LENGTH
        ? report.content.slice(0, MAX_CONTENT_LENGTH) + "…（内容已截断）"
        : report.content;

    let aiSummary: string;
    try {
      aiSummary = await callAgnesForSummary(report.title, truncatedContent);
    } catch (err) {
      // LLM 失败：写 fallback + 确保 partial=false + 仍触发画像刷新
      await prisma.weeklyReport.update({
        where: { id: reportId },
        data: { aiSummary: "", aiSummaryPartial: false },
      });
      enqueueUpdateProfile(report.userId);
      return;
    }

    // Step 3: 写 aiSummary
    await prisma.weeklyReport.update({
      where: { id: reportId },
      data: {
        aiSummary: aiSummary.trim(),
        aiSummaryAt: new Date(),
        aiSummaryPartial: false,
      },
    });

    // Step 4: 触发画像刷新（无论成功失败都走这一步）
    enqueueUpdateProfile(report.userId);
  } catch (err) {
    console.warn(`[summarizeWeeklyReport] failed for ${reportId}:`, err);
  }
}
```

**关键设计决策**：

1. **content 截断 8000 字**：Agnes LLM context 限制（max_tokens=2048 输出 + 上下文窗口）。截断避免超出。
2. **partial 状态机**：先写 `aiSummaryPartial=true`（UI 显示 skeleton）→ 调 LLM → 写 `aiSummary + aiSummaryAt + aiSummaryPartial=false`（UI 显示内容）。
3. **LLM 失败兜底**：写 `aiSummary=""` + `aiSummaryPartial=false`（避免永远卡在"生成中"）+ 仍触发 `enqueueUpdateProfile`（让画像至少能拿到旧 aiSummary）。
4. **失败仍触发画像**：「失败也要继续」原则——画像里有旧 aiSummary 比没有强。
5. **整体 try/catch**：fire-and-forget 模式下，吞错防止 unhandled rejection。

### 3.2 enqueueSummarizeWeeklyReport（PR4 简化版）

```startLine:23:features/reports/weekly-reports/lib/background-jobs.ts
export async function enqueueSummarizeWeeklyReport(reportId: string): Promise<void> {
  setTimeout(() => {
    summarizeWeeklyReport(reportId).catch((err) => {
      console.warn(`[enqueueSummarizeWeeklyReport] failed for ${reportId}:`, err);
    });
  }, 500);
}
```

**为什么 setTimeout(500ms)**：
- HTTP 响应在 `POST/PATCH route.ts` 里是**同步返回**的（事务已 commit）
- 500ms 延迟给 Prisma replica 留窗口（分布式场景防御）
- 单实例下不需要，但保留无害

**为什么函数名保留 `enqueueSummarizeWeeklyReport`**：
- PR4 已在 3 个路由里用了
- 改名要改 3 处，破坏 PR4 既有调用
- 新功能用"内部调用新函数"实现即可，**API 兼容**比"命名清晰"更重要

### 3.3 updateUserProfile 增加 weeklyReport 数据源

```startLine:215:features/ai/lib/summarizer.ts
export async function updateUserProfile(
  userId: string
): Promise<UserProfileData | null> {
  const conversations = await prisma.aiConversation.findMany({
    where: { userId, summary: { not: Prisma.JsonNull } },
    select: { id: true, summary: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  // PR5: Also pull in weekly report AI summaries as a second data source
  const weeklyReports = await prisma.weeklyReport.findMany({
    where: {
      userId,
      aiSummary: { not: null },
      aiSummaryPartial: false,
    },
    select: { id: true, aiSummary: true, aiSummaryAt: true },
    orderBy: { weekStart: "desc" },
    take: 10,
  });

  // 过滤空字符串（fallback 写的 ""）
  const weeklySummaries = weeklyReports
    .filter((r) => r.aiSummary && r.aiSummary.trim() !== "")
    .map((r) => ({ id: r.id, summary: { type: "weekly_report", aiSummary: r.aiSummary } }));

  const summaries = [...conversationSummaries, ...weeklySummaries];
  // ... 后续 LLM 调用、prompt 构建（PROFILE_INSTRUCTION 增加数据源说明）
}
```

**关键决策**：

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据源合并 | 把 aiSummary 包装成 `{ type: "weekly_report", aiSummary }` | 让 LLM 区分对话摘要 vs 周报摘要 |
| take: 10 | 最近 10 周 | 避免单用户有 50 周周报时 token 爆炸 |
| 过滤空字符串 | `.filter(r => r.aiSummary.trim() !== "")` | fallback 写的 `""` 不应喂给 LLM |
| prompt 标注 | `[对话 N]` vs `[weekly_report N]` | buildProfilePrompt 检测 `type` 字段动态加标签 |

**PROFILE_INSTRUCTION 改造**（line 110-133）：

```typescript
const PROFILE_INSTRUCTION = [
  "你是一个用户画像分析助手。请根据用户提供的内容片段，提取并更新用户画像。",
  "",
  "## 数据来源说明",
  "用户提供的内容可能来自：",
  "1. AI 对话摘要（type=对话）：多轮对话的摘要，包含主题、要点、行动项等",
  "2. 周报 AI 摘要（type=weekly_report）：用户提交的周报自动生成的摘要",
  // ... JSON 输出要求
  "注意：",
  "- 周报摘要中提到的项目名应合并到 projects 字段",
].join("\n");
```

### 3.4 AiSummaryPanel 三态 + XSS 修复

```startLine:38:app/reports/weekly-reports/[id]/page.tsx
function AiSummaryPanel({
  aiSummary,
  aiSummaryPartial,
  aiSummaryAt,
}: {
  aiSummary: string | null;
  aiSummaryPartial: boolean;
  aiSummaryAt: Date | string | null;
}) {
  if (aiSummary === null && !aiSummaryPartial) {
    return null;  // 状态 1: 不渲染
  }

  const isGenerating = aiSummary === null && aiSummaryPartial;  // 状态 2: skeleton

  return (
    <div className="mt-6 rounded-xl border border-brand-100 bg-brand-50/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        {/* AI icon + 标题 + 更新时间 */}
      </div>

      {isGenerating ? (
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-ink-200 animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-ink-200 animate-pulse" />
          <div className="h-3 w-4/6 rounded bg-ink-200 animate-pulse" />
        </div>
      ) : (
        <div
          className="prose prose-sm prose-ink max-w-none whitespace-pre-wrap text-sm leading-relaxed text-ink-700"
          dangerouslySetInnerHTML={{ __html: escapeAiSummary(aiSummary) }}
        />
      )}
    </div>
  );
}
```

**三态语义**：

| 状态 | 条件 | UI |
|------|------|-----|
| 不渲染 | `aiSummary=null && !aiSummaryPartial` | 整个 `<div>` 不挂载（页面没区块） |
| 生成中 | `aiSummary=null && aiSummaryPartial=true` | 3 行 animate-pulse 灰块 skeleton |
| 已生成 | `aiSummary 有值` | markdown-like 渲染 + 更新时间 |

### 3.5 XSS 转义（ai-learning-mentor 审计必须修）

**风险**：Agnes LLM 是外部 API，理论上可被 prompt injection 污染输出。如果直接 `dangerouslySetInnerHTML` 原文，`<img onerror=alert('XSS')>` 会被浏览器执行 → Stored XSS。

**修复**（`page.tsx` line 32-50）：

```typescript
function escapeAiSummary(aiSummary: string | null | undefined): string {
  if (!aiSummary) return "";
  return aiSummary
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}
```

**修复策略**：先转义危险字符（`& < > " '`），再还原 markdown 标记。这样 LLM 输出的 `<script>` 会被显示成文本（`&lt;script&gt;`），而不是被执行。

**为什么必须修**：
- Agnes 是外部 API，理论上可被 prompt injection 污染
- Stored XSS 一旦触发，影响所有访问该周报的用户
- 攻击者污染自己的数据虽无横向影响，但**用户数据被破坏**就是 bug

### 3.6 sonner toast 集成

**AppShell 全局**（`shared/ui/AppShell.tsx` line 7, 412）：

```typescript
import { Toaster } from "sonner";
// ...
return (
  <div className="flex min-h-screen bg-ink-100 text-ink-900">
    {/* ... sidebar + header + main ... */}
    <Toaster position="top-right" richColors />
  </div>
);
```

**按钮调用**（`WeeklyReportRegenerateButton.tsx`）：

```typescript
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export function WeeklyReportRegenerateButton({ reportId }: Props) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleRegenerate() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/weekly-reports/${reportId}/regenerate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        toast.success("AI 总结已入队，预计 5-30 秒后完成");
        router.refresh();  // 关键：重新拉 server component 数据
      } else if (res.status === 401) {
        toast.error("请先登录");
      } else if (res.status === 403) {
        toast.error("无权操作此周报");
      } else if (res.status === 404) {
        toast.error("周报不存在");
      } else {
        toast.error(`操作失败 (${res.status})`);
      }
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }
  // ...
}
```

**`router.refresh()` 的意义**：
- 周报详情页是 server component
- 刷新画像触发后 aiSummary 字段会在 5-30s 内更新
- 用户点击"刷新画像" → toast → 立即 router.refresh() → 重新渲染详情页
- 如果 aiSummary 已生成（快速 case）→ 用户立刻看到新内容
- 如果还在生成中 → skeleton 状态

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 端口 | 3003 | dev server |
| 鉴权 | NextAuth v5 | `auth()` from `@/lib/auth` |
| OpenAI | `OPENAI_API_KEY` | features/ai/lib/summarizer.ts（PR4 已有） |
| sonner | latest | `npm install sonner` |
| schema | 不变 | `WeeklyReport.aiSummary` 字段已预留 |

---

## 5. 启动 / 部署

```bash
# 1. 装新依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 启动 dev server（已有 schema 无需重新 prisma generate）
npm run dev
# 期望：Local: http://localhost:3003

# 3. 浏览器手测
# - 登录后访问 /reports/weekly-reports/new
# - 填周报并提交
# - 等 5-10s 后访问 /reports/weekly-reports/<id>
# - 看到 AI 总结区块显示内容（或 skeleton → 内容）
# - 点 "刷新画像" → toast 提示 → 5-30s 后 AiUserProfile 更新
```

---

## 6. 测试 & 验证

### 6.1 单元测试

```bash
cd /Users/vastgui/Desktop/project-manager
./node_modules/.bin/tsx --env-file=.env.local scripts/weekly-report-bg-job-unit-test.ts
```

**期望输出**：

```
[weekly-report-bg-job unit tests]
(pure logic tests with mocks — no DB required)

  ✓ report 存在 → enqueueUpdateProfile 被调用，userId 正确
  ✓ report 不存在 → no-op（enqueueUpdateProfile 未被调用）
  ✓ 同 userId 多 report 入队：每个 report 都触发入队（去重在 enqueueUpdateProfile 内部）
  ✓ fire-and-forget 不抛异常
  ✓ regenerate API 状态码分支（401/404/403/202）
  ✓ WeeklyReport schema 含 aiSummary 系列字段
  ✓ 边界：空 reportId → no-op
  ✓ content 空字符串 → 不调 LLM，直接触发 enqueueUpdateProfile    ← PR5 新增
  ✓ LLM 失败 → 仍触发 enqueueUpdateProfile（写 fallback 后刷新画像）  ← PR5 新增

Results: 9 passed, 0 failed
```

### 6.2 端到端 HTTP 验证

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --all
```

**期望输出**（PR5 部分）：

```
===== PR5 STEPS =====

[BG-JOB UNIT] Running: tsx --env-file=.env.local scripts/weekly-report-bg-job-unit-test.ts
[weekly-report-bg-job unit tests]
(pure logic tests with mocks — no DB required)
... 9 passed, 0 failed
  ✓ BG-JOB UNIT PASS

[PR5 API ROUTE TESTS]
  ✓ POST regenerate (no auth) → 307

========================================
[PR1+PR2+PR3+PR4+PR5 OK]
========================================
```

### 6.3 浏览器手测 checklist

- [ ] `/reports/weekly-reports/new` 提交周报 → 列表页多 1 条
- [ ] `/reports/weekly-reports/<id>` 5-10s 后 aiSummary 自动出现
- [ ] 同一周报 PATCH 修改 → aiSummary 重新生成（可见新内容）
- [ ] "刷新画像" 按钮 → toast 弹出 → 5-30s 后 /team/<id> 画像更新
- [ ] aiSummary 含 `<script>alert(1)</script>` → 页面显示文本（不执行）— XSS 验证

---

## 7. 复现 Checklist

- [ ] `npm install sonner` 成功（`package.json` 有 sonner 依赖）
- [ ] `features/reports/weekly-reports/lib/summarize.ts` 存在
- [ ] `features/reports/weekly-reports/lib/background-jobs.ts` `enqueueSummarizeWeeklyReport` 内部调 `summarizeWeeklyReport`
- [ ] `features/ai/lib/summarizer.ts` `updateUserProfile` 查 weeklyReports
- [ ] `app/reports/weekly-reports/[id]/page.tsx` 完整详情页 + AiSummaryPanel 三态 + `escapeAiSummary` 函数
- [ ] `WeeklyReportRegenerateButton.tsx` 改用 sonner toast + router.refresh()
- [ ] `shared/ui/AppShell.tsx` 加 `<Toaster position="top-right" richColors />`
- [ ] `scripts/weekly-report-bg-job-unit-test.ts` 9/9 pass
- [ ] `scripts/verify-pr.ts --all` PR1+PR2+PR3+PR4+PR5 全绿
- [ ] tsc 无 PR5 相关错误
- [ ] 浏览器手测 5 步全过

---

## 8. 踩坑记录

### 坑 1：tsc 错误（子代理初次提交）

**现象**：子代理在 `app/reports/weekly-reports/[id]/page.tsx` 用了 `getServerSession(authOptions)`，但项目用 next-auth v5，应使用 `auth()`。

**根因**：子代理不熟悉 next-auth v5 API 变化。

**解法**（子代理自动修复）：改用 `const session = await auth()`（line 92），import 从 `next-auth` 改为 `@/lib/auth`。

**教训**：子代理 tsc 错误主代理必须**强制再跑一次**（PR4 踩坑 + PR5 重演）。

### 坑 2：submittedAt 字段不存在

**现象**：子代理用 `report.submittedAt`（plan 文档里的字段名），但实际 schema 只有 `createdAt` 和 `updatedAt`。

**根因**：plan 文档 §1.1 写 `submittedAt DateTime @default(now())`，但 schema 实际是 `createdAt`。

**解法**：把 `report.submittedAt` 改为 `report.createdAt`（PR5 范围不应改 schema）。

**教训**：子代理相信 plan 文档，没核对实际 schema 字段。

### 坑 3：XSS 风险（ai-learning-mentor 审计发现）

**现象**：`AiSummaryPanel` 用 `dangerouslySetInnerHTML` 渲染 aiSummary，但替换规则没转义 `<>`。LLM 输出 `<img onerror=alert(1)>` 会执行 XSS。

**影响**：Stored XSS — 一旦 LLM 被 prompt injection 污染，所有访问该周报的用户都受影响。

**解法**：在 markdown 替换前先转义 `& < > " '`，再还原 `**bold**` / `*italic*` 标签。新增 `escapeAiSummary` 函数（`page.tsx` line 32-50）。

**ai-learning-mentor 审计结论**：「必须修，安全红线」。

**教训**：用 `dangerouslySetInnerHTML` 必须先 escape，再 markdown 转换。

### 坑 4：500ms setTimeout 无意义？

**现象**：HTTP 响应在 `POST/PATCH route.ts` 里是同步返回的，事务已 commit。`setTimeout(500ms)` 不服务于"等事务"。

**ai-learning-mentor 评估**：
- 单实例 + 直连 master DB → 不需要 500ms 延迟
- 分布式 / Prisma replica 场景 → 500ms 是合理窗口
- ProjectHub 当前是单实例，但保留无害

**决策**：保留 500ms，加注释说明"分布式防御"。**不改 PR5**。

### 坑 5：同一周报 PATCH 两次 → LLM 调两次

**现象**：用户连续 PATCH 同一周报，每次都触发 `enqueueSummarizeWeeklyReport` → 调 LLM。第二次 LLM 结果覆盖第一次，token 浪费。

**ai-learning-mentor 评估**：
- 浪费 token 但结果正确（第二次覆盖第一次）
- `enqueueUpdateProfile` 内部 15min 冷却窗去重，所以**画像刷新只一次**
- 真要解决需要"reportId 版本号去重"机制

**决策**：可延后到 PR6 一起做（结合 LLM 调用去重 + 画像版本号）。

### 坑 6：AiSummaryPanel 注释误导

**现象**：注释写"AI 总结折叠面板"（来自顾问原始建议），但代码实现是**始终展开**（没有 `<details>/<summary>`）。

**根因**：UI 实现选择了"直接展示"（更符合周报场景），但注释没同步更新。

**解法**：改注释为"AI 总结展示区块"（line 28）。**已修复**。

**教训**：代码注释要反映实际行为，不要保留历史错误。

---

## 9. 端到端链路时间线

完整时序（用户视角）：

```
T=0         POST /api/reports/weekly-reports         → HTTP 201
T=0~500ms   用户看到列表页多 1 条
T=0.5s      setTimeout 触发 → summarizeWeeklyReport
            ↓
            查 weeklyReport（DB hit）
            ↓
            写 aiSummaryPartial=true
            ↓
            调 callAgnes 读 title+content（LLM 3-5s）
            ↓
T=5s        写 aiSummary + aiSummaryAt + aiSummaryPartial=false
            ↓
            enqueueUpdateProfile(userId) → 15min 冷却窗
            ↓
T=5~30s     doUpdateProfile → 调 updateUserProfile
            ↓
            读 conversations + weeklyReports aiSummary
            ↓
            调 callAgnes 读多源（LLM 5-20s）
            ↓
            写 AiUserProfile
            ↓
            用户在 /team/<id> 看到画像更新
```

**用户等待时间**：
- 看到 aiSummary 内容：5-10s
- 看到画像更新：10-30s
- 总链路延迟：30s 内

**对应文案**：
- 按钮："刷新画像" → "刷新中…"
- toast 提示："AI 总结已入队，预计 5-30 秒后完成"

---

## 10. PR5 后续：PR6+ 路线

按 ai-learning-mentor 审计报告：

| 项 | 优先级 | 备注 |
|----|------|------|
| 周报重复提交 LLM 去重 | 中 | 同一 reportId 在 LLM 调用期间防止重复触发（可结合画像版本号统一） |
| 删 setTimeout(500ms) 或加注释 | 低 | 单实例不需要；保留作分布式防御 |
| Integration test 补 Prisma 真实写 | 低 | PR5 unit test 覆盖纯逻辑，integration 可加 |
| 提取 `escapeAiSummary` 到 shared/lib | 低 | 当前 page.tsx 内部函数，复用时再提 |
| 报表页加"周报提交情况"区块 | 中 | PR5 已有 weeklyReports 数据，可加统计 |
| 周报列表页显示 aiSummary 摘要 | 中 | 当前只显示 title，可加 truncated aiSummary |
| 团队主页 (`/team`) 显示成员最近周报 | 中 | 把 weeklyReports 加到 profile summary |
| 周报编辑页加 AI 辅助（"帮我润色"按钮） | 低 | 调 callAgnes 优化 content |

---

## 附：相关文件位置

| 关注点 | 文件 |
|--------|------|
| 周报 AI 总结 | `features/reports/weekly-reports/lib/summarize.ts` |
| 入队函数（简化） | `features/reports/weekly-reports/lib/background-jobs.ts` |
| 画像更新（多数据源） | `features/ai/lib/summarizer.ts` |
| 详情页 + 三态 + XSS | `app/reports/weekly-reports/[id]/page.tsx` |
| 按钮 + toast + refresh | `features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx` |
| 全局 Toaster | `shared/ui/AppShell.tsx` |
| 单元测试 | `scripts/weekly-report-bg-job-unit-test.ts` |
| 集成测试 | `scripts/verify-pr.ts --pr5` |
| AI 审计报告 | 6f3472b6-888d-4412-875f-467c5bf1851f |
| PR4 复现 | `docs/reports/PR4-weekly-report-ai-enqueue.md` |
| PR3 复现 | `docs/reports/PR3-ai-profile.md` |
| PR2 复现 | `docs/reports/PR2-stats-and-reports.md` |
| PR1 复现 | `docs/reports/PR1-weekly-reports.md` |
| subagent SOP | `.cursor/rules/subagent-coordination-sop.mdc` |
| code-reviewer agent | `.cursor/agents/code-reviewer.md` |

---

## 11. Code Review 审查

> 本节记录 PR5 的 code-reviewer 硬技术审查结论。ai-learning-mentor 软架构审计已在 PR5 开发期间完成（见 §8 踩坑记录坑 3/4/5）。code-reviewer 审查与 ai-learning-mentor 审计的分工：前者管硬技术（类型 / 安全 / N+1 / FSD），后者管软架构（取舍 / 边界 / 可观测性 / 成本）。

**审查时间**：2026-06-29（PR5 完工后）
**审查文件**：`docs/reports/PR5-code-review.md`

### 审查结论

| 维度 | 结论 |
|------|------|
| **Verdict** | ✅ **Approved** — 无 Critical 问题 |
| **tsc 错误** | ✅ 无 PR5 相关错误（仅有历史遗留的 e2e/admin.test.ts） |
| **XSS 安全** | ✅ `escapeAiSummary` 先转义 `& < > " '` 再还原 markdown |
| **Auth 检查** | ✅ 详情页用 `auth()`、regenerate API 有 401/403/404 |
| **FSD 边界** | ✅ `summarize.ts` 在 `features/reports/weekly-reports/lib/` 边界清晰 |
| **错误处理** | ✅ fire-and-forget 有 try/catch，partial 状态兜底 |
| **测试覆盖** | ✅ Test 9/10 覆盖 PR5 新增路径（content 空 / LLM 失败） |

### Improvements（推荐项，可选）

| # | 文件 | 问题 | 建议 |
|---|------|------|------|
| 1 | `app/api/reports/weekly-reports/[id]/regenerate/route.ts:9-15` | 注释写"刷新用户画像"但实际是"生成周报 AI 总结"，语义已变 | 更新注释匹配 PR5 实际行为 |
| 2 | `scripts/weekly-report-bg-job-unit-test.ts` | 测试编号跳号（Test 4 缺失） | 补 Test 4 或重新统一编号 |
| 3 | `features/reports/weekly-reports/lib/summarize.ts:71` | `content.trim() === ""` 对 null 值不够健壮 | 加 `|| null` 兜底：`if (!report.content || report.content?.trim() === "")` |

### Nitpicks（可选，不影响合并）

- `summarize.ts:86` 中文截断提示 `…（内容已截断）` 未 i18n（项目若有 i18n 体系则统一）
- `[id]/page.tsx:46` `escapeAiSummary` 未转义 `/`（但 `<>` 已转义，实际攻击面极小，接受现状）

### 踩坑记录对照（code-reviewer 逐条验证）

| 坑 | PR5 复现文档记录 | code-reviewer 实际验证 |
|----|----------------|----------------------|
| 坑 1: `getServerSession` → `auth()` | ✅ 已修复 | ✅ `[id]/page.tsx:111` 用 `auth()`，import 从 `@/lib/auth` |
| 坑 2: `submittedAt` 不存在 | ✅ 已修复 | ✅ `[id]/page.tsx:168` 用 `report.createdAt` |
| 坑 3: XSS 未 escape | ✅ 已修复 | ✅ `escapeAiSummary` 函数（line 38-49）先转义后还原 markdown |
| 坑 4: 500ms setTimeout 语义 | ✅ 保留（加注释） | ✅ 有注释说明"分布式防御" |
| 坑 5: PATCH 两次 LLM 调两次 | ✅ PR6 待做 | ✅ PR5 范围外 |
| 坑 6: 注释写"折叠"但实际"展开" | ✅ 已修复 | ✅ `[id]/page.tsx:51` 注释为"始终展开" |
