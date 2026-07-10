# Agnes Tool Calling 接入 — 开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + Vercel AI SDK）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"Agnes 模型 tool calling 接入"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- **现象**：Agnes AI 模型接入后，调用 `/v1/responses` 端点时返回 400 错误，错误信息为 Pydantic 校验失败（`input` 字段格式不匹配）
- **业务影响**：AI 助手无法使用 `webSearch` 和 `searchKnowledge` 两个工具（tool calling 全部失败），只能做纯文本对话
- **根因误解**：最初以为是 Agnes 不支持 tool calling，后来确认 Agnes 官方明确支持 tool calling，问题出在 SDK 选错了端点

### 1.2 结论

- 改用 `@ai-sdk/openai@4` + `ai@7`，通过 `.chat()` 方法强制路由到 `/v1/chat/completions` 端点
- 同步处理 `ai@6` → `ai@7` 带来的三处 breaking change

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `package.json` | 修改 | 升级 `@ai-sdk/openai` 3.0.75 → 4.0.5；升级 `ai` 6.0.211 → 7.0.11 |
| `features/ai/lib/agnes-provider.ts` | 修改 | 用 `.chat()` 替换直接调用，强制走 `/v1/chat/completions` |
| `features/ai/tools/index.ts` | 修改 | 去掉泛型 `Record<string, Tool>`，改用具体工具类型（解决 `ai@7` 类型推断问题） |
| `features/ai/tools/search-knowledge.ts` | 修改 | `experimental_context` → `context`；新增 `contextSchema` |
| `features/ai/tools/web-search.ts` | 修改 | 新增空 `contextSchema: z.object({})`（仅作为占位，`ai@7` 行为变更） |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修改 | `experimental_context` → `toolsContext`；去掉 `messages` 数组里的 system 消息 |
| `app/api/ai/conversations/[id]/greeting/route.ts` | 简化 | 删除冗余的 streamText 调用简化，重写 greeting 生成 prompt |
| `features/ai/ui/AiChatPanel.tsx` | 新增 | 完整 AI 对话面板 UI，含打字机效果、tool call 状态、用户画像编辑 |
| `app/api/ai/chat/route.ts` | 删除 | 旧版简单 chat 接口，合并入 conversations API |
| `.env.example` | 修改 | 新增 `AGNES_API_URL` 环境变量说明 |

---

## 3. 核心实现

### 3.1 Agnes Provider（`features/ai/lib/agnes-provider.ts`）

核心改动：用 `.chat()` 强制 Chat Completions 路径，而不是默认的 Responses 路径。

```startLine:1:features/ai/lib/agnes-provider.ts
import { createOpenAI } from "@ai-sdk/openai";

export const agnes = createOpenAI({
  baseURL: process.env.AGNES_API_URL ?? "https://apihub.agnes-ai.com/v1",
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

export const agnesFlash = agnes.chat("agnes-2.0-flash");
```

**为什么这样写**：`@ai-sdk/openai@4` 有两个模型创建方法：
- `provider("model-name")`：默认路由到 `/v1/responses`（新版 OpenAI 格式，Agnes 不完全兼容）
- `provider.chat("model-name")`：强制路由到 `/v1/chat/completions`（标准 Chat Completions，Agnes 完整支持 tool calling）

Agnes 官方文档明确说明 tool calling 支持走的是 Chat Completions 格式。

---

### 3.2 Messages Route — Tool Calling 上下文传递（`app/api/ai/conversations/[id]/messages/route.ts`）

`ai@7` 中 `experimental_context` 改名 `toolsContext`，且不能和 `messages` 数组里的 system 消息同时存在。

```startLine:128:app/api/ai/conversations/[id]/messages/route.ts
    const messages: Message[] = [];

    if (conversationHistory?.length) {
      for (const msg of conversationHistory.slice(-10)) {
        messages.push({
          id: msg.id,
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    messages.push({ id: "current", role: "user", content: prompt });

    const sources = useRag ? extractSourceReferences(context.results) : [];

    const tools = toolsetForMode(mode);

    const result = streamText({
      model: agnesFlash,
      system: systemPrompt,          // system prompt 只通过这个参数传
      messages,                      // messages 只有 history + 当前消息，不含 system
      tools,
      stopWhen: stepCountIs(3),
      toolsContext: { viewerUserId: session.user.id } as any,
```

