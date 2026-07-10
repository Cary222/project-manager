# AI 工具链优化：从开发到测试复盘手册

> 适用：project-manager 仓库（Next.js + Prisma + Vercel AI SDK）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"AI 工具链优化"的端到端过程。
> 日期：2026-07-10（持续补充中）
> PR：PR10（持续迭代中）

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

| 问题 | 业务影响 |
|------|----------|
| **AI 返回空文本但参考来源有内容** | 用户看到"根据参考来源..."却没有 AI 回答，体验断裂 |
| **简单问题响应耗时 116 秒** | 用户以为系统卡死，实际上是 AI 被提前终止 |
| **用户深挖时无缓存预加载** | 每次深挖都需要重新 embedding 查询，响应慢 |
| **用户数据来源不一致** | `getUserProfileAction` 只查"创建的工单"，而 AI 搜索"被指派的工单" |
| **Embedding 服务不可用时无提示** | 日志无明确错误，开发调试困难 |

### 1.2 结论

- **stopWhen 步数限制**：从 6/8/4/2 增加到 20/25/15/3，给 AI 充足空间完成工具调用 + 生成文本
- **预测性预加载缓存**：auto 模式下用户查询实体时，后台异步预加载 searchKnowledge 结果
- **用户数据合并**：profile 页面合并"被指派" + "创建"的工单
- **Embedding 错误处理**：明确日志 + 优雅降级
- **search mode 工具引导**：buildSystemPrompt 增加 mode 参数，LLM 不再死循环调用 searchStructured

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/tools/index.ts` | 修改 | AI 模式策略配置，search mode maxSteps 从 3→8→25，auto mode maxSteps 6→20 |
| `features/ai/lib/speculation-cache.ts` | 新增 | 预测性预加载缓存模块 |
| `features/ai/tools/search-knowledge.ts` | 修改 | 增加 embedding 错误处理和优雅降级；description 增加【搜索第一步优先用这个】前缀 |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修改 | buildSystemPrompt 增加 mode 参数注入不同 tool 引导；search mode 清空 toolRules 避免矛盾；集成预缓存逻辑，增加日志 |
| `features/profile/lib/profile-actions.ts` | 修改 | 合并"被指派"+"创建"的工单数据 |
| `features/ai/tools/search-structured.ts` | 新增 | 结构化数据搜索工具 |
| `shared/lib/search.ts` | 修改 | embedding 错误日志 + 关键词搜索分词修复 |
| `docs/ai/agnes-tool-calling.md` | 修改 | AI 工具调用文档更新 |

---

## 3. 核心实现

### 3.1 模式策略配置（`features/ai/tools/index.ts`）

```1:54:features/ai/tools/index.ts
```

**为什么这样写**：
- `stopWhen: stepCountIs(N)` 在第 N 步触发停止，此时模型已没有新 step 可用，会完成当前 step 的文本生成
- 旧版 `maxSteps=6` 导致 AI 在第 6 步刚完成工具调用就被终止，还没生成文本就被中断
- 新版大幅增加步数限制，确保 AI 有充足空间完成多轮工具调用

### 3.2 预测性预加载缓存（`features/ai/lib/speculation-cache.ts`）

```1:181:features/ai/lib/speculation-cache.ts
```

**为什么这样写**：
- 设计理念类似 CPU 流水线预取（Speculative Execution）
- 用户查询实体时后台异步预加载，用户深挖时直接命中缓存
- 实体匹配使用模糊匹配（工单号、用户名、项目名），提高命中率
- TTL 5 分钟 + 惰性清理，避免内存泄漏

### 3.3 Embedding 错误处理（`features/ai/tools/search-knowledge.ts`）

```48:88:features/ai/tools/search-knowledge.ts
```

**为什么这样写**：
- 当 embedding 服务不可用时，返回明确的 `_error` 字段
- 让 AI 可以告知用户知识库检索暂时不可用，而不是静默失败
- 同时在 `shared/lib/search.ts` 中增加详细的 warn 日志

### 3.4 用户数据合并（`features/profile/lib/profile-actions.ts`）

```140:169:features/profile/lib/profile-actions.ts
```

**为什么这样写**：
- 旧版只查询用户"创建的工单"，与 AI searchStructured 的"被指派工单"不一致
- 新版合并两个数据源：先加入被指派的（优先级更高），再补充创建的
- 使用 Map 去重，避免同一条工单出现两次

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `EMBEDDING_API_URL` | `http://192.168.1.14:5000` | Embedding 服务地址 |
| `EMBEDDING_TIMEOUT_MS` | `30000` | Embedding 超时（毫秒） |
| `EMBEDDING_DIMENSIONS` | `1024` | Embedding 向量维度 |
| 项目端口 | `3003` | Next.js 开发服务器 |
| AI SDK | `ai@^7.0.11` | Vercel AI SDK |

