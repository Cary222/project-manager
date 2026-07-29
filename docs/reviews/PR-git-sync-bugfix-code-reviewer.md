# Code Review: Git Sync Bug Fixes

**Scope:** `lib/git-sync/repos.ts`, `lib/git-sync/scan.ts`, `worker/lib/cron-scheduler.ts`
**Review Type:** Local Changes (git diff)
**Reviewer:** code-reviewer (硬层)

---

## Code Review Summary

### Verdict: ❌ Request Changes

4 个修复中有 2 个存在 must-fix 问题，其中修复 4 实际上**未完成**。

---

## Findings

### Critical (Must Fix)

#### 1. **修复 4 未实现 — cron scheduler 未启动 git sync**

- **文件:** `worker/lib/cron-scheduler.ts:21, 133-136`
- **问题:** 第 21 行导入了 `syncAllManagedRepos`，但从未调用。模块底部只启动了 `startOverdueScanner()` 和 `startProfileCleanupScheduler()`，git sync 的 scheduler **完全缺失**。
- **Impact:** 用户期望的"添加 cron 调度"功能根本不存在，git sync 只能手动触发。
- **Suggestion:** 参考 `startOverdueScanner()` 模式，添加类似 `startGitSyncScanner()` 并在模块底部调用：

```typescript
export function startGitSyncScanner(): void {
  if (__git_sync_started) return;
  __git_sync_started = true;
  runGitSyncScan().catch((error) => {
    console.error("[git-sync] Initial scan failed:", error);
  });
  __git_sync_interval = setInterval(() => {
    runGitSyncScan().catch((error) => {
      console.error("[git-sync] Scheduled scan failed:", error);
    });
  }, 5 * 60 * 1000); // 5 minutes
  console.log("[cron-scheduler] Git sync scanner started (5 min interval)");
}

// 底部加上
if (process.env.NODE_ENV !== "test") {
  startOverdueScanner();
  startProfileCleanupScheduler();
  startGitSyncScanner(); // ← 缺失
}
```

---

#### 2. **修复 2 边界风险 — 首次同步可能漏扫**

- **文件:** `lib/git-sync/scan.ts:57`
- **问题:** 首次同步使用 `--max-count=1000`，但 `--max-count` 限制的是**当前 ref 可见的提交数**，而非"最近 N 天/周"。对于活跃仓库，1000 条可能只覆盖几天或几周，导致历史漏扫。
- **Impact:** 首次部署时，如果仓库 commit 历史超过 1000 条，超过的 commit 不会被关联到 ticket，用户感知上"历史 commit 丢失"。
- **Suggestion:** 考虑两个方向之一：
  - **方案 A（推荐）：** 增大限制至 `10000`，首次同步允许更多历史（如仓库有 3 年历史 × 每天 5 commits = 约 5500 条，仍在范围内）
  - **方案 B：** 首次同步不设 `--max-count`，扫描全部历史（适合首次导入）
- **临时缓解:** 可以在注释中说明"首次同步后游标建立，后续增量不受此限制"，并在文档中提示用户首次运行可能需要手动补全历史。

---

### Improvements (Recommended)

#### 3. **repos.ts — macOS/Linux 路径构造不一致**

- **文件:** `lib/git-sync/repos.ts:16-27`
- **问题:** macOS 分支用 `path.join(home, "work", "company")` 构造路径，而 Linux 分支硬编码 `/home/hxy/work/company`。逻辑上 Linux 也应该用 `path.join(home, "work", "company")`，保持一致性。
- **Impact:** 如果 Linux 用户目录不是 `/home/hxy`（例如 `root`、`ubuntu`），Linux 分支的 fallback 路径完全不生效。
- **Suggestion:** Linux 分支也改为 `path.join(home, "work", "company")` 或在环境变量缺失时抛出错误提示用户配置 `GIT_REPO_ROOTS`。

#### 4. **scan.ts — 调试日志残留**

- **文件:** `lib/git-sync/scan.ts:61, 64, 67, 76`
- **问题:** `console.log("DEBUG ...")` 调试日志残留 4 处。
- **Impact:** 生产环境中产生噪音日志。
- **Suggestion:** 全部移除，或改为 `console.debug()` 并确保生产环境 `DEBUG` 日志级别不输出。

#### 5. **repos.ts — parseRootsFromEnv 缺乏校验**

- **文件:** `lib/git-sync/repos.ts:37`
- **问题:** `parseRootsFromEnv()` 返回的路径没有验证是否存在。如果用户配置了无效路径，`listManagedRepos()` 会报错。
- **Suggestion:** 添加存在性检查：

```typescript
return raw.split(",")
  .map((p) => path.resolve(p.trim()))
  .filter(Boolean)
  .filter(async (p) => {
    try { await fs.access(p); return true; } catch { return false; }
  });
```

---

### Positive Points

- **修复 1（路径动态化）** 整体设计合理：环境变量优先 + 平台检测 + `os.homedir()` fallback，方向正确。
- **修复 3（参数顺序）** 正确修复了 `--since` 必须在 `--max-count` 之前的 git 语义问题。
- **scan.ts 的 `hasCursor` 变量名** 比原来的 `cursor?.lastCommitAt` 更清晰。
- **增量同步 1 小时回退窗口** 设计合理，避免了边界 commit 漏扫。
- **cron-scheduler.ts 的多实例并发风险注释** 准确，代码中 `upsert` 的幂等性设计也合理。

---

## Next Steps

1. **必须修复（阻塞发布）：**
   - 完成修复 4：在 `cron-scheduler.ts` 中实际启动 git sync scheduler
   - 增大首次同步的 `--max-count` 限制（或文档说明限制）

2. **建议修复（提升质量）：**
   - 统一 Linux/macOS 路径构造方式
   - 移除 DEBUG 日志
   - 添加 `GIT_REPO_ROOTS` 环境变量的路径存在性校验

3. **审查类型建议：**
   - 本次修复涉及 worker 模块和 git 操作，**建议补充**：
     - 在 `lib/git-sync/scan.ts` 的 `syncRepoCommits` 中对每个 ticket lookup 增加 batch 查询，避免 N+1
     - 测试覆盖：验证首次同步、增量同步、空仓库场景

---

## Appendix: tsc 编译检查

运行 `npx tsc --noEmit` 发现 **0 个** 与本次修改相关的类型错误。现有的 tsc 错误（`app/projects/[projectId]/page.tsx`、`e2e/` 测试文件、`features/admin/admin.test.ts`）均为**历史遗留问题**，与本次 git-sync 修复无关。
