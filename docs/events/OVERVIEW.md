# 事件追踪（Event Backbone）开发到测试复现手册

> 适用：`project-manager` 仓库（Next.js 15 App Router + Prisma + NextAuth）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"Dashboard 最近/经常 + 入站 page.view 埋点"的端到端链路。
>
> 文档面向：**未来自己 + 团队新人**（既要快速回忆，也要解释清楚设计意图）。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

| 旧现象 | 业务影响 |
|---|---|
| Dashboard 的"最近 / 经常"卡片完全靠硬编码 placeholder，新用户登录看到一片空白 | 用户找不到自己昨天还在追的项目 / 工单，体验断档 |
| 项目详情 / 工单 / 笔记页面没有任何访问记录 | 团队 Leader 想看"哪些工单最近最热"无数据可查 |
| `ActivityLog` 表的 `dwellMs` 字段信任前端上报，存在恶意前端可以虚报"我看了 999 秒" | 后续做"热门内容"排行时会污染数据 |
| Tier 1（page.view）和 Tier 3（ticket.* / note.* / admin.*）事件混在同一个枚举里，没有任何路由控制 | Tier 3 已经有独立的 `ModerationLog` / `Notification` 系统，再写一遍就是双写 + 不一致 |

### 1.2 结论

1. **客户端**：`shared/lib/visits-context.tsx` 在 localStorage 维护"最近 20 条 + 计数"，通过 `scheduleRecord`（停留 5s 才计次）/ `recordImmediate`（立即写入不计次）两个 API 暴露。
2. **后端**：`POST /api/events` 接 `page.view` 事件，**后端**用 `computeDwellMetrics` 计算 `dwellMs` 和 `isValidView`（dwellMs > 3000ms 才是有效访问），写入 `pm.ActivityLog`。
3. **Dashboard**：`useRecentVisits()` / `useFrequentVisits()` 两个 hook 直接消费 localStorage 数据，**完全不走后端**（首屏零请求）。
4. **路由白名单**：用 `isRoutableAction` 拒绝 Tier 3 事件，避免双写。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|---|---|---|
| `shared/lib/events/ACTION.ts` | 新增 | 事件动作枚举（v1.0）+ Tier 1/2/3 分类标注 |
| `shared/lib/events/types.ts` | 新增 | `RawEvent`（前端上报） / `StoredEvent`（后端落库） |
| `shared/lib/events/compute.ts` | 新增 | 后端计算 `dwellMs` / `isValidView`，阈值 3000ms |
| `shared/lib/events/router.ts` | 新增 | 事件分类（behavior/business/audit）+ 路由白名单 |
| `shared/lib/events/track.ts` | 新增 | `trackEvent`（普通 fetch + keepalive） / `trackEventBeacon`（页面卸载兜底） |
| `shared/lib/visits-context.tsx` | 新增 | VisitsProvider + `useRecentVisits` / `useFrequentVisits` 两个 hook |
| `app/api/events/route.ts` | 新增 | Event Gateway 入口（POST /api/events） |
| `prisma/schema.prisma` | 修改 | 新增 `pm.ActivityLog` 模型（含 `@@index` 优化） |
| `app/pkm/notes/[id]/NoteDetailRecord.tsx` | 新增 | 笔记详情页埋点容器（调 `scheduleRecord`） |
| `app/tickets/[ticketId]/TicketDetailClient.tsx` | 修改 | 工单详情页加 `scheduleRecord` |
| `app/dispatchTicket/tickets/[ticketId]/DispatchTicketDetailHeader.tsx` | 修改 | 派单工单详情加 `scheduleRecord` |
| `features/project/ui/ProjectDetail.tsx` | 修改 | 项目详情 tab 切换 + mount 时 `scheduleRecord` |
| `features/dispatch/ui/DispatchProjectDetail.tsx` | 修改 | 派单项目详情加 `scheduleRecord` |
| `features/knowledge/ui/KnowledgeSearchResults.tsx` | 修改 | 搜索结果 commit 点击立即写 `recordImmediate` |
| `app/knowledge/KnowledgeRecentNoteLink.tsx` | 新增 | `/knowledge` 最近更新列表 onClick 兜底 `recordImmediate` |
| `features/dashboard/Dashboard.tsx` | 修改 | 接入 `useRecentVisits` / `useFrequentVisits`，渲染两个 tab |
| `shared/ui/AppShell.tsx` | 修改 | AppShell 包一层 `<VisitsProvider>` 让全站可消费 |
| `shared/ui/headers/index.tsx` | 修改 | Header 接入 hook（侧栏"最近访问"） |