---

## 5. 启动 / 部署

```bash
# 1. 确认 Embedding 服务运行
curl -s -w "\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
  -X POST http://192.168.1.14:5000/embed \
  -H "Content-Type: application/json" \
  -d '{"text":"test"}' --max-time 10

# 2. 启动 Next.js 开发服务器
cd /Users/vastgui/Desktop/project-manager
npm run dev

# 3. 确认服务正常
curl -s http://localhost:3003/api/health || echo "Check server status"
```

---

## 6. 测试 & 验证

### 6.1 Embedding 服务验证

```bash
curl -s -X POST http://192.168.1.14:5000/embed \
  -H "Content-Type: application/json" \
  -d '{"text":"cary 最近开发的那一单是什么"}' --max-time 10
```

**期望输出**：
```
{"embedding":[...1024 个浮点数...]}
HTTP Status: 200
Time: ~0.2s
```

### 6.2 AI 对话验证

在浏览器中访问 `http://localhost:3003`，发送消息：`cary 最近开发的那一单是什么`

**期望输出**：
- 响应时间 < 60 秒
- AI 返回文本内容（非空）
- 参考来源显示相关工单

### 6.3 预缓存验证

发送消息：`工单 #10085 具体是什么，有设计什么笔记附件`

查看服务器日志：

**期望输出**：
```
[SpeculationCache] HIT conv=xxx query="工单 #10085..."
[searchKnowledge] cache HIT for "工单 #10085 周报需求...", returning 4 results
```

---

## 7. 复现 Checklist

- [ ] 确认 Embedding 服务在 `192.168.1.14:5000` 运行
- [ ] `curl` 测试 embedding 接口响应正常（< 1s）
- [ ] 启动 Next.js：`npm run dev`（端口 3003）
- [ ] 浏览器打开 `http://localhost:3003` 并登录
- [ ] 测试 AI 对话：发送 `cary 最近开发的那一单是什么`
- [ ] 确认响应时间 < 60 秒（非 116 秒）
- [ ] 确认 AI 返回文本内容（非空）
- [ ] 测试深挖：发送 `工单 #10085 具体是什么`
- [ ] 查看日志确认 `SpeculationCache HIT`
- [ ] 测试 profile 页面：用户被指派的工单也显示

---

## 8. 踩坑记录

### 坑 1：AI 返回空文本但参考来源有内容（textChars=0）

**现象**：
```
[AI-SSE] fullStream done. textDelta=0, textChars=0, toolCall=5, toolResult=5, unknown=51
[AI-SSE] result.text len=0, preview=""
POST /api/ai/conversations/... 200 in 113s
```

**原因**：`stopWhen: stepCountIs(N)` 在第 N 步触发停止时，模型已没有新 step 可用。LLM 在当前 step 完成工具调用后，正要 flush 文本时，步数限制触发导致 Controller 被关闭，text 从未发出。

**解法**：大幅增加各模式 maxSteps，确保 LLM 有充足空间完成所有工具调用后再生成文本：
```typescript
// features/ai/tools/index.ts
const POLICIES: Record<ToolMode, ModePolicy> = {
  auto:   { tools: { searchStructured, searchKnowledge }, maxSteps: 20 },  // 旧：6
  search: { tools: { searchKnowledge, searchStructured }, maxSteps: 25 },  // 旧：3→8
  chat:   { tools: {},                                    maxSteps: 3 },  // 旧：2
  web:    { tools: { webSearch, searchStructured },       maxSteps: 15 }, // 旧：4
};
```

**教训**：`stopWhen` 触发时整个流立即终止，没有任何 text 缓冲机制。步数必须足够大，让 LLM 在倒数第 N 步之前完成所有工具调用，倒数第 1 步专注生成文本。

### 坑 2：Embedding 服务不可达导致超时

**现象**：
```bash
curl http://192.168.1.14:5000/health
# 输出：Service unreachable
```

响应时间 30 秒超时（因为 `EMBEDDING_TIMEOUT_MS=30000`）

**原因**：Embedding 服务未启动或网络不可达

