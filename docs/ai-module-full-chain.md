# AI 对话（小星）模块 — 端到端全链路复现手册

> 适用：`project-manager` 仓库（Next.js 15 + React 19 + Prisma + Agnes LLM）
> 目标：拿到这份文档 + 仓库 commit 后，能**完整复现**"小星 AI 对话"模块从打开 `/ai` 页面到 AI 流式回复的整条链路，包括 RAG 检索、对话持久化、后台摘要、用户画像更新。

---

## 1. 目标 & 背景

### 1.1 模块做什么

`小星` 是恒星研内部项目管理系统的 AI 助手，能：

- **回答日常问题**（项目咨询、通用对话、代码讨论）
- **检索知识库**（工单、提交记录、个人笔记 / PKM notes）→ 基于检索结果回答（RAG）
- **持久化对话历史**（每个会话都有标题、消息计数、最后一次消息时间）
- **后台自动摘要对话 + 累积用户画像**（对话越多，AI 对你越了解）

### 1.2 三大端到端场景

| 场景 | 用户操作 | 链路关键点 |
|------|----------|------------|
| **场景 A：开新对话** | 点"新对话" | 创建空 conv → typewriter 欢迎 → AI 主动打招呼 → 持久化问候 |
| **场景 B：发消息** | 输入文字 → Enter | RAG 检测 → 知识库检索 → Agnes 流式 LLM → 持久化 user/assistant 两条消息 → 后台摘要 |
| **场景 C：刷新 / 切回对话** | 点 sidebar 旧对话 | 加载 messages + profile → 渲染历史 → 看不到已删的消息 |

### 1.3 旧版 → 新版的关键升级

| 旧版问题 | 新版方案 |
|----------|----------|
| 新对话冷启动无内容 | typewriter 欢迎气泡 + AI 主动问候 |
| 一次性发到 LLM 的对话历史没有持久化 | 写库 `aiChatMessage`，消息计数 + 最后消息时间同步更新 |
| 摘要任务频繁触发，浪费 LLM 调用 | 15 分钟冷却窗口 + 失败重试 |
| 画像更新时把空 summary 也喂给 LLM，导致画像变 `{}` | 先过滤掉空 summary；若全空则 `deleteMany` 保留行让 UI 显示"暂无画像" |
| `recentTopics` 没拼进 prompt | 现在拼进 system prompt，AI 问候会参考 |

---

## 2. 改动清单

### 2.1 新增模块（untracked → 之后会 tracked）

| 文件 | 角色 |
|------|------|
| `app/api/ai/chat/route.ts` | **兼容旧 API**——前端不再用，保留以防外部脚本仍在 POST |
| `app/api/ai/conversations/route.ts` | GET 列表 / POST 新建对话 |
| `app/api/ai/conversations/[id]/route.ts` | GET 单个对话（含 messages）/ PATCH 重命名 / DELETE 删除 |
| `app/api/ai/conversations/[id]/messages/route.ts` | **主聊天端点**——发送消息 → SSE 流式回复 |
| `app/api/ai/conversations/[id]/greeting/route.ts` | AI 主动打招呼端点——新对话触发 |
| `app/api/ai/profile/route.ts` | GET 当前用户画像 |
| `app/ai/page.tsx` | Next.js 页面壳，组装 AppShell + AiChatPage |
| `features/ai/lib/types.ts` | AiMode 类型定义（`auto` / `search` / `chat`） |
| `features/ai/lib/detector.ts` | `shouldUseRag()`——基于关键字正则判断是否要 RAG |
| `features/ai/lib/rag.ts` | `retrieveContext` / `buildRagPrompt` / `extractSourceReferences` |
| `features/ai/lib/summarizer.ts` | `summarizeConversation` + `updateUserProfile`（两个 server actions） |
| `features/ai/lib/conversation-store.ts` | CRUD 封装：`createConversation` / `appendMessage` / `listConversations` 等 |
| `features/ai/lib/background-jobs.ts` | 异步队列：摘要 / 画像更新的 cooldown + retry |
| `features/ai/ui/AiChatPage.tsx` | 页面主组件：sidebar + chat panel + URL 同步 |
| `features/ai/ui/AiConversationSidebar.tsx` | 对话列表 + 重命名 / 删除 |
| `features/ai/ui/AiChatPanel.tsx` | **聊天主组件**：消息列表 + 输入框 + 流式打字机 |
| `features/ai/ui/AiChatInput.tsx` | 输入框组件 |
| `features/ai/ui/AiMessageBubble.tsx` | 单条气泡 + 自带打字机动画（基于 SSE cadence） |
| `features/ai/ui/AiTypingBubble.tsx` | "思考中…"三点动画气泡，caption 可定制 |
| `features/ai/ui/AiFloatingButton.tsx` | 右下角浮窗入口（仅支持临时对话，无持久化） |

