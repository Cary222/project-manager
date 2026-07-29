<!-- reviewer: ai-learning-mentor (软层) -->
# AI Mentor Review: Human-in-Loop 重构 V2

> 🎭 当前身份：学习导师（软层审查）

## 架构评估

**`resolvedEntities` 作为 SSOT 的合理性：APPROVED**

这次重构解决了一个经典的"两处写、一处读"的数据竞争问题。

**重构前的痛点**：
- `toolResults.confirmedUserId` 在 HTTP 层写
- `additional_kwargs.entityId` 在消息层写
- Graph 只读，却看不到任何一路写入的结果
- 结果：路由决策失效，`routeAfterHumanConfirmation` 误判

**重构后的方案**：
- Graph 是唯一写入 `resolvedEntities` 的地方（`humanConfirmationNode` 第 96–102 行）
- HTTP 层只转发消息，不碰业务状态
- 所有节点只读 `resolvedEntities`

**为什么这个设计值得肯定**：这符合你之前学过的"状态和UI分离"原则——Graph 是状态机（程序逻辑），AIMessage 是对话历史（LLM 上下文），两者各司其职，互不混淆。

---

## 状态机设计评估

**三个字段的职责边界：清晰，但有一个隐含风险**

| 字段 | 职责 | 写入者 |
|------|------|--------|
| `pendingConfirmation` | 持有候选列表（多用户同名时） | `searchStructuredNode` |
| `waitingForConfirmation` | 控制路由是否绕道 humanConfirmation | `searchStructuredNode` / `humanConfirmationNode` |
| `resolvedEntities` | 最终解析结果（SSOT） | `humanConfirmationNode` |

**职责分工原则**：✅ 每个字段有且只有一个写入者。

**一个隐含风险点**（不在 plan 里，需要你知道）：

`waitingForConfirmation` 是一个"全局中断信号"，一旦设为 `true`，`routeAfterDetectIntent` 会无条件路由到 `humanConfirmation`（`routing.ts` 第 64–66 行）。这意味着：

> **如果 Graph 在多轮对话中（比如第二、三轮）意外保留了 `waitingForConfirmation: true`，用户任何新消息都会被劫持到消歧流程，而不是正常路由。**

目前代码在成功消歧后会设为 `false`（第 97 行），但 `generateResponseNode` 在生成消歧提示后也设 `waitingForConfirmation: true`（第 261 行），而 `humanConfirmationNode` 成功后会清掉它。这个时序是对的，但建议在 `route.ts` 的 `initialState` 里始终重置它，以防 Graph 状态泄漏。

---

## 命名与语义评估

**字段命名：基本合格，有一处语义模糊**

**清晰的部分**：
- `pendingConfirmation` — 直观："待确认"
- `waitingForConfirmation` — 直观："等待确认中"
- `resolvedEntities` — 直观："已解析的实体"
- `user?: { id, name, resolvedBy }` — 结构清晰

**语义模糊的地方**：`resolvedBy: "auto" | "confirmation"`

这个字段目前只定义了两种值，但含义不够自解释：
- `"auto"` — 自动解析（Graph 从查询文本中推断出唯一用户，跳过消歧）
- `"confirmation"` — 用户确认（经过消歧流程手动选择）

**问题**："auto" 这个词容易被误解为"AI 自动判断"，而实际是指"Graph 从查询文本中提取，不需要人介入"。建议考虑改名：
- `"extracted"` — 从查询文本中提取的
- `"confirmed"` — 用户确认的

这样更符合状态机的语义。

---

## UX 流程评估

**两轮对话模型：✅ 设计合理**

```
第一轮：User: "刘工最近在干什么"
  → searchStructured → 多候选
  → generateResponse → "找到 2 位用户，请选择"
  [Graph 暂停，等待用户输入]

第二轮：User: "1"
  → detectIntent → humanConfirmation（读取用户输入 → 解析为 ID → 写入 resolvedEntities）
  → routeAfterHumanConfirmation → resolvedEntities?.user 存在 → searchStructured
  → generateResponse → 真实回答
```

