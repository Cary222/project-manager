<!-- reviewer: code-reviewer (硬层) -->

## 审查摘要

**Scope:** `features/ai/ui/AiResponsePanel.tsx`、`AiMessageBubble.tsx`、`AiChatPanel.tsx`、`AiThinkingStream.tsx`
**Review Type:** Local Changes（AI 对话框 UI 重构）

| 维度 | 评分 | 说明 |
|------|------|------|
| TypeScript 类型安全 | B | Props 接口完整，类型守卫到位；但存在少量非空断言 |
| 边界检查 | C | `content` props 的 undefined / 空字符串未做防御性处理 |
| 性能 | C | 多处重渲染问题：`StepRow` 每 200ms 全量 re-render；双 `MarkdownContent` 同步渲染 |
| 错误处理 | B | 组件级 try-catch 完善；SSE handler 错误吞掉（但对 UX 可接受） |
| React 规范 | B | Hooks 依赖基本正确；useEffect 清理完备；但存在反模式 |

**总体评分：C（存在可修复的性能和边界问题）**

---

## Critical 问题（必须修复）

### 1. **`AiThinkingStream.tsx:129–141` — `StepRow` 每 200ms 全量 re-render**
- **问题**：`useEffect` + `setInterval(200ms)` 驱动 `setTick`，触发所有可见 `StepRow` 组件 re-render。假设 5 个思考步骤同时 running，用户会看到 60FPS × 5 组件 = 300 次 re-render/秒。
- **Impact**：长思考流程下 CPU 占用高，移动端耗电加剧。
- **Suggestion**：将实时计时器提升到 `AiThinkingStream` 父组件级别，用一个 `useState` 控制全局 tick，`StepRow` 统一读取同一时间戳。效果：从 O(N) 次 re-render/step 降为 O(1) 全局 tick。

### 2. **`AiResponsePanel.tsx:63–68` — Ghost/Active 双层 `MarkdownContent` 同步渲染**
- **问题**：两路 `<MarkdownContent content={content} />` 在同一次渲染中被执行，一个 invisible（参与布局计算），一个 absolute（实际可见）。每次 `content` 更新导致两次 Markdown 解析 + 两次 DOM diff。
- **Impact**：长回答（> 500 字）时渲染成本翻倍；流式打字过程中每字符更新触发双重计算。
- **Suggestion**：Ghost 层仅用于占高，改用 CSS `min-height` 或 `line-clamp` + JS 测量，而非重复渲染整个 MarkdownContent。

---

## Major 问题（建议修复）

### 3. **`AiResponsePanel.tsx` + `AiMessageBubble.tsx` — `content` 未防御 undefined**
- **文件**：`AiResponsePanel.tsx:42`、`AiMessageBubble.tsx:52`
- **问题**：`content` 为 `string` 类型但 Props 接口未标记必填（`content?: string` 允许 undefined）。若父组件传入 `undefined`，`displayed !== content` 比较为 `true`，打字机逻辑可能异常；`content.length` 在 undefined 时行为为 `NaN`。
- **Suggestion**：Props 接口加 `content: string`（必填），或在使用处加 `content ?? ""`。

### 4. **`AiMessageBubble.tsx:85–88` — 非流式切换的 setTimeout 微任务竞态**
- **问题**：当 `isStreaming` 从 `true → false` 时，旧的 RAF 可能还在运行，同时 setTimeout(0) 也在排队。如果 content 仍不完全，两段逻辑可能同时尝试设置 `displayed`，RAF 抢先完成后 RAF ref 被置 null，导致 setTimeout 回调里 `displayedRef.current` 与 `content` 再次不等，产生二次渲染。
- **Suggestion**：在 RAF 的 `tick()` 里也检查 `streamingRef.current`，发现 false 时立即停止；或者在 `isStreaming` 切换时用 ref 标记而非依赖 state。

### 5. **`AiMessageBubble.tsx:1087` — 内联 `onCandidateSelect` 未 memoize**
- **问题**：`AiChatPanel` 中 `handleSend` 是 `useCallback`，但传给 `AiMessageBubble` 的 `onCandidateSelect` prop 在每次消息列表渲染时重建。
- **Impact**：低（`messages.map` 场景下消息数量有限），但违反 React 最佳实践。
- **Suggestion**：`AiMessageBubble` 的 `onCandidateSelect` prop 比较若用 `Object.is`（React 18+ 默认），内联函数重建不影响 children memo。