### 2.2 已修改

| 文件 | 改动 |
|------|------|
| `prisma/schema.prisma` | 新增 3 张表：`AiConversation` / `AiChatMessage` / `AiUserProfile`，都在 `pm` schema |
| `shared/ui/AppShell.tsx` | 全局壳层接入 `<AiFloatingButton />`，所有页面都能开 AI 浮窗 |
| `shared/ui/icons.tsx` | 新增 `IconSparkles` / `IconPlus` / `IconEdit` / `IconTrash` 等 AI 模块需要的 icon |

---

## 3. 数据模型（Prisma）

```538:579:prisma/schema.prisma
model AiConversation {
  id             String   @id @default(cuid())
  userId         String
  title          String
  summary        Json?
  messageCount   Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  lastMessageAt  DateTime @default(now())
  // ...
}

model AiChatMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           String   // "user" | "assistant"
  content        String   @db.Text
  sources        Json?    // RAG 来源引用 [{ index, title, url, type }]
  createdAt      DateTime @default(now())
  // @@index([conversationId, createdAt(asc)])
}

model AiUserProfile {
  userId             String   @id
  profile            Json     // { roles, interests, expertise, projects, recentTopics, preferences }
  sourceSummaryCount Int      @default(0)
  updatedAt          DateTime @updatedAt
  createdAt          DateTime @default(now())
}
```

**关键设计**：
- **3 张表都在 `pm` schema**——和主应用共用数据库；通过 schema 隔离便于未来独立迁移。
- `summary` / `sources` / `profile` 都是 JSON——Prisma 的 `Json` 字段，方便存半结构化数据。
- `@@index([conversationId, createdAt(asc)])`——按对话查消息必须按时间排序，索引避免扫表。
- **不存 SSE chunk**——流式中间产物不入库，只存最终 `fullContent`。

---

