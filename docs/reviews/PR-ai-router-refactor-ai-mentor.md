# AI Router 重构 — 软层架构审查报告

<!-- reviewer: ai-learning-mentor (软层) -->
<!-- 审查范围：features/ai/routing/task-router.ts, features/ai/types/modes.ts, features/ai/llm/providers/types.ts, features/ai/llm/model-routing.ts, features/ai/llm/providers/registry.ts, features/ai/agents/conversation/nodes/detect-intent.ts, features/ai/agents/conversation/edges/routing.ts, features/ai/llm/model-selector.tsx -->

---

## 审查结论

**CHANGES_REQUIRED**

本次重构的方向正确，核心双 Router 架构设计合理，但有 **3 处软架构问题**需要在合并前修复。其中 2 处是语义歧义风险，1 处是能力与野心的错位。

---

## 审查维度 1：架构一致性 ✅（通过）

### 前端 / 后端 Router 边界

| 文件 | 定位 | 实际表现 | 评估 |
|------|------|----------|------|
| `features/ai/routing/task-router.ts` | 前端轻量 Hint，非权威 | `resolveIntent()` 只返回 `{category, toolMode}`，无任何副作用 | ✅ 符合 |
| `features/ai/agents/conversation/nodes/detect-intent.ts` | 后端最终权威判断 | 独立正则集 + detectMode() + detectWorkflowMatch()，完整闭环 | ✅ 符合 |

**验证**：前端 `resolveIntent` 和后端 `detectMode` 使用了**完全独立的正则集合**：
- 前端：`(?:帮我|请)?(?:生成|画|创作|制作)(?:一张|一幅)?/i` + 图片对象词
- 后端：`(?:生成|画|创作|制作)(?:一张|一幅|一张)?[的]?(?:.+?)?(?:图片?|图|画像|照片)/i` + `[:：]` 冒号格式

两者不共享代码、不相互调用，边界清晰。

### task-router 的接入点

计划中描述的是 `AiChatPanel.handleSend` 调用 `resolveIntent`，但代码中：
- `task-router.ts` 仅有函数定义
- `model-selector.tsx` 是独立的 ModelSelector 组件
- `detect-intent.ts` 的 `detectMode` 是后端唯一入口

**需要确认**：`task-router.ts` 是否已在某处被实际调用（代码 diff 中未看到 AiChatPanel 的改动）？如果只是写了但没用，属于"过度设计"问题（见审查维度 2）。

---

## 审查维度 2：是否过度设计 ⚠️（有条件通过）

### capabilities 匹配 — 设计过度，但尚未真正启用

`model-routing.ts` 接收 `capabilities?: ModelCapability[]` 参数：

```typescript
selectModel(
  taskType: TaskType,
  options?: {
    manualOverride?: string;
    defaults?: Partial<Record<TaskType, string>>;
    capabilities?: ModelCapability[]; // ← 新增，但未在 selectModel 体内使用
  }
)
```

实际代码中，`capabilities` 参数**从未被读取**，`selectModel` 仍然走 hardcoded defaults。`inferCapabilities` 虽然存在于 `registry.ts`，但也没有被 `selectModel` 调用。

**这意味着**：capabilities 匹配链路目前是"存根"——类型签 名有了，逻辑没有。这不是问题（后续可以补完），但需要明确**当前阶段的优先级**：
- 如果这次 PR 的目标是"Tab 重构 + task-router 新建"，capabilities 存根可接受
- 如果目标是"完整 capabilities 路由"，当前实现不完整，需要说明

### tier 分组 — 计划中提了，代码中没有

计划里描述 `chat 模式按 tier 分组（reasoning > strong > fast > standard）`，但 `model-selector.tsx` 的 `sortedModels` 只按 `fast` 标签排序，没有完整的 tier 分层。

**结论**：大部分"过度设计"其实是**计划与实现的对齐问题**，不是架构本身有问题。capabilities/tier 的引入方向是对的，只是实现还不完整。建议在 PR 描述中说明"capabilities 路由 v1（存根）"或"capabilities 路由 v2（完整）"，避免误导。

---

## 审查维度 3：可维护性 / 解耦 ✅（通过）

### task-router 解耦设计 — 优秀

```typescript
// task-router.ts
export interface ResolvedAiIntent {
  category: AiTaskCategory;
  toolMode?: ChatToolMode;
}

export function resolveIntent(input: string): ResolvedAiIntent
export function getTaskHint(intent: ResolvedAiIntent): string | undefined
```

**未来替换为 LLM 分类器**时的改动边界：
- 替换 `resolveIntent` 函数体 → 不需要改任何调用方
- `ResolvedAiIntent` 接口不变 → Model Selector / API Route 均无需改动

符合开闭原则，解耦设计合理。

### detect-intent 的可测试性

`detectMode()` 是纯函数（无副作用，参数是 string，返回 `AgentMode`），可直接单元测试。`task-router.test.ts` 已有 18 个用例覆盖。detect-intent 自身的测试覆盖未在这次 PR 中体现，但鉴于用户学习档案中已有 LangGraph StateGraph 实战经验，测试意识应该到位。

---

## 审查维度 4：命名与语义 ⚠️（发现问题）

### 四个核心概念的语义重叠分析

