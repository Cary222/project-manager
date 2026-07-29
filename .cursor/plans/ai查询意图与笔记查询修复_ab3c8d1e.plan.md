---
name: AI 查询意图识别与笔记查询修复
overview: 解决用户查询被误识别为用户名、缺少笔记结构化查询能力、以及 HIL 弹窗交互优化的问题。
todos:
  - id: fix-hil-custom-input
    content: "HIL 弹窗：添加自定义输入文本框"
    status: pending
  - id: fix-query-parser
    content: "query-parser：扩大排除词 + 业务关键词检测"
    status: pending
  - id: fix-query-user
    content: "query-user：找不到用户时触发 HIL 建议相关人员"
    status: pending
  - id: fix-query-weekly-report
    content: "query-weekly-report：无指定用户时返回全局周报列表"
    status: pending
  - id: create-query-note
    content: "新增 query-note.ts：笔记结构化查询"
    status: pending
  - id: extend-search-structured-core
    content: "search-structured-core：注册 note 类型 + 调用 query-note"
    status: pending
isProject: false
---

## 问题总结

### 问题 1：查询意图无法识别时的错误处理

**场景**：
- "光污染传感器需求" → 当前默认返回 `type="user"`，然后用"光污染传感器需求"作为用户名去匹配

**根本原因**：
- `parseQueryType()` 无法识别时默认返回 `"user"`
- 即使提取不到有效用户名，也会硬塞一个进去继续执行

### 问题 2：缺少笔记结构化查询能力

**场景**：
- "光污染传感器需求" 是一个 PKM 笔记
- 当前系统没有笔记的结构化查询工具，只有 RAG 向量查询

### 问题 3：意图不明确时用户体验差

**当前问题**：
- 意图不明确时默认当作用户查询
- 应该触发 HIL 让用户选择是什么类型（用户/笔记/工单/项目/周报）

---

## 架构问题：职责重叠

### 当前问题

| 文件 | 职责 | 问题 |
|------|------|------|
| `detect-intent.ts` | 判断 `AgentMode` (search/auto/web/chat) | 与 routing 边重复 `isUserActivityQuery()` |
| `query-parser.ts` | 判断 `QueryType` (ticket/user/project...) | 被 `searchStructuredNode` 调用，不在主流程中 |
| `routing.ts` | 边函数决定下一个节点 | 重复 `isUserActivityQuery()` 和 `isDeepContentQuery()` |

### 根本问题

1. **意图判断逻辑分散**：
   - `detectIntentNode` 判断 `mode`
   - `searchStructuredNode` 调用 `parseQueryType()` 判断 `type`
   - 职责不统一，导致重复和遗漏

2. **`query-parser.ts` 定位模糊**：
   - 作为 utility 被任意调用
   - 应该在主流程中作为唯一的意图识别入口

---

## 解决方案：统一意图识别架构

### 新架构

```
用户消息
    ↓
detectIntentNode（唯一意图识别入口）
    ↓
调用 query-parser.ts 核心函数
    ↓
┌─────────────────────────────────────────┐
│ query-parser.ts（统一意图判断）            │
│                                         │
│ parseQueryType(content) → QueryType     │
│   - ticket / project / weekly_report    │
│   - commit / note                       │
│   - user（含显式用户模式检测）            │
│   - ambiguous（无法识别）                │
│                                         │
│ extractUserIdentifier(content) → User    │
│   - 排除词清理                          │
│   - 英文/中文 token 提取                │
│                                         │
│ detectActivityWindow(content) → Window   │
│                                         │
│ isUserActivityQuery(content) → boolean  │
│ isDeepContentQuery(content) → boolean   │
└─────────────────────────────────────────┘
    ↓
返回 state:
  - mode: AgentMode (search/auto/web/chat)
  - queryType: QueryType (ticket/user/project/...)
  - extractedUser: ExtractedUser | undefined
  - activityWindow: ActivityWindow | undefined
  - isAmbiguous: boolean (是否需要 HIL)
    ↓
routing.ts（纯路由，不含判断逻辑）
    ↓ 根据 mode 路由
searchStructuredNode（纯执行，不含判断逻辑）
    ↓ 根据 queryType 执行对应查询
```

