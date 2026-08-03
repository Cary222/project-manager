<!-- reviewer: ai-learning-mentor (软层) -->

# AI 对话框 UI 重构 — 软层架构审查报告

**审查文件：**
- `features/ai/ui/AiResponsePanel.tsx`（新建）
- `features/ai/ui/AiMessageBubble.tsx`（重构）
- `features/ai/ui/AiChatPanel.tsx`（布局调整）
- `features/ai/ui/AiThinkingStream.tsx`（重构）

**审查维度：** 组件职责、可维护性、可扩展性、一致性、用户体验
**参考规范：** `pretty-ui` skill（ProjectHub 前端美化规范）

---

## 审查摘要

- **总体评分：A**
- 架构问题：0 个
- 可维护性问题：2 个（轻微）
- UX 建议：2 个（优化项）

---

## 一、组件职责

### 评分：A

**分析：**

这次重构最大的进步是**解开了 `AiMessageBubble` 的耦合**。

之前 Bubble 组件内部塞了打字机逻辑、思考流渲染、来源列表、复制按钮——一个大杂烩。这次拆成了清晰的三层：

```
AiMessageBubble（角色路由 + 打字机动画）
    └── AiResponsePanel（Code Agent 风格响应容器）
            ├── AiThinkingStream（思考过程可视化）
            ├── MarkdownContent（Markdown 渲染）
            └── AiSourcesList + MessageCopyButton（来源 + 复制）
```

**每个组件的职责边界非常干净：**

| 组件 | 职责 | 单一性 |
|------|------|--------|
| `AiMessageBubble` | 角色分发 + 打字机 RAF 循环 + HIL 候选人按钮 | ✅ |
| `AiResponsePanel` | 三段式布局（思考 → 正文 → Footer） | ✅ |
| `AiThinkingStream` | 可折叠步骤列表 + 实时计时器 | ✅ |

`AiChatPanel` 作为Orchestrator（编排者）负责 SSE 解析 + 状态管理，和 UI 组件的边界也清晰——它不渲染具体内容，只负责数据流。

**一个值得肯定的取舍：** `AiThinkingStream` 的 `StepRow` 组件被放在文件底部作为内部子组件（不是导出），而不是单独建文件。这是正确的——`StepRow` 和 `StatusIcon`、`CategoryIcon` 都是 `AiThinkingStream` 的内部展示逻辑，没有复用价值，独立文件只会增加目录碎片。

---

## 二、可维护性

### 评分：A

**命名：** 所有命名都语义清晰。`TYPEWRITER_MIN_MS_PER_CHAR` / `TYPEWRITER_MAX_MS_PER_CHAR` 这种常量名虽然长，但把设计意图（自适应速度的上下界）直接编码进去了，未来调参不需要看注释。`persistedTotalMs` 带 `persisted` 前缀，明确区分了"从 DB 读的历史数据"和"实时计算值"，两个概念不再混淆。

**注释质量：** `AiResponsePanel` 顶部的 ASCII 布局图是亮点——不用看代码就能理解三段式结构，code review 时节省大量沟通成本。`AiThinkingStream` 的架构注释（`graph.stream() → Route → TimelineAdapter → TimelineStore → SSE → React`）把数据流全链路串了起来，是架构文档化的好例子。

**代码可读性：** `AiMessageBubble` 里的 RAF 打字机循环注释非常详细（解释了为什么用 `contentRef` 避免 stale closure、为什么 `useEffect` 依赖项不加 `displayed`），这些注释对未来的维护者（包括未来的 AI）理解"为什么这样写"很有帮助。

**两个轻微可维护性观察（非阻断）：**

1. **`AiThinkingStream` 的 `stepRow` 内部存在 `setInterval` 驱动的手动 re-render**（200ms 刷新一次计时器）。当有多个 running 步骤时，每 200ms 全组件刷新一次。在 steps 不超过 10 个的场景下影响微小，但如果未来扩展到 50+ 步骤，可以考虑用 `requestAnimationFrame` 或 CSS 动画替代（`AiMessageBubble` 已经正确使用 RAF 了）。

2. **`AiChatPanel` 中 `formatToolResult` 的返回值是中文硬编码字符串**（"找到 N 条结果"、"已获取摘要"），如果未来需要支持英文 UI，需要改动这里。属于国际化欠债，当前阶段可以接受。

---

## 三、可扩展性

### 评分：A

**工具类型扩展：** 思考步骤的类型是 `TaskCategory = "reason" | "tool" | "workflow" | "system" | "human"`，通过 `CategoryIcon` 组件做 SVG 图标映射。未来加新类别（如 `"data"` 用于数据可视化步骤）只需要：

1. 类型加一个联合成员
2. `CategoryIcon` 的 switch 加一个分支

不需要动任何业务逻辑。这是一种很好的**可插拔设计**。

