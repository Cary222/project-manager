# AI 对话界面重构、模型思考强度下拉、意图路由与输入法防误触（#10205）复现手册

> 适用：project-manager 仓库（Next.js + Prisma + LangGraph + AI SDK 3.x）
> 目标：完整记录 #10205 涉及的 UI 布局重构、Thinking 思考强度切换、会话流式创建、大厂级时序与意图分诊、以及全局输入法回车防误触机制。

---

## 1. 目标与背景

### 1.1 问题与诉求

1. **界面冗余堆叠**：会话主界面顶部原有「小星 · AI 助手、状态副标题、工作模式按钮、模型选择器、自动/通用/生图/视频切换栏」等一整套控件，占据大量竖向空间，视觉繁杂；
2. **缺乏即时思考强度调节**：深度推理模型（如 DeepSeek-R1 / o1 / Claude 3.7 / agnes-thinking）的推理档位无法在输入框直接切换，缺乏类似 ChatGPT 的快捷 `High ⌵` 下拉控制；
3. **欢迎页发起新对话异常与模型响应假死**：
   - 从欢迎页（WelcomeView）输入发起的会话未能自动持久化对应 `type: "CHAT"` 的会话记录；
   - 主面板在未绑定会话时，错误地请求了仅用于返回简单 JSON 的 `POST /api/ai/conversations`，而非返回 SSE 流的 `/api/ai/conversations/${id}/messages`，导致前端读取不到任何 `data:` 流事件，界面无限停留在“正在思考”；
   - SSE 内部的 `conversationId` 比较逻辑因 React 状态异步延迟导致误杀当前流。
4. **Work 模式意图分诊孤岛与误分流**：
   - 用户输入“我上周干了什么”，在工作台被错误归属为 `Coding Task`；
   - 根因是 Work 模式使用了极度简陋的 4 行硬编码正则，未命中显式关键词即兜底至 `coding`；而 Chat 模式成熟的 `isUserActivityQuery` 与时序解析能力未打通复用。
5. **全站中文输入法 Enter 误触提交**：
   - 用户在 AiChat、欢迎页、工作台输入框使用拼音/双拼输入法按回车确认上屏文字时，直接触发了表单提前提交，严重影响中文交互体验。

---

## 2. 核心改动清单

| 文件 | 类型 | 作用 |
| ------ | ------ | ------ |
| `features/ai/ui/ai-chat/AiChatPanel.tsx` | 修改 | 移除主对话顶部冗余 Header；统一向 `/api/ai/conversations/${id}/messages` 发起 SSE 流，修复流式创建与守卫条件；接收并下发 thinkingLevel |
| `features/ai/ui/ai-chat/AiRightInspectorPanel.tsx` | 修改 | 在“会话属性”Tab 下完整承接小星形象、就绪状态、工作模式切换按钮、对话任务模式选择器（带子模式下拉）、当前模型选择器以及会话元数据 |
| `features/ai/ui/ai-chat/AiChatInput.tsx` | 修改 | 输入框采用现代胶囊容器，左侧内置 `+` 上传按钮，右侧内嵌思考强度下拉修改拉框（`High ⌵`）；接入 IME 输入法生命周期守护 |
| `features/ai/ui/ai-chat/AiChatPage.tsx` | 修改 | 状态提升统一管理 `aiMode`、`chatToolMode`、`thinkingLevel`；`handleStartChat` 显式创建 `category: "CHAT"` 的持久化会话 |
| `features/ai/types/structured.ts` | 修改 | `ActivityWindow` 扩展原生支持 `"last_week"` |
| `features/ai/core/formatters.ts` | 修改 | `getWindowStart` 与 `formatWindowLabel` 补齐 `"last_week"` 映射与时间计算 |
| `features/ai/core/resolvers/query-parser.ts` | 修改 | 新增自然周毫秒边界解析引擎 `resolveTemporalWindow`，增强 `isUserActivityQuery`，新增工单隐式指代识别 `isImplicitTicketReference` |
| `features/ai/core/runtime/runtime-state-bridge.ts` | 修改 | `ConversationContext` 升级支持 `lastMentionedTicket` 工单焦点缓存 |
| `features/ai/agents/conversation/agent.ts` | 修改 | `AgentState` 增加 `lastMentionedTicket` 和 `resolvedTimeWindow` 字段 |
| `features/ai/agents/conversation/nodes/detect-intent.ts` | 修改 | `detectIntent` 注入工单指代消解与绝对时序字段；添加 AST 安全断言 |
| `features/ai/agents/work/runtime/work-run-ref.ts` | 修改 | 重构 `routeWorkGoal`，复用 Chat 模式解析能力，构建 5 级级联意图路由器 |
| `features/ai/ui/ai-chat/AiWelcomeView.tsx` | 修改 | 接入 IME 组合态与 100ms 宽限保护，防止拼音选词回车误提交 |
| `features/ai/ui/ai-work/WorkDashboard.tsx` | 修改 | 目标输入框接入 IME 组合态与 100ms 宽限保护 |
| `features/ai/ui/ai-work/ChatReviewPanel.tsx` | 修改 | 周报审查输入框接入 IME 组合态保护 |
| `features/ai/ui/AiChatInput.tsx` | 修改 | 根目录旧版兼容输入框同步接入 IME 组合态保护 |
| `features/ai/core/resolvers/__tests__/query-parser.test.ts` | 新增 | 时序窗口解析与工单指代消解的专项单元测试 |
| `features/ai/ui/ai-chat/__tests__/thinking-options.test.ts` | 新增 | 思考强度选项与契约校验测试 |
| `features/ai/agents/work/runtime/work-run-ref.test.ts` | 修改 | 补充工作活动回顾类提示词自动路由到 `project_progress` 的测试用例 |

