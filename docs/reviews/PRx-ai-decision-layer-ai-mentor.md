<!-- reviewer: ai-learning-mentor (软层) -->
# AI 查询意图重构 — 决策层架构软层审查

> 审查范围：F1 + F2 + F3（decision 节点重命名、query-parser 重构、状态字段拆分）
> 审查视角：架构合理性 · 关注点分离 · 状态设计 · 可维护性 · 路由可读性 · 学习价值 · 替代方案权衡
> 审查者身份：ai-learning-mentor（架构顾问 + 学习导师）

---

## 整体评价

**结论：可以接受，建议 1 处重构降低未来风险。**

改动整体方向正确——将分散的意图判断逻辑收敛到 `detectIntent`（唯一入口）、`query-parser.ts`（唯一判断逻辑）、`decision`（唯一决策节点）。这套"入口 → 判断 → 决策"三层分离，对项目的 LangGraph 学习线有直接价值。

---

## 维度 1：架构合理性

### `disambiguateIntent` → `decision` 重命名是否合理？

**合理，理由如下：**

1. **职责已超出"消歧"**：原名 `disambiguateIntent` 只覆盖"意图消歧"这一件事，但新节点实际处理三种场景：
   - Branch 1：`state.isAmbiguous = true` 时做跨类型搜索
   - Branch 2：Tool 返回 `decision.type === "human"` 时展示候选项
   - 路由后续轮次（多轮 HIL 时"回炉"再决策）

2. **与 LangGraph HITL 模型的契合度**：LangGraph 的 `interrupt` 机制本质就是"暂停 → 等人 → 恢复"。`decision` 节点就是这套机制的具象化——它读取状态后决定"继续还是暂停"。重命名为 `decision` 更贴近这个语义。

3. **过渡命名策略安全**：`decision.ts` 同时导出 `decision`（新名）和 `disambiguateIntentNode`（旧名），`agent.ts` 用 `decision as disambiguateIntentNode` 注册。这种"新名导出 + 旧名兼容"是安全的中途重构策略，不会 break 任何在途的调用。

### "决策层"是否是过度工程化？

**对于单人内部工具来说，边界确实偏细。** 但代码行数说明了一切——`decision.ts` 只有 133 行（含注释），实际逻辑只有 2 个分支 + 1 个兜底。它不是一个"决策引擎"，而是一个**协调层**：决定"什么时候让用户参与"。

如果把它塞回 `searchStructuredNode`，会导致那个节点从"执行者"变成"执行者+决策者"，违反单一职责。

---

## 维度 2：关注点分离

### 做得好的地方 ✅

| 节点 | 职责边界 | 评价 |
|------|---------|------|
| `detectIntent` | 调用 query-parser，设置 `mode`/`queryType`/`isAmbiguous` | 唯一入口，干净 |
| `query-parser.ts` | 纯函数，无副作用，4 个核心函数 | 可独立测试 |
| `searchStructured` | 只执行结构化查询，不触发 HIL | 真正做到了"执行者"定位 |
| `routing.ts` | 纯路由，从 state 读取判断依据 | 消除了原有的 `isUserActivityQuery()` 重复 |
| `humanConfirmation` | 只解析用户选择，设置 `resolvedEntities` | 单一职责 |

### 潜在问题 ⚠️

`decision` 节点的 **Branch 1 和 Branch 2 触发机制不同**：

```
Branch 1: 读 state.toolResults.searchStructured.decision
           → 触发时机：searchStructured 工具返回候选项
Branch 2: 读 state.isAmbiguous
           → 触发时机：detectIntent 设置了 isAmbiguous=true
```

**问题不是"职责重叠"，而是"触发路径不同"。**

这会导致调试时思维跳跃：
- "这条日志是哪个分支触发的？" → 需要看是 toolResult 触发还是 state 触发
- 如果未来加 Branch 3（比如"用户画像触发"），节点会越来越难维护

**建议**：将 Branch 1 和 Branch 2 统一为"决策信号"——在 `searchStructuredNode` 执行完毕后，把所有需要决策的信息（包括 ambiguous）都写入 `toolResult.decision`，让 `decision` 节点只读 `toolResult`。

这样做的好处：
- `decision` 节点变成纯读取者，不再需要知道"ambiguous 是在哪里设置的"
- 新增决策类型只需要改 `searchStructuredNode`（执行者），不用改 `decision`（决策者）

---

## 维度 3：状态字段命名

### 字段拆分 vs. 嵌套对象

