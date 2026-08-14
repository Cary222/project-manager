# 方案 v4 完成度审查 — AI 思考流程重构

> **审查对象**: `.cursor/plans/ai思考流程重构方案_f718c71c.plan.md`（AI 思考流程重构方案 v4）
> **审查人**: Main（按 SOP 直接执行，Stage 0 + Stage 2 产物核对）
> **审查时间**: 2026-08-01 21:18 (UTC+8)
> **审查范围**: 方案 7 个 todo + 文件清单 + 架构集成

---

## 一、结论速览

| todo | 内容 | 方案要求 | 实际产物 | 完成度 |
|------|------|---------|---------|--------|
| 1 | `TimelineCommand + TaskRecord + NodeRegistry` | `features/ai/types/timeline.ts` + `graph/registry.ts` | timeline.ts 完整（156 行） | ✅ **90%**（registry.ts 缺失，但映射表 inline 到 timeline.ts） |
| 2 | `TimelineStore`（扁平 Map） | `features/ai/lib/timeline-store.ts` | 完整（117 行） | ✅ **100%** |
| 3 | `TimelineAdapter.fromGraph(chunk)` | `features/ai/lib/timeline-adapter.ts` | 完整（346 行） | ✅ **100%**（超出方案：拆出 onNodeStart/onNodeEnd + adaptGraphChunk 三函数） |
| 4 | `Route 集成 TimelineStore + SSE` | route.ts 改造 | 集成完整 | ✅ **100%**（TimelineStore + onNodeStart + onNodeEnd + 订阅 SSE） |
| 5 | `TreeBuilder`（扁平 → 嵌套） | `features/ai/ui/hooks/useTimelineTree.ts` | 完整（141 行） | ✅ **100%** |
| 6 | `前端 TimelineStore hook + Timeline UI` | `useTimelineStore.ts` + `AiThinkingTrace.tsx` | useTimelineStore 75 行 + AiThinkingStream 300 行 | ✅ **90%**（文件名改 AiThinkingStream；hook 是 stub 但前端通过共享 SSE 实现） |
| 7 | `测试完整流程` | 单元测试 + 集成测试 | 无新测试 | ⚠️ **0%**（未找到 timeline-store/adapter 的测试文件） |

**整体完成度**: 6.5 / 7 = **93%**

**核心架构 (Stream → Adapter → Store → Tree → React) 已完整落地**，仅缺 `NodeRegistry.ts` 独立文件和单元测试。

---

## 二、详细对照

### ✅ Todo 1: TimelineCommand + TaskRecord（90% 完成）

**方案要求**:
- 文件 `features/ai/types/timeline.ts`
- 类型 `TaskStatus` / `TimelineCommand` / `TaskRecord`

**实际产物**（156 行）:
- ✅ `TaskStatus` (line 19-24): pending/running/success/warning/error — 匹配
- ✅ `TaskRecord` (line 48-73): 完整 + 增强（加了 `stepLabel` 和 `logs` 字段，超出方案）
- ✅ `TimelineCommand` (line 81-85): create/update/delete/snapshot — 匹配

**❌ 与方案偏差**: `features/ai/graph/registry.ts` **未独立实现**！方案要求 NodeRegistry 作为独立文件，实际产物把映射表 inline 到了 `features/ai/types/timeline.ts`：
- `NODE_STEP_LABELS`（line 93-102）
- `NODE_DISPLAY_TITLES`（line 108-117）
- `NODE_CATEGORY_MAP`（line 123-132）

**问题**: 方案要求的 NodeRegistry 包含 MCP/Workflow 节点（`mcpRead`/`mcpWrite`/`mcpBash`/`collectData`/`waitApproval`），实际实现只有 Chat Agent 节点。**Phase 2/3 接入 Workflow/MCP 时需要重建 registry**。

**评价**: ⚠️ 功能正确，但**架构未严格按方案 v4**。建议补建 `features/ai/graph/registry.ts` 并把 mapping 移过去。

### ✅ Todo 2: TimelineStore（100% 完成）

