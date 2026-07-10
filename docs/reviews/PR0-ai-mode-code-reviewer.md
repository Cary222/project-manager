<!-- reviewer: code-reviewer (硬层) -->

## Code Review Summary

**Scope:** `features/ai/tools/index.ts`（新实现）+ `app/api/ai/conversations/[id]/messages/route.ts`（改动点）
**Review Type:** Local Changes（方案 v2）
**tsc:** ✅ 0 新增错误（仅 2 个历史遗留 pre-existing：`e2e/module-edit.spec.ts`、`features/admin/admin.test.ts`，已见于 PR6~PR8 踩坑记录）

---

### Verdict: ✅ Approved

两个文件实现质量良好，类型安全正确，无 critical must-fix 问题。仅有 1 个设计一致性问题值得注意。

---

### Findings

#### Improvements (Recommended)

- **`features/ai/tools/index.ts:43`** `toolsetForMode` 和 `maxStepsForMode` 的 unknown-mode fallback 策略不一致

  ```ts
  // toolsetForMode: 未知 mode → fallback 到 auto tools
  const policy = POLICIES[mode] ?? POLICIES.auto;

  // maxStepsForMode: 未知 mode → 默认 4
  return POLICIES[mode]?.maxSteps ?? 4;
  ```

  - **现状**：`mode` 实际经 `z.enum` 验证，永不走到 unknown branch；但类型签名（`ToolMode`）本身无法在运行时保证
  - **风险**：如果未来某处绕过 schema 直接传字符串（如前端 bug 或内部调用），两个函数会产生不一致行为：`toolsetForMode` 会返回 auto 的工具集（而非 `undefined`），`maxStepsForMode` 返回 `4`
  - **Suggestion**：将 `toolsetForMode` 改为与 `maxStepsForMode` 对齐的 fallback 策略：

    ```ts
    // option A: 严格模式，unknown 返回 undefined
    const policy = POLICIES[mode];
    if (!policy) return undefined;
    if (Object.keys(policy.tools).length === 0) return undefined;
    return policy.tools;

    // option B: 与 maxStepsForMode 对齐，统一用 auto policy
    // （当前实现即此策略，只需在 maxStepsForMode 也用同样的 ?? POLICIES.auto）
    ```

  - **Reason**：两个函数签名互补（返回工具 vs 返回步数），应有一致的 unknown 语义

---

#### Nitpicks (Optional)

- **`app/api/ai/conversations/[id]/messages/route.ts:171`** `mode as "auto" | "web" | "search" | "chat"` — 这行是显式 type assertion，类型上等价于 `mode as ToolMode`。从 `z.enum` 校验结果做此 cast 是**安全**的（Zod 不改变运行时代码），但如果未来 `AI_MODE_OPTIONS` / schema 增加 mode，此处需同步更新
  - 当前不是问题（与 `ToolMode` 和 `z.enum` 保持同步），但可考虑用 `mode as ToolMode` 替代字面量 union 以减少维护风险

- **`features/ai/tools/index.ts:44`** `Object.keys(policy.tools).length === 0` 判断空工具集 — 这在 TypeScript 层是正确且常用的模式，但注意 `EmptyToolSet = Record<string, never>` 的 `Object.keys()` 返回 `string[]` 而非 `never[]`，这是 TS 的已知行为，此处用法正确

---

### Positive Points

- **类型安全 ✅**：toolset 返回 union type，`EmptyToolSet` + `undefined` 边界处理正确；`z.enum` 校验保证 `mode` 合法；`streamText` 对 `tools` 参数接受 `unknown`
- **chat mode 边界 ✅**：`chat: { tools: {}, maxSteps: 2 }`，`toolsetForMode` 对空对象正确返回 `undefined`（`Object.keys({}).length === 0`），Vercel AI SDK 收到 `undefined` 工具集后将以无工具模式运行
- **stopWhen 行为 ✅**：`stepCountIs(maxStepsForMode(mode))` 对不同 mode 有不同上限（chat=2, search=3, auto/web=4），符合各模式预期对话长度
- **FSD 边界 ✅**：`features/ai/tools/` 是正确的放置位置，route.ts 通过 barrel export 导入，无跨 feature 越界
- **错误处理 ✅**：SSE stream 有 try/catch，`tool-error` 类型正确处理，`result.text` fallback 有单独 try/catch，防止 stream 异常时吐出空响应
- **无 DB 路径 ✅**：本次改动无 Prisma/N+1 查询
- **安全 ✅**：无 XSS 风险（`dangerouslySetInnerHTML` 未出现），`requireSession` 在 API route 入口做认证，`setSearchKnowledgeViewer` / `setSearchStructuredViewer` 在 handler 内同步调用无并发问题
- **历史一致性 ✅**：prevents double-emit fallback 设计正确（`totalTextChars === 0` 才 fallback），避免 multi-step 调用时重复发送

---

### Next Steps

- 建议主代理决定是否修复 `toolsetForMode` / `maxStepsForMode` fallback 不一致问题（当前优先级：**低**，因为 `z.enum` 已在入口保证 mode 合法）
- 无需重跑 tsc（已 0 新增）
- 如需 Review 其他相关文件（如 `agnes-provider.ts`、`summarizer.ts`），请主代理另开任务