## 4. 全链路调用图

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 浏览器                                                                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  /ai 路由  (app/ai/page.tsx)                                         │ │
│  │   ↓                                                                  │ │
│  │  AppShell + AiChatPage (URL 同步 ?c=xxx)                              │ │
│  │   ├─ AiConversationSidebar (左侧)                                    │ │
│  │   │   ├─ 点 "新对话"  → POST /api/ai/conversations                  │ │
│  │   │   │                     → setPendingGreetingIds.add(newId)      │ │
│  │   │   │                     → setActiveConversationId(newId)         │ │
│  │   │   ├─ 点某条对话      → onSelect(id) → URL 同步                    │ │
│  │   │   ├─ 重命名          → PATCH /api/ai/conversations/{id}          │ │
│  │   │   └─ 删除            → DELETE /api/ai/conversations/{id}         │ │
│  │   │                                                                  │ │
│  │   └─ AiChatPanel (右侧主区)                                          │ │
│  │       ├─ conversationId 变化 effect:                                 │ │
│  │       │   loadMessages(id)  → GET /api/ai/conversations/{id}        │ │
│  │       │   loadProfile()     → GET /api/ai/profile                   │ │
│  │       │   if (autoGreet)    → playWelcomeTypewriter + triggerGreet  │ │
│  │       ├─ handleSend(message):                                        │ │
│  │       │   setMessages([..., user bubble])                            │ │
│  │       │   POST /api/ai/conversations/{id}/messages (SSE)            │ │
│  │       │   读 SSE: text → setStreamingContent(delta)                  │ │
│  │       │           sources → setPendingSources                        │ │
│  │       │           done → push assistant bubble to messages            │ │
│  │       └─ handleStop() → abortController.abort() + 保存当前 partial    │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  全局浮窗  (AiFloatingButton, AppShell 注入)                          │ │
│  │   → AiChatPanel variant="floating" (无 conversationId, 临时对话)       │ │
│  │   → 发消息走 /api/ai/chat (旧兼容路由)                                 │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 后端 (Next.js Route Handlers, 全部在 app/api/ai/...)                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  POST /api/ai/conversations/[id]/messages                                │
│   ├─ requireSession()                                                     │
│   ├─ getConversation(id, userId)        ← 校验归属                        │
│   ├─ getOrCreateProfile(userId)          ← 读用户画像                      │
│   ├─ shouldUseRag / mode 决定 useRag                                     │
│   ├─ useRag ? retrieveContext(msg, {limit:5}) : skip                     │
│   │   └─ searchDocuments({query, userId})  ← embedding 混合检索           │
│   ├─ buildRagPrompt(msg, ctx)                                            │
│   ├─ buildSystemPrompt(userName, useRag, profile)                        │
│   ├─ 拼 messages: [system, ...history.slice(-10), user]                  │
│   ├─ appendMessage(convId, "user", msg)  ← 立即写库                       │
│   ├─ fetch Agnes API (stream:true)                                       │
│   │   ├─ delta → SSE "data: {type:text, delta}"                          │
│   │   └─ stream done → appendMessage(convId, "assistant", fullContent)  │
│   ├─ enqueueSummarizeConversation(convId, {force:true})  ← 后台异步       │
│   └─ SSE sources + done                                                  │
│                                                                            │
│  POST /api/ai/conversations/[id]/greeting                                │
│   ├─ getConversation + getOrCreateProfile + getConversationSummaries     │
│   ├─ buildGreetingSystemPrompt(profile, recentTopics)                    │
│   ├─ fetch Agnes API (stream:true)                                       │
│   ├─ SSE "data: {type:text, delta}" 流式                                  │
│   ├─ stream done → appendMessage(convId, "assistant", fullContent)      │
│   └─ SSE "data: {type:done}"                                             │
│                                                                            │
│  GET   /api/ai/conversations             → listConversations(userId)      │
│  POST  /api/ai/conversations             → createConversation(userId)     │
│  GET   /api/ai/conversations/[id]        → getConversationsWithMessages   │
│                                            (if msgs≥4 & no summary → enqueue) │
│  PATCH /api/ai/conversations/[id]        → renameConversation             │
│  DELETE /api/ai/conversations/[id]       → deleteConversation              │
│  GET   /api/ai/profile                   → getOrCreateProfile             │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 后台任务 (background-jobs.ts, 全局 Map + setTimeout)                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  enqueueSummarizeConversation(convId, {force}?)                          │
│   ├─ if (recently summarized & !force) → skip                            │
│   ├─ setTimeout(() => doSummarize(convId), 0)                            │
│   └─ doSummarize → summarizeConversation(convId)                         │
│       ├─ 取最近 30 条消息 + 已存在的 summary                                │
│       ├─ Agnes API 提取 JSON {topics, keyPoints, actionItems, queries}  │
│       ├─ 解析失败 → 写空 fallback summary, return null                    │
│       └─ 成功 → 写 aiConversation.summary                                 │
│            └─ doUpdateProfile(userId)                                    │
│                ├─ 取最近 20 条已摘要的对话                                 │
│                ├─ 过滤掉空 summary 的对话                                  │
│                ├─ 空 → deleteMany(aiUserProfile) 让 UI 显示"暂无画像"      │
│                └─ Agnes API 合并 JSON → upsert aiUserProfile              │
│                                                                            │
└──────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ LLM (Agnes 2.0 Flash) + Embedding API                                     │
├──────────────────────────────────────────────────────────────────────────┤
│  AGNES_API_URL = "https://apihub.agnes-ai.com/v1/chat/completions"        │
│  EMBEDDING_API_URL = "http://localhost:5000" (本地运行)                    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. 核心实现（关键代码 + 设计意图）

### 5.1 模式判断 — `detector.ts`

```36:46:features/ai/lib/detector.ts
export function shouldUseRag(
  message: string,
  forceMode?: "search" | "chat"
): boolean {
  if (forceMode === "search") return true;
  if (forceMode === "chat") return false;
  // auto: 检查是否含"项目|工单|查找|代码|统计..."等关键字
  return containsSearchKeywords(message);
}
```

**为什么**：用户不需要每次手动选模式；auto 模式下关键字命中自动启用 RAG，未命中走纯对话。

### 5.2 RAG 上下文 — `rag.ts`

```9:35:features/ai/lib/rag.ts
export async function retrieveContext(query, { limit = 5, userId }) {
  const data = await searchDocuments({ query, limit, viewerUserId: userId });
  const contextText = data.results
    .map((r, i) => `[${i + 1}] ${sourceLabel(r.type)}：${r.title}\n${r.snippet}`)
    .join("\n\n");
  return { results: data.results, contextText };
}
```

**为什么**：`searchDocuments` 是上游**混合检索**（keyword + embedding），返回带 score 的结果；这里只取前 5 个拼接成 LLM 友好的纯文本 `contextText`。

### 5.3 对话消息端点 — `app/api/ai/conversations/[id]/messages/route.ts`

```95:310:app/api/ai/conversations/[id]/messages/route.ts
export async function POST(request, { params }) {
  // 1) 鉴权 + 校验 conversation 归属
  // 2) 加载 profile + 决定 useRag
  // 3) 拼 system prompt（baseIntro + ragDuty/chatDuty + style + userName + profile）
  // 4) 拼 messages = [system, ...history.slice(-10), user]
  // 5) ReadableStream start(controller):
  //    - appendMessage(convId, "user", message)   ← user 消息立即入库
  //    - 调 Agnes 流式 API
  //    - 每个 delta → SSE "data: {type:text, delta}"
  //    - stream done → appendMessage(convId, "assistant", fullContent, sources)
  //    - enqueueSummarizeConversation(convId, { force: true })
  //    - SSE "data: {type:sources}" + "data: {type:done}"
  // 6) 返回 SSE 响应
}
```