**UX 优点**：
1. 支持数字选择（"1"、"2"）和姓名输入（"刘工"、"zhang jing"）
2. 支持 skip/cancel（"0"、"取消"）
3. 消歧失败时（输入无法匹配）会重试，不丢上下文

**UX 隐患**：
- 如果用户忘记自己在消歧流程中，输入了完全不相关的问题（比如"帮我查一下 #10156 的状态"），`humanConfirmationNode` 的 `parseUserSelection` 会返回 `null`（第 53 行），状态会停留在 `waitingForConfirmation: true`，用户被卡在消歧里。

**建议**（可选）：在 `humanConfirmationNode` 里加一个"意图检测"——如果用户输入明显是新的独立问题（包含 `#`、`工单`、`项目` 等关键词），直接 `pendingConfirmation: null` + `waitingForConfirmation: false` + 将消息透传给 `detectIntent` 处理。

---

## 扩展性评估

**project / ticket 消歧的扩展路径：设计已预留，实现需谨慎**

`resolvedEntities` 的类型定义已经支持三种实体：

```typescript:features/ai/graph/agent.ts:91-95
resolvedEntities: Annotation<{
  user?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
  project?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
  ticket?: { id: string; name: string; resolvedBy: "auto" | "confirmation" };
} | null>
```

**扩展路径**：

1. **searchStructured** — 检测多候选时，需要区分是 user/project/ticket 的多候选（目前只处理 user）
2. **generateResponse** — 消歧提示模板需要随实体类型变化（目前硬编码用户提示）
3. **humanConfirmationNode** — `parseUserSelection` 目前只处理 user 类型，需要抽象为通用的候选选择器
4. **路由** — `routeAfterHumanConfirmation` 目前只检查 `resolvedEntities?.user`，需要泛化

**取舍建议**：目前的类型设计是合理的，"先 user 后 project/ticket"也是合理的优先级。但**不要急着扩展**——等你真的有 project 消歧需求时再动，否则就是过度设计。

---

## 教学价值评估

**新人能否看懂这套系统：✅ 可以，但需要配套文档**

**好的部分**：
- `pendingConfirmation` / `waitingForConfirmation` / `resolvedEntities` 三个字段职责单一，注释清晰
- `routeAfterHumanConfirmation` 的判断逻辑只有两行，意图明确
- 重构计划（`docs/features/human-in-loop_重构_f77e77e9.plan.md`）完整记录了"为什么改"和"怎么改"

**需要补充的部分**：
1. **状态转换图**：目前只有文字描述，建议补充一张状态机图（节点 = 字段值，边 = 触发条件）。可以用 PlantUML 或者 Excalidraw 画。
2. **常见错误排查指南**：比如"用户卡在消歧里怎么办"（检查 `waitingForConfirmation` 是否被意外清空）、"消歧后 Graph 走到了 generateResponse 而非 searchStructured 怎么办"（检查 `resolvedEntities.user` 是否写入）。
3. **`resolvedBy` 语义澄清**：前文提到的命名问题，文档里可以加个注释说明。

---

## 最终判定

**APPROVED — 可以合并**

**判定理由**：

1. **SSOT 原则落实到位**：`resolvedEntities` 是唯一的业务状态写入点，消除了数据竞争。
2. **状态机职责清晰**：三个字段各有唯一写入者，路由逻辑简洁。
3. **两轮交互模型符合直觉**：用户输入 "1" 到最终回答的路径可追踪、可解释。
4. **类型定义预留扩展性**：不需要大改就能支持 project/ticket 消歧。

**建议改进（可选，不阻塞合并）**：

| 优先级 | 问题 | 位置 | 说明 |
|--------|------|------|------|
| 低 | `resolvedBy` 改名 | `agent.ts:92` | `"auto"` → `"extracted"`，语义更准确 |
| 低 | 意图逃逸机制 | `humanConfirmationNode` | 用户输入独立新问题时，透传给 `detectIntent` |
| 低 | 状态转换图 | 文档 | 补充一张状态机图，辅助新人理解 |
| 低 | 排查指南 | 文档 | 补充常见错误排查步骤 |

---

*审查完成时间：2026-07-27*
*审查维度：架构可解释性 / 状态机设计 / 命名语义 / UX 流程 / 扩展性 / 教学价值*