### 职责清晰化

| 组件 | 职责 |
|------|------|
| `detectIntentNode` | 唯一入口，调用 query-parser，设置 state |
| `query-parser.ts` | 所有意图判断逻辑（纯函数） |
| `routing.ts` | 纯路由逻辑（if-else 决定下一个节点） |
| `searchStructuredNode` | 纯执行逻辑（调用 core 执行查询） |

### 具体改动

1. **迁移函数到 query-parser.ts**：
   - 从 `detect-intent.ts` 迁移 `isUserActivityQuery()`
   - 从 `routing.ts` 迁移 `isDeepContentQuery()`

2. **修改 detectIntentNode**：
   - 调用 `parseQueryType()` → `state.queryType`
   - 调用 `extractUserIdentifier()` → `state.extractedUser`
   - 调用 `detectActivityWindow()` → `state.activityWindow`
   - 设置 `state.isAmbiguous = queryType === "ambiguous"`

3. **修改 routing.ts**：
   - 删除 `isUserActivityQuery()` 和 `isDeepContentQuery()`
   - 改为从 `state` 读取（由 detectIntentNode 设置）

4. **修改 searchStructuredNode**：
   - 从 `state.queryType` 读取，而非调用 `parseQueryType()`

---

## 改动文件清单

| 文件 | 改动 |
|------|------|
| `query-parser.ts` | 新增 `isUserActivityQuery()`、`isDeepContentQuery()`、`QueryType` 类型 |
| `detect-intent.ts` | 调用 query-parser 函数，设置 state |
| `routing.ts` | 删除重复函数，从 state 读取 |
| `search-structured-node.ts` | 从 state 读取 queryType |

---

## 核心改动：parseQueryType 的逻辑重构

### 改动前

```typescript
export function parseQueryType(content: string): QueryType {
  if (/工单|ticket|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  return "user"; // ← 问题：没有检查用户模式就默认当 user
}
```

### 改动后

```typescript
export function parseQueryType(content: string): QueryType {
  // 1. 精确匹配优先
  if (/工单|ticket|tickets?|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  if (/笔记|note|文档|需求|内容/i.test(content)) return "note";

  // 2. 用户查询模式检测（显式的用户+动作组合才返回 user）
  // "张三的周报", "刘工最近在干嘛", "cary 的工单"
  if (/^[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,60}\s*(?:的|最近|在干|干了|做了什么|工|老师|经理|总)/.test(content)) {
    return "user";
  }
  // "帮我查刘工", "请问 cary 是谁"
  if (/(?:帮我|请问|找|查|看)\s*[\u4e00-\u9fa5A-Za-z0-9_.\-@]{1,30}/.test(content) &&
      !/(?:项目|工单|笔记|周报|文档|需求)/.test(content)) {
    return "user";
  }

  // 3. 无法识别 → ambiguous（不再默认 user）
  return "ambiguous";
}

type QueryType = "ticket" | "project" | "user" | "commit" | "weekly_report" | "note" | "ambiguous";
```

### 关键逻辑

| 内容 | 改动前 | 改动后 |
|------|--------|--------|
| "光污染传感器需求" | 返回 `"user"` | 返回 `"ambiguous"` |
| "刘工的周报有哪些" | 返回 `"user"` | 返回 `"user"` |
| "张三最近在干嘛" | 返回 `"user"` | 返回 `"user"` |
| "cary的工单" | 返回 `"user"` | 返回 `"user"` |
| "本周周报有哪些" | 返回 `"weekly_report"` | 返回 `"weekly_report"` |

---

## 新增：Decision Layer（统一决策层）

根据 LangGraph 最佳实践，引入 **Decision Layer** 统一处理所有需要人工介入的决策点。

### 架构原则

```
Tool 执行后 → Decision Layer → Human / Continue

不是：
Tool → 自己决定 → 自己跳流程
```

### Decision Node 职责

| 决策类型 | 触发条件 | 动作 |
|----------|----------|------|
| 类型消歧 | `isAmbiguous = true` | 展示各类型候选，让用户选择 |
| 候选过多 | `candidates > 3` | 展示候选列表，让用户选择 |
| 审批确认 | `needsApproval = true` | 等待用户确认 |
| 降级处理 | `confidence < threshold` | 降级到 RAG |