---

## 3. 核心实现

### 3.1 ACTION 枚举（`shared/lib/events/ACTION.ts`）

```1:40:shared/lib/events/ACTION.ts
export const EVENT_VERSION = "1.0";

export const ACTION = {
  // === Tier 1 — 当前 phase 实现 ===
  PAGE_VIEW: "page.view",

  // === Tier 2 — RAG 问答阶段实现 ===
  SEARCH_QUERY: "search.query",
  SEARCH_RESULT_CLICK: "search.result_click",
  RAG_QUERY: "rag.query",
  RAG_FEEDBACK: "rag.feedback",

  // === Tier 3 — 通知/审计（已有独立系统，暂不路由） ===
  TICKET_CREATE: "ticket.create",
  TICKET_STATUS_CHANGE: "ticket.status_change",
  TICKET_ASSIGN: "ticket.assign",
  ...
} as const;
```

**为什么这样写**：
- `as const` 让所有 action 变成字符串字面量类型，后续 `ActionValue` 可以做穷举校验。
- Tier 3 的枚举**也定义在这里**（不另开文件），目的是后续阶段直接复用名字、同时通过 `isRoutableAction` 拦截，避免误用。

### 3.2 后端 dwell 计算（`shared/lib/events/compute.ts`）

```1:37:shared/lib/events/compute.ts
/** 有效停留阈值（毫秒）：超过此值的 page.view 计为有效访问 */
export const VALID_VIEW_THRESHOLD_MS = 3000;

export function computeDwellMetrics(
  action: string,
  context: Record<string, unknown> | undefined
): ComputedFields {
  if (action !== ACTION.PAGE_VIEW || !context) {
    return { dwellMs: null, isValidView: false };
  }

  const raw = context.dwellMs;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    return { dwellMs: null, isValidView: false };
  }

  const dwellMs = Math.floor(raw);
  return {
    dwellMs,
    isValidView: dwellMs > VALID_VIEW_THRESHOLD_MS,
  };
}
```

**为什么这样写**：
- **后端是 dwellMs / isValidView 的唯一计算者**，前端只能报"原始停留毫秒数"，不能直接报"isValidView=true"。否则攻击者改前端就能污染统计。
- `Number.isFinite(raw) && raw >= 0` 防御性检查：JSON 解析后类型可能不符。
- 非 `page.view` 事件直接返回 `null / false`，行为统一。

### 3.3 路由白名单（`shared/lib/events/router.ts`）

```33:44:shared/lib/events/router.ts
export function isRoutableAction(action: string): action is ActionValue {
  return (Object.values(ACTION) as string[]).includes(action)
    && !action.startsWith("ticket.")
    && !action.startsWith("project.")
    && !action.startsWith("note.")
    && !action.startsWith("admin.");
}
```

**为什么这样写**：
- Tier 3 事件由 `ModerationLog` / `Notification` 系统承担，Event Gateway 拒绝接收，避免双写不一致。
- type predicate `action is ActionValue` 让调用方拿到字面量类型，TypeScript 友好。

### 3.4 前端 SDK（`shared/lib/events/track.ts`）

```25:49:shared/lib/events/track.ts
export function trackEventBeacon(event: Omit<RawEvent, "eventVersion">) {
  const fullEvent: RawEvent = {
    eventVersion: EVENT_VERSION,
    ...event,
  };

  const payload = JSON.stringify(fullEvent);
  const blob = new Blob([payload], { type: "application/json" });

  // sendBeacon 失败（false）时 fallback 到 keepalive fetch
  if (!navigator.sendBeacon?.("/api/events", blob)) {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}
```