**关键设计**：

- **user 消息先入库，assistant 后入库**——避免 SSE 中断时 user 消息丢失
- **`history.slice(-10)`**——避免 prompt 超长，保留最近 10 轮
- **`force: true`**——发完消息**立即**触发摘要，不等 15 分钟冷却（因为有新增内容）
- **profile 嵌入 system prompt**——画像为空时**不**插入空块（避免 LLM 回显"您的画像是 {}"）
- **`apiResponse.ok` 失败**→ SSE `error` 事件 → 前端抛错但不破坏消息流

### 5.4 摘要 + 画像更新 — `summarizer.ts`

```153:205:features/ai/lib/summarizer.ts
export async function summarizeConversation(conversationId) {
  const messages = await prisma.aiChatMessage.findMany({
    where: { conversationId }, take: 30, orderBy: { createdAt: "desc" }
  });
  if (messages.length === 0) return null;
  const previousSummary = (await prisma.aiConversation.findUnique(...))?.summary;

  const prompt = buildSummaryPrompt(messages, previousSummary);
  try {
    const responseText = await callAgnes(promptMessages);  // JSON 提取
    const summary = JSON.parse(extractJsonFromResponse(responseText));
    await prisma.aiConversation.update({
      where: { id: conversationId },
      data: { summary },
    });
    return summary;
  } catch (error) {
    // 失败 → 写空 fallback summary, return null
  }
}
```

```207:281:features/ai/lib/summarizer.ts
export async function updateUserProfile(userId) {
  // 1) 取最近 20 条对话 summary
  // 2) 过滤掉空 summary（避免 LLM 把空数组变成空画像）
  // 3) 全部空 → deleteMany 现有 profile 行 → return null（UI 显示"暂无画像"）
  // 4) 拼 PROFILE_INSTRUCTION + summaries + previousProfile
  // 5) Agnes JSON 提取 → upsert aiUserProfile
}
```

**为什么失败也写空 fallback summary**：

- 不写 → 下次重入时 `previousSummary = null` → LLM 又要从头提取 → 浪费 token
- 写空 → 下次重入时把空数组喂给 LLM 也只是浪费 token，**但有防重入的 filter**（line 223-231）

### 5.5 后台任务防抖 — `background-jobs.ts`

```24:24:features/ai/lib/background-jobs.ts
const SUMMARIZE_COOLDOWN_MS = 15 * 60 * 1000; // 15 分钟
```

```74:109:features/ai/lib/background-jobs.ts
async function doSummarize(conversationId, attempt = 0) {
  try {
    await summarizeConversation(conversationId);
    markSummarized(conversationId);
    // 查 conversation 拿 userId（避免用 convId slice 凑出来的假 userId）
    const conversation = await prisma.aiConversation.findUnique({ ... });
    await doUpdateProfile(conversation.userId, attempt);
  } catch (err) {
    if (attempt === 0) {
      console.warn(`... retry in 5s`);
      setTimeout(() => doSummarize(conversationId, 1), 5000);
    } else {
      console.error(`... failed after retry`);
    }
  }
}
```

**坑**（已修）：旧版用 `conversationId.slice(0, 20)` 当 userId 占位 → 永远匹配不到真实用户 → 画像更新**悄悄失败**。修法：先 `findUnique` 拿真实 userId 再调 `doUpdateProfile`。

### 5.6 前端三段式开场 — `AiChatPanel.tsx`

```414:455:features/ai/ui/AiChatPanel.tsx
useEffect(() => {
  // 监听 conversationId 变化
  if (autoGreet) {
    playWelcomeTypewriter(conversationId);   // 阶段 1: typewriter 欢迎
    onGreetingConsumed?.(conversationId);   // 通知 parent 清 pending 标记
  }
}, [conversationId, isPage, loadMessages, loadProfile, autoGreet, playWelcomeTypewriter, onGreetingConsumed]);
```

```259:335:features/ai/ui/AiChatPanel.tsx
const triggerGreeting = useCallback(async (convId) => {
  setIsLoading(true);
  setStreamingContent("");
  setGreetingHint(pickGreetingHint());   // 阶段 2: 随机 "正在根据你的画像准备..."
  // ... 读 SSE → text event 更新 streamingContent → done event 追加到 messages
}, [pickGreetingHint]);
```