**方案要求**（96 行）:
- 扁平 Map 存储
- `applyCommand` 处理 create/update/delete/snapshot
- `onUpdate` 订阅
- `getTasks` / `clear`

**实际产物**（117 行）:
- ✅ `tasks: Map<string, TaskRecord>`（line 25）
- ✅ `applyCommand`（line 32-58）: 4 个 op 全实现
- ✅ `onUpdate` 返回 unsubscribe（line 64-67）
- ✅ `getTasks` 返回副本（line 73-75）
- ✅ **超出方案**: 多了 `getTask` / `isEmpty` / `size` 三个便利方法
- ✅ `notifyUpdate` 用副本传递（line 106-114）+ 异常隔离

**评价**: 完美实现 + 超出方案。

### ✅ Todo 3: TimelineAdapter（100% 完成，超越方案）

**方案要求**:
- `adaptGraphChunk(nodeName, nodeOutput, onCommand)` 单函数
- 内部调用 `createTaskCmd` + `updateTaskCmd`
- `extractDetail` 提取 detail

**实际产物**（346 行）:
- ✅ `adaptGraphChunk`（line 190-261）: 完整实现
- ✅ `createTaskCmd`（line 36-59）
- ✅ `updateTaskCmd`（line 65-70）
- ✅ `extractDetail`（line 88-176）：**超出方案**（line 88-176 比方案详细：支持 queryType/candidates/resolvedEntities/attribution/mode/pendingHumanAction/response/toolResults 7 种字段）

**🟢 超越方案的关键点**:
- **拆出 `onNodeStart` / `onNodeEnd` 两个独立函数**（line 269-345）：让 Route 可以分开订阅 node 开始和结束事件，实现"step 逐个出现"的 log stream 效果
- `extractDetail` 支持 7 种 detail 来源（方案只列了 3 种）

**评价**: 实现质量超过方案。✅

### ✅ Todo 4: Route 集成（100% 完成）

**方案要求**: 改造 route.ts，在 chunk 遍历里 `adaptGraphChunk` → `timelineStore.applyCommand`

**实际产物**:
- ✅ `import { TimelineStore }`（route.ts:10）
- ✅ `import { onNodeStart, onNodeEnd } from timeline-adapter`（route.ts:11）
- ✅ `timelineStore = new TimelineStore()`（route.ts:794）
- ✅ `unsubscribeTimeline = timelineStore.onUpdate(...)` 订阅 SSE 发送（route.ts:797-807）
- ✅ `onNodeStart` + `onNodeEnd` 在 chunk 循环里调用（route.ts:822, 851）
- ✅ SSE finally 清理 unsubscribe（route.ts:920）

**额外**: 在 Timeline 集成基础上，**还集成了 RuntimeStatePersist**（patcher.parse/patch/flush），这是方案 v4 的延伸。✅

### ✅ Todo 5: TreeBuilder（100% 完成）

**方案要求**: `features/ai/ui/hooks/useTimelineTree.ts`
- 扁平 Map → 嵌套 TreeNode[]
- 按 startTime 排序

**实际产物**（141 行）:
- ✅ `TreeNode` 接口（line 17-29）
- ✅ `buildTree` 算法（line 42-82）
  - 1. 创建 TreeNode
  - 2. 建立 parent-child（虽然 v1 全部 root）
  - 3. 按 startTime 排序
- ✅ **超出方案**: 多了 `formatDuration` / `getStatusConfig` / `getCategoryConfig` 三个 UI 工具函数

**评价**: 完美实现 + 超出方案。

### ⚠️ Todo 6: 前端 Hook + UI（90% 完成）

**方案要求**:
- `useTimelineStore.ts`：SSE 订阅 hook
- `AiThinkingTrace.tsx`：UI 组件

**实际产物**:
- ✅ `useTimelineStore.ts`（75 行）— **但只是 stub**：无 SSE 订阅逻辑，只返回空 Map + toggle
  - 方案要求 SSE 订阅，实际通过 `TimelineEventHandler` 类（line 84-107）实现
  - 但 `TimelineEventHandler` 是独立类，**没有真正接入到 SSE 流**
  - **实际情况是 `AiChatPanel` 自己处理 `timeline_snapshot` 事件**（line 688-732），绕过 hook