### 流程对比

#### 改动前（ambiguous 判断散落在 searchStructuredNode）

```
用户输入 "光污染传感器需求"
    ↓
detectIntent → mode=search
    ↓
searchStructuredNode
    ├─ parseQueryType() → "ambiguous"  ← 职责混乱
    ├─ searchAmbiguousEntities()
    └─ 触发 HIL  ← 流程决策在执行节点中
    ↓
disambiguateIntent → 处理选择
    ↓
generateResponse
```

#### 改动后（统一 Decision Layer）

```
用户输入 "光污染传感器需求"
    ↓
detectIntentNode
    ├─ parseQueryType() → "ambiguous"
    ├─ set isAmbiguous = true
    └─ return state.mode, state.queryType, state.isAmbiguous
    ↓
searchStructuredNode（纯执行）
    ↓
decisionNode（统一决策层）
    ├─ isAmbiguous? → 展示候选 → HIL
    └─ candidates>3? → 展示列表 → HIL
    ↓
generateResponseNode
```

### decisionNode 的设计

```typescript
// features/ai/graph/nodes/decision.ts

export async function decision(
  state: AgentState
): Promise<Partial<AgentState>> {
  // 1. ambiguous 类型 → 需要选择实体类型
  if (state.isAmbiguous) {
    const candidates = await searchAmbiguousEntities(state.originalQuery);
    return {
      pendingHumanAction: {
        type: "select",
        entity: "ambiguous",
        entityType: "ambiguous",
        reason: "无法确定查询类型，请选择要查询的内容",
        candidates: formatCandidates(candidates),
        query: state.originalQuery,
      },
      waitingForConfirmation: true,
    };
  }

  // 2. searchStructured 返回候选过多 → 需要选择
  const toolResult = state.toolResults?.searchStructured;
  if (toolResult?.decision?.type === "human") {
    return {
      pendingHumanAction: {
        type: "select",
        entity: toolResult.decision.entity,
        entityType: toolResult.decision.entityType,
        reason: toolResult.decision.reason,
        candidates: toolResult.decision.candidates,
        query: state.originalQuery,
      },
      waitingForConfirmation: true,
    };
  }

  // 3. 无需决策 → 继续
  return {};
}
```

### decisionNode 的边路由

```typescript
// features/ai/graph/edges/routing.ts

export function routeAfterSearchStructured(state: AgentState): NextNode {
  // 任何 pendingHumanAction → decision
  if (state.pendingHumanAction) {
    return "decision";
  }
  return "generateResponse";
}

export function routeAfterDecision(state: AgentState): NextNode {
  // 继续执行 searchStructured（使用 resolvedEntities）
  if (state.resolvedEntities) {
    return "searchStructured";
  }
  // 用户取消 → 结束
  return END;
}
```

### 边路由更新

| 边 | 改动 |
|----|------|
| `routeAfterSearchStructured` | 从 `disambiguateIntent` 改为 `decision` |
| `routeAfterDecision` | 新增：从 `decision` 路由 |
| `routeAfterHumanConfirmation` | 从 `decision` 获取结果 |

### 改动文件清单

| 文件 | 改动 |
|------|------|
| `features/ai/graph/nodes/disambiguate-intent.ts` | 重命名为 `decision.ts` |
| `features/ai/graph/edges/routing.ts` | 更新路由函数 |
| `features/ai/graph/agent.ts` | 注册新节点名 `decision` |
| `search-structured-node.ts` | 删除 ambiguous 判断逻辑（移到 decision） |

---

## 解决方案

### Part 1: query-parser 核心改动

#### 1.1 修改 `parseQueryType` 返回类型和逻辑

```typescript
// 新增类型
type QueryType = "ticket" | "project" | "user" | "commit" | "weekly_report" | "note" | "ambiguous";

export function parseQueryType(content: string): QueryType {
  if (/工单|ticket|tickets?|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  // 新增：笔记关键词
  if (/笔记|note|文档|需求|内容/i.test(content)) return "note";
  // 无法识别 → ambiguous
  return "ambiguous";
}
```

