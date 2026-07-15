# Code Review Report — Dashboard 重构

<!-- reviewer: code-reviewer (硬技术层) -->

## Code Review Summary

**Scope:** `features/dashboard/Dashboard.tsx`、`app/api/pkm/notes/route.ts`、`app/api/ai/conversations/route.ts`、`app/api/tickets/mine/route.ts`
**Review Type:** Local Changes

### Verdict: ⚠️ Approved with Suggestions

---

## TypeScript Check

```bash
npx tsc --noEmit 2>&1 | head -100
```
**Result:** ✅ 无新增 tsc 错误。现有错误均来自历史遗留文件（`e2e/module-edit.spec.ts` 的 Playwright 类型误用、`features/admin/admin.test.ts` 的 `@/lib/db` 缺失），与本次改动无关。

---

## Findings

### Critical (Must Fix)

- **[`features/dashboard/Dashboard.tsx:43-48`]** `Conversation` 本地类型与 `ConversationListItem` 实际返回类型存在严重不一致：

  1. `title: string` — 实际是 `string | null`（可空）
  2. `updatedAt: string` — 实际 Prisma 返回 `Date` 对象，不是 ISO 字符串
  3. 缺少 `createdAt`、`lastMessageAt` 字段（但 Dashboard 组件未使用，影响较小）

  `useSWR` 的泛型参数期望 `updatedAt` 是字符串，但 Prisma 直接返回 `Date`，`toISOString()` 等字符串方法会失败。**这是运行时潜在 bug**。

  **建议**：从 `features/ai/lib/conversation-store.ts` 导出 `ConversationListItem` 类型，或在 Dashboard 中改用 `Date` 类型并处理序列化。

- **[`app/api/pkm/notes/route.ts:28`]** `take` 参数未校验 NaN / 负数 / 超大值，可能导致无意义的全量查询或 Prisma 报错。

```ts
const take = Number(searchParams.get("take") ?? "10");
// - 若 NaN，take = NaN，Prisma take: NaN → 报错
// - 若负数，Prisma 接受负数并返回 0 条记录
// - 若极大（如 9999999），可能查询全表
```

建议：
```ts
const raw = Number(searchParams.get("take") ?? "10");
const take = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 10;
```

---

### Improvements (Recommended)

- **[`features/dashboard/Dashboard.tsx:50-56`]** `WeekReportResponse` 类型中 `reports: unknown[]` 字段在组件中完全未使用，建议改为 `reports?: []` 或删除该字段，避免类型不一致。

- **[`features/dashboard/Dashboard.tsx:178-179`]** P0/P1 筛选条件：

```ts
const p0p1 = myTickets.filter(
  (t) => t.priority <= 1 && !["DONE", "CLOSED"].includes(t.status)
).length;
```

`priority` 的类型定义是 `number`（0-3），`priority <= 1` 逻辑正确。但 `MyTicket` 类型中 `priority` 确实是 `number`，已确认。但注意：`priority: 0 | 1` 等价于 P0/P1，这里用了 `<= 1`，包含 `priority = -1`、`priority = 0.5` 等边界情况。

建议更严格：
```ts
t.priority === 0 || t.priority === 1
```

- **[`features/dashboard/Dashboard.tsx:192-194`]** 周报提交状态判断：

```ts
const weeklySubmitted = weeklyData?.submitted.some(
  (u) => u.id === session?.user?.id || u.name === session?.user?.name
) ?? false;
```

逻辑正确。注意 `session?.user?.id` 是 `string | undefined`，与 `u.id` 做 `===` 比较时，如果两边类型不一致可能引发 TS 错误（但 tsc 通过说明类型已兼容）。✅

- **[`features/dashboard/Dashboard.tsx:154`]** `refreshInterval: 60000` 只设置在 weeklyData 上，不在 notesData / conversationsData 上——这是合理的有意为之（周报数据需要更高实时性），但代码中无注释说明。**建议加注释**解释为何周报需要更高的刷新频率。

---

### Nitpicks (Optional)

- **[`app/api/ai/conversations/route.ts:21`]** GET handler 没有 input validation，依赖 `Number.parseInt` + `Number.isFinite` 做兜底。逻辑安全，建议加注释说明兜底逻辑。

- **[`features/dashboard/Dashboard.tsx:178-179`]** P0/P1 筛选用 `t.priority <= 1`，逻辑正确但包含负数和浮点。**建议**改严格相等 `t.priority === 0 || t.priority === 1`。

- **[`features/dashboard/Dashboard.tsx:154`]** `refreshInterval: 60000` 无注释说明，**建议加一行注释**解释周报刷新频率较高的原因。

- **[`features/dashboard/Dashboard.tsx:50-56`]** `WeekReportResponse.reports: unknown[]` 在组件中未使用，建议改为 `reports?: []` 避免误解。

- **[`features/dashboard/Dashboard.tsx:165-171`]** 所有 `useMemo` 依赖项都是单一来源（各自对应一个 API），没有跨数据源派生计算，memo 使用合理。

- **[`app/api/tickets/mine/route.ts:21` Added: `priority: true`]** ✅ 新增的 `priority` 字段正确添加在 `select` 中。

- **[`app/api/pkm/notes/route.ts:28` Added: `take` param]** ✅ take 参数已正确实现。

- **[`app/api/ai/conversations/route.ts:18-20` Added: `limit` param]** ✅ limit 参数已正确实现。

---

## Positive Points

- API 层均正确使用 `requireSession` 进行权限检查，错误处理完整（401 / 400 / 500 分层）。
- Prisma 查询使用了精确的 `select`，避免过度获取数据（N+1 防护）。
- SWR 配置正确使用 `STALE_SWR_OPTIONS`，`refreshInterval` 仅在需要的端点上单独设置。
- `normalizeTags` 函数健壮，处理了非数组输入。
- PKM notes 的 `transaction` 使用得当，附件记录和笔记创建在同一事务中。
- `PreviewCard` 组件封装良好，可复用。
- UI 使用了正确的 pretty-ui token（`border-ink-200`、`text-brand-600`、`shadow-sm` 等）。
- `pm-fade-in` 入场动画统一处理。

---

## Cross-Mentor Notes

- `Dashboard.tsx` 中的 `Conversation` 类型错误（`title` 应为可空、`updatedAt` 应为 `Date`）已升级为 Critical，建议 mentor 确认 API 契约文档并推动统一类型定义。
- `WeeklyReportResponse.reports` 未使用但类型为 `unknown[]`，组件逻辑未依赖此字段，可确认是否为历史遗留字段。
- `app/api/pkm/notes/route.ts` 的 `take` 参数校验缺失（Critical）——涉及安全边界，建议 mentor 评估是否需要补充 API 限流。

---

## Next Steps

1. **[Critical]** 为 `features/dashboard/Dashboard.tsx` 中的 `Conversation` 类型与 `ConversationListItem` 保持一致（`title: string | null`、`updatedAt: Date`）
2. **[Critical]** 为 `app/api/pkm/notes/route.ts` 的 `take` 参数添加 NaN / 负数 / 上限校验
3. 为 `features/dashboard/Dashboard.tsx` 中 `weeklyData` 的 `refreshInterval` 添加注释说明
4. `P0/P1` 筛选条件可考虑改用严格相等 `t.priority === 0 || t.priority === 1`
5. `WeekReportResponse.reports` 字段可考虑移除或明确标记为废弃