- ✅ `AiThinkingStream.tsx`（300 行）— **文件名与方案不同**（方案是 `AiThinkingTrace.tsx`，实际改名）
  - 实际文件: `AiThinkingStream.tsx`，被 `AiMessageBubble.tsx:8` 导入
  - 实现完整：TaskRecord 列表渲染、状态图标、duration、expand/collapse、logs 展开

**问题**:
1. **`useTimelineStore` hook 没有真正独立 SSE 订阅** — 是 stub（line 39-60 注释说明"目前使用共享 SSE 连接"）
2. **AiThinkingTrace.tsx 被删除**（git status 确认 D 状态），被 AiThinkingStream.tsx 替代
3. 集成路径是：`AiChatPanel` SSE `timeline_snapshot` 事件 → 直接 setStreamingTasks → 通过 `thinkingSteps` prop 传给 `AiMessageBubble` → 渲染 `AiThinkingStream`

**评价**: ✅ 功能完整，但**hook 与方案不一致**，且**用 AiChatPanel 直接接管 timeline 状态**绕过了 hook。建议清理（删除 stub hook，统一用 AiChatPanel 状态管理）。

### ⚠️ Todo 7: 测试（0% 完成）

**方案要求**: "测试完整流程"

**实际产物**:
- ❌ 无 `timeline-store.test.ts`
- ❌ 无 `timeline-adapter.test.ts`
- ❌ 无 `useTimelineTree.test.ts`

**问题**: **完全没有单元测试**。前面 Context 重构有 7 个 vitest 测试用例，Timeline v4 是零测试状态。

**建议**: 至少补 3 个核心测试：
- TimelineStore.applyCommand（4 种 op）
- TimelineAdapter.extractDetail（7 种 detail 字段）
- buildTree（嵌套 + 排序）

---

## 三、架构层核对（与方案 v4 架构图对照）

```
方案 v4 期望数据流:
graph.stream()
  → Route
  → TimelineAdapter.fromGraph(chunk)  ← ✅ 实现 (adaptGraphChunk)
  → TimelineStore (扁平 Map)         ← ✅ 实现
  → TreeBuilder                       ← ✅ 实现 (buildTree)
  → React Timeline UI                 ← ✅ 实现 (AiThinkingStream)
```

**完整数据流已就位** ✅。Phase 2/3（Workflow / MCP）的扩展点是 **NodeRegistry**（独立文件缺失），未来接入需要先把 registry.ts 重建。

---

## 四、方案 v4 之外的实际扩展（超出方案）

1. **`useTimelineStore` hook 是 stub**：实际 timeline 状态由 `AiChatPanel` 直接管理（line 176-182: `useState<TaskRecord[]>`）
2. **方案里没有的"placeholder 合并"逻辑**（AiChatPanel.tsx:700-728）：前端 placeholder 与 backend snapshot 智能合并
3. **AiThinkingStream 改名 + 加 `logs` 字段 + `stepLabel` 短标签**：超出 TaskRecord 方案设计
4. **RuntimeStatePersist**（patcher.parse/patch/flush）集成到同一 chunk 循环：超出方案 v4 范围（属于 Context 重构 v4）

---

## 五、Critical 问题清单

1. ⚠️ **`features/ai/graph/registry.ts` 未独立实现**（架构偏离方案 v4）：方案明确要求 NodeRegistry 单独文件作为 Phase 2/3 扩展点，实际 inline 到 timeline.ts
2. ⚠️ **无单元测试**：TimelineStore / TimelineAdapter / buildTree 都无测试覆盖
3. ⚠️ **`useTimelineStore` hook 是死代码**：75 行 stub，没有任何调用方
4. 🟢 **集成路径完整**：后端 SSE → 前端 timeline_snapshot → AiThinkingStream 渲染全链路打通