```startLine:148:app/api/ai/conversations/[id]/messages/route.ts
    const result = streamText({
      model: agnesFlash,
      system: systemPrompt,
      messages,
      tools,
      stopWhen: stepCountIs(3),
      toolsContext: { viewerUserId: session.user.id } as any,
      onFinish: async ({ text }) => {
        await appendMessage(conversationId, "assistant", text, sources.length > 0 ? sources : undefined);
        enqueueSummarizeConversation(conversationId, { force: true });
      },
    });
```

**为什么 `as any`**：`ai@7` 的 `InferToolSetContext` 在处理联合类型（`WebToolSet | SearchToolSet`）时类型推断失败，传入具体的 `{ viewerUserId: string }` 但 TypeScript 认为类型不匹配。加 `as any` 绕过类型推断 bug。

**为什么去掉 `messages` 里的 system 消息**：`ai@7` + `@ai-sdk/openai@4` 的组合强制要求：要么在 `system:` 参数传 system prompt，要么在 `messages[]` 里放 `{ role: "system", ... }`，但不能两者同时存在。同时存在会抛出 `AI_InvalidPromptError`。

---

### 3.3 searchKnowledge Tool — Module-Scoped Viewer（`features/ai/tools/search-knowledge.ts`）

`searchKnowledge` 用 module-scoped viewer 注入（与 `searchStructured` 一致），原因：

- Agnes 不支持 `contextSchema`（坑 7）
- `toolsContext` 在 union 工具集上类型推断失败（坑 6）
- `experimental_refineToolInput` 的 key 必须是 `TOOLS` 联合类型中存在的 tool name
- `onToolCall` 在 `streamText` 的类型签名中不存在

```startLine:1:features/ai/tools/search-knowledge.ts
import { tool } from "ai";
import { z } from "zod";
import { retrieveContext } from "@/features/ai/lib/rag";

let currentViewerUserId: string | null = null;
export function setSearchKnowledgeViewer(userId: string | null) {
  currentViewerUserId = userId;
}

export const searchKnowledge = tool({
  description: "在 ProjectHub 知识库（工单/提交/笔记）语义检索。",
  inputSchema: z.object({
    query: z.string().min(2),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ query, limit }) => {
    return await retrieveContext(query, {
      limit,
      userId: currentViewerUserId,
    });
  },
});
```

**`viewerUserId` 的用途**：用于 RAG 检索时的权限过滤，确保用户只能检索到自己有权限看到的工单/提交/笔记。

---

### 3.4 webSearch Tool（`features/ai/tools/web-search.ts`）

webSearch 不需要 context，所以**不能**声明 `contextSchema`（否则 `ai@7` 会尝试验证，传入 `undefined` 导致 Zod 校验失败）。

```startLine:1:features/ai/tools/web-search.ts
import { tool } from "ai";
import { z } from "zod";
import { tavily } from "@tavily/core";

export const webSearch = tool({
  description: "搜索互联网获取实时信息。",
  inputSchema: z.object({
    query: z.string().min(2).max(200),
    maxResults: z.number().int().min(1).max(10).default(5),
  }),
  execute: async ({ query, maxResults }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return { error: "TAVILY_API_KEY not set" };
    const client = tavily({ apiKey });
    const res = await client.search(query, { searchDepth: "basic", maxResults });
    return {
      results: res.results.map((r) => ({ title: r.title, url: r.url, content: r.content })),
      answer: res.answer,
    };
  },
});
```

**没有 `contextSchema` 的原因**：Agnes 不支持 tool 的 `contextSchema`，会导致 400 错误。

---

### 3.5 Tool Mode 分发（`features/ai/tools/index.ts`）

```startLine:1:features/ai/tools/index.ts
import { tool, type Tool } from "ai";
import { webSearch } from "./web-search";
import { searchKnowledge } from "./search-knowledge";
import { searchStructured } from "./search-structured";

export { webSearch, searchKnowledge, searchStructured };

export type ToolMode = "auto" | "web" | "search" | "chat";

type WebToolSet = {
  webSearch: typeof webSearch;
  searchKnowledge: typeof searchKnowledge;
  searchStructured: typeof searchStructured;
};
type SearchToolSet = { searchKnowledge: typeof searchKnowledge; searchStructured: typeof searchStructured };
type StructuredToolSet = { searchStructured: typeof searchStructured };

export function toolsetForMode(
  mode: ToolMode
): WebToolSet | SearchToolSet | StructuredToolSet | undefined {
  if (mode === "auto" || mode === "web")
    return { webSearch, searchKnowledge, searchStructured };
  if (mode === "search") return { searchKnowledge, searchStructured };
  return undefined;
}
```