| 字段 | 类型 | 评价 |
|------|------|------|
| `queryType` | `QueryType \| null` | ✅ 命名清晰 |
| `extractedUser` | `ExtractedUser \| null` | ✅ 语义明确 |
| `activityWindow` | `ActivityWindow \| null` | ✅ 语义明确 |
| `isAmbiguous` | `boolean` | ⚠️ 与 `queryType === "ambiguous"` 重复 |
| `resolvedEntities` | `{ user?, project?, ticket?, ... }` | ✅ 嵌套合理，类型安全 |

**`isAmbiguous` 与 `queryType` 的重复问题：**

两者表达的是同一件事：
```typescript
// 判断逻辑分散在两个地方
state.queryType === "ambiguous"  // 在 searchStructuredNode 里
state.isAmbiguous               // 在 decision 节点里
```

建议：删除 `isAmbiguous` 字段，统一用 `queryType === "ambiguous"` 判断。这样：
- `detectIntent` 不需要额外设置 `isAmbiguous`，只需 `state.queryType = "ambiguous"`
- `decision` 节点只需要读 `state.queryType`
- 消除一个冗余字段

**LangGraph Annotation 命名惯例**：`queryType` / `extractedUser` / `activityWindow` 都符合"名词短语"命名惯例，OK。

---

## 维度 4：可维护性

### decision 节点的多分支风险

当前 `decision.ts` 的两个分支逻辑路径差异大：

| 维度 | Branch 1 | Branch 2 |
|------|-----------|----------|
| 触发源 | `state.toolResults` | `state.isAmbiguous` |
| 数据来源 | Tool 返回值 | State 注解 |
| 后续操作 | `pendingHumanAction` | `pendingHumanAction` |
| 读取的消息 | `lastMessage.content` | `lastMessage.content` |

**未来的维护挑战：**

如果下一个 feature 需要"当用户画像置信度低于阈值时触发 HIL"，你有两个选择：
1. 在 `decision` 节点加 Branch 3 → 节点膨胀
2. 把信号写入 `toolResult.decision` → `decision` 节点保持简洁

**建议采用方案 2**（见维度 2 的建议），让 `searchStructuredNode`（执行者）负责"什么情况下需要决策"，`decision`（决策者）只负责"把决策请求格式化为 `pendingHumanAction`"。

---

## 维度 5：路由可读性

### `routeAfterHumanConfirmation` → `decision` 的设计

```typescript
// routing.ts
export function routeAfterHumanConfirmation(state): NextNode {
  if (state.pendingHumanAction) return "humanConfirmation";
  if (resolvedEntities) return "decision";  // ← 这里
  return END;
}
```

**表面看起来奇怪**：用户明明已经"确认"了，为什么还要回到 `decision`？

**但这恰恰是多轮 HIL 的正确模式——"回炉"：**

```
Round 1: "刘工的周报有哪些"
  → decision(user, candidates=2) → humanConfirmation
  → 用户选了 "1. cary"
  → resolvedEntities.user = { id, name }
  → 路由回到 decision  ← 这里

Round 2: decision 检测到 resolvedEntities.user 已设置，但 queryType=weekly_report
  → searchStructured 查到了 4 条周报
  → decision(weekly_report, candidates=4) → humanConfirmation
  → 用户选了 "2. 2026-07-14 ~ 2026-07-20"
  → resolvedEntities.weekly_report = { id, name }
  → 路由回到 searchStructured（因为 resolvedEntities.weekly_report 已设置）

Round 3: searchStructured 用选定的周报 ID 查询详情 → generateResponse
```

这种"回炉"设计的价值：支持任意多轮的决策链，不需要为每一轮单独写路由逻辑。

**可读性改进建议**：在 `routeAfterHumanConfirmation` 的注释里加一行：

```typescript
// routing.ts
export function routeAfterHumanConfirmation(state): NextNode {
  // Round 1: user picked "1. cary" → back to decision to process next decision
  // Round N: no more decisions → END
  if (resolvedEntities) return "decision";
  // ...
}
```

---

## 维度 6：学习价值

### 这套决策层架构对 LangGraph 学习线的贡献

**直接价值：高。** 这套架构覆盖了 LangGraph 最核心的两个概念：

1. **Human-in-the-Loop（人机交互）**：
   - `decision` 节点 = 决策暂停点
   - `pendingHumanAction` = 状态标记（"等用户参与"）
   - `routeAfterDecision` = 条件路由（"继续还是暂停"）
   - 对应 LangGraph skill 中的 `interrupt` + `Command(resume=...)` 模式

2. **条件边（Conditional Edges）**：
   - 6 个路由函数，每个都是 `state → NextNode` 的纯函数
   - 比 LangGraph 文档里的"单一路由函数"更细粒度，每个节点有自己的路由
   - 符合"节点职责单一 + 边职责单一"的 FSD 原则