```732:747:features/ai/ui/AiChatPanel.tsx
{/* 三段渲染 */}
{isLoading && !streamingContent && (
  <AiTypingBubble text={greetingHint ?? undefined} />
)}
{isLoading && streamingContent && (
  <AiMessageBubble role="assistant" content={streamingContent} isStreaming />
)}
{messages.map(msg => <AiMessageBubble key={msg.id} ... />)}
```

**三段时序**：

1. `t=0`：typewriter 立即插入第一个字符到 `messages`（避免空气泡闪烁）
2. `t=0~3s`：每 45ms 推 1 字显示静态欢迎
3. `t≈3s`：typewriter 完成 → `triggerGreeting()` → `setGreetingHint(...)` → 渲染 AiTypingBubble 带 caption
4. `t≈3s+`：Agnes 第一个 delta 到达 → `setStreamingContent` 累积 → 切换到 AiMessageBubble 流式
5. `t=LLM 完成`：`done` 事件 → 把完整问候追加到 messages → `setIsLoading(false)`

### 5.7 打字机动画 — `AiMessageBubble.tsx`

```22:115:features/ai/ui/AiMessageBubble.tsx
const TYPEWRITER_MIN_MS_PER_CHAR = 18;
const TYPEWRITER_MAX_MS_PER_CHAR = 55;

// SSE cadence 自适应：估算每秒字符数 → 调整打字间隔
// 后端 burst ≈ 80ms，前端 rAF 循环每帧显示 backlog / 16ms ≈ 速度匹配
```

**为什么自适应**：固定速度（45ms/char）会让 SSE 到达后**一次性渲染所有未显示字符**——视觉上是"墙"。自适应让前端打字机"贴着"SSE 的前缘走。

### 5.8 路由同步 — `AiChatPage.tsx`

```14:40:features/ai/ui/AiChatPage.tsx
const [activeConversationId, setActiveConversationId] = useState<string | null>(
  () => searchParams.get("c") || null  // 从 URL 初始化
);

useEffect(() => {
  // activeId → URL 同步：只在 URL 和 state 不一致时 router.replace
  // 否则 searchParams 变化会触发 effect 死循环
}, [activeConversationId, pathname, router, searchParams]);
```

**为什么**：URL 是状态源——刷新页面 / 分享链接 / 浏览器后退都能恢复 active conversation。

---

## 6. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `OPENAI_API_KEY` | Agnes-2.0-Flash 兼容 key | 必填，所有 LLM 调用都靠它 |
| Agnes API URL | `https://apihub.agnes-ai.com/v1/chat/completions` | 硬编码在 `chat/route.ts` / `messages/route.ts` / `greeting/route.ts` / `summarizer.ts` |
| Embedding API | `http://localhost:5000` | RAG 上游，需本地 embedding 服务（不在 AI 模块内） |
| 模型 | `agnes-2.0-flash` | 流式聊天 + 摘要都用同一个 |
| 端口 | `3003` | `npm run dev` |
| Prisma schema | `pm` | 3 张 AI 表都在 `pm` schema |

---

## 7. 启动 / 部署

```bash
# 1. 确认仓库根
cd /Users/vastgui/Desktop/project-manager

# 2. 确认 .env
grep OPENAI_API_KEY .env   # 必须存在
grep DATABASE_URL .env     # 必须指向 pm schema 的 Postgres

# 3. 推 schema（如果是新环境）
npx prisma db push --schema prisma/schema.prisma

# 4. 启动 embedding 服务（如果用 RAG）
cd ../embedding-service  # 假设上游路径
python -m uvicorn main:app --port 5000

# 5. 启动 dev server
cd /Users/vastgui/Desktop/project-manager
npm run dev
# → http://localhost:3003

# 6. 健康检查
curl -s http://localhost:3003/api/auth/session | head -c 200
# 期望：{"user":{"id":"..."}, ...} 或 401（未登录）
```

---

## 8. 测试 & 验证

### 8.1 场景 A：新对话自动问候

```bash
# 1) 浏览器打开 http://localhost:3003/ai
# 2) 登录
# 3) 点 sidebar "新对话"
# 期望（按时间顺序）：
#   - t=0ms：第一个气泡显示 "你"
#   - t=3s：完整显示静态欢迎（"你好！我是小星..."）
#   - t=3s+ε：第二个气泡显示 "正在根据你的画像准备一句开场白…"（随机三选一）
#   - t=3s+ε+LLM：第二个气泡切换为打字机气泡，显示个性化问候
```

### 8.2 场景 B：发消息 + RAG

```bash
# 1) 在 /ai 页面的输入框输入："最近项目有哪些工单？"
# 2) 发送
# 期望：
#   - 用户气泡立刻出现
#   - typing bubble 短暂显示
#   - 流式气泡显示 AI 回复
#   - AI 回复末尾有"参考资料"区域带 [1] 工单标题链接（前提是 RAG 命中）
```

**curl 验证**：

