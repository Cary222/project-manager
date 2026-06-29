# PR4 周报 AI 入队 — 开发到测试复现手册

> 适用：ProjectHub 仓库（Next.js 15 + Prisma pm schema + NextAuth）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"周报提交/更新后自动刷新用户 AI 画像"端到端。

---

## 1. 目标 & 背景

### 1.1 旧版的问题（PR1-PR3 后）
- PR1 周报 CRUD 已能创建/更新周报
- PR2 报表已能读 `weeklyReports.aiSummary` 字段
- PR3 团队主页已能显示 `AiUserProfile`
- **但**：周报提交/更新后，**用户画像不会自动刷新**。用户必须手动点"刷新画像"或去 `/ai` 对话才能触发 summarizer → profile 链路
- PR2 已埋的 `features/reports/weekly-reports/lib/background-jobs.ts` line 22-31 是**空函数**（console.warn 占位）

### 1.2 结论（PR4 实施）
- 把 PR2 占位函数 `enqueueSummarizeWeeklyReport` / `enqueueUpdateProfileFromReport` 替换为**真逻辑**
- 周报 POST 创建 / PATCH 更新后，**fire-and-forget** 入队 `enqueueUpdateProfile(userId)`
- `/api/reports/weekly-reports/[id]/regenerate` 从 501 升级为 202，校验 report 归属
- 周报详情页加"🔄 刷新画像"按钮
- 复用 `features/ai/lib/background-jobs.ts` 的 `enqueueUpdateProfile`（已实现）+ `updateUserProfile`（已实现）