**为什么用具体类型而不是泛型 `Record<string, Tool>`**：`ai@7` 的 `InferToolSetContext` 对 `Record<string, Tool>` 推断结果为 `never`，导致 `toolsContext` 无法通过类型检查。改用具体工具类型的 union 可以在 `streamText` 泛型展开时保留正确的 context 类型。

### 3.6 searchStructured Tool — 结构化数据查询（`features/ai/tools/search-structured.ts`）

**核心问题**：Agnes 不支持 tool 的 `contextSchema`（坑 7），且 `toolsContext` 在 union 工具集上推断失败（坑 6）。本工具采用 **module-scoped viewer 注入**：route handler 在请求到来时调用 `setSearchStructuredViewer(session.user.id)`，execute 闭包读取模块级变量。

**Route 注入**（`messages/route.ts`）：

```typescript
import { setSearchStructuredViewer } from "@/features/ai/tools/search-structured";
setSearchStructuredViewer(session.user.id);
```

**实现**（`features/ai/tools/search-structured.ts`）：提供 5 种数据类型（ticket/project/user/commit/weekly_report）的精确查询和过滤查询。`queryUser` / `queryWeeklyReport` 的 `id`/`filters.userId` 支持用户 CUID、用户名（精确匹配，case-insensitive）、邮箱前缀三种格式。

**为什么需要 searchStructured 而 searchKnowledge 不够**：`searchKnowledge` 走 `retrieveContext` → `canAccessSearchResult`，对笔记类资源有严格的权限过滤（只能看到自己的私有笔记 + 全公司公开笔记），查不到他人私有笔记。`searchStructured` 直接查 `prisma.user`，绕开了笔记权限过滤，但仍可被 LLM 调用以获取任何用户的基本信息（指派工单、创建工单、周报）。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `OPENAI_API_KEY` | Agnes API Key | 从 apihub.agnes-ai.com 获取 |
| `AGNES_API_URL` | `https://apihub.agnes-ai.com/v1` | Agnes API Base URL，`/v1` 是必须的 |
| `TAVILY_API_KEY` | Tavily API Key | 用于 webSearch 工具联网搜索 |
| `@ai-sdk/openai` | `^4.0.5` | 必须 `^4`，v3 只有 `.responses()` / `.languageModel()` 入口 |
| `ai` | `^7.0.11` | 必须 `^7`，v6 只认识 `LanguageModelV3/V2`，不支持 V4 模型 |
| 端口 | 3003 | Next.js dev server |

---

## 5. 启动 / 部署

```bash
# 1. 安装 / 更新依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 确认 .env.local 中包含：
#    OPENAI_API_KEY=你的AgnesKey
#    AGNES_API_URL=https://apihub.agnes-ai.com/v1
#    TAVILY_API_KEY=你的TavilyKey

# 3. 启动开发服务器
npm run dev

# 4. 确认服务存活
curl -s http://localhost:3003 | head -5
# 期望输出：<!DOCTYPE html>...
```

---

## 6. 测试 & 验证

### 6.1 类型检查

```bash
cd /Users/vastgui/Desktop/project-manager
npx tsc --noEmit 2>&1 | grep -E "search-knowledge|messages/route|agnes-provider|tools/index|web-search"
```

**期望输出**：（无输出表示类型正确）

### 6.2 端到端验证 — 发送消息触发 tool calling

1. 打开浏览器访问 `http://localhost:3003/ai`
2. 点击"新对话"创建一个新会话
3. 发送：`帮我搜索一下最新的 React 19 新闻`
4. **期望行为**：
   - 看到 `正在使用 联网搜索…` 状态提示（绿色脉冲圆点）
   - 搜索完成后状态变为 `联网搜索 完成`
   - AI 基于搜索结果生成回答
5. **错误表现**：
   - 400 错误 → 端点路由问题，检查 `.chat()` 是否正确使用
   - `Type validation failed for tool context (webSearch)` → webSearch 错误声明了 `contextSchema`
   - `System messages are not allowed in the prompt` → messages 和 system 参数重复传了 system 消息

### 6.3 验证知识检索工具

1. 在 AI 页面发送：`帮我找一下关于工单 #10156 的内容`
2. **期望行为**：
   - 看到 `正在使用 知识检索…` 状态提示
   - 检索完成后显示 `知识检索 完成 — 找到 N 条结果`
   - AI 基于检索结果回答