```bash
# 1) 登录拿 cookie（按实际登录方式）
# 2) 创建对话
CONV_ID=$(curl -s -X POST http://localhost:3003/api/ai/conversations \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{}' | jq -r '.data.id')

# 3) 发消息
curl -N -X POST "http://localhost:3003/api/ai/conversations/$CONV_ID/messages" \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"message":"最近项目有哪些工单？","mode":"auto"}'

# 期望 SSE：
#   data: {"type":"conversation","id":"...","title":"新对话"}
#   data: {"type":"text","delta":"最"}
#   data: {"type":"text","delta":"近"}
#   ...
#   data: {"type":"sources","sources":[{"index":1,"title":"工单 #1234","url":"/tickets/1234","type":"ticket"}]}
#   data: {"type":"done"}
```

### 8.3 场景 C：刷新页面 / 切回对话

```bash
# 1) 在 /ai 选一个老对话
# 2) 浏览器刷新页面
# 期望：
#   - URL 仍带 ?c=xxx
#   - chat panel 加载该对话所有历史消息
#   - typing bubble 不出现（autoGreet 不会被设 true）
```

### 8.4 后台摘要 + 画像验证

```bash
# 1) 用同一用户多发几条对话
# 2) 等 15 分钟（或重启 dev server 触发 background-jobs）
# 3) 查 DB
psql $DATABASE_URL -c 'SELECT id, title, summary FROM pm.ai_conversation ORDER BY updated_at DESC LIMIT 5;'
# 期望：每条有 summary JSON

# 4) 查画像
curl -s http://localhost:3003/api/ai/profile -b cookies.txt | jq
# 期望：{"data":{"profile":{"roles":["前端工程师"],"interests":["AI"],"..."}}}
```

### 8.5 Lint / Type Check

```bash
cd /Users/vastgui/Desktop/project-manager
npx eslint \
  app/api/ai/**/*.ts \
  features/ai/**/*.{ts,tsx} \
  app/ai/page.tsx

npx tsc --noEmit
```

**期望**：0 errors 0 warnings。

---

## 9. 复现 Checklist

- [ ] 仓库根：`/Users/vastgui/Desktop/project-manager`
- [ ] `.env` 含 `OPENAI_API_KEY` 和 `DATABASE_URL`
- [ ] `npx prisma db push --schema prisma/schema.prisma` 已跑过
- [ ] `pm.ai_conversation` / `pm.ai_chat_message` / `pm.ai_user_profile` 3 张表存在
- [ ] Embedding 服务在 `localhost:5000` 跑着（RAG 才生效）
- [ ] `npm run dev` 启动在 3003
- [ ] 浏览器登录后访问 `/ai`，左 sidebar 显示"对话历史"列表
- [ ] 点"新对话"看到 typewriter 欢迎 + AI 主动问候
- [ ] 输入框发"最近项目有哪些工单？"→ 流式回复 + 参考资料
- [ ] sidebar 切到老对话，历史正确加载
- [ ] 多次对话后等 15 分钟，DB 里 `summary` 不为 null
- [ ] 调用 `/api/ai/profile` 返回非空画像
- [ ] `npx eslint` + `npx tsc --noEmit` 0 错 0 警

---

## 10. 踩坑记录

### 坑 1：新对话同时出现两个 AI 气泡

**现象**：点"新对话"后 UI 同时显示一个**空 content 的气泡** + 一个 **typing bubble**，看起来像两个 AI 在说话。

**原因**：triggerGreeting 第一版在 `messages` 里塞了空占位 + 又开启了 `isLoading + streamingContent` 流式机制。渲染层同时把占位（`messages.map`）和 typing bubble（`isLoading && !streamingContent`）都画出来。

**解法**：triggerGreeting 改为**只走流式机制**——不往 messages 塞占位，`done` 事件时才把完整内容**追加**为稳定消息。

```253:335:features/ai/ui/AiChatPanel.tsx
const triggerGreeting = useCallback(async (convId) => {
  setIsLoading(true);
  setStreamingContent("");
  // ❌ 不要 setMessages 占位
  // ...
  } else if (parsed.type === "done") {
    setMessages((prev) => [
      ...prev,
      { id: `assistant-greeting-${convId}`, role: "assistant", content: fullContent },
    ]);
  }
});
```

### 坑 2：typing bubble caption 是硬编码"小星正在思考…"

**现象**：triggerGreeting 时 typing bubble 显示"小星正在思考…"——对主动问候语境不贴切。

**原因**：`AiTypingBubble` 内部 caption 写死成 prop-less。

**解法**：加可选 `text` prop，向后兼容；triggerGreeting 用 `setGreetingHint(pickGreetingHint())` 注入随机文案。