---

## 3. 核心机制与架构实现

### 3.1 会话属性下沉与输入框思考强度下拉

- **AiRightInspectorPanel 会话属性**：将原先横亘在聊天面板顶部的控件整体移入右侧抽屉式检查器中，包括：
  1. 小星助手身份与就绪指示卡片，带“工作模式”直达入口；
  2. 任务模式分段控制器（自动 / 通用对话 / 生图 / 视频，其中通用对话可进一步展开切换直接对话、知识库检索或联网搜索）；
  3. 当前模型选择（`UnifiedModelSelector`），随任务类型自动过滤；
  4. 会话 ID 展示与一键清空会话功能。
- **AiChatInput 胶囊控制**：
  在输入框内右侧提供 `High ⌵`（深度思考）、`Medium ⌵`（均衡思考）、`Low ⌵`（快速思考）、`Off ⌵`（直出回答）档位切换，自动更新本地存储并异步调用 `/api/ai/model-preferences`，无缝生效于大模型思考参数链路。

### 3.2 欢迎页新建会话与 SSE 流式通道闭环

- **新建会话契约**：欢迎页发起时，`handleStartChat` 显式调用 `POST /api/ai/conversations`，以 `{ title, category: "CHAT" }` 创建真实会话并拿到 `id`，立刻驱动 URL 更新与左侧侧边栏高亮；
- **消息发送管道重构**：`AiChatPanel.handleSend` 确保目标端点恒为 `/api/ai/conversations/${convId}/messages`，杜绝请求非流式端点导致的无响应挂起；
- **流守卫修复**：在 SSE 读取循环中将原本脆弱的 `parsed.conversationId !== conversationId` 优化为 `if (parsed.conversationId && convId && parsed.conversationId !== convId) return;`，杜绝因组件异步渲染时差误截断真实输出。

### 3.3 级联意图识别与自然语言时序解析（Cascade Router）

参考工业级标准（Dify / LangGraph Router / Microsoft Copilot），打通 Chat 与 Work 意图识别体系：

1. **时序解析（`resolveTemporalWindow`）**：
   - “上周”精确锚定为上周一 `00:00:00.000` 至上周日 `23:59:59.999`；
   - “本周”精确锚定为周一 `00:00:00.000` 至当前周末；
   - “昨天/前天/今天/近期”输出毫秒级精确的 `[startTime, endTime]`。
2. **多轮实体消歧**：
   - 升级会话上下文存储，支持跨轮继承最近讨论的工单号（`lastMentionedTicket`）；
   - 用户输入“它的负责人是谁”、“针对该工单写测试”时，自动消解代词“它/该任务”。
3. **分诊矩阵对齐**：
   - `routeWorkGoal` 重构为 5 级级联分诊：周报 -> 会议纪要 -> 项目进展/活动回顾 -> 代码任务 -> 智能兜底；
   - “我上周干了什么”、“团队近期做了什么”统一准确归入 `project_progress`。

### 3.4 全局 IME 输入法组合态保护机制

所有输入框（AiChatInput / AiWelcomeView / WorkDashboard / ChatReviewPanel）采用复合拦截策略：

```ts
const isComposing =
  isComposingRef.current ||
  e.nativeEvent.isComposing ||
  e.keyCode === 229 ||
  Date.now() - lastCompositionEndAtRef.current < 100;

if (e.key === "Enter" && !e.shiftKey) {
  if (isComposing) return; // 拦截拼音选词回车，杜绝误触发送
  e.preventDefault();
  handleSubmit();
}
```

结合 `<textarea onCompositionStart={...} onCompositionEnd={...}>`，彻底解决各平台浏览器拼音选词回车误触提交的问题。

---

## 4. 验证与测试结果

1. **单元测试矩阵**：
   - `npx vitest run features/ai/` 运行 29 个测试套件，全部 198 项测试 100% 通过；
   - 专项测试 `query-parser.test.ts` 验证自然周边界计算、跨周时间戳精度、工单隐式代词与活动问句捕获；
   - 专项测试 `work-run-ref.test.ts` 验证“我上周干了什么”等问题 100% 路由到 `project_progress`；
   - 专项测试 `thinking-options.test.ts` 验证思考强度档位与 ReasoningLevel 兼容性。
2. **生产构建验证**：
   - `npm run build`（Next.js Turbopack）编译成功，耗时 24s，TypeScript 0 errors，所有静态页面生成完毕。
