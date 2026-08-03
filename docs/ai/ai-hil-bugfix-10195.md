# AI HIL Bugfix — queryTicket extractedUser + stale-pending guard

> 适用：project-manager 仓库（Next.js + Prisma + LangGraph）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**此次 AI HIL bug 修复过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

**Bug 1 — 用户过滤失效**

- 用户说"帮我查一下刘工的工单"，系统显示"找到 20 个工单"（全量），而不是刘工的工单
- 原因：`queryTicket` 只认识 `filters.userId`，不认识 `filters.extractedUser`；而 `search-structured.ts` 节点对"刘工"这类非自我引用传入的是 `extractedUser`

**Bug 2 — HIL 候选项选择被吞掉**

- AI 返回 20 个工单候选项，让用户选择；用户回复"0"（取消）或"1"（选择）
- 系统没有消费这个选择，反而把"0"当成新查询重新走一遍 `detectIntent → searchStructured → decision` 流程
- 同一条"0"消息被连续发送 6 次，陷入循环

### 1.2 修复结论

- Bug 1：`queryTicket` 新增 `extractedUser` 支持，调用 `resolveUser` 解析用户名后过滤工单
- Bug 2：stale-pending guard 判断逻辑修正——只有当 `pendingAction` 和 `resolvedEntities` 同时存在时才清理（说明确认已完成），否则保留有效 HIL 状态

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/core/queries/query-ticket.ts` | 修改 | 新增 `extractedUser` 和 `viewerUserId` 参数；调用 `resolveUser` 解析用户；多候选时返回消歧列表 |
| `features/ai/core/search-structured-core.ts` | 修改 | 调用 `queryTicket` 时传递 `viewerUserId` |
| `features/ai/core/context/context-builder.ts` | 修改 | stale-pending guard 修正：只有 `pendingAction && resolvedEntities` 同时存在时才清理 |
| `features/ai/core/queries/query-weekly-report.ts` | 参考 | `extractedUser` + `resolveUser` 的正确实现，本 bugfix 参照其模式 |

---

## 3. 核心实现

### 3.1 `queryTicket` 新增用户解析逻辑（`query-ticket.ts`）

```14:14:features/ai/core/queries/query-ticket.ts
import { resolveUser } from "@/features/ai/core/resolvers/user-resolver";
```

新增 `ExtractedUser` 类型引入，`viewerUserId` 参数接收调用方传来的 viewer ID。

```27:28:features/ai/core/queries/query-ticket.ts
  viewerUserId?: string;
```

接口新增两个可选字段：`filters.extractedUser` 和 `viewerUserId`。

```133:176:features/ai/core/queries/query-ticket.ts
  // 用户过滤：优先使用 extractedUser（包含 raw + normalized），其次使用 userId
  const extractedUser = filters?.extractedUser;
  const targetUserId = filters?.userId;

  // 如果有 extractedUser，通过 resolveUser 解析用户
  let resolvedUserId: string | null = null;
  if (extractedUser) {
    const resolved = await resolveUser(extractedUser, input.viewerUserId);
    if (resolved?.user) {
      resolvedUserId = resolved.user.id;
    } else if (resolved?.candidates && resolved.candidates.length > 0) {
      // 多个候选用户 → 返回消歧列表（与 queryWeeklyReport 一致）
      const userCandidates = resolved.candidates.map((u) => ({
        id: u.id,
        label: `${u.name ?? u.id}（${u.email}）`,
        summary: "",
      }));
      return {
        summary: `找到多个与"${extractedUser.raw}"相关的用户，请确认目标用户：\n${
          resolved.candidates.map((u, i) => `${i + 1}. ${u.name}（${u.email}）`).join("\n")
        }\n\n请输入数字或姓名确认。`,
        sources: [],
        attribution: {
          kind: "disambiguation" as const,
          entityType: "user" as const,
          candidates: userCandidates,
          count: resolved.candidates.length,
        },
        decision: {
          type: "human" as const,
          reason: `找到 ${resolved.candidates.length} 个匹配用户，需要人工确认`,
          entityType: "user",
          candidates: userCandidates,
        },
      };
    }
  } else if (targetUserId) {
    resolvedUserId = targetUserId;
  }

  // 应用用户过滤（指派给该用户的工单）
  if (resolvedUserId) {
    where.assignees = { some: { userId: resolvedUserId } };
  }
```

**为什么这样写**：参照 `queryWeeklyReport` 的实现模式——优先用 `extractedUser` 调用 `resolveUser`，多候选时走消歧流程；解析成功后把 userId 应用到 Prisma `where.assignees` 过滤条件。

### 3.2 `executeStructuredQuery` 传递 `viewerUserId`（`search-structured-core.ts`）

```78:79:features/ai/core/search-structured-core.ts
      case "ticket":
        result = await queryTicket({ id, filters, viewerUserId });
```

**为什么这样写**：之前漏传 `viewerUserId`，导致 `queryTicket` 内的 `resolveUser` 无法用 viewer ID 做自我引用兜底（"我的工单"场景）。

### 3.3 stale-pending guard 判断修正（`context-builder.ts`）

```92:99:features/ai/core/context/context-builder.ts
  const hasPendingAction =
    runtimeState.human?.pendingAction != null &&
    typeof runtimeState.human.pendingAction === "object" &&
    (runtimeState.human.pendingAction as { type?: string }).type != null;
  const hasResolvedEntity =
    runtimeState.human?.resolvedEntities != null &&
    typeof runtimeState.human.resolvedEntities === "object";
  const hasStalePending = hasPendingAction && hasResolvedEntity;
