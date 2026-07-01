## Code Review Summary

**Scope:** PR9-ticket-detail-merge-edit-panel 涉及的文件
**Review Type:** Local Changes (2 files)

### Verdict: ❌ Request Changes

---

### Findings

#### Critical (Must Fix)

- **`app/api/tickets/[id]/route.ts:422-443`** PATCH 状态变更缺失通知逻辑
  - **Impact:** 用户通过 PATCH 修改状态时,不会触发任何站内通知(无 `buildDeliveredNotification`/`buildCompletedNotification`/`buildStatusChangedNotification`)。而原来的 `/status/route.ts` 有完整的通知逻辑(155-216 行)。
  - **Suggestion:** 补齐 `PATCH` 内的通知分支,逻辑同 `/status/route.ts`:

    ```ts
    // 在 status 事务块之后追加通知逻辑
    if (nextStatus === TicketStatus.DELIVERED) {
      // notify root users
    } else if (nextStatus === TicketStatus.DONE) {
      // notify assignees + creator
    } else if (isRoot) {
      // notify assignees
    }
    ```

- **`app/api/tickets/[id]/route.ts:446-460`** PATCH assignee 变更缺失通知逻辑
  - **Impact:** 通过 PATCH 修改指派人时,不会通知新增的 assignees 和 root users。而原来的 `/assignee/route.ts` 有完整的通知逻辑(89-117 行)。
  - **Suggestion:** 补齐:

    ```ts
    // 新增 assignee 通知
    const addedAssigneeIds = nextAssigneeIds.filter(id => !currentAssigneeIds.includes(id));
    if (addedAssigneeIds.length > 0) { /* buildAssignedNotification + createManyNotifications */ }
    // root 通知
    const rootUserIds = await listRootUserIds(session.user.id);
    if (rootUserIds.length > 0) { /* notify root */ }
    ```

#### Improvements (Recommended)

- **`app/api/tickets/[id]/route.ts:371, 407`** moduleId 查询执行了两次
  - **Reason:** Line 371 查询 `newModule` 用于 responsibility 校验;Line 407 再次查询用于写入日志 reason 字符串。两次独立的 `findUnique` 调用。
  - **Suggestion:** 在 line 371 查出后存入临时变量,line 407 直接复用;或在 updateData 构建阶段统一做一次查询。

- **`app/api/tickets/[id]/route.ts:293`** PATCH body 无 runtime 校验
  - **Reason:** 直接 `as PATCHBody` 强转,无 zod 等 schema 校验。PATCHBody 字段均为简单类型(string/number/array),实际风险低,但不符合 API 安全规范。
  - **Suggestion:** 考虑加 `z.object({...})` 校验,或至少对 `body` 各字段显式做 `typeof` 检查。

- **`features/ticket/ui/ticket-detail/TicketDetail.tsx:223-227`** `allowedStatuses` 对 BUG 非 ROOT 用户缺少 `READY_FOR_TEST`
  - **Reason:** 代码逻辑写的是:

    ```ts
    if (kind === "BUG") {
      return isRoot ? ["DEVELOPING", "READY_FOR_TEST", "DELIVERED", "DONE"] : ["DEVELOPING", "READY_FOR_TEST", "DELIVERED"];
    }
    return isRoot ? [...] : [...]; // ← 缺 if,PROGRAM 也走这
    ```

    非 ROOT 的 BUG 用户被错误地允许了 `READY_FOR_TEST`,但实际上 BUG 用户改 `READY_FOR_TEST` 应该只给 ROOT(因为 `READY_FOR_TEST` 本质是"待测试"——只有测试人员能操作)。**但更重要的问题**:非 ROOT 的 PROGRAM/BUG 用户本应能改 `READY_FOR_TEST`(USER_ALLOWED_STATUSES 里有这个值),但因为缺少 `if` 导致 PROGRAM 非 ROOT 用户也无法选这个状态。
  - **cross-mentor:** UI `allowedStatuses` 与 API 权限矩阵存在偏差,建议评估 UX 一致性。

#### Nitpicks (Optional)

- **`features/ticket/ui/ticket-detail/TicketDetail.tsx:347-349`** activityLog 中 `type: "created"` 的 `changedBy` 固定取当前 session 用户,而非 ticket 实际 creator
  - Reason: `ticket.creatorId` 已通过 API 返回,但 UI 没用它而用了 `session?.user`。影响:activityLog 里"创建单子"条目的操作人永远是当前看页面的人,而不是创建者。这个问题在 UI 层面无法修复(API GET 未返回 ticket.creator 的完整信息)。
  - **Impact 极低**:只是 activityLog 里"创建单子"条目显示不对。

- **`features/ticket/ui/ticket-detail/TicketDetail.tsx:269-271`** assigneeIds 比较用 `JSON.stringify` + `sort()` 而非直接比较
  - Reason: 可以接受,但可读性略差。`sameAssigneeIds` 函数已存在于 ticket-assignees,建议复用。

---

### Positive Points

- **状态权限矩阵与原子路由 100% 等价** — status 检查的 5 个分支(DESIGN/DESIGN_USER/USER/OVERDUE+CLOSED/DONE)与 `/status/route.ts` 完全一致,无安全偏差。
- **事务处理正确** — `status` 和 `assignee` 变更在 `prisma.$transaction` 内原子更新+写 history,符合参考路由模式。
- **Priority/Module ModerationLog 覆盖** — `EDIT_TICKET`(priority)和 `CHANGE_TICKET_MODULE`(module)均已正确记录,匹配原 `/priority/route.ts` 和 `/module/route.ts`。
- **FSD 边界干净** — `features/ticket/ui/ticket-detail/TicketDetail.tsx` 未跨 feature import;API route 引用路径正常。
- **SWR 数据层清晰** — UI 层数据获取与 UI state 分离良好;`activityLog` 用 `useMemo` 合并 statusHistory/assigneeHistory/moderationLogs,避免冗余渲染。
- **删除单子 ROOT 权限校验** — `DELETE` 用 `requireRoot()`,符合需求。
- **图片上传安全** — `fileToDataUrl` 生成 `data:image/...;base64,...` 本地 URL,无远端 XSS 风险。

---

### Next Steps

1. **必须修复(阻塞合并):**
   - [ ] 补齐 PATCH handler 的 status 变更通知逻辑
   - [ ] 补齐 PATCH handler 的 assignee 变更通知逻辑

2. **建议优化:**
   - [ ] 修复 moduleId 二次查询问题
   - [ ] 确认 `allowedStatuses` BUG 分支逻辑是否符合业务预期
   - [ ] 考虑 PATCH body 加 zod 校验

3. **非阻塞,可后续迭代:**
   - [ ] activityLog "创建单子"条目 creator 信息问题需 API 侧改动(GET 返回完整 creator 信息)
   - [ ] assigneeIds 比较改用 `sameAssigneeIds` 函数

---

### TSC 检查结果

```bash
npx tsc --noEmit 2>&1 | grep -E "TicketDetail|route\.ts\([0-9]+\.[0-9]+"
# 无输出 → 0 个相关类型错误
```

**结论:** 本次 PR 范围内 0 个 TypeScript 类型错误。

---

*本报告由 code-reviewer 子代理生成,主代理负责决策后续处理。*