**为什么这样写**：
- 页面卸载场景用 `sendBeacon` 才能保证请求发出去；普通场景用 `keepalive: true` 的 fetch 也兼容。
- `sendBeacon` 返回 boolean（true/false），**不能用 `??` 触发 fallback**，必须显式 `if (!...)`。
- `.catch(() => {})` 静默吞掉失败：事件统计不能阻断主业务。

### 3.5 visits-context 核心逻辑（`shared/lib/visits-context.tsx`）

```160:208:shared/lib/visits-context.tsx
const _recordWithCount = useCallback(
  (v: RecordInput, dwellMs: number) => {
    const key = deduplicateKey(v);
    setCounts((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
    recordImmediate(v);

    const enterAt = Date.now() - dwellMs;
    const leaveAt = Date.now();
    trackEventBeacon({
      action: ACTION.PAGE_VIEW,
      targetType: v.tabKey,
      targetId: v.ticketId ?? v.projectId,
      targetName: v.ticketTitle ?? v.projectName,
      context: { dwellMs, enterAt, leaveAt },
    });
  },
  [recordImmediate]
);

const scheduleRecord = useCallback(
  (v: RecordInput, delayMs: number = DEFAULT_DWELL_MS) => {
    const key = deduplicateKey(v);
    if (pendingKeyRef.current === key) return;  // 相同 key 不重复开 timer
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);     // 快速切换不留下历史噪声
    }
    pendingKeyRef.current = key;
    pendingTimerRef.current = setTimeout(() => {
      pendingTimerRef.current = null;
      pendingKeyRef.current = "";
      _recordWithCount(v, delayMs);
    }, delayMs);
  },
  [_recordWithCount]
);
```

**为什么这样写**（重点）：
1. **埋点时机选在 timer 触发瞬间**：用户已真实停留 `delayMs`，是"有效访问"的精确信号；不是 onMount、不是路由变化。
2. **dwellMs 用实际 `delayMs`**：传啥用啥，调用者可控；后端用同一阈值判定 `isValidView`。
3. **去重策略**：相同 key 重复 `scheduleRecord` 不重新开 timer（避免父子组件同时 mount 计次翻倍）；不同 key 调度会 clear 上一个 timer（避免快速切 tab 留下脏数据）。
4. **详情页优先**：`recordImmediate` 对 `tabKey in {note, ticket}` 的子级页面，会把同 `projectId` 下所有非子级记录整体移除，让详情直接占据顶部（解决"打开工单详情被旧概览顶下去"的体验问题）。

### 3.6 Event Gateway 入口（`app/api/events/route.ts`）

```19:60:app/api/events/route.ts
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = (await request.json()) as RawEvent;

    if (!body.action?.trim()) {
      return NextResponse.json({ error: "action required" }, { status: 400 });
    }

    if (!isRoutableAction(body.action)) {
      return NextResponse.json({ error: "action not routable" }, { status: 400 });
    }

    routeEvent(body.action);

    const { dwellMs, isValidView } = computeDwellMetrics(body.action, body.context);

    await prisma.activityLog.create({
      data: {
        eventVersion: EVENT_VERSION,
        action: body.action.trim(),
        actorId: session.user.id,
        actorName: session.user.name ?? session.user.email ?? "未知",
        targetType: body.targetType ?? null,
        targetId: body.targetId ?? null,
        targetName: body.targetName ?? null,
        sessionId: body.sessionId ?? null,
        context: (body.context ?? {}) as object,
        dwellMs,
        isValidView,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[events] POST error:", error);
    return NextResponse.json({ ok: true });  // 静默失败
  }
}
```