### 6. **`AiThinkingStream.tsx:284–289` — useEffect 依赖数组缺少 `tasks` 的稳定引用**
- **问题**：依赖 `tasks` 数组（引用每次 SSE 更新都变），导致 `autoCollapse` 定时器被反复创建/清理。若用户在 1.5s 临界点附近快速完成多步，定时器行为不确定。
- **Suggestion**：依赖 `tasks.map(t => t.status).join()` 或用 `useRef` 存储上一次的 status set，避免不必要的 effect 重跑。

### 7. **`AiChatPanel.tsx:655,663,671,676,781,809` — 多处调试 console.log**
- **问题**：SSE handler 内含 `console.log("[AI] SSE chunk:", ...)`、`console.log("[AI] tool_result received:", ...)` 等调试语句。生产环境会刷屏 console，且可能在敏感日志系统（如 Sentry）中产生噪音。
- **Suggestion**：全部替换为条件编译（`if (process.env.NODE_ENV === 'development')`）或直接删除。

---

## Minor 建议（可选优化）

### 8. **`AiMessageBubble.tsx:140` — useEffect 依赖 `displayed` 可能非预期**
- `displayed` 每次字符更新都变，但 effect 实际只需要同步 `displayedRef`，理论上可以用 `useRef` 替代 `useState` 存储 `displayed`，完全避免依赖。
- 风险：现有设计利用 `displayed` 状态驱动渲染，改动较大，建议标记为 tech debt。

### 9. **`AiMessageBubble.tsx:162` — `candidates!.map()` 非空断言冗余**
- 在 `hasCandidates && onCandidateSelect` 条件后，`candidates!` 的 `!` 可省略，改为先解包：
  ```ts
  const hasCandidates = Boolean(candidates?.length);
  // ...
  {hasCandidates && onCandidateSelect && candidates.map(...)}
  ```

### 10. **`AiChatPanel.tsx:868` — entityLabelMap 硬编码在渲染路径**
- 每次 SSE `pending_confirmation` 事件都重建 Map 对象。建议提升到组件顶层或用 `useMemo`。

### 11. **`AiThinkingStream.tsx:236` — logs 渲染缺少 key 稳定性**
- `(task as any).logs.map((log: any, i: number) => ...)` 用 index 作为 key，若 log 内容顺序变化会产生错误的 DOM 更新。但 logs 一般是追加的，风险低。

---

## 正面亮点

- **Props 接口设计清晰**：`AiResponsePanel`、`AiMessageBubble` 的接口字段命名一致，类型推导良好。
- **SSE 版本号取消机制**（`conversationVersionRef`）：有效防止 stale update 问题，设计优秀。
- **RAF typewriter 循环**：`AiMessageBubble` 用 `requestAnimationFrame` 做打字机，相比 `setInterval` 更流畅，`msPerChar` 自适应速度调优逻辑考虑周全。
- **ref 桥接模式**（`streamingTasksRef` + `setStreamingTasks`）：巧妙解决了 SSE 直接更新 ref 绕过 React batching 的问题。
- **`AbortController` 管理**：SSE 请求取消逻辑完备，组件卸载时正确 abort。
- **Loading skeleton**：空状态和骨架屏设计提升了 UX。

---

## tsc 检查结果

```
✅ 无被审查文件的 TypeScript 编译错误
```

所有 4 个被审查文件通过 tsc 类型检查。tsc 输出的错误均来自历史遗留文件（`e2e/`、`features/admin/`、`pi/packages/agent/`），与本次重构无关。

---

## 结论

**PASS_WITH_FIXES**

本次重构在架构设计（ref 桥接、SSE 版本取消、RAF typewriter）和代码组织上表现优秀，主要问题集中在：

1. **性能**：双 MarkdownContent 渲染和 StepRow 全量 re-render 是主要瓶颈，应优先修复
2. **边界处理**：`content` props 未防御 undefined，存在运行时风险
3. **调试代码**：`console.log` 应在 PR 合并前清理

建议优先修复 Critical 问题 #1、#2 后再合入主干；Major 问题可在后续迭代中处理。

---

## Next Steps

1. 修复 `StepRow` 200ms 全量 re-render（Critical #1）
2. 消除 `AiResponsePanel` 双 `MarkdownContent`（Critical #2）
3. 防御 `content` undefined 边界（Major #3）
4. 清理 `console.log` 调试语句（Major #7）
5. Review 完成后由主代理合并报告