#### 1.2 扩大排除词

```typescript
const excludeWords = [
  "周报", "日报", "月报", "工作", "事情", "任务", "项目", "业务", "开发",
  "需求", "文档", "笔记", "内容", "设计", "PRD", "传感器", "硬件", "功能",
  "缺陷", "bug", "问题", "的", "地", "得",
];

const excludePhrases = [
  "有哪些", "有什么", "是哪些", "的周报", "的日报", "的月报",
  "的需求", "的文档", "的笔记", "的内容", "的设计",
];
```

---

### Part 2: search-structured-node 支持 ambiguous 类型

#### 2.1 在 `searchStructuredNode` 中处理 ambiguous

```typescript
// features/ai/graph/nodes/search-structured.ts

// 检测到 ambiguous 类型
if (queryType === "ambiguous") {
  // 查询各类型实体的候选
  const candidates = await searchAmbiguousEntities(effectiveQuery, viewerUserId);

  if (candidates.length > 0) {
    // 触发 HIL 让用户选择
    return {
      pendingHumanAction: {
        type: "select",
        entity: "ambiguous",
        entityType: "ambiguous",
        reason: "无法确定查询类型，请选择要查询的内容",
        candidates: candidates.map((c) => ({
          id: c.id,
          label: c.label,
          summary: c.summary,
          entityType: c.entityType, // 携带实体类型
        })),
        query: effectiveQuery,
      },
      waitingForConfirmation: true,
    };
  }

  // 没有候选 → 尝试走 RAG
  return {
    mode: "search", // 触发 RAG 流程
  };
}
```

#### 2.2 新增 `searchAmbiguousEntities` 函数

```typescript
// features/ai/core/queries/query-ambiguous.ts

interface AmbiguousCandidate {
  id: string;
  label: string;
  summary: string;
  entityType: "user" | "note" | "ticket" | "project" | "weekly_report";
}

/**
 * 查询各类型实体的候选，用于 ambiguous 意图的场景。
 */
export async function searchAmbiguousEntities(
  query: string,
  viewerUserId?: string
): Promise<AmbiguousCandidate[]> {
  const results: AmbiguousCandidate[] = [];
  const limit = 3; // 每类最多返回 3 个候选

  // 并行查询各类实体
  const [users, notes, tickets, projects] = await Promise.all([
    // 用户搜索
    prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: query.slice(0, 10), mode: "insensitive" } },
          { searchName: { contains: query, mode: "insensitive" } },
        ],
        bannedAt: null,
      },
      take: limit,
      select: { id: true, name: true, email: true },
    }),
    // 笔记搜索（模糊匹配标题）
    prisma.pkmNote.findMany({
      where: { title: { contains: query, mode: "insensitive" } },
      take: limit,
      select: { id: true, title: true, updatedAt: true },
    }),
    // 工单搜索（模糊匹配标题）
    prisma.ticket.findMany({
      where: { title: { contains: query, mode: "insensitive" } },
      take: limit,
      select: { id: true, ticketNo: true, title: true },
    }),
    // 项目搜索（模糊匹配名称）
    prisma.project.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      take: limit,
      select: { id: true, name: true },
    }),
  ]);

  // 转换格式
  for (const u of users) {
    results.push({
      id: u.id,
      label: `${u.name}（用户）`,
      summary: u.email,
      entityType: "user",
    });
  }
  for (const n of notes) {
    results.push({
      id: n.id,
      label: `${n.title}（笔记）`,
      summary: `更新于 ${n.updatedAt.toLocaleDateString("zh-CN")}`,
      entityType: "note",
    });
  }
  for (const t of tickets) {
    results.push({
      id: t.id,
      label: `#${t.ticketNo} ${t.title}（工单）`,
      summary: "",
      entityType: "ticket",
    });
  }
  for (const p of projects) {
    results.push({
      id: p.id,
      label: `${p.name}（项目）`,
      summary: "",
      entityType: "project",
    });
  }

  return results;
}
```

---

### Part 3: decisionNode 处理 HIL 选择结果

当用户从 HIL 中选择后，`humanConfirmationNode` 处理选择，`decisionNode` 根据结果决定下一步：

```typescript
// humanConfirmationNode 处理选择后，设置 resolvedEntities

