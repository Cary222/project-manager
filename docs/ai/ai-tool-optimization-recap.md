# AI 工具链优化：从开发到测试复盘手册

> 适用：project-manager 仓库（Next.js + Prisma + Vercel AI SDK）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"AI 工具链优化"的端到端过程。
> 日期：2026-07-10
> PR：PR10

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

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/tools/index.ts` | 修改 | AI 模式策略配置，增加 maxSteps 限制 |
| `features/ai/lib/speculation-cache.ts` | 新增 | 预测性预加载缓存模块 |
| `features/ai/tools/search-knowledge.ts` | 修改 | 增加 embedding 错误处理和优雅降级 |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修改 | 集成预缓存逻辑，增加日志 |
| `features/profile/lib/profile-actions.ts` | 修改 | 合并"被指派"+"创建"的工单数据 |
| `features/ai/tools/search-structured.ts` | 新增 | 结构化数据搜索工具 |
| `shared/lib/search.ts` | 修改 | 增加 embedding 错误日志提示 |
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

### 坑 1：AI 返回空文本但参考来源有内容

**现象**：
```
[AI-SSE] fullStream done. textDelta=0, textChars=0, toolCall=6, toolResult=6
[AI-SSE] result.text len=0, preview=""
[AI-SSE] sending sources event with 6 sources
POST /api/ai/conversations/... 200 in 116s
```

**原因**：`stopWhen: stepCountIs(6)` 在第 6 步触发时，模型还没有生成文本就被终止。AI 完成工具调用后，正要开始生成文本时，步数限制触发了停止条件。

**解法**：
```typescript
// features/ai/tools/index.ts
const POLICIES: Record<ToolMode, ModePolicy> = {
  auto:   { tools: { searchStructured, searchKnowledge }, maxSteps: 20 },  // 6 → 20
  search: { tools: { searchKnowledge, searchStructured }, maxSteps: 25 },  // 8 → 25
  chat:   { tools: {},                                    maxSteps: 3 },  // 2 → 3
  web:    { tools: { webSearch, searchStructured },       maxSteps: 15 },  // 4 → 15
};
```

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

---

## 附录：相关文档

- [AI 工具调用文档](./agnes-tool-calling.md)
- [PR10 Code Review](./reviews/PR10-speculation-cache-code-reviewer.md)
- [AI Tool Optimization Review](./reports/PR10-ai-tool-optimization-review.md)