**解法**：
1. 启动 Embedding 服务：`cd ~/embedding && python api.py`
2. 或检查防火墙/网络配置
3. 增加错误日志提示：
```typescript
// shared/lib/search.ts
if (msg.includes("EMBEDDING_API_TIMEOUT")) {
  console.warn("[search:vector] Embedding service timeout (>30s), skipping vector search");
}
```

### 坑 3：用户数据来源不一致

**现象**：profile 页面显示的工单与 AI 搜索结果不一致

**原因**：
- `getUserProfileAction` 只查询 `creatorId = userId`（用户创建的工单）
- `searchStructured` 查询 `assignees.userId = userId`（用户被指派的工单）

**解法**：合并两个数据源
```typescript
// features/profile/lib/profile-actions.ts
// 1. 先查被指派的工单
const assignedTickets = await prisma.ticket.findMany({
  where: { assignees: { some: { userId } } },
  ...
});
// 2. 再查创建的工单
const createdTickets = user.createdTickets;
// 3. 用 Map 去重合并
const recentTicketsMap = new Map<string, UserTicketSummary>();
```

### 坑 4：Vercel AI SDK 没有 `maxSteps` 参数

**现象**：尝试使用 `maxSteps` 参数时报类型错误

**原因**：AI SDK v7 (`ai@^7.0.11`) 只有 `stopWhen` 参数，没有 `maxSteps` 参数

**解法**：继续使用 `stopWhen: stepCountIs(N)`，但大幅增加 N 值

### 坑 5：预缓存未命中（实体匹配问题）

**现象**：用户深挖时缓存未命中

**原因**：实体提取正则可能漏掉某些工单号格式

**解法**：`extractEntities` 函数支持多种工单号格式
```typescript
// 匹配工单号：工单 #123、工单:123、工单：123、工单123
const ticketMatches = query.match(/工单\s*[#：:]\s*(\d+)/gi);
const ticketMatches2 = query.match(/工单\s*\d+/i);
```

### 坑 6：多词查询返回 0 结果（中文无空格分词）

**现象**：
```
搜索 "cary笔记" → 0 结果
搜索 "cary" → 23 结果
搜索 "笔记" → 16 结果
```

**原因**：`searchKeywordCandidates` 用完整查询字符串搜索，而不是分词后的 terms。

```typescript
// 之前：直接用完整查询字符串（错误）
{ title: { contains: options.query, mode: "insensitive" } }
// "cary笔记" 作为一个整体搜索，数据库中没有这个连续字符串

// 修复后：使用 splitTerms 分词
const terms = splitTerms(options.query);
// "cary笔记" → ["cary", "笔", "记"]（中文 2-gram + 英文原样）
for (const term of terms) {
  orConditions.push({ title: { contains: term, mode: "insensitive" } });
  orConditions.push({ content: { contains: term, mode: "insensitive" } });
}
```

**教训**：中文没有空格分隔符，搜索 "cary笔记" 和 "cary 笔记"（有空格）是完全不同的结果。必须用 2-gram 分词处理中文。

### 坑 7：speculationCache.set() 每次调用都做 O(n) 全量清理

**现象**：缓存条目增多后，每次 set 操作变慢

**原因**：`set()` 方法每次都调用 `cleanup()` 遍历全量 Map

**解法**：惰性清理，每 10 次 set 才清理一次

```typescript
private cleanupCounter = 0;
private readonly CLEANUP_INTERVAL = 10;

set(...) {
  if (++this.cleanupCounter >= this.CLEANUP_INTERVAL) {
    this.cleanup();
    this.cleanupCounter = 0;
  }
  // ...
}
```

### 坑 8：retrieveContext 重复调用

**现象**：speculation 预加载时，retrieveContext 被调用两次（主流程 + 预加载）

**原因**：预加载逻辑独立调用了 `retrieveContext`，而主流程已经调用过一次

**解法**：复用 `ragPromise` 结果

```typescript
// 之前：重复调用
const ragPromise = retrieveContext(message, { limit: 5, ... });
retrieveContext(message, { limit: 8, ... })  // 浪费！

// 修复后：复用 ragPromise
ragPromise.then((context) => {
  speculationCache.set(conversationId, message, context);
});
```

### 坑 9：code-reviewer 误报 setSearchKnowledgeConversationId 未导入

**现象**：审查报告说 `setSearchKnowledgeConversationId` 未导入

**实际**：该函数已在 `features/ai/tools/search-knowledge.ts:19` 定义，并在 `messages/route.ts:16` 正确导入

**教训**：审查报告可能有误，需要交叉验证实际代码

### 坑 10：search mode 下 LLM 死循环调用 searchStructured，从不调用 searchKnowledge