```7:25:features/ai/ui/AiTypingBubble.tsx
interface AiTypingBubbleProps { text?: string; }
```

随机文案候选：
```243:251:features/ai/ui/AiChatPanel.tsx
const hints = [
  "正在根据你的画像准备一句开场白…",
  "正在翻看我们最近的对话，找点共同话题…",
  "正在结合你的角色和项目，主动想个问候…",
];
```

### 坑 3：typing 太快 → 用户感觉是"刷屏"

**现象**：`WELCOME_TYPEWRITER_INTERVAL_MS = 28` + `CHARS_PER_TICK = 2` → 70 字/秒，用户没看清。

**原因**：tick 数 × tick 频率过高，~18ms/char 对中文偏快。

**解法**：调到 45ms/char ≈ 22 cps（人类默读速度）。

```349:350:features/ai/ui/AiChatPanel.tsx
const WELCOME_TYPEWRITER_INTERVAL_MS = 45;
const WELCOME_TYPEWRITER_CHARS_PER_TICK = 1;
```

### 坑 4：用户中途切走对话，typewriter 还在跑

**现象**：连点"新对话"两次，第二个 typewriter 启动时第一个还没完，两个 timer 同时往不同 convId 的气泡推内容。

**解法**：用 `welcomeTypewriterRef` 跟踪当前 timer；新 typewriter 启动时先 `clearInterval`；加 unmount cleanup。

```355:410:features/ai/ui/AiChatPanel.tsx
const playWelcomeTypewriter = useCallback((convId) => {
  if (welcomeTypewriterRef.current?.timerId) {
    clearInterval(welcomeTypewriterRef.current.timerId);
  }
  // ...
});

useEffect(() => {
  return () => {
    if (welcomeTypewriterRef.current?.timerId) {
      clearInterval(welcomeTypewriterRef.current.timerId);
    }
    welcomeTypewriterRef.current = null;
  };
}, []);
```

### 坑 5：URL sync 死循环

**现象**：每次切换 activeConversationId → `router.replace` → `searchParams` 引用变 → effect 重跑 → 再 `router.replace` → 死循环，浏览器一直 reload。

**原因**：effect 里没判断"URL 和 state 已经一致"，每次都 replace。

**解法**：

```27:40:features/ai/ui/AiChatPage.tsx
useEffect(() => {
  const currentC = searchParams.get("c");
  if (currentC === activeConversationId) return;  // 已经一致 → 跳过
  // ... router.replace
}, [activeConversationId, pathname, router, searchParams]);
```

### 坑 6：`recentTopics` 没拼进 prompt → ESLint 报错

**现象**：`npx eslint` 报 `'recentTopics' is defined but never used` 和 `prefer-const`。

**解法**：把 `recentTopics` 拼进 prompt template；`let` → `const`。

### 坑 7：`conversationId.slice(0, 20)` 当 userId 占位 → 画像悄悄不更新

**现象**：后台跑了几十次，DB 里 `aiUserProfile` 行从未创建或更新；但日志里看不到 error。

**原因**：`doUpdateProfile(conversationId)` 直接传了 cuid 切片当 userId，但 `prisma.aiUserProfile.findUnique({ where: { userId: cuidSlice } })` 永远 null → `upsert` 的 `create` 分支用假 userId 建了一条**孤儿行**。

**解法**：

```84:94:features/ai/lib/background-jobs.ts
const conversation = await prisma.aiConversation.findUnique({
  where: { id: conversationId },
  select: { userId: true },
});
if (!conversation) return;
await doUpdateProfile(conversation.userId, attempt);
```

### 坑 8：空 summary 被喂给 LLM → 画像变 `{}`

**现象**：早期对话刚启动时 summary 字段是 fallback 的空对象 `{}`，调 `updateUserProfile` 时把 N 条空对象拼起来让 LLM 合并 → 画像直接变 `{}`。

**解法**：先 filter 掉空 summary；如果全部空，`deleteMany` 清掉当前行（让 UI 显示"暂无画像"），避免污染。

```223:241:features/ai/lib/summarizer.ts
const summaries = conversations
  .filter((c) => {
    const s = c.summary as Record<string, unknown>;
    const topics = Array.isArray(s.topics) ? s.topics : [];
    const keyPoints = Array.isArray(s.keyPoints) ? s.keyPoints : [];
    const recentQueries = Array.isArray(s.recentQueries) ? s.recentQueries : [];
    return topics.length > 0 || keyPoints.length > 0 || recentQueries.length > 0;
  })
  .map((c) => ({ id: c.id, summary: c.summary }));

if (summaries.length === 0) {
  await prisma.aiUserProfile.deleteMany({ where: { userId } });
  return null;
}
```

### 坑 9：summary 失败 → 下次重入时 LLM 反复重提