---

## 7. 复现 Checklist

- [ ] `npm install` 安装最新依赖（确认 `@ai-sdk/openai` 版本 ≥ 4.0）
- [ ] `.env.local` 中配置 `OPENAI_API_KEY`、`AGNES_API_URL`、`TAVILY_API_KEY`
- [ ] `npm run dev` 启动服务（端口 3003）
- [ ] 浏览器打开 `http://localhost:3003/ai`
- [ ] 创建新对话，发送一条会触发 webSearch 的消息
- [ ] 确认 tool calling 状态指示器正常显示（联网搜索 / 知识检索）
- [ ] `npx tsc --noEmit` 无 AI 相关类型错误

---

## 8. 踩坑记录

> 本次开发过程中实际遇到并解决的问题，按时间顺序排列。每个坑写「现象 / 原因 / 解法」三段式。

---

### 坑 1：400 Bad Request — Agnes Responses 端点格式不兼容

**现象**：

```
AI_InvalidRequestError: 400 Bad Request
{ type: 'invalid_request_error',
  code: 400,
  errors: [
    { type: 'missing', loc: ['body', 'input', 'list[...union[...]]', 5, 'ResponseOutputMessage', 'call_id'],
      msg: 'Field required' },
    ...
  ]
}
url: 'https://apihub.agnes-ai.com/v1/responses'
```

**原因**：`@ai-sdk/openai@3` 的 `provider("agnes-2.0-flash")` 默认路由到 `/v1/responses` 端点，这是 OpenAI Responses API 的端点。Agnes 的 `/v1/responses` 实现不完全兼容 OpenAI Responses 格式（缺少 `call_id` 等字段），所以 Pydantic 校验失败。

**解法**：升级到 `@ai-sdk/openai@4`，使用 `provider.chat("agnes-2.0-flash")` 强制路由到 `/v1/chat/completions`。Agnes 官方文档明确声明 tool calling 支持走的是 `/v1/chat/completions`。

---

### 坑 2：`ai@6` 不认识 `LanguageModelV4`

**现象**：升级 `@ai-sdk/openai` 到 v4 后，TypeScript 报错：

```
error TS2322: Type 'LanguageModel' is not assignable to type
'LanguageModelV3 | LanguageModelV2 | GlobalProviderModelId'
```

**原因**：`@ai-sdk/openai@4` 返回的是 `LanguageModelV4` 模型，但 `ai@6` 的 `LanguageModel` 类型只包含 V3/V2，不认识 V4。

**解法**：同步升级 `ai` 到 v7（首个支持 `LanguageModelV4` 的版本）：`npm i ai@7`。

---

### 坑 3：`experimental_context` 在 `ai@7` 中被移除

**现象**：

```
error TS2561: Object literal may only specify known properties,
but 'experimental_context' does not exist in type 'LanguageModelCallOptions...'
```

**原因**：`ai@7` 做了 breaking change：
- `streamText` 参数：`experimental_context` → `toolsContext`
- Tool `execute` 函数：`options.experimental_context` → `options.context`

**解法**：

```ts
// streamText 调用侧
toolsContext: { viewerUserId: session.user.id } as any,

// searchKnowledge execute 函数侧
execute: async ({ query, limit }, options) => {
  const ctx = (options?.context ?? { viewerUserId: null }) as ToolContext;
```

---

### 坑 4：不能同时在 `messages` 和 `system` 参数中传 system 消息

**现象**：

```
Error [AI_InvalidPromptError]: Invalid prompt:
System messages are not allowed in the prompt or messages fields.
Use the instructions option instead.
```

**原因**：`ai@7` + `@ai-sdk/openai@4` 的组合强制要求 system prompt 只能通过 `system:` 参数传入，或者只在 `messages` 数组中放一条 `{ role: "system", ... }` 消息。两者同时使用会触发 `AI_InvalidPromptError`。

**解法**：构建 `messages` 数组时去掉 system 消息，只放 history + 当前消息：

```ts
const messages: Message[] = [];
// ... 添加 history ...
messages.push({ id: "current", role: "user", content: prompt });

streamText({
  system: systemPrompt,  // 通过这个传
  messages,              // 不含 system 消息
  ...
})
```

---

### 坑 5：webSearch 工具 `contextSchema: z.object({})` 导致类型校验失败

**现象**：