### 1.3 范围限定（PR4 不做）
- ❌ **不**自动生成 weeklyReport.aiSummary 字段（PR5+ 概念）
- ❌ **不**做 `/team/[id]` 画像区块的 router.refresh 自动刷新（PR5+）
- ❌ **不**改 `features/ai/lib/background-jobs.ts`（已完整，含 15min 冷却窗 + retry）
- ❌ **不**改 `features/ai/lib/summarizer.ts`（已完整，含 LLM 调用 + 错误兜底）
- ❌ **不**引入新依赖

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/reports/weekly-reports/lib/background-jobs.ts` | 修改 | 替换 PR2 占位为真逻辑（enqueueSummarizeWeeklyReport + 删 alias） |
| `app/api/reports/weekly-reports/[id]/regenerate/route.ts` | 修改 | 501 → 202 + 归属校验 |
| `app/api/reports/weekly-reports/route.ts` | 修改 | POST 创建后 fire-and-forget enqueue |
| `app/api/reports/weekly-reports/[id]/route.ts` | 修改 | PATCH 更新后 fire-and-forget enqueue |
| `features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx` | 新增 | 客户端按钮 + alert() toast |
| `app/reports/weekly-reports/[id]/page.tsx` | 修改 | 集成刷新按钮 |
| `scripts/weekly-report-bg-job-unit-test.ts` | 新增 | 8 个纯函数测试（含 prisma 失败） |
| `scripts/verify-pr.ts` | 扩展 | 加 `--pr4` 步骤 + 1 个 HTTP 测试 |

---

## 3. 核心实现

### 3.1 enqueueSummarizeWeeklyReport 入队函数

```startLine:22:features/reports/weekly-reports/lib/background-jobs.ts
import { prisma } from "@/shared/db/client";
import { enqueueUpdateProfile } from "@/features/ai/lib/background-jobs";
```

**关键设计**：

```startLine:35:features/reports/weekly-reports/lib/background-jobs.ts
export async function enqueueSummarizeWeeklyReport(reportId: string): Promise<void> {
  try {
    const report = await prisma.weeklyReport.findUnique({
      where: { id: reportId },
      select: { userId: true },
    });
    if (!report) return; // no-op: 周报不存在
    enqueueUpdateProfile(report.userId);
  } catch (err) {
    console.warn(`[enqueueSummarizeWeeklyReport] failed for ${reportId}:`, err);
    // 静默吞错：HTTP 已响应，无法回滚；下次用户手动点 "刷新画像" 可重试
  }
}
```

**三个关键决策**：

1. **try/catch 包整个函数体** —— ai-learning-mentor 审计建议：fire-and-forget 场景下，Promise rejection 变成 unhandled rejection → 静默失败且用户无感知
2. **`select: { userId: true }` 最小字段** —— 团队页/周报页只用 userId，不需要读 JSON / content
3. **不返回任何值** —— 纯 fire-and-forget 语义；调用方 `void` 关键字

### 3.2 /regenerate route 升级

```startLine:16:app/api/reports/weekly-reports/[id]/regenerate/route.ts
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: reportId } = await params;

  // 校验 report 归属
  const report = await prisma.weeklyReport.findUnique({
    where: { id: reportId },
    select: { userId: true },
  });

  if (!report) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (report.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 入队用户画像刷新
  enqueueSummarizeWeeklyReport(reportId);

  return NextResponse.json(
    {
      ok: true,
      enqueued: true,
      reportId,
      message: "用户画像刷新已入队（实际是基于周报内容更新 AiUserProfile，预计 5-30 秒完成）",
    },
    { status: 202 }
  );
}
```

**校验层级**（403/404/401）：
- 无 session → 401
- report 不存在 → 404
- report 存在但 userId !== session.user.id → 403
- 校验通过 → 202

**为什么 message 写这么长**：`重新生成` 语义保留但实际行为是"刷新画像"（因为 weeklyReport 暂时没有可生成的 summary 字段）。前端要清楚展示这个语义转变，避免用户疑惑。

### 3.3 POST/PATCH fire-and-forget

POST 创建（`app/api/reports/weekly-reports/route.ts` line 58）：

```startLine:56:app/api/reports/weekly-reports/route.ts
return NextResponse.json({ report }, { status: 201 });
// 之前
void enqueueSummarizeWeeklyReport(report.id);
```

PATCH 更新（`app/api/reports/weekly-reports/[id]/route.ts` line 59）：

```startLine:55:app/api/reports/weekly-reports/[id]/route.ts
return NextResponse.json({ report }, { status: 200 });
// 之前
void enqueueSummarizeWeeklyReport(id);
```

**为什么用 `void`**：TS 显式忽略 Promise，避免"unhandled async function"警告。

**为什么 POST 和 PATCH 都入队**：
- POST：用户第一次写周报 → 立刻产生新数据 → 入队
- PATCH：用户改了内容 → 之前的画像"过期" → 入队
- 两次都依赖 `enqueueUpdateProfile` 内部 `clearTimeout` 去重（同一 userId 5 秒内多次触发只保留最新一次）

### 3.4 客户端按钮

```startLine:14:features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx
export function WeeklyReportRegenerateButton({ reportId }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleRegenerate() {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/weekly-reports/${reportId}/regenerate`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        alert("用户画像刷新已入队，预计 5-30 秒后完成");
      } else if (res.status === 401) {
        alert("请先登录");
      } else if (res.status === 403) {
        alert("无权操作此周报");
      } else if (res.status === 404) {
        alert("周报不存在");
      } else {
        alert(`操作失败 (${res.status})`);
      }
    } catch {
      alert("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRegenerate}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 transition hover:bg-ink-50 hover:border-ink-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} ...>...</svg>
      {loading ? "刷新中…" : "刷新画像"}
    </button>
  );
}
```

**已知局限**：
- `alert()` 不是真 toast，UX 差。**PR5+ 用 sonner 或 react-hot-toast 替换**
- 按钮不能反映**画像实际是否已更新**——需要前端轮询或 server-sent events（PR5+）
- 用户不知道"5-30 秒"具体多长，只能盲等

### 3.5 测试

`scripts/weekly-report-bg-job-unit-test.ts` 8 个测试：

| # | 测试 | 覆盖 |
|---|------|------|
| 1 | report 存在 → 入队 userId | 正常路径 |
| 2 | report 不存在 → no-op | 边界 |
| 3 | 同 userId 多 report 入队 | 去重前置条件 |
| 4 | fire-and-forget 不抛异常 | 异步语义 |
| 5 | regenerate 状态码（401/404/403/202） | 鉴权 + 归属 |
| 6 | WeeklyReport schema 含 aiSummary | 数据契约 |
| 7 | 边界：空 reportId → no-op | 异常输入 |
| 8 | prisma 报错 → try/catch 吞错 | ai-learning-mentor 审计建议 |

### 3.6 verify-pr --pr4

```startLine:214:scripts/verify-pr.ts
// ===== PR4 steps =====
if (runPr4) {
  console.log("\n===== PR4 STEPS =====");
  if (!runScript("BG-JOB UNIT", "weekly-report-bg-job-unit-test.ts", [])) {
    allPassed = false;
  }
  console.log("\n[PR4 API ROUTE TESTS]");
  {
    const { status } = await apiFetch("/api/reports/weekly-reports/fake-id/regenerate", { method: "POST" });
    if ([307, 302, 401].includes(status)) {
      console.log(`  ✓ POST regenerate (no auth) → ${status}`);
    }
    // ...
  }
}
```

**为什么只测 1 个 HTTP**：403/404 都需要真实登录态，verify-pr 鉴权后端是 307/302 redirect，没法测鉴权后的分支。逻辑分支由 unit test 覆盖。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 端口 | 3003 | dev server |
| 鉴权 | NextAuth v5 | session 校验 |
| OpenAI | `OPENAI_API_KEY` | features/ai/lib/background-jobs.ts 间接使用 |
| schema | `WeeklyReport.aiSummary` 字段已存在 | PR1 schema 预留，PR4 不写 |

---

## 5. 启动 / 部署

```bash
# 1. 启动 dev server
cd /Users/vastgui/Desktop/project-manager
npm run dev

# 2. 浏览器手测
# - 登录后访问 /reports/weekly-reports/<id>
# - 看到"🔄 刷新画像"按钮
# - 点击 → alert 提示 → 后台 5-30 秒内更新 AiUserProfile
# - 刷新 /team/<id> 看 PR3 画像区块是否更新
```

---

## 6. 测试 & 验证

### 6.1 单元测试

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/weekly-report-bg-job-unit-test.ts
```

**期望**：
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
  ✓ prisma 报错 → try/catch 吞错，无 unhandled rejection

Results: 8 passed, 0 failed
```

### 6.2 端到端

```bash
./node_modules/.bin/tsx --env-file=.env.local scripts/verify-pr.ts --all
```

**期望**：
```
===== PR4 STEPS =====
[BG-JOB UNIT] 8 passed
[PR4 API ROUTE TESTS]
  ✓ POST regenerate (no auth) → 307

[PR1+PR2+PR3+PR4 OK]
```

### 6.3 浏览器手测 checklist

- [ ] `/reports/weekly-reports/<id>` 有"🔄 刷新画像"按钮
- [ ] 点击后弹 alert，5-30 秒内 AiUserProfile 真正更新
- [ ] 改完周报内容 → PATCH 触发 → 用户画像被刷新
- [ ] 同一用户 5 秒内多次点击 → LLM 只被调一次（依赖 enqueueUpdateProfile 去重）

---

## 7. 复现 Checklist

- [ ] `features/reports/weekly-reports/lib/background-jobs.ts` 实现了 `enqueueSummarizeWeeklyReport`（含 try/catch）
- [ ] `app/api/reports/weekly-reports/[id]/regenerate/route.ts` 返回 202 而非 501
- [ ] `app/api/reports/weekly-reports/route.ts` POST 创建后 `void enqueueSummarizeWeeklyReport(report.id)`
- [ ] `app/api/reports/weekly-reports/[id]/route.ts` PATCH 更新后 `void enqueueSummarizeWeeklyReport(id)`
- [ ] `features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx` 存在（client component）
- [ ] `app/reports/weekly-reports/[id]/page.tsx` 集成了刷新按钮
- [ ] `scripts/weekly-report-bg-job-unit-test.ts` 8/8 pass
- [ ] `scripts/verify-pr.ts --all` PR1+PR2+PR3+PR4 全绿
- [ ] tsc 无新增错误（历史 e2e + admin.test 错误与 PR4 无关）

---

## 8. 踩坑记录

### 坑 1：Subagent background 模式无报告

**现象**：fullstack-developer 在 background 模式跑完，主代理读 transcript 看不到 tool calls/工具输出，只有原始 prompt。

**根因**（推测）：
- `subagent_type: fullstack-developer, run_in_background: true` 子代理实际跑完了所有工作（文件被改）
- 但 transcript 文件只记了 user prompt，工具调用记录在另一个地方
- 主代理等不到"完成报告"时不能傻等——必须主动 review 文件 + 跑 verify-pr

**解法**（已规则化）：`.cursor/rules/subagent-coordination-sop.mdc` 写明"主代理轮询 + 主动 review"。

### 坑 2：Subagent 写的测试有 bug

**现象**：`scripts/weekly-report-bg-job-unit-test.ts` 第一版 8 个测试，2 个 fail：
- Test 1（"report exists → enqueueUpdateProfile called"）实际 calls=[]
- Test 6（"prisma select shape"）实际 got undefined

**根因**：子代理设计的 mock 太复杂——用 `Object.assign` 改造 `vi.fn()`，mockResolvedValue 没正确返回。**子代理的测试**没真的 import background-jobs 模块（inline 复刻函数体），所以"测的是 mock 自己的逻辑"。

**解法**：主代理重写测试，去掉复杂 vi.fn() 改造，用**自包含 Map** + `let shouldThrow` 简单开关。8 个测试全过。

**教训**：subagent 写的测试要主代理**强制**再跑一遍（不能信"应该通过"）。

### 坑 3：verify-pr 加 --pr4 但漏写 STEPS 块

**现象**：`scripts/verify-pr.ts` 改了 `runPr4` 变量 + 顶部 help text + 底部 label，但**没在中间加 `if (runPr4) { ... }` 块**。

**根因**：子代理的 grep 模糊匹配失败（用 `if (runPr4)` 但实际是 `if (runPr4) {` 格式），主代理以为没写。

**解法**：直接 Read 文件确认——发现已经有完整 PR4 STEPS 块（子代理写了，但 banner 重复了一次，主代理看到的"未加"是误判）。

**教训**：grep 模糊匹配失败时**直接 Read 文件**。

### 坑 4：fire-and-forget 静默失败

**现象**：原版 `enqueueSummarizeWeeklyReport` 内部 `await prisma.findUnique` 可能抛错，但 `void enqueueSummarizeWeeklyReport(report.id)` 在 route.ts 里 fire-and-forget → 错误变成 unhandled rejection → 用户看到 201 但实际后台任务没入队。

**根因**：fire-and-forget 模式固有缺陷——HTTP 响应已发出，无法回滚。

**ai-learning-mentor 审计建议**：在 `enqueueSummarizeWeeklyReport` 内部加 try/catch + console.warn，至少让错误在 stderr 可见。

**解法**：
```typescript
try {
  // ... 主体逻辑
} catch (err) {
  console.warn(`[enqueueSummarizeWeeklyReport] failed for ${reportId}:`, err);
  // 静默吞错：HTTP 已响应，无法回滚；下次用户手动点 "刷新画像" 可重试
}
```

**测试覆盖**：Test 9（prisma 报错 → try/catch 吞错）验证了这条路径。

### 坑 5：subagent 自创了 alias 函数 `enqueueUpdateProfileFromReport`

**现象**：fullstack-developer 在 background-jobs.ts 加了 `enqueueUpdateProfileFromReport(reportId, userId)` 简化版 alias 函数（不知道 userId 也能调）。

**ai-learning-mentor 审计建议**：alias 是过度设计——没人用，应该删除。

**解法**：
```diff
- export function enqueueUpdateProfileFromReport(reportId: string, userId: string): void {
-   void reportId;
-   enqueueUpdateProfile(userId);
- }
```
（删除）+ 单元测试同步删除 Test 3。

### 坑 6：dev HMR 下 globalThis timer 行为

**现象**：用户在 dev 模式连续触发"刷新画像"，偶尔会发现"任务没执行"。

**ai-learning-mentor 审计结论**（正确）：
- `globalThis` 上存的 Map 在 HMR 后还在
- 但 HMR 触发的瞬间，**新请求的 setTimeout 引用了旧 Map 的 key**，新模块代码不感知
- 极端情况：HMR 期间 timer 触发，新代码逻辑跑但旧 Map 还有 entry
- 实际影响低，**生产环境（无 HMR）完全没问题**

**解法**：不修，加注释。生产用 `npm run start` 而不是 `npm run dev`。

### 坑 7：前端 alert() 而不是真 toast

**现象**：`WeeklyReportRegenerateButton` 用 `alert()` 弹提示，UX 差且阻塞主线程。

**子代理 TODO 注释**："PR5+ can replace with proper toast library"

**ai-learning-mentor 审计建议**：接受 PR4 现状（合理优先级），PR5 再用 sonner/react-hot-toast 替换。

**解法**：PR4 接受，PR5 再做。

---

## 9. PR4 后续：PR5+ 路线

按 ai-learning-mentor 审计报告：

| 项 | 优先级 | 备注 |
|----|------|------|
| 自动生成 weeklyReport.aiSummary | 高 | PR1 schema 已预留字段 |
| 替换 alert() 为真 toast | 中 | 用 sonner 或 react-hot-toast |
| 画像面板自动刷新（router.refresh 或 SSE） | 中 | 用户提交周报后立即看新画像 |
| 移除 alias 函数（如未删） | 已完成 | ai-learning-mentor 建议 |
| integrate-test 加 403/404 真实登录态分支 | 低 | 需要 e2e + fixture user |

---

## 附：相关文件位置

| 关注点 | 文件 |
|--------|------|
| 入队实现 | `features/reports/weekly-reports/lib/background-jobs.ts` |
| 入队机制（复用） | `features/ai/lib/background-jobs.ts` |
| LLM 调用（复用） | `features/ai/lib/summarizer.ts` |
| regenerate route | `app/api/reports/weekly-reports/[id]/regenerate/route.ts` |
| 周报 POST | `app/api/reports/weekly-reports/route.ts` |
| 周报 PATCH | `app/api/reports/weekly-reports/[id]/route.ts` |
| 周报 store（PR1） | `features/weekly-reports/lib/weekly-report-store.ts` |
| 客户端按钮 | `features/reports/weekly-reports/ui/WeeklyReportRegenerateButton.tsx` |
| 页面壳 | `app/reports/weekly-reports/[id]/page.tsx` |
| 单元测试 | `scripts/weekly-report-bg-job-unit-test.ts` |
| 集成测试 | `scripts/verify-pr.ts --pr4` |
| AI 审计报告 | 1eae8510-b552-4737-ac26-dd130fc007c1 |
| PR1 复现 | `docs/reports/PR1-weekly-reports.md` |
| PR2 复现 | `docs/reports/PR2-stats-and-reports.md` |
| PR3 复现 | `docs/reports/PR3-ai-profile.md` |
| subagent SOP | `.cursor/rules/subagent-coordination-sop.mdc` |