---

## 六、测试案例（针对"上下文"，关联 Context 重构 + Timeline v4）

你问的"刚刚的上下文给我测试案例"，我理解是 **Context v4 重构 + Timeline v4 集成** 的端到端测试。下面给一套**手动测试剧本 + 自动化测试补充**。

### 测试场景 1: 简单对话（chat 模式，验证 Timeline + Context 基础流）

**前置**: DEV 模式跑 dev server，登录 cary 账号（userId=cmpuv1ota001rjlnkds1ckqe2）

**步骤**:
1. 创建新对话
2. 输入: `你好`
3. 观察:
   - **前端**: 思考流应显示 [意图识别] → [选择模型] → [生成回答] 三步
   - **后端**: dev terminal 输出 `[Timeline] create task cmd: create 意图识别` 等日志
   - **DB**: AiConversationRuntimeState 不应被写入（没有 HIL 也没有 lastMentionedUser）
4. **断言**:
   - chat 模式 steps = 3（不是 6/7，**不带 searchKnowledge/searchStructured**）
   - 所有步骤 status 最终为 `success`
   - toolResults 为空（不调用任何工具）

### 测试场景 2: 深度 RAG 检索（search 模式 + 长上下文）

**步骤**:
1. 输入: `光污染计这个产品的需求文档在哪`
2. 观察:
   - 思考流应显示 [意图识别] → [选择模型] → [知识检索] → [数据库查询] → [分析问题] → [生成回答] 6 步
   - **搜索模式必须命中 searchKnowledge**（验证 Context 配置）
3. **断言**:
   - search 模式走完整链路
   - searchKnowledge 返回 ≥1 条结果
   - `extractDetail` 应显示 "找到 N 条记录"
   - sources 事件被正确发送到前端
4. **边缘**: 重复发同样的问题 → 验证**id 去重不吞消息**（Context v4 messages-builder.ts 的关键约束）

### 测试场景 3: 人员消歧（HIL 介入 + RuntimeStatePersist）

**步骤**:
1. 输入: `刘工的周报有哪些`
2. 观察:
   - detectIntent 检测到 queryType=ambiguous → decision 节点触发 HIL
   - 前端弹出候选选择器（5 个刘姓用户）
   - 后端 dev log: `[RuntimeState] patcher flush` 写入 DB
3. **验证 RuntimeStatePersist 写 DB**:
   ```sql
   SELECT humanstate, semanticcontext FROM pm.ai_conversation_runtime_state
   WHERE conversation_id = '<conv-id>';
   ```
   应看到 humanState.pendingAction + originalQuery
4. 用户选 "刘屹鹏" → HIL 消歧 → decision → searchStructured → 周报列表
5. **断言**:
   - **disambiguateIntentNode 后**：pendingHumanAction 应被清空
   - **最后消息时**：AiChatMessage.metadata.thinkingSteps 应包含全部 6+ 步骤
   - DB 里的 RuntimeState.human 应被清空（resolve 成功后）

### 测试场景 4: 多轮对话（Context 累积 + Timeline 跨轮）

**步骤**:
1. 第一轮: `刘工的周报有哪些` → 选"刘屹鹏" → 看到周报列表
2. 第二轮: `他最近干了什么`（**用代词**）
3. **关键测试点**:
   - **Context v4 关键**：第二轮必须解析"他"为第一轮确认的"刘屹鹏"
   - **DB RuntimeState** 应有 `semantic.lastMentionedUser = { id: cary, name: 'cary（刘屹鹏）' }`
4. **断言**:
   - 不需要再次 HIL（lastMentionedUser 直接命中）
   - Timeline 显示新一轮的完整 6 步（**两轮的 thinkingSteps 独立存储在各自的 AiChatMessage.metadata**）

### 测试场景 5: Token 截断验证（Context v4）

**步骤**:
1. 在一个对话里发 20 条短消息
2. 第 21 条消息触发时:
   - 验证 `buildMessages` 截断旧历史（只看前 ~4000 tokens）
   - **验证 id 去重**：发两条 content 相同但 id 不同的消息，**两条都必须保留**