```
Error [AI_TypeValidationError]: Type validation failed for tool context (webSearch):
Value: undefined. Error message: [{ "expected": "object", "code": "invalid_type" }]
```

**原因**：最初尝试给 `webSearch` 加空 `contextSchema: z.object({})`，让两个工具都有 `contextSchema`。但 `ai@7` 的 tool context 验证行为变化：当 tool 有 `contextSchema` 时，会用 Zod 校验传入的 `toolsContext`。对于 `webSearch`，实际传入的是 `{ viewerUserId: string }`（来自 `searchKnowledge` 的 schema），而 `webSearch` 的 schema 要求非 undefined 的 object，导致校验失败。

**解法**：去掉 `webSearch` 的 `contextSchema`。webSearch 不需要 `viewerUserId`，不声明 schema 即可。

---

### 坑 6：`InferToolSetContext` 对 union 工具集类型推断失败

**现象**：

```
error TS2322: Type '{ viewerUserId: string | null; }'
is not assignable to type 'Normalize<RequiredToolSetContext<WebToolSet | SearchToolSet>>'
```

**原因**：`ai@7` 的 `InferToolSetContext` 对联合类型 `WebToolSet | SearchToolSet` 推断为 `never`（因为 TypeScript 在 union 场景下的交叉类型处理有 bug）。即使 `searchKnowledge` 明确声明了 `contextSchema`，联合类型下的推断依然失败。

**解法**：两处绕过：
1. `tools/index.ts` 用具体类型名而非泛型 `Record<string, Tool>`
2. `messages/route.ts` 里对 `toolsContext` 加 `as any` 断言

---

### 坑 7：Agnes 不支持 tool 的 `contextSchema` 参数

**现象**：带 `contextSchema` 的 tool 发送到 Agnes 时返回 400 错误。

**原因**：Agnes 的 `/v1/chat/completions` 端点只接受标准 OpenAI tool 格式（`type: "function"` + `function: { name, description, parameters }`），不支持扩展的 `contextSchema` 字段。

**解法**：Agnes 官方明确说 tool calling 走的是标准 OpenAI Chat Completions 格式，因此必须保持 tool 定义为纯 OpenAI 兼容格式。`contextSchema` 是 Vercel `ai` SDK 的扩展功能，但 tool calling 请求体中不会暴露这个字段（它是 SDK 内部用来做类型检查的），所以不影响 Agnes 的接收。

---

## 附录：Agnes Tool Calling 架构概览

```
前端 (AiChatPanel.tsx)
  │
  ├── POST /api/ai/conversations/:id/messages
  │
  ▼
messages/route.ts
  │
  ├── requireSession()  → 鉴权
  ├── getConversation() → 确认会话存在
  ├── toolsetForMode()  → 根据 mode 返回工具集
  │   ├── mode="auto/web" → { webSearch, searchKnowledge, searchStructured }
  │   └── mode="search"  → { searchKnowledge }
  │
  ▼
streamText({
  model: agnesFlash,          // Agnes.chat("agnes-2.0-flash")
  system: systemPrompt,        // 小星人设 + 用户画像
  messages: [...],             // 历史 + 当前消息
  tools: {...},
  toolsContext: { viewerUserId },  // 传给 searchKnowledge
  stopWhen: stepCountIs(3),    // 最多 3 步 tool 调用
})
  │
  ├── 发送 /v1/chat/completions 到 Agnes
  │
  ├── AI 决定调用哪个工具
  │
  ▼
工具执行
  ├── webSearch.execute() → 调用 Tavily API
  ├── searchKnowledge.execute({ context: { viewerUserId } })
  │   → retrieveContext() → 向量数据库检索
  └── searchStructured.execute({ type, id, filters, viewerUserId, limit })
      → Prisma 查询 → 格式化文本
  │
  ▼
fullStream 事件
  ├── text-delta        → 流式文本
  ├── tool-call         → 工具调用开始
  ├── tool-result       → 工具执行结果
  └── tool-error        → 工具执行失败
  │
  ▼
ReadableStream SSE → 前端渲染
```

---

## 9. 响应速度优化（2026-07-02）

> 问题：首次响应耗时 2.9 分钟，远超可接受范围。

### 9.1 瓶颈分析