**现象**：
```
[AI-MSG] tools=searchKnowledge,searchStructured useRag=true
[searchStructured] type=ticket filters={"userId":"许敏捷"}  # 5次重复调用
[searchKnowledge]  # 0次调用！
textChars=0  # 流被截断，无文本输出
```

**原因**：三层叠加：
1. `searchKnowledge` description 只说"语义检索"，LLM 不知道它可以用来找人
2. `buildSystemPrompt` 原来只有 `useRag: boolean`，没有 mode 上下文，不知道该优先用哪个工具
3. `toolRules` 里"必须用 type=user" 与 modeHint 里"禁止用 type=user" 矛盾，LLM 无所适从

**解法（三步）**：
1. `searchKnowledge` description 加 `【搜索第一步优先用这个】` 前缀 + 明确使用场景
2. `buildSystemPrompt` 增加 `mode: string` 参数，根据 mode 注入不同 tool 引导
3. search mode 下清空 `toolRules`（避免矛盾冲突）
```typescript
// features/ai/tools/search-knowledge.ts
export const searchKnowledge = tool({
  description:
    "【搜索第一步优先用这个】在 ProjectHub 知识库做语义检索。能通过关键词找到任何人（输入中文姓名即可）、任何项目、任何工单相关的讨论。使用场景：问某人最近在做什么；搜索关键词不明确的问题；需要综合搜索多个类型。",
  ...
});

// app/api/ai/conversations/[id]/messages/route.ts - buildSystemPrompt
const modeHints: Record<string, string> = {
  search: `【知识检索模式必须遵守以下规则】
RULE 1（最高优先级）：第一步必须调用 searchKnowledge，输入用户原话即可。
RULE 2（绝对禁止）：禁止用 searchStructured 的 type=user 或 userId="中文名" 去查人。
RULE 3：searchKnowledge 返回结果后，再用 searchStructured 补充查详情。`,
  ...
};
// search mode 禁用 toolRules（避免与 modeHint 冲突）
const toolRules = mode === "search" ? `` : `...`;
```

**教训**：
- LLM 主要依赖 tool description 和 system prompt 前几行做决策
- 互相矛盾的 system prompt 会让 LLM 随机选工具
- 必须在 buildSystemPrompt 层面区分 mode，而不是只传 boolean

### 坑 11：中文引号导致 TypeScript 语法错误

**现象**：`tsc --noEmit` 报错
```
features/ai/tools/search-knowledge.ts(18,112): error TS1005: ',' expected.
```

**原因**：description 字符串里用了中文引号 `「某人在做什么/最近"」`，TS 把 `"` 当成 JS 字符串结束符。

**解法**：去掉中文引号，改用纯中文或全角符号：
```typescript
// 错误
"使用场景：① 问"某人在做什么/最近" ② 搜索..."  // 中文引号破坏 JS 字符串

// 正确
"使用场景：问某人最近在做什么；搜索关键词不明确的问题；..."  // 去掉引号
```

**教训**：description 等纯展示文本中也要避免任何中文引号（`""` `''` `「」` `` ``` ``），统一用中文句号或分号分隔。

### 坑 12：search mode 下 useRag=true 导致 retrieveContext 污染 system prompt

**现象**：search mode 问"许敏捷最近在干啥"，retrieveContext 返回空，system prompt 告诉 LLM "没有找到相关信息"，LLM 被暗示放弃调用 searchKnowledge。

**原因**：`buildSystemPrompt` 在 search mode 下会把 `useRag=true` 的预检索结果注入 system prompt，但这与 searchKnowledge 自搜索的目的冲突。

**验证结果**：实际代码中 `retrieveContext` 只在 `onFinish` 中使用（提取 sources），不参与 system prompt 构建。所以这不是 bug，但 search mode 的 `useRag` 语义容易混淆。设计上 search mode 让 LLM 自己决定何时调用 searchKnowledge，不需要预检索注入。

**教训**：search mode 的 `useRag` 语义是"是否预加载知识库上下文到 system prompt"，但 searchKnowledge 的设计是"LLM 自己决定何时搜索"。两者语义不兼容，未来可以考虑让 search mode 始终 `useRag=false`，让 LLM 完全依赖工具调用。

---

## 附录：相关文档

- [AI 工具调用文档](./agnes-tool-calling.md)
- [PR10 Code Review](./reviews/PR10-speculation-cache-code-reviewer.md)
- [AI Tool Optimization Review](./reports/PR10-ai-tool-optimization-review.md)