// decisionNode 路由
export function routeAfterDecision(state: AgentState): NextNode {
  // 用户从 ambiguous HIL 中选择了具体实体
  if (state.resolvedEntities?.user ||
      state.resolvedEntities?.note ||
      state.resolvedEntities?.ticket ||
      state.resolvedEntities?.project ||
      state.resolvedEntities?.weekly_report) {
    // 重新执行 searchStructured（使用 resolvedEntities）
    return "searchStructured";
  }
  return END;
}
```

### Part 3.1: 重命名 disambiguateIntent → decision

#### 3.1.1 重命名文件

```bash
mv features/ai/graph/nodes/disambiguate-intent.ts features/ai/graph/nodes/decision.ts
```

#### 3.1.2 更新节点名称

```typescript
// features/ai/graph/nodes/decision.ts

// 导出新名称
export const decision = disambiguateIntent;
export const humanConfirmation = disambiguateHumanConfirmation;
```

#### 3.1.3 更新 agent.ts 注册

```typescript
// features/ai/graph/agent.ts

import { decision, humanConfirmation } from "./nodes/decision";

const workflow = new StateGraph(AgentState)
  .addNode("decision", decision)
  .addNode("humanConfirmation", humanConfirmation)
  // ...
```

#### 3.1.4 更新 routing.ts

```typescript
// features/ai/graph/edges/routing.ts

export function routeAfterSearchStructured(state: AgentState): NextNode {
  // 任何 pendingHumanAction → decision
  if (state.pendingHumanAction) {
    return "decision";
  }
  return "generateResponse";
}

export function routeAfterDecision(state: AgentState): NextNode {
  if (state.pendingHumanAction) {
    return "humanConfirmation";
  }
  if (state.resolvedEntities) {
    return "searchStructured";
  }
  return END;
}

export function routeAfterHumanConfirmation(state: AgentState): NextNode {
  if (state.pendingHumanAction) {
    return "humanConfirmation";
  }
  if (state.resolvedEntities) {
    return "decision"; // 回到 decision 处理下一个决策
  }
  return END;
}
```

---

### Part 4: HIL 弹窗添加自定义输入

#### 4.1 修改 `AiCandidatePicker.tsx`

```typescript
interface AiCandidatePickerProps {
  onCustomInput?: (text: string) => void;
  customInputPlaceholder?: string;
}
```

#### 4.2 修改 `AiChatPanel.tsx`

```typescript
onCustomInput={(text) => {
  handleSend(text);
  setPendingCandidates(null);
}}
```

---

### Part 5: 新增笔记结构化查询

#### 5.1 创建 `query-note.ts`

（与之前计划相同，提供笔记的结构化查询能力）

#### 5.2 修改 `search-structured-core.ts`

注册 `note` 类型

---

## 实施步骤

1. **修改 `query-parser.ts`**：新增 `ambiguous` 类型 + `note` 类型
2. **创建 `query-ambiguous.ts`**：查询各类型实体的候选
3. **修改 `search-structured-node.ts`**：处理 `ambiguous` 类型
4. **修改 `disambiguate-intent.ts`**：处理 ambiguous HIL 选择
5. **修改 `human-confirmation.ts`**：支持自定义输入
6. **修改 `AiCandidatePicker.tsx`**：添加自定义输入框
7. **修改 `AiChatPanel.tsx`**：传递 `onCustomInput`
8. **创建 `query-note.ts`**：笔记结构化查询
9. **测试验证**

---

## 预期效果

| 查询 | 修复前 | 修复后 |
|------|--------|--------|
| "光污染传感器需求" | 尝试匹配用户名失败 | 展示各类型候选（笔记/用户/工单），用户选择后继续 |
| "本周周报有哪些" | 报错"未找到用户" | 识别为 weekly_report，直接返回周报列表 |
| HIL 弹窗 | 只能选列表 | 可选列表 + 可手动输入 |
| 模糊查询 | 默认当用户查 | ambiguous → HIL 选择类型 → 执行对应查询 |

---

## 解决方案

### Part 1: HIL 弹窗添加自定义输入

#### 1.1 修改 `features/ai/ui/AiCandidatePicker.tsx`

添加文本输入框，允许用户直接输入：

```typescript
import { useState } from "react";