**为什么这样写**：
- `requireSession()` 保证 actorId 来自服务端 session，前端无法伪造。
- Tier 3 事件 → `400 action not routable`，前端 SDK 上报错也会被吞，不影响业务。
- `catch` 块**也返回 `{ ok: true }`**：事件统计失败不能让前端走错误分支。

### 3.7 ActivityLog 模型（`prisma/schema.prisma`）

```465:504:prisma/schema.prisma
model ActivityLog {
  id           String   @id @default(cuid())

  eventVersion String   @default("1.0")
  action       String  // 冗余存储而非外键：避免枚举变更牵连历史

  actorId      String
  actorName    String?

  targetType   String?
  targetId     String?
  targetName   String?

  sessionId    String?

  context      Json?  // 原始上下文

  dwellMs      Int?  // 后端计算
  isValidView  Boolean?

  createdAt    DateTime @default(now())

  @@index([action, createdAt(sort: Desc)])
  @@index([actorId, createdAt(sort: Desc)])
  @@index([targetType, targetId, createdAt(sort: Desc)])
  @@index([targetType, isValidView, createdAt(sort: Desc)])
  @@schema("pm")
}
```

**为什么这样写**：
- `action` 用 String 不用 enum：枚举扩展不影响老数据（这是事件流的特性，向前兼容比类型严格更重要）。
- 4 个 `@@index` 覆盖主要查询模式：按 action / 按用户 / 按 target / 按"有效访问统计"。
- 全部字段都允许 null：非 page.view 事件的 dwellMs / isValidView 是 null，schema 不强制。

---

## 4. 环境与配置

| 项 | 值 | 说明 |
|---|---|---|
| 数据库 schema | `pm` | ActivityLog 在 `pm` schema 下 |
| 表名 | `pm.ActivityLog` | 需 `prisma migrate dev` 后才会出现 |
| 端口 | 3003 | Next.js dev server |
| Session | NextAuth | `requireSession()` 必须能拿到 user |
| 客户端存储 | `localStorage.pm:recent-visits` | VisitsContext 的 storage key |

无新增 env 变量；不依赖外部服务（埋点完全在 Next.js 进程内完成）。

---

## 5. 启动 / 部署

```bash
# 1. 切到项目根目录
cd /Users/vastgui/Desktop/project-manager

# 2. 应用 schema 变更（首次部署需要）
npx prisma migrate dev --schema=prisma/schema.prisma --name add_activity_log
npx prisma generate

# 3. 启动开发服务
npm run dev   # 默认 3003 端口

# 4. 浏览器登录任意账号，访问 /dashboard
#    - 打开任意项目详情、工单详情、笔记详情，停留 5 秒以上
#    - 返回 /dashboard，应该看到"最近 / 经常"卡片有新记录

# 5. 确认 ActivityLog 表有数据
psql "$DATABASE_URL" -c "SELECT action, \"actorName\", \"targetName\", \"dwellMs\", \"isValidView\", \"createdAt\" FROM pm.\"ActivityLog\" ORDER BY \"createdAt\" DESC LIMIT 10;"
```

---

## 6. 测试 & 验证

### 6.1 单元 / 脚本验证

```bash
# 1. 计算函数（纯函数，可直接 node 验证）
cd /Users/vastgui/Desktop/project-manager
npx tsx -e "
import { computeDwellMetrics } from './shared/lib/events/compute';
console.log(computeDwellMetrics('page.view', { dwellMs: 5000 }));   // { dwellMs: 5000, isValidView: true }
console.log(computeDwellMetrics('page.view', { dwellMs: 1500 }));   // { dwellMs: 1500, isValidView: false }
console.log(computeDwellMetrics('page.view', { dwellMs: -1 }));     // { dwellMs: null, isValidView: false }
console.log(computeDwellMetrics('search.query', { dwellMs: 9999 }));// { dwellMs: null, isValidView: false }
"
```

**期望输出**：
```
{ dwellMs: 5000, isValidView: true }
{ dwellMs: 1500, isValidView: false }
{ dwellMs: null, isValidView: false }
{ dwellMs: null, isValidView: false }
```