**现象**：第一次 summarize 失败时**没**写库，下次触发时 LLM 又从零开始提取。

**解法**：失败时写**空 fallback summary**——下次重入时 LLM 看到空数组，`extractJsonFromResponse` 返回 `{}`，**不会污染画像**（因为过滤器会拦截）。

```192:204:features/ai/lib/summarizer.ts
} catch (error) {
  console.error("[summarizer] Failed to summarize conversation:", error);
  const fallback = { topics: [], keyPoints: [], actionItems: [], recentQueries: [] };
  await prisma.aiConversation.update({
    where: { id: conversationId },
    data: { summary: fallback },
  });
  return null;
}
```

### 坑 10：Agnes API 拒绝只含 system message 的 prompt

**现象**：`callAgnes` 单独发 `[{role:"system", content:INSTRUCTION}]` → 400 "No user query found in messages."

**解法**：把整个 prompt（含待摘要的对话内容）作为 user message 再发一遍。

```173:179:features/ai/lib/summarizer.ts
const promptMessages: ChatMessage[] = [
  { role: "system", content: SUMMARY_INSTRUCTION },
  { role: "user", content: promptUser },  // 包含对话内容
];
```

### 坑 11：`GREETING_HINTS` 数组在 useCallback 外导致依赖告警

**现象**：`react-hooks/exhaustive-deps` warning：`The 'GREETING_HINTS' array makes the dependencies of useCallback Hook change on every render`。

**解法**：把数组挪进 useCallback 内部。

```243:251:features/ai/ui/AiChatPanel.tsx
const pickGreetingHint = useCallback(() => {
  const hints = [/* ... */];
  return hints[Math.floor(Math.random() * hints.length)];
}, []);
```

---

## 附录 A：调用链上下游对照表

| 角色 | 文件 | 关键导出 | 谁调用 |
|------|------|----------|--------|
| 页面壳 | `app/ai/page.tsx` | `default Page` | Next.js Router |
| 页面主组件 | `features/ai/ui/AiChatPage.tsx` | `default AiChatPage` | 页面壳 |
| Sidebar | `features/ai/ui/AiConversationSidebar.tsx` | `AiConversationSidebar` | AiChatPage |
| Chat Panel | `features/ai/ui/AiChatPanel.tsx` | `AiChatPanel` | AiChatPage / AiFloatingButton |
| 浮窗 | `features/ai/ui/AiFloatingButton.tsx` | `AiFloatingButton` | `shared/ui/AppShell.tsx` |
| 输入 | `features/ai/ui/AiChatInput.tsx` | `AiChatInput` | AiChatPanel |
| 气泡 | `features/ai/ui/AiMessageBubble.tsx` | `AiMessageBubble` | AiChatPanel |
| Typing | `features/ai/ui/AiTypingBubble.tsx` | `AiTypingBubble` | AiChatPanel |
| 类型 | `features/ai/lib/types.ts` | `AI_MODE_OPTIONS` | AiChatPanel |
| RAG 检测 | `features/ai/lib/detector.ts` | `shouldUseRag` | AiChatPanel |
| RAG 上下文 | `features/ai/lib/rag.ts` | `retrieveContext`, `buildRagPrompt` | API routes |
| 对话 CRUD | `features/ai/lib/conversation-store.ts` | `createConversation`, `appendMessage` 等 | API routes |
| 后台任务 | `features/ai/lib/background-jobs.ts` | `enqueueSummarizeConversation` | API routes |
| 摘要 / 画像 | `features/ai/lib/summarizer.ts` | `summarizeConversation`, `updateUserProfile` | background-jobs |
| 检索上游 | `shared/lib/search.ts` | `searchDocuments` | rag.retrieveContext |
| Embedding | `shared/lib/embedding.ts` | `fetchEmbedding`, `fetchEmbeddingsBatch` | shared/lib/search.ts |

## 附录 B：SSE 事件协议

所有 AI 流式端点共用同一套 SSE 事件：

| `type` | 字段 | 出现时机 | 前端处理 |
|--------|------|----------|----------|
| `conversation` | `{ id, title }` | 仅 `/messages` 端点，首次发消息时（创建新对话） | `onConversationCreated(id)` |
| `text` | `{ delta: string }` | 每个 LLM token | `setStreamingContent(cum += delta)` |
| `sources` | `{ sources: [...] }` | 仅在 useRag 时，stream 完成后 | `setPendingSources(sources)` |
| `done` | `{}` | 流结束 | push assistant bubble to messages, isLoading=false |
| `error` | `{ message: string }` | 任意环节出错 | 抛错 → 显示 fallback 错误气泡 |

---

**完成时间**：2026-06-28
**作者**：Cursor (claude-opus-4-8-max)
**仓库 commit**：（commit 后回填）