interface AiCandidatePickerProps {
  // ... existing props
  onCustomInput?: (text: string) => void;
  customInputPlaceholder?: string;
}

export function AiCandidatePicker({
  isPage,
  options,
  onSelect,
  onCancel,
  onCustomInput,
  customInputPlaceholder = "输入其他内容...",
}: AiCandidatePickerProps) {
  const [customText, setCustomText] = useState("");

  return (
    <div className={`border-t border-ink-200 ${isPage ? "px-6 pt-4" : "px-3 pt-3"}`}>
      {/* 现有候选项列表 */}
      <div className="flex flex-wrap gap-2">
        {/* ... existing buttons ... */}
      </div>

      {/* 新增：自定义输入区域 */}
      {onCustomInput && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && customText.trim()) {
                onCustomInput(customText.trim());
                setCustomText("");
              }
            }}
            placeholder={customInputPlaceholder}
            className="flex-1 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 placeholder:text-ink-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="button"
            onClick={() => {
              if (customText.trim()) {
                onCustomInput(customText.trim());
                setCustomText("");
              }
            }}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
          >
            确认
          </button>
        </div>
      )}
    </div>
  );
}
```

#### 1.2 修改 `features/ai/ui/AiChatPanel.tsx`

传递 `onCustomInput` 回调：

```typescript
<AiCandidatePicker
  isPage={isPage}
  options={pendingCandidates}
  onSelect={(option) => {
    handleSend((option as CandidateUser).label ?? (option as CandidateUser).name ?? "");
    setPendingCandidates(null);
  }}
  onCancel={() => {
    handleSend("0");
    setPendingCandidates(null);
  }}
  onCustomInput={(text) => {
    // 直接发送用户输入的内容，让后端重新解析意图
    handleSend(text);
    setPendingCandidates(null);
  }}
  customInputPlaceholder="输入用户名或重新描述问题..."
/>
```

#### 1.3 修改 `features/ai/graph/nodes/human-confirmation.ts`

当用户输入的内容无法匹配任何候选时，清除 pendingHumanAction 让下一轮重新处理：

```typescript
// 在 parseSelection 函数中，当完全不匹配时返回特殊标记
if (result === null && trimmed.length >= 2) {
  return "custom_input";
}

// humanConfirmationNode 中处理
if (result === "custom_input") {
  return {
    waitingForConfirmation: false,
    pendingHumanAction: null,
    resolvedEntities: null,
  };
}
```

---

### Part 2: query-parser 增强

#### 2.1 修改 `features/ai/core/resolvers/query-parser.ts`

扩大排除词 + 增加业务关键词检测：

```typescript
// 扩大后的排除词
const excludeWords = [
  "周报", "日报", "月报", "工作", "事情", "任务", "项目", "业务", "开发",
  "需求", "文档", "笔记", "内容", "设计", "PRD", "传感器", "硬件", "功能",
  "缺陷", "bug", "问题", // 新增
  "的", "地", "得",
];

// 扩大后的排除词组
const excludePhrases = [
  "有哪些", "有什么", "是哪些", "的周报", "的日报", "的月报",
  "的需求", "的文档", "的笔记", "的内容", "的设计",
  "是什么", "的详情", "的内容是", // 新增
];

// 业务关键词：匹配后提前返回，不提取用户名
const businessKeywords = [
  "周报", "日报", "月报", "需求", "文档", "笔记", "内容", "设计",
  "PRD", "传感器", "硬件", "功能", "缺陷", "bug", "问题", "任务",
];

