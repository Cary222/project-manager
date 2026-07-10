# AI Mode 重构 v2 — 审查合并报告

> merged by Main, 2026-07-10

---

## 审查范围

| 文件 | 改动类型 |
|------|---------|
| `features/ai/tools/index.ts` | 重写（新增 POLICIES 表 + maxStepsForMode） |
| `app/api/ai/conversations/[id]/messages/route.ts` | 2 行改动（import + stopWhen） |

---

## 综合 Verdict：✅ Approved（无 Critical）

**tsc：** ✅ 0 新增错误（仅 2 个历史遗留 pre-existing：`e2e/module-edit.spec.ts`、`features/admin/admin.test.ts`）

---

## 硬层审查（来源：[PR0-ai-mode-code-reviewer.md](docs/reviews/PR0-ai-mode-code-reviewer.md)）

### 类型安全 ✅
- `toolsetForMode` 返回 `WebToolSet | SearchToolSet | AutoToolSet | EmptyToolSet | undefined`，union type + `EmptyToolSet` + `undefined` 边界处理正确
- `chat: { tools: {}, maxSteps: 2 }` → `Object.keys({}).length === 0` → `undefined`，Vercel AI SDK 收到 `undefined` 工具集后将以无工具模式运行
- `mode as "auto" | "web" | "search" | "chat"` — 从 `z.enum` 校验结果强转，**安全**（Zod 不改变运行时代码）

### 错误处理 ✅
- SSE stream 有 try/catch，`tool-error` 类型正确处理，`result.text` fallback 有单独 try/catch
- `stopWhen: stepCountIs(maxStepsForMode(mode))` 对不同 mode 有不同上限（chat=2, search=3, auto/web=4）

### 安全 ✅
- 无 XSS 风险（`dangerouslySetInnerHTML` 未出现）
- `requireSession` 在 API route 入口做认证
- `setSearchKnowledgeViewer` / `setSearchStructuredViewer` 在 handler 内同步调用，无并发问题

### FSD 边界 ✅
- `features/ai/tools/` 是正确的放置位置，route.ts 通过 barrel export 导入，无跨 feature 越界

### 无 DB 路径 ✅
- 本次改动无 Prisma / N+1 查询

---

## 软层审查（来源：ai-learning-mentor 子代理 transcript，合并 by Main）

### 设计决策评估 ✅

**4 种 mode 工具集分配：合理**
- auto（structured 优先，4 步）：工单/用户/项目查询命中率最高，优先正确
- search（knowledge 优先，3 步）：语义检索精准度高，顺序合理
- chat（无工具，2 步）：最快路径，无工具集噪音
- web（webSearch 优先，4 步）：联网为主，structured 兜底（knowledge 不挂，避免联网场景被笔记带偏）

**maxSteps 分配：合理**
- chat=2：≥1 思考 + 1 生成，符合 Vercel AI SDK stepCountIs 语义
- search=3 / auto=web=4：从 RAG 检索到最终回答，3-4 步足够覆盖

### v1 → v2 迭代质量 ✅

| v1 问题 | v2 处理 | 效果 |
|---------|---------|------|
| `prefetchRag` 重复 `useRag` | 删除，改用 `useRag` | ✅ |
| `maxSteps=1`（chat） | 改为 2 | ✅ chat 能生成 text |
| auto 加 webSearch | 删除 | ✅ 不违背"智能选择"描述 |
| mode 指令无效 | 删除，只靠 toolset | ✅ LLM 看不到就不会调 |

---

## 已知低优先级问题

> code-reviewer 提出，Main 判断无需在本 PR 修复（未来可作为 follow-up）

1. **`toolsetForMode` vs `maxStepsForMode` 的 unknown-mode fallback 语义不一致**
   - `toolsetForMode`: `POLICIES[mode] ?? POLICIES.auto` → 返回 auto 工具集
   - `maxStepsForMode`: `POLICIES[mode]?.maxSteps ?? 4` → 返回默认值 4
   - 当前无风险：`z.enum` 在入口保证 `mode` 永远合法，永远不走 unknown 分支
   - 未来可统一为两者都用 `?? POLICIES.auto`

2. **`mode as "auto"|"web"|"search"|"chat"` 强转 vs `ToolMode` 类型同步维护**
   - 当前由 Main 人肉保证一致性，未来可改为 `mode as ToolMode` 引用 `tools/index.ts` 的 `ToolMode` 类型

---

## Main 交叉验证结论

- ✅ 方案 v2 正确处理了 v1 的所有问题（prefetchRag 过度抽象 + 4 个质疑点）
- ✅ 工具分发逻辑完整（searchStructured 入 POLICIES，3 个工具全部覆盖）
- ✅ `stopWhen: stepCountIs(8)` → `maxStepsForMode(mode)` 解决延迟问题
- ✅ 无新引入的 breaking change
- ✅ `useRag` 逻辑未改，维持向后兼容

---

## Next Steps

1. **无需重跑 tsc**（已 0 新增错误）
2. **建议进入 Stage3 Merge**
3. 审查报告：`docs/reviews/PR0-ai-mode-code-reviewer.md`
