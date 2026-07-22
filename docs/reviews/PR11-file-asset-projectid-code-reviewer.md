<!-- reviewer: code-reviewer (硬层) -->

## 审查结论

**APPROVED** — 硬层质量良好，类型安全、错误处理、N+1 和索引均有保障，无必须修复的 Critical 问题。

---

## 硬层审查

### 类型安全 ✅

| 检查项 | 结果 | 位置 |
|--------|------|------|
| `FileReferenceSourceType` 正确导入 | ✅ `type` 定义于 `shared/lib/file-reference.ts:4`，`document.ts:15` 正确 `import type` | `document.ts:15` |
| switch case 覆盖所有枚举值 | ✅ 4 个 case (PKM_NOTE/TICKET/TICKET_COMMENT/PROJECT) + `default` 分支全覆盖 | `document.ts:46–72` |
| Prisma select 类型正确 | ✅ `PkmNote.projectId` (`String?`) 和 `Ticket.projectId` (`String`) 均与 schema 一致 | `document.ts:48–59` |
| `SearchDocument.projectId` 接受 nullable | ✅ schema 定义 `String?`，代码传入 `string \| null` 类型匹配 | `document.ts:299` |
| tsc 无新增错误 | ✅ `document.ts` 零 tsc 错误（仅有 `e2e/` 和 `features/admin/` 测试文件的预存错误，与本次改动无关） | — |

---

### 错误处理 ✅

| 检查项 | 结果 |
|--------|------|
| `findFirst` 返回 `null` 的处理 | ✅ `if (!ref) return null` 在入口处拦截，不继续执行 switch | `document.ts:44` |
| `findUnique` 返回 `null` 的处理 | ✅ 所有 `findUnique` 均通过 `?.` 可选链 + `?? null` 安全降级，不会抛未定义异常 | `document.ts:52,59,66` |
| `PROJECT` case 返回 `sourceId` 作为 projectId | ✅ 逻辑自洽（PROJECT 的 sourceId 即 projectId），无需查询 | `document.ts:69` |
| 查询异常传播路径 | ✅ `resolveProjectIdFromFileAsset` 异常会向上穿透 `processFileAssetJob` 的 try/catch，被捕获后写入 `Document.FAILED`，不导致进程崩溃 | `document.ts:260,330–341` |
| 无 swallowing 问题 | ✅ 没有 catch 后 silent swallow，所有异常路径均有日志写入 | `document.ts:332,337` |

---

### N+1 风险 ✅

每个 `processFileAssetJob` 调用产生至多 **3 次**额外只读查询（不是 O(N) N+1）：

1. `fileReference.findFirst` — 找关联记录（0 或 1 次）
2. `pkmNote.findUnique` / `ticket.findUnique` / `ticketComment.findUnique` — 反查 projectId（0 或 1 次）
3. `ticketComment` → 额外 JOIN `ticket` 读 `projectId`（仅 TICKET_COMMENT 分支）

**结论**：N=1，不是 N+1。无需批量优化。

---

### 性能 ✅

| 查询 | 索引支撑 | 状态 |
|------|---------|------|
| `fileReference.findFirst({ where: { fileAssetId, deletedAt: null } })` | `@@index([fileAssetId, deletedAt])` | ✅ 覆盖 |
| `pkmNote.findUnique({ where: { id } })` | `@id` (cuid PK) | ✅ 覆盖 |
| `ticket.findUnique({ where: { id } })` | `@id` (cuid PK) | ✅ 覆盖 |
| `ticketComment.findUnique({ where: { id }, select: { ticket: { select: { projectId: true } } } })` | `@id` (cuid PK) + `ticket` relation FK | ✅ 覆盖 |

查询策略：所有只读查询均在事务外执行，仅写操作在 `$transaction` 内，符合读多写少模式。

---

### 事务一致性 ✅

**当前设计**：`projectId` 读取在事务外（`document.ts:260`），写入在事务内（`document.ts:299`）。

**分析**：
- `SearchDocument.projectId` 是 **nullable** 字段
- 最坏情况：事务内写入 `projectId: null`（reference 在读取后、写入前被软删除）
- **影响**：搜索精度降级（该文档不在项目范围内筛选），但**不会**导致数据损坏或进程崩溃
- **设计合理**：如果将 projectId 查询纳入事务，会拉长事务持有时间，增加锁竞争；当前设计是正确取舍

**Found new issue（建议）**：若未来 PR11 重处理走 `processFileAssetJob` 路径，需确保 `deletedAt: null` 条件始终生效（当前已满足 ✅，但 PR11 实现者需知此约束）。

---

### PR11 兼容 ✅

| 场景 | 当前行为 | PR11 需知 |
|------|---------|-----------|
| `resolveProjectIdFromFileAsset` 在 PR11 重处理时 | 正常工作，`deletedAt: null` 过滤有效 | 保持此 helper 不变 |
| `processFileAssetJob` 重处理 | 走现有 upsert 路径（status → PROCESSING） | PR11 需在 upsert 前处理 version++ |
| `metadata.fileAssetId` 清理 | 暂保留（PR11 清理注释已标注） | PR11 重处理会逐步覆盖旧 metadata |

---

## Critical 问题（必须修复）

**无 Critical 问题**。

---

## 建议优化（可选）

### Improvement #1（建议）：`TICKET_COMMENT` 查询加 `orderBy` 确定性

| 项目 | 内容 |
|------|------|
| **位置** | `document.ts:62` |
| **问题** | `ticketComment.findUnique` 不需要 `orderBy`，但语义上一个 comment 有多个 projectId 是不合理的（comment → ticket 是 1:1）。当前 `@id` 唯一查询已保证确定性。 |
| **结论** | ✅ 当前实现正确，无需修改。这是代码规范风格问题，不影响功能。 |

### Improvement #2（建议）：bytes 类型 cast 注释可精简

| 项目 | 内容 |
|------|------|
| **位置** | `document.ts:267–269` |
| **当前** | `eslint-disable` + `as any` + 长注释解释 |
| **建议** | 可在 `shared/lib/document.ts` 顶部加一行 `// eslint-disable-next-line @typescript-eslint/no-explicit-any`（文件级禁用），省去行内注释 |

---

## 正面发现

- `resolveProjectIdFromFileAsset` helper 设计清晰，注释完整（JSDoc 覆盖所有 sourceType 查询路径）
- 错误处理覆盖完整：`FILE_NOT_FOUND` / `FILE_DELETED` / `EXTRACTION_EMPTY` / `EXTRACT_TEXT_FAILED` 均有明确错误码
- `upsertSearchDocumentEmbedding` 使用 `Prisma.TransactionClient` 参数，正确嵌入事务上下文
- `vectorToSqlLiteral` 与 `shared/lib/search.ts` 保持一致，避免重复造轮子

---

## Next Steps

- 无需修改，可直接进入 User Decide 阶段
- 如需处理 Improvement #2（eslint cast），可作为低优先级 follow-up
