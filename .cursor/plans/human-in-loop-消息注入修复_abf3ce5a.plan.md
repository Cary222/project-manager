---
name: human-in-loop 消息注入修复
overview: 用户选"1"后，通过在 messages 中注入内部 AI 消息 + searchStructured 重跑，保持 Tool 幂等，不引入 checkpointer。
todos:
  - id: project-fix-route
    content: "route.ts: 消息注入（第二轮调用时注入内部 AI 消息）"
    status: pending
  - id: project-fix-search
    content: "search-structured.ts: confirmedUserId 分支重跑（从历史构建增强查询）"
    status: pending
  - id: project-fix-confirm
    content: "human-confirmation.ts: 插入理解确认消息"
    status: pending
  - id: project-verify
    content: "验证: tsc + dev 测试"
    status: pending
isProject: false
---

# Plan: Human-in-Loop 消息注入修复（项目线）

## 核心原则

| 问题 | 决策 |
|------|------|
| 如何保存用户确认 | ✅ 在 messages 中插入内部 AI/System 消息 |
| searchStructured 是否重跑 | ✅ 重跑，保持 Tool 幂等 |
| 是否引入 MemorySaver | ❌ 不引入，收益远小于成本 |

**一句话**：把"用户确认"当成一次新的用户输入，不中断，不 hack。

## 现状问题

```
用户: "刘工最近在做什么"
AI:    candidates=[cary, zhangjing] → pendingConfirmation
前端:  用户点 cary → handleSend("cary") → 新一轮 graph.invoke()
问题:  第二次 graph.invoke() 时 conversation history = [原问题, "cary"]
       searchStructuredNode 拿到 content="cary"，提取 user="cary"
       查的是 "cary 最近" 而不是 "刘工最近"
```

## 修复方案

### 关键洞察

不要偷偷塞变量，而是往 messages 里加一条系统可见的内部消息：

```
User:
刘工最近在做什么

Assistant:
找到多个用户：
1. 张靖
2. 张强
请选择。

User:
张靖

Assistant (internal):
User confirmed that "刘工" -> userId=u123, displayName=张靖
```

LLM 看到这条内部消息后，直接知道 entity 已绑定，无需猜测。

### 改动文件（3 个）

| 文件 | 改动 |
|------|------|
| `app/api/ai/conversations/[id]/messages/route.ts` | 检测用户选择，注入内部 AI 消息 |
| `features/ai/graph/nodes/search-structured.ts` | 读取内部消息的 confirmedUserId，重跑时从历史构建增强查询 |
| `features/ai/graph/nodes/human-confirmation.ts` | 确认后插入理解确认消息 |

---

## 1. `route.ts` — 消息注入

**位置**：`app/api/ai/conversations/[id]/messages/route.ts`

**逻辑**：当 `pendingState` 存在且用户发送的是选择（数字或候选名），在 `langgraphMessages` 中注入内部消息：

```typescript
// 检测用户是否在选择候选项
function isUserSelection(
  message: string,
  candidates: Array<{ id: string; name: string }>
): boolean {
  // 纯数字（1/2/3）
  const num = parseInt(message.trim());
  if (!isNaN(num) && num >= 1 && num <= candidates.length) return true;
  // 候选名（完整或部分匹配）
  const lower = message.toLowerCase().trim();
  return candidates.some(
    c => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower
  );
}

// 解析用户选择
function resolveCandidate(
  message: string,
  candidates: Array<{ id: string; name: string }>
): { id: string; name: string } {
  const num = parseInt(message.trim());
  if (!isNaN(num) && num >= 1 && num <= candidates.length) {
    return candidates[num - 1];
  }
  const lower = message.toLowerCase().trim();
  return candidates.find(
    c => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower
  )!;
}

// 在 langgraphMessages 构建时注入内部消息
if (pendingState?.pendingConfirmation) {
  const { candidates, query } = pendingState.pendingConfirmation;
  if (isUserSelection(message, candidates)) {
    const confirmed = resolveCandidate(message, candidates);
    // 注入内部消息：告知 LLM 用户确认了哪个实体
    langgraphMessages.push(
      new AIMessage({
        content: `[Internal] User confirmed that the entity in original query "${query}" refers to ${confirmed.name} (userId=${confirmed.id}). This is a clarification, not a new question.`,
        name: "__system_internal__",
      })
    );
  }
}
```

---

## 2. `search-structured.ts` — 增强查询

**位置**：`features/ai/graph/nodes/search-structured.ts`

**逻辑**：在第二轮 `searchStructuredNode` 中，有 `confirmedUserId` 时，从 `state.messages` 中找原始问题，构建增强查询用于类型解析：

```typescript
// 在 searchStructuredNode 中，找到消息入口处理
// 假设入口在函数开头，已解析出 content 和 langgraphMessages

// 检测是否来自内部确认消息
const internalMsg = langgraphMessages.find(
  m => (m as AIMessage).name === "__system_internal__"
);
if (internalMsg) {
  // 提取 confirmedUserId
  const confirmedMatch = (internalMsg.content as string).match(/userId=(\w+)/);
  const confirmedUserId = confirmedMatch?.[1];
  
  if (confirmedUserId) {
    // 从历史消息中找原始问题（跳过 __system_internal__ 消息）
    const originalHumanMsg = langgraphMessages
      .slice() // 逆序
      .reverse()
      .find(
        m => m.getType() === "human" && (m as HumanMessage).name !== "__system_internal__"
      );
    const originalQuery = originalHumanMsg?.content as string;
    
    // 构建增强查询（仅用于类型解析和日志，不改变查询逻辑）
    const confirmedName = pendingConfirmation?.candidates
      .find(c => c.id === confirmedUserId)?.name ?? confirmedUserId;
    
    const enhancedQuery = originalQuery
      ? `用户已确认目标是 ${confirmedName}（${confirmedUserId}）。原问题："${originalQuery}"`
      : `用户选择了 ${confirmedName}`;
    
    // 用增强查询用于类型解析（保持 Tool 幂等）
    effectiveQuery = enhancedQuery;
    // filters 用 confirmedUserId 精确查数据（效率不变）
    // 最终查的是 "confirmedUserId 的最近动态"，符合幂等性
  }
}
```

---

## 3. `human-confirmation.ts` — 理解确认消息

**位置**：`features/ai/graph/nodes/human-confirmation.ts`

**逻辑**：用户确认后，在 `messages` 中追加一条 AI 的理解确认消息：

```typescript
// 确认成功后，返回理解确认消息
return {
  waitingForConfirmation: false,
  pendingConfirmation: null,
  messages: [
    ...state.messages,
    new AIMessage(`好的，你选择的是 ${confirmedCandidate.name}。我来查一下他的最近动态……`),
  ],
};
```

---

## 验证流程

```bash
# 1. 类型检查
npx tsc --noEmit

# 2. 启动开发服务器
npm run dev

# 3. 测试场景
# 3a. 用户: "刘工最近在做什么" → AI 返回候选列表
# 3b. 用户: 点击 cary / 发送 "1"
# 3c. 验证: AI 回答 "cary 最近..." 而不是 "你选择了 cary"
# 3d. 验证: 对话历史完整，没有"断裂感"
# 3e. 验证: searchStructured 第二次拿到正确的增强查询
```

---

## 改动摘要

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `route.ts` | ~20 行 | 消息注入逻辑 |
| `search-structured.ts` | ~25 行 | 增强查询构建 |
| `human-confirmation.ts` | ~5 行 | 理解消息 |

**总改动量**：小。均在现有架构内修复，不引入 checkpointer。