// 在 extractUserIdentifier 函数中增加检测
export function extractUserIdentifier(content: string): ExtractedUser | undefined {
  // ... 现有清理逻辑 ...

  // 新增：如果内容主要是业务关键词，不提取用户名
  const cleanedTokens = cleaned.split(/\s+/).filter(Boolean);
  const businessKeywordCount = cleanedTokens.filter(token => 
    businessKeywords.some(kw => token.includes(kw))
  ).length;

  // 如果业务关键词占比超过 50%，认为这不是用户查询
  if (cleanedTokens.length > 0 && businessKeywordCount / cleanedTokens.length > 0.5) {
    return undefined;
  }

  // ... 现有逻辑 ...
}
```

#### 2.2 修改 `parseQueryType` 函数

增加 `note` 类型识别：

```typescript
export function parseQueryType(content: string): "ticket" | "project" | "user" | "commit" | "weekly_report" | "note" {
  if (/工单|ticket|tickets?|#\d+/i.test(content)) return "ticket";
  if (/项目|module|组件|功能/i.test(content)) return "project";
  if (/周报|weekly.report/i.test(content)) return "weekly_report";
  if (/commit|提交/i.test(content)) return "commit";
  // 新增：笔记关键词
  if (/笔记|note|文档|需求|内容/i.test(content)) return "note";
  return "user";
}
```

---

### Part 3: 新增笔记结构化查询

#### 3.1 创建 `features/ai/core/queries/query-note.ts`

```typescript
/**
 * Note query for search-structured.
 * Provides structured access to PKM notes with full metadata.
 */

import { prisma } from "@/shared/db/client";
import type { StructuredResult, SourceReference } from "@/features/ai/types/structured";

export interface NoteQueryInput {
  id?: string;
  filters?: {
    title?: string;        // 标题模糊匹配
    userId?: string;       // 笔记作者
    projectId?: string;    // 关联项目
    activityWindow?: "today" | "yesterday" | "this_week" | "this_month" | "recent";
  };
  limit?: number;
}

/**
 * Execute a note query with optional filters.
 */
export async function queryNote(
  input: NoteQueryInput,
  _viewerUserId?: string
): Promise<StructuredResult> {
  const { id, filters } = input;

  // 按 ID 查询
  if (id) {
    const note = await prisma.pkmNote.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, email: true } },
        project: { select: { name: true } },
      },
    });

    if (note) {
      return {
        summary: `笔记标题：${note.title}
作者：${note.user?.name ?? "未知"}
项目：${note.project?.name ?? "无"}
创建时间：${note.createdAt.toLocaleString("zh-CN")}
更新时间：${note.updatedAt.toLocaleString("zh-CN")}
标签：${note.tags?.join("、") ?? "无"}
链接：/notes/${note.id}`,
        sources: [{
          index: 1,
          title: note.title,
          url: `/notes/${note.id}`,
          type: "note" as const,
        }],
      };
    }

    return { summary: `未找到笔记：${id}`, sources: [] };
  }

  // 按条件查询列表
  const where: Record<string, unknown> = {};

  if (filters?.userId) {
    where.userId = filters.userId;
  }

  if (filters?.projectId) {
    where.projectId = filters.projectId;
  }

  if (filters?.title) {
    where.title = { contains: filters.title, mode: "insensitive" };
  }

  // 时间窗口
  if (filters?.activityWindow) {
    const windowStart = getWindowStart(filters.activityWindow);
    if (windowStart) {
      where.updatedAt = { gte: windowStart };
    }
  }

  const notes = await prisma.pkmNote.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: input.limit ?? 10,
    include: {
      user: { select: { name: true } },
      project: { select: { name: true } },
    },
  });

  if (notes.length === 0) {
    return { summary: "未找到符合条件的笔记", sources: [] };
  }

  const lines = [`找到 ${notes.length} 条笔记：`];
  const sources: SourceReference[] = notes.map((note, i) => {
    const projectName = note.project?.name ?? "无项目";
    lines.push(`${i + 1}. ${note.title}｜作者: ${note.user?.name ?? "未知"}｜项目: ${projectName}｜更新于 ${note.updatedAt.toLocaleDateString("zh-CN")} → /notes/${note.id}`);
    return {
      index: i + 1,
      title: note.title,
      url: `/notes/${note.id}`,
      type: "note" as const,
    };
  });

  return {
    summary: lines.join("\n"),
    sources,
  };
}
```

#### 3.2 修改 `features/ai/core/search-structured-core.ts`

注册 `note` 类型：

```typescript
// 添加 import
import { queryNote } from "@/features/ai/core/queries/query-note";