```bash
# 2. 白名单拒绝 Tier 3 事件
npx tsx -e "
import { isRoutableAction } from './shared/lib/events/router';
console.log(isRoutableAction('page.view'));        // true
console.log(isRoutableAction('search.query'));     // true
console.log(isRoutableAction('ticket.create'));    // false
console.log(isRoutableAction('admin.ban_user'));   // false
"
```

**期望输出**：
```
true
true
false
false
```

### 6.2 端到端验证

```bash
# 1. 浏览器登录 → DevTools → Application → Local Storage → http://localhost:3003
#    找到 pm:recent-visits，结构应为:
#    { "visits": [...], "counts": { "projectId|tabKey|ticketId": 次数 } }

# 2. 数据库验证：停留超过 5 秒的页面应该产生 isValidView=true 的记录
psql "$DATABASE_URL" -c "
SELECT action, \"actorName\", \"targetName\", \"dwellMs\", \"isValidView\"
FROM pm.\"ActivityLog\"
WHERE \"isValidView\" = true
ORDER BY \"createdAt\" DESC LIMIT 5;
"
```

**期望**：
- 至少能看到 1 条 `page.view` 且 `isValidView=t`、`dwellMs > 3000` 的记录。
- `targetName` 对应你刚才停留超过 5 秒的工单 / 笔记 / 项目标题。

### 6.3 Dashboard UI 验证

- [ ] `/dashboard` 页面右上角卡片，"最近" tab 显示最近 4 条访问
- [ ] 切换"经常" tab，按访问次数降序排列，次数徽章为琥珀色
- [ ] 访问一次项目 → 切回 dashboard，"最近"第一项应是该项目
- [ ] 在项目里切 tab（概览/工单/知识）→ 同一项目出现多条 visit
- [ ] 打开工单详情 → 同项目之前的"概览"记录被替换（详情优先）

---

## 7. 复现 Checklist

- [ ] 已读 `shared/lib/events/ACTION.ts`，理解 Tier 1/2/3 分层
- [ ] 已读 `shared/lib/events/compute.ts`，理解后端为何是 dwellMs 唯一计算者
- [ ] 已读 `shared/lib/events/router.ts`，理解 `isRoutableAction` 拒绝 Tier 3 的意义
- [ ] 已读 `shared/lib/events/track.ts`，理解 sendBeacon fallback 的坑
- [ ] 已读 `shared/lib/visits-context.tsx`，理解 scheduleRecord / recordImmediate 的区别
- [ ] 已读 `app/api/events/route.ts`，理解为什么 catch 块也返回 ok
- [ ] 已应用 `prisma migrate dev` 看到 `pm.ActivityLog` 表
- [ ] 浏览器停留某页超过 5 秒 → DB 出现 `isValidView=t` 记录
- [ ] Dashboard 卡片显示"最近/经常"切换正常
- [ ] 详情页打开后，原"项目概览"记录被移除（子级优先）

---

## 8. 踩坑记录

### 坑 1：`sendBeacon` 返回 boolean，`??` 触发不了 fallback

**现象**：在 Chrome 上发请求偶尔丢失，`console` 报 `true/false`，看起来"成功"，但 `/api/events` 没收到。
**原因**：`navigator.sendBeacon(...)` 返回 boolean（true=已加入发送队列，false=队列满丢弃），用 `?? fallback` 永远命中 `true`，永远不会走 `fetch` 兜底。
**解法**：必须显式 `if (!navigator.sendBeacon(...))` 判断失败才走 fetch。详见 `shared/lib/events/track.ts:41`。

### 坑 2：`dwellMs` 信任前端会被攻击

**现象**：第一版让前端直接报 `{ dwellMs: 5000, isValidView: true }`，写完觉得简单。
**原因**：任何用户改前端请求体就能虚报停留时长，后续做"热门内容"排行会被污染。
**解法**：前端只报原始 `dwellMs` 数字 + `enterAt` / `leaveAt` 时间戳；后端 `computeDwellMetrics` 才是 `isValidView` 的唯一计算者，且阈值统一从 `VALID_VIEW_THRESHOLD_MS = 3000` 读取。