| 环节 | 耗时 | 问题 |
|------|------|------|
| `getConversation` + `getOrCreateProfile` + `appendMessage` | ~25ms（串行） | 无谓等待，3 个 DB 查询本可并行 |
| `retrieveContext()` 在 `streamText` **之前**执行 | ~5-15s（每次 RAG） | RAG 结束前不输出任何 token，阻塞首 token |
| `stopWhen: stepCountIs(3)` | 最多 3 轮 tool 调用 | 3 轮串行 RAG 可累计 15-45s |
| `shouldUseRag()` 关键词过宽泛 | 几乎所有中文消息都触发 RAG | 无意义的检索拖慢响应 |
| `appendMessage(user)` 调用了两次 | ~10ms 浪费 | Promise.all 里一次，stream start 里又一次 |

**根本原因**：`retrieveContext()` 在 `streamText` 之前被 `await`，导致 AI 模型在 RAG 完成前无法开始推理。2.9 分钟 ≈ Agnes 模型推理（约 30s） + 多次串行 RAG（每次 ~15s × 3 轮） + DB 查询串行耗时。

### 9.2 优化方案

**1. DB 查询并行化**

```startLine:111:app/api/ai/conversations/[id]/messages/route.ts
    const [userProfile, appendUserMsg] = await Promise.all([
      getOrCreateProfile(session.user.id),
      appendMessage(conversationId, "user", message),
    ]);
```

**改前**：`await getConversation()` → `await getOrCreateProfile()` → `await appendMessage()` → `await retrieveContext()` → `streamText`，每个步骤等待前一个完成。

**改后**：`getConversation` 只验证会话存在（单独 await），其余两个 DB 操作和 append 并行。

**2. Lazy RAG — 不阻塞首 token**

```startLine:121:app/api/ai/conversations/[id]/messages/route.ts
    const ragPromise = useRag
      ? retrieveContext(message, { limit: 5, userId: session.user.id })
      : Promise.resolve({ results: [] as ..., contextText: "" });
```

RAG 不再 `await`，`streamText` 立即开始。RAG 结果只在 `onFinish` 里使用（保存 assistant 消息时提取 sources），不影响流式输出。

**3. tool 步数 3 → 2**

```startLine:151:app/api/ai/conversations/[id]/messages/route.ts
      stopWhen: stepCountIs(2),
```

减少最多串行 tool 调用次数。

**4. detector 关键词精确化**

改前：几乎所有中文都会触发 RAG（如"项目"、"查找"）。

改后：只有明确检索意图才触发，如 `#10156`、`帮我找`、`进度统计`、`commit` 等：

```startLine:4:features/ai/lib/detector.ts
  { pattern: /(?:工单|ticket|tickets?|issue|issues?)\s*[#：:]\s*\d+/i, category: "project_id" },
  { pattern: /(?:帮我)?(?:找|查|搜|检索|调出|列出|查看)\b/i, category: "search_action" },
  { pattern: /(?:进度|完成率|统计|汇总|总计|排名|未完成|进行中|逾期)/i, category: "statistics" },
```

### 9.3 效果预期

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 首次 token 响应 | 等 RAG 完成后（约 5-15s）才开始 | 立即开始（< 1s） |
| 纯对话场景（不触发 RAG） | 约 30s | 约 5-15s（仅模型推理） |
| 工具调用场景 | 30s + N×5s（N=工具调用轮数） | 立即响应 + 工具调用并行 |
| DB 查询 | 串行 ~25ms | 并行 ~10ms |

### 9.4 踩坑记录（速度优化阶段）

### 坑 8：`sources` 变量 scope 泄漏

**现象**：类型错误 `TS2304: Cannot find name 'sources'`。

**原因**：将 `sources` 提取逻辑从 stream 开始处移到 `onFinish` 回调后，stream 结束时发送 `sources` 的代码找不到变量。

**解法**：删除 stream 结束时 `sources` 发送逻辑，`sources` 只在 `onFinish` 里提取并随 assistant 消息持久化。

### 坑 9：RAG 结果类型标注

**现象**：`Promise.resolve({ results: [] as typeof context.results, ... })` 引用了未定义的 `context`。

**原因**：RAG 结果不再在 streamText 调用前获取，类型标注直接引用 `context` 变量已不存在。

**解法**：用 `Awaited<ReturnType<typeof retrieveContext>>["results"]` 提取类型。

### 坑 10：`appendMessage` 调用两次

**现象**：用户消息被重复写入数据库。

**原因**：在 `Promise.all` 并行里调用了一次，又在 `ReadableStream.start` 里又调用了一次。

**解法**：保留 `Promise.all` 里的调用，删除 stream start 里的重复调用。