```

**为什么这样写**：原逻辑只检查 `pendingAction != null`，导致有效 HIL 流程中的候选项状态（用户看到候选、正要回复"0"）被误清。正确的"stale"信号是：`pendingAction` 存在**且** `resolvedEntities` 也存在（说明用户已在上一轮确认，`pendingAction` 应该被清理但没被清理）。`waitingNode` 字段不可用——LangGraph 节点从未设置它（grep 整个 `features/ai/graph/**` 返回 0 结果）。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| 端口 | 3003 | Next.js dev server |
| `DATABASE_URL` | PostgreSQL `pm` schema | Prisma 连接 |
| 核心依赖 | `@langchain/langgraph`, `prisma` | LangGraph 状态机 + Prisma ORM |

---

## 5. 启动 / 部署

```bash
# 1. 安装依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 启动开发服务器
npm run dev

# 3. 确认服务存活
curl -s http://localhost:3003/api/auth/session | head -c 100
```

---

## 6. 测试 & 验证

### 6.1 单元测试

```bash
cd /Users/vastgui/Desktop/project-manager
npx vitest run features/ai --reporter=verbose
```

**期望输出**：

```
✓ features/ai/core/queries/query-ticket.ts
✓ features/ai/core/context/context-builder.ts
✓ ...（所有 AI 相关测试通过）
```

### 6.2 端到端验证

**Bug 1 验证**：在 AI 聊天面板输入：

```
帮我查一下刘工的工单
```

**期望**：返回刘工的工单列表（不是全部 20 个）

**Bug 2 验证**：收到候选项后输入：

```
0
```

**期望**：正确消费取消选择，不再触发新的查询循环

---

## 7. 复现 Checklist

- [ ] 确认 `queryTicket` 导入了 `resolveUser`
- [ ] 确认 `queryTicket` 接口包含 `extractedUser` 和 `viewerUserId` 字段
- [ ] 确认 `executeStructuredQuery` 调用 `queryTicket` 时传递 `viewerUserId`
- [ ] 确认 stale-pending guard 判断条件为 `hasPendingAction && hasResolvedEntity`
- [ ] 确认 `features/ai/graph/**` 中没有对 `waitingNode` 的赋值
- [ ] 运行 `npx vitest run features/ai` 确认所有测试通过
- [ ] 启动 dev server（`npm run dev`）
- [ ] 浏览器打开 `http://localhost:3003/ai`
- [ ] 测试"刘工的工单"查询，确认返回过滤后的工单
- [ ] 测试候选项选择，确认选择被正确处理

---

## 8. 踩坑记录

### 坑 1：`queryTicket` 不知道 `extractedUser` 是什么

**现象**：

```
[AI-LangGraph] searchStructured type=ticket result summary len=22 sources count=0
[AI-LangGraph] searchStructured result length=6113, content={
  "summary": "找到 20 个工单，请选择想了解的具体工单：",
  ...
}
```

用户说"刘工的工单"，返回了全部 20 个工单而不是刘工的。

**原因**：`search-structured.ts` 节点对非自我引用传入 `filters.extractedUser`，但 `queryTicket` 的 `TicketQueryInput.filters` 只有 `userId`/`projectId`/`status`/`priority`/`activityWindow`，没有 `extractedUser` 字段。`extractedUser` 被传入后被完全忽略，等于没加任何用户过滤。

**解法**：参照 `queryWeeklyReport` 的实现，在 `queryTicket` 里添加 `extractedUser` 支持，先调用 `resolveUser` 解析用户 ID，再用解析结果构建 Prisma `where.assignees` 过滤条件。

### 坑 2：stale-pending guard 把有效的 HIL 状态清掉了

**现象**：

```
[AI-LangGraph] pendingState loaded: entityType=n/a candidates=0
[AI-LangGraph] runtimeState loaded: human=yes semantic.lastMentionedUser=刘工
[detectIntent] content="0"
[decision] ambiguous query candidates=6 query="0"
```

用户回复"0"时，`pendingState` 中的候选项丢失（`candidates=0`），"0"被当成新查询重新走完整流程。

**原因**：`context-builder.ts` 的 stale-pending guard 只检查 `pendingAction != null`，认为所有 pendingAction 都是 stale 并清理掉。但有效的 HIL 流程中（用户看到候选、正要回复"0"），`pendingAction` 本来就应该保留。注释里声称用 `waitingNode` 字段判断是否 stale，但 LangGraph 节点从未设置 `waitingNode`（grep 整个 `features/ai/graph/**` 返回 0 结果），所以这个字段永远是 null。

**解法**：修改判断逻辑——只有当 `pendingAction` **和** `resolvedEntities` 同时存在时才清理（说明用户已确认，`pendingAction` 是残留的）。去掉对 `waitingNode` 的依赖（该字段从未被使用）。

### 坑 3：`resolveUser` 里"刘工"解析失败的根因追溯

**现象**：`resolveUser` 对"刘工"返回了多个候选（姓刘的用户），但没有触发消歧。

**原因**：通过日志链路追踪发现，问题是坑 1 和坑 2 的叠加效应——即使 `resolveUser` 返回了有效 userId，`queryTicket` 也不认识这个字段，所以仍然返回全部 20 个工单。即使 `resolveUser` 返回了候选用户列表，`decision` 节点也没有正确处理，最终导致候选项状态丢失。

**解法**：先修坑 1（让 `queryTicket` 处理 `extractedUser`），再修坑 2（保留 HIL 状态）。两个 bug 必须同时修，否则单独修一个会导致部分场景 still broken。