**新消息类型扩展：** `AiResponsePanel` 当前只渲染 Markdown。如果未来需要支持卡片、表格、图表，可以在 `AiResponsePanel` 里增加一个 `type` 分支，或者拆分出 `AiResponseCard`、`AiResponseChart` 等子组件。当前结构为这种演进预留了空间。

**SSE 事件类型扩展：** `AiChatPanel` 的 SSE 解析 switch 已经覆盖了 12 种事件类型（`text`、`sources`、`timeline_snapshot`、`tool_call`、`tool_result`、`tool_error`、`pending_confirmation` 等）。如果未来需要新增事件（比如 `model_heartbeat`），只需要加一个 case 分支，主流程不需要改动。

**HIL 候选人扩展：** `CandidateUser` 接口当前只包含人员结构，如果未来需要支持"周报选择"或"工单选择"（已经在 `pending_confirmation` 的 `entityType` 里有映射），`AiMessageBubble` 的候选人按钮渲染逻辑不需要改——后端返回的 candidates 已经是解耦的，只要 `label` / `name` 字段有值就能渲染。

---

## 四、一致性

### 评分：A

**与 pretty-ui 规范的一致性：**

| 检查项 | 状态 |
|--------|------|
| 颜色使用 `ink-*` / `brand-*` token | ✅ |
| 圆角使用 4 档规范（`rounded-xl`/`rounded-lg`） | ✅ |
| 阴影使用 `shadow-sm` / `shadow` token | ✅ |
| hover 有 `transition-colors` | ✅ |
| focus-visible 处理 | ✅（部分，`AiMessageBubble` 候选人按钮有 `type="button"` 但缺 `focus-visible` ring） |
| 无 emoji 装饰 | ✅ |
| 边框使用 `border-ink-200` 而非硬编码颜色 | ✅ |

`AiResponsePanel` 的设计完全遵循了 pretty-ui 的 token 规范，特别是 `bg-gradient-to-b from-brand-50/30 to-white` 这个渐变用法，和规范里"状态色配图标/文字"的原则一致。

**与项目现有代码的一致性：** `AiChatPanel` 里的 `variant="page" | "floating"` 模式复用了一套布局逻辑（通过 `isPage` 布尔切换 `padding`、样式差异），而不是写两套组件。这是 ProjectHub 现有 `AppShell` 模式的一致延伸。

**一处风格不一致（轻微）：** `AiChatPanel` 里内联了 `CandidateUser` 类型（第 53-62 行），但同一类型在 `AiMessageBubble.tsx` 里也定义了一个副本（`CandidateUser` 接口，第 8-15 行）。两个定义几乎一样，但字段略有差异——`AiMessageBubble` 版本有 `sublabel`，`AiChatPanel` 版本没有。如果这个类型未来要扩展字段，需要同步修改两处。建议后续抽取到 `features/ai/types/` 统一管理。

---

## 五、用户体验

### 评分：A

**打字机效果：** 自适应速度 RAF 循环（18-55ms/字）是这轮重构的核心亮点。用 SSE 数据到达速率动态调整打字速度——SSE 空闲时加速补位（防止用户干等），SSE 突发时降速平滑（防止文字轰炸）。这个设计比固定速度体验好很多。

**思考流折叠：** `AiThinkingStream` 完成 1.5 秒后自动折叠的设计很好——流式回答结束后，思考过程收缩为一行摘要，让用户聚焦于正文。点击可展开回看，这是"渐进式披露"的好例子。

**HIL 候选人按钮：** 渲染在 bubble 内部、发送 label 而非索引的设计很自然——用户看到的是真实姓名，后端收到的是可解析的字符串。相比发送 "1"/"2" 索引，这种方案在 conversation 历史里更可读。

**两个 UX 优化建议（非阻断）：**

1. **候选人按钮缺 `focus-visible` ring：** `AiMessageBubble` 的候选人按钮（第 163-177 行）有 `transition-colors hover` 但没有 `focus-visible:ring`。键盘用户在 Tab 聚焦时看不到焦点提示，建议加 `focus-visible:ring-2 focus-visible:ring-warning/50 focus-visible:outline-none`。

2. **流式光标位置：** `AiResponsePanel` 里的流式光标 `<span>` 是 `inline-block` 加 `animate-pulse`（第 71 行），在 Markdown 内容中间闪烁。当前实现放在 `z-0` 层的最后，对于短文本影响小，但当 Markdown 内容很长需要滚动时，光标可能不在可视区域内。可以考虑用 CSS `caret-color` 替代 span 光标，让光标跟随文字末尾，而不是固定在 DOM 末尾。

---

## 结论

**APPROVED**

这是一次高质量的 UI 重构。组件职责清晰、命名语义一致、扩展性设计到位、和 pretty-ui 规范对齐良好。两个轻微的可维护性观察（计时器 re-render 策略、双重 CandidateUser 定义）和两个 UX 优化建议都是"未来可改进项"，不影响本次通过。

重构后的架构为下一步演进（卡片响应、多模态、AI 教练提示）预留了充足的空间。