| 类型名 | 定义位置 | 语义含义 | 问题 |
|--------|----------|----------|------|
| `AiMode` | `modes.ts` | 完整模式：`"auto" \| "search" \| "chat" \| "web" \| "image" \| "video"` | 6 个值 |
| `AiTaskCategory` | `modes.ts` | UI Tab 级别：`"auto" \| "chat" \| "image" \| "video"` | 4 个值，比 AiMode 少 `search` 和 `web` |
| `ChatToolMode` | `modes.ts` | chat 子工具：`"chat" \| "web" \| "search"` | 3 个值 |
| `TaskType` | `providers/types.ts` | 模型路由用：`"chat" \| "search" \| "rag" \| "complex" \| "quick" \| "image" \| "video"` | 7 个值 |

**语义重叠问题**：

1. **`AiTaskCategory` vs `AiMode`**：`AiTaskCategory` 包含 `"chat"`，但 `"chat"` 在 `AiMode` 里也有。这两个类型在语义上应该是包含关系（AICategory 是 AiMode 的子集），但代码中 `AiTaskCategory` 在 `model-selector.tsx` 用作 category 参数，`AiMode` 在 `AI_MODE_OPTIONS` 里。两者的**使用场景已经分开**，但命名让人容易混淆。

2. **`ChatToolMode` vs `AiMode` 中的 `"chat" | "web" | "search"`**：语义完全重叠但定义在两个地方。如果未来 `"search"` 从 `AiMode` 中移除（因为折叠到 chat tab 下拉框），`ChatToolMode` 仍然保留，这会造成理解上的歧义。

3. **`TaskType` vs `AiMode`**：`TaskType` 有 `"rag" | "complex" | "quick"`，`AiMode` 没有。这说明**模型路由层和 UI 层使用不同的任务分类体系**，这本身是合理的（路由需要更细的粒度），但命名上需要明确区分，否则容易混用。

**建议**：在 `modes.ts` 或 `providers/types.ts` 顶部加一段注释，说明三个分类体系的层次关系：

```
AiTaskCategory (UI Tab 层) → AiMode (用户可见的 6 种模式) → TaskType (内部模型路由粒度)
ChatToolMode (chat 模式下的子工具) ⊂ AiTaskCategory.chat
```

这样后续接手的人能快速理解层级。

---

## 审查维度 5：扩展性（audio 场景）⚠️（有条件通过）

### 当前架构对 audio 的扩展能力

仓库里已有 `features/ai/audio/` 目录在开发中，检查架构是否已为 audio 预留空间：

| 维度 | 当前状态 | audio 扩展是否平滑 |
|------|----------|-------------------|
| `AiTaskCategory` | `"auto" \| "chat" \| "image" \| "video"` | 需要加 `"audio"` → 不平滑（改枚举） |
| `AiMode` | 包含 `"image" \| "video"` | 需要加 `"audio"` → 不平滑（改枚举） |
| `TaskType` | `"image" \| "video"` 已存在 | 需要加 `"audio"` → 不平滑（改枚举） |
| `routeByMode` | `case "image": case "video":` | 需要加 `case "audio":` → 不平滑 |
| `routeAfterModelSelect` | `if (mode === "image") return "generateResponse"` | 需要加 audio 分支 → 不平滑 |
| `model-selector.tsx` | `getRequiredCapabilities` 硬编码 `["image"]` 和 `["video"]` | 需要加 `"audio"` → 不平滑 |

**结论**：当前架构对 audio 的扩展**不是"平滑"的**，而是需要多处同步修改。但这是合理的——TypeScript 枚举式类型本身就不支持平滑扩展，未来任何新模式都需要同样的改动。这不是架构缺陷，而是 TypeScript 类型系统的固有约束。

**唯一需要注意的是**：`detect-intent.ts` 的 `detectMode` 和 `task-router.ts` 的 `resolveIntent` 需要**同时更新**才能保持一致。如果未来新增 audio，这两个文件的新增分支必须同步，否则会出现"前端识别了但后端不识别"的 UX 割裂问题。

---

## 总体评价

| 维度 | 结论 | 说明 |
|------|------|------|
| 架构一致性 | ✅ 通过 | 双 Router 职责边界清晰，代码层面已落地 |
| 是否过度设计 | ⚠️ 有条件通过 | capabilities/tier 是存根，计划与实现有对齐问题，需在 PR 描述中明确说明 |
| 可维护性 | ✅ 通过 | task-router 解耦优秀，LLM 分类器替换成本低 |
| 命名语义 | ⚠️ 需补充 | 四个分类体系层级关系需文档化，避免混用 |
| 扩展性 | ⚠️ 有条件通过 | audio 扩展需同步修改多处，但这是 TypeScript 的固有约束 |

---

## 建议修复的优先级

### P0（合并前建议修复）

1. **补充三体系层级注释**：在 `modes.ts` 顶部加一段 doc comment，说明 `AiTaskCategory` / `AiMode` / `TaskType` / `ChatToolMode` 四个类型的使用场景和层次关系。

2. **capabilities 存根标注**：在 `model-routing.ts` 的 `selectModel` 函数顶部加注释，说明 `capabilities` 参数 v1 为存根，v2 才真正按 capability 过滤。

### P1（可选，建议在下次迭代处理）

3. **task-router 接入点验证**：确认 `resolveIntent` 在哪里被调用。如果只是新建但未接入，考虑是这次 PR 的 scope 不完整还是故意留着后续补。

4. **plan 计划与实现的差异整理**：将 plan 中提到的"按 tier 分组"等未实现项标注为 TODO，避免后续开发者误以为已实现。

---

> 本审查基于 git diff + 代码静态分析。未包含运行时行为验证。建议在合并前由 fullstack-developer 跑一次 `npm run build` 确认类型链路完整。