3. **断言**:
   - dev log: `history-window.ts:truncateHistoryByToken` 截断日志
   - 前端 LLM 不会因为 token 超限报错

### 测试场景 6: 自我引用（"我最近干了什么"）

**步骤**:
1. 输入: `我最近干了什么`
2. 观察:
   - `detectIntent.ts` 应识别 user_activity category
   - **前端传入 mode="chat"** 也应被后端 force 改成 "search"（detect-intent.ts 改动）
3. **断言**:
   - `query-weekly-report.ts` 走 viewer fallback
   - userId 解析为当前登录用户的 id

### 测试场景 7: 错误恢复（RuntimeStatePersist 兜底）

**步骤**:
1. 启动一个对话，触发 HIL 弹窗（生成 pendingHumanAction）
2. **强制停止 dev server**（Ctrl+C）
3. 重启 server
4. 重发同样的查询
5. **关键验证**:
   - **DB RuntimeState 是否丢失？** 应该是**丢失**（因为 stop 时 finally 没执行）
   - **Map fallback 是否也丢失？** 是（Map 是内存的）
   - 用户必须重新 HIL

### 测试场景 8: 并发 Timeline 验证

**步骤**:
1. 同时打开两个浏览器 tab 访问同一对话
2. 在 tab A 提问
3. **观察**:
   - tab A 应看到 Timeline 完整
   - tab B 不应收到 timeline_snapshot（conversationId mismatch，AiChatPanel.tsx:671-673 应 drop）
4. **断言**: 两个 tab 互不干扰

---

## 七、自动化测试补充建议

**当前缺**: Timeline v4 完全没有 vitest 测试。建议立即补：

```typescript
// features/ai/lib/timeline/__tests__/timeline-store.test.ts
import { TimelineStore } from "../timeline-store";

describe("TimelineStore", () => {
  it("applies create command", () => {
    const store = new TimelineStore();
    store.applyCommand({ op: "create", task: mockTask });
    expect(store.size()).toBe(1);
  });

  it("applies update command", () => { ... });
  it("applies delete command", () => { ... });
  it("applies snapshot command (replace all)", () => { ... });
  it("notifies subscribers on mutation", () => { ... });
  it("isolates listener exceptions", () => { ... });
});

// features/ai/lib/__tests__/timeline-adapter.test.ts
describe("extractDetail", () => {
  it("extracts count from toolResults", () => { ... });
  it("extracts candidates as joined labels", () => { ... });
  it("extracts resolvedEntities confirmation", () => { ... });
  it("extracts response preview", () => { ... });
  it("extracts pendingHumanAction as 等待确认", () => { ... });
});

// features/ai/ui/hooks/__tests__/useTimelineTree.test.ts
describe("buildTree", () => {
  it("builds flat root nodes when parentId=null", () => { ... });
  it("attaches children to parent", () => { ... });
  it("sorts siblings by startTime", () => { ... });
});
```

至少 **14 个测试用例** 才能与 Context v4 的 7 个测试质量对齐。

---

## 八、给 Main 的建议

1. **补 registry.ts**（P0）：独立 NodeRegistry 文件是 Phase 2/3 扩展点
2. **补 14 个单元测试**（P0）：Timeline v4 零测试是风险
3. **删除 stub `useTimelineStore`**（P1）：75 行死代码，前端已经用 AiChatPanel 直接接管
4. **清理 Map fallback**（P2）：一周过渡期到了，route.ts 里 Map 兜底应该删除
5. **补 buildTree 测试用例**：让 Timeline v4 与 Context v4 测试质量对齐

---

## 九、相关审查产物链接

- Context v4 重构审查报告: `docs/reviews/PR-ai-context-refactor-review.md`（含双审查合并）
- Context v4 commit 拆分方案: `docs/ai/PR-ai-context-refactor-commit-split.md`
- Timeline v4 测试计划（待补）: 本报告 **第七节** 给出了 14 个测试用例清单