### 坑 3：父子组件同时 mount 导致计数翻倍

**现象**：用户反馈"我明明只看了一次，'经常'显示 2 次"。
**原因**：`ProjectDetail` 和 `TicketDetailClient` 都在 mount 时调 `scheduleRecord`，React 18 严格模式下 effect 跑两次，timer 触发了两次。
**解法**：`scheduleRecord` 用 `pendingKeyRef` 去重：相同 `key` 重复调度不开新 timer。详见 `shared/lib/visits-context.tsx:196`。

### 坑 4：详情页被旧概览记录顶下去

**现象**：打开工单详情后，"最近"列表工单不在第一位，被项目概览压着。
**原因**：`recordImmediate` 默认按 `visitedAt` 排序，详情页进入时刻虽更新 visitedAt，但被前面残留的同项目概览记录遮住视觉。
**解法**：`recordImmediate` 检测到 `tabKey in {note, ticket}` 时，把同 `projectId` 下所有**非子级**记录整体移除，让详情直接占据顶部。详见 `shared/lib/visits-context.tsx:141`。

### 坑 5：React 18 hydration 偶发 `onClick` 不触发

**现象**：`/knowledge` 页面的笔记链接偶尔不写入 visits。
**原因**：服务端渲染的 `<a>` 标签 + React 18 异步 hydration，目标页 `NoteDetailRecord` 的 `useEffect` 偶尔没跑到。
**解法**：在 `KnowledgeRecentNoteLink` 的 `onClick` 里主动调一次 `recordImmediate` 兜底。详见 `app/knowledge/KnowledgeRecentNoteLink.tsx:27`。

### 坑 6：Tier 3 事件想接入 Event Gateway 被拒

**现象**：想在 `ticket.create` 时也发一条 `page.view` 风格的统计事件，发现 400。
**原因**：设计上 Tier 3 事件由独立的 `ModerationLog` / `Notification` 系统承担，Event Gateway 显式拒绝（避免双写）。
**解法**：不要尝试绕过白名单。需要新事件类型时，先在 `ACTION` 加枚举 + 更新 `isRoutableAction`，并明确该事件的存储归宿（写入哪张表）。

### 坑 7：Event Gateway catch 块返回 500

**现象**：第一次写 `catch (e) { return NextResponse.json({ error }, { status: 500 }) }`，发现前端 SDK 会报错且整条业务请求链路受影响。
**原因**：埋点失败 ≠ 业务失败，前端 SDK 用了 `.catch(() => {})` 但上层框架（SWR）看到 5xx 会重试。
**解法**：`catch` 块也 `return { ok: true }`，埋点 100% 静默。详见 `app/api/events/route.ts:59`。

---

## 9. 相关文件清单（速查表）

```
shared/lib/events/
├── ACTION.ts       # 动作枚举 + Tier 标注
├── types.ts        # RawEvent / StoredEvent
├── compute.ts      # 后端 dwellMs / isValidView 计算
├── router.ts       # 分类 + 路由白名单
└── track.ts        # 前端 SDK（fetch + sendBeacon）

shared/lib/
└── visits-context.tsx   # VisitsProvider + 两个 hook

app/api/events/
└── route.ts        # Event Gateway

prisma/schema.prisma     # ActivityLog 模型

features/dashboard/Dashboard.tsx          # 消费最近/经常
features/project/ui/ProjectDetail.tsx     # 项目详情埋点
app/tickets/[ticketId]/TicketDetailClient.tsx
app/dispatchTicket/tickets/[ticketId]/DispatchTicketDetailHeader.tsx
app/pkm/notes/[id]/NoteDetailRecord.tsx
features/dispatch/ui/DispatchProjectDetail.tsx
features/knowledge/ui/KnowledgeSearchResults.tsx
app/knowledge/KnowledgeRecentNoteLink.tsx
```
