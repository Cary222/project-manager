## F0 死代码清理 Code Review 结论: NEEDS_FIX

---

### 审查项

- [PASS] 删除动作确认 — `ls` 返回 `No such file or directory`，文件已不存在
- [FAIL] 残留引用检查 — `.next/types/validator.ts` 仍有对已删路由的静态类型验证引用
- [PASS] tsc 错误是否新增 — 仅 `.next/` 缓存（gitignored build artifact）报错，非源码污染
- [PASS] e2e/script/tests 间接引用 — `e2e/ai-chat-polish.spec.ts` / `scripts/ai-chat-polish-smoke.ts` 均无 `/api/ai/chat` 引用

---

### 详细发现

#### Critical (Must Fix)

**`.next/types/validator.ts:305`** — 残留类型引用导致 tsc 报错

```
Cannot find module '../../app/api/ai/chat/route.js'
```

- **Impact**: `.next/` 目录（gitignored build artifact）缓存了已删除路由的类型验证块，每次 `tsc --noEmit` 仍会拉取这个文件导致报错。新 clone 或 CI 机器上首次运行会失败。
- **Root Cause**: 删除 `route.ts` 后未清理 `.next/` 缓存；Next.js App Router 的 route handler 类型校验在 `.next/types/` 下生成了独立验证块。
- **Suggestion**: 运行 `rm -rf .next`，让 Next.js 在下次 build/dev 时重新生成干净的类型缓存。该错误会在 `.next/` 重建后自动消失。

> **说明**：该错误**不是**源码污染，不影响生产构建（`.next/` 不进入 git），但会污染本地 `tsc --noEmit` 输出，CI 环境首次运行时也会报错，直到 `.next/` 重建。plan §9 的验证命令 `npx tsc --noEmit` 会因这个残留而失败。

---

### 决议

**NEEDS_FIX** — 必须清理 `.next/` 缓存后 tsc 才能绿。

待修清单：

1. `rm -rf /Users/vastgui/Desktop/project-manager/.next`（本地开发环境）
2. CI/CD 流程中若执行 `tsc --noEmit`，需在该步骤前加 `rm -rf .next` 或 `npm run clean`（如果存在该 script）

---

### 后续建议（若有）

删除文件本身是干净彻底的，无源码级残留。清理 `.next/` 缓存后，F0 的 tsc 错误将归零。建议在 plan §9 复现 Checklist 里加上 `rm -rf .next` 一步，避免新人踩同样的坑。

---

### Positive Points

- 删除动作正确，文件真的没了
- 代码引用层面零残留（`grep` 仅命中 `docs/ai/ai-module-full-chain.md`，文档提及不影响编译/运行）
- 测试文件无任何间接引用
- `package-lock.json` / `package.json` 无相关变更

---

### 审查范围说明

- 仅审查 F0 死代码清理一项
- 不涉及 F1 / F2 / F3 改动
- `features/admin/admin.test.ts` 的 `@/lib/db` 错误 和 `e2e/module-edit.spec.ts` 的 `expect()` 参数错误均为**已知历史遗留**（user prompt 已注明），不计入本次审查