### 建议提炼的"Decision Layer Pattern"学习笔记

**值得写，理由：**

- 这是 ProjectHub 独有的模式（不是官方文档例子，而是从真实业务里提炼的）
- 对应 Day 10-11（"把 tools/index.ts → 节点 + 边"）的进阶内容
- 涵盖了"多轮 HIL"、"决策协调"、"跨层状态传递"三个实战问题

**建议放在 `docs/learning/LangGraph-实战学习计划.md`**：

```
Day 10-11 后面加：
### Day 12：决策层模式（Decision Layer Pattern）
- 为什么需要决策层？（vs 把决策塞到执行节点里）
- decision 节点 = 状态机里的"暂停点"
- 多轮 HIL："回炉"设计
- 实践：在 ProjectHub 的 decision.ts 里找这 3 个模式的证据
```

---

## 维度 7：替代方案权衡

### 方案 A：把 ambiguous 处理塞到 `searchStructuredNode`

```
优点：
- 少一个节点，少一层抽象
- 调试时"执行+决策"在同一个文件里

缺点：
- searchStructuredNode 从"执行者"变成"执行者+决策者"
- 如果需要多轮 HIL（比如 ambiguous → 用户选类型 → 用户选具体实体），逻辑会变得复杂
- decision 节点的其他决策逻辑（Branch 1）也要重复
```

### 方案 B：独立 decision 节点（当前方案）

```
优点：
- 职责清晰：decision = "什么时候让用户参与"
- 支持任意多轮 HIL，每轮都经过 decision
- 与 LangGraph HITL 模型天然对齐

缺点：
- 多一个节点，多一层间接
- 对于单人工具来说，边界偏细
```

### 判断：当前方案是"适度过工程化"，但值得

你的项目已经从"工单助手"演进到"AI 对话助手"，HIL 场景会越来越多（选用户、选类型、选具体实体、多轮确认）。独立 decision 节点是**为未来留扩展性**的合理投资。

**类比**：就像装修房子——单人公寓可以不做隔断，但如果你计划将来有室友，提前做好房间划分是值得的。

---

## 汇总：软层观察（3-5 条）

1. **架构方向正确**：入口 → 判断 → 决策三层分离，与 LangGraph HITL 模型对齐，`decision` 命名比 `disambiguateIntent` 更准确地反映节点职责。

2. **状态设计有一处冗余**：`isAmbiguous` 字段与 `queryType === "ambiguous"` 重复，建议删除 `isAmbiguous`，统一用 `queryType` 判断。这是小改动，但能消除一个"同一事实两个来源"的风险。

3. **decision 节点的两个分支有不同触发路径**：Branch 1 读 `toolResults`，Branch 2 读 `isAmbiguous`。建议将所有决策信号统一写入 `toolResult.decision`，让 `decision` 节点只做"读取 + 格式化 HIL 请求"一件事，降低未来维护成本。

4. **`routeAfterHumanConfirmation` → `decision` 的"回炉"设计是合理的**：这支持了多轮 HIL（如"刘工的周报有哪些"需要先选用户、再选具体周报）。建议加一行注释说明这个路由意图，降低未来阅读门槛。

5. **这套决策层架构值得提炼成学习笔记**：直接对应 LangGraph 的 HITL 和条件边概念，对项目的 LangGraph 学习线（Day 10-12）有直接价值。建议在 `docs/learning/LangGraph-实战学习计划.md` 里加一篇 "Decision Layer Pattern"。

---

## 关于"过度工程化"的判断

对于你的项目规模和当前阶段：

| 指标 | 评估 |
|------|------|
| decision.ts 行数 | 133 行（含注释），很薄 |
| 新增文件 | 2 个（decision.ts + query-ambiguous.ts），可接受 |
| 架构复杂度 | 每层职责单一，无循环依赖 |
| 实际业务价值 | 直接解决"光污染传感器需求 → ambiguous"的 bug |

**结论：没有过度工程化。** 这是一次"把散落逻辑收敛到单一职责"的合理重构，代价可控，收益明确。

---

## 建议优先级

| 优先级 | 建议 | 原因 |
|--------|------|------|
| 🔴 高 | 删除 `isAmbiguous` 字段，统一用 `queryType` 判断 | 消除冗余，降低 future bug 风险 |
| 🟡 中 | decision 节点统一从 `toolResult.decision` 读取 | 让 decision 变成纯读取者，降低维护成本 |
| 🟢 低 | `routeAfterHumanConfirmation` 加一行注释 | 对当前功能无影响，只是为了可读性 |
| 🟢 低 | 在 LangGraph 学习线里加 "Decision Layer Pattern" 笔记 | 对项目有长期学习价值 |