// 修改 schema
export const searchStructuredInputSchema = z.object({
  type: z.enum(["ticket", "project", "user", "commit", "weekly_report", "note"]), // 添加 note
  // ...
});

// 添加 case
switch (type) {
  case "note":
    result = await queryNote({ id, filters }, viewerUserId);
    break;
  // ...
}
```

#### 3.3 修改 `features/ai/graph/nodes/search-structured.ts`

支持 `note` 类型：

```typescript
// 添加 note 的 resolved 处理
if (resolvedNote) {
  queryType = "note";
  queryText = `note:${resolvedNote.id}`;
  filters = { id: resolvedNote.id };
}

// 添加 note 类型到 switch
let queryType: "ticket" | "project" | "user" | "commit" | "weekly_report" | "note";
```

---

### Part 4: query-user 和 query-weekly-report 增强

#### 4.1 修改 `features/ai/core/queries/query-user.ts`

找不到用户时触发 HIL：

```typescript
// 在 !resolved.user 分支中添加
if (!resolved.user) {
  // 尝试模糊匹配相关用户
  if (queryText.length >= 2) {
    const relatedMembers = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: queryText.slice(0, 4), mode: "insensitive" } },
          { email: { contains: queryText, mode: "insensitive" } },
        ],
        bannedAt: null,
      },
      take: 5,
      select: { id: true, name: true, email: true },
    });

    if (relatedMembers.length > 0) {
      // 触发 HIL 选择
      return {
        summary: `未找到名为"${queryText}"的用户。以下是可能相关的成员：...`,
        decision: {
          type: "human" as const,
          entityType: "user",
          candidates: relatedMembers.map((u) => ({
            id: u.id,
            label: `${u.name}（${u.email}）`,
            summary: "",
          })),
        },
      };
    }
  }

  return { summary: `未找到用户：${queryText}`, sources: [] };
}
```

#### 4.2 修改 `features/ai/core/queries/query-weekly-report.ts`

无指定用户时返回全局周报列表：

```typescript
// 在 reports.length === 0 分支中添加
if (reports.length === 0) {
  // 如果没有 extractedUser，返回全局周报列表
  if (!extractedUser && !targetId) {
    const allReports = await prisma.weeklyReport.findMany({
      orderBy: { weekStart: "desc" },
      take: 10,
      include: {
        user: { select: { name: true } },
        projects: { include: { project: { select: { name: true } } } },
      },
    });

    if (allReports.length > 0) {
      const lines = ["周报列表："];
      allReports.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}｜${r.user.name}｜${formatReportPeriod(r.weekStart, r.weekEnd)} → /reports/weekly-reports/${r.id}`);
      });
      return {
        summary: lines.join("\n"),
        sources: allReports.map((r, i) => ({
          index: i + 1,
          title: r.title,
          url: `/reports/weekly-reports/${r.id}`,
          type: "weekly_report" as const,
        })),
      };
    }
  }

  return { summary: `暂无周报记录`, sources: [] };
}
```

---

## 实施步骤

1. **HIL 弹窗**：`AiCandidatePicker.tsx` → `AiChatPanel.tsx` → `human-confirmation.ts`
2. **query-parser**：`query-parser.ts` 排除词 + 业务关键词 + `note` 类型
3. **新增 query-note.ts**：笔记结构化查询
4. **search-structured-core**：注册 `note` 类型
5. **search-structured node**：支持 `note` 类型
6. **query-user**：无匹配时触发 HIL
7. **query-weekly-report**：无指定用户时返回全局列表
8. **测试验证**：各种查询场景

---

## 预期效果

| 查询 | 修复前 | 修复后 |
|------|--------|--------|
| "本周周报有哪些" | 报错"未找到用户" | 返回全局周报列表 |
| "光污染传感器需求" | 尝试匹配用户名失败 | 识别为笔记查询，返回笔记信息 |
| "张三的周报"（张三不存在） | 报错"未找到用户" | 弹出 HIL 选择相关人员 |
| HIL 弹窗 | 只能选列表 | 可选列表 + 可手动输入 |

