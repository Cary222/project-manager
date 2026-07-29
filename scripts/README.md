# scripts/ — 一次性脚本

全部是手跑或自动化辅助脚本（**不是常驻服务**）。常驻进程见：
- `worker/` — Node.js 异步索引 Worker
- `embedding/` — Python FastAPI 向量服务

## 根目录脚本

| 脚本 | 类型 | 用途 |
|---|---|---|
| `deploy.sh` | bash | git post-receive hook 触发：拉新代码 → npm install → build → 重启 Next.js |
| `diag-agnes-api.sh` | bash | Agnes API 诊断脚本 |
| `cleanup-old-jobs.ts` | tsx | 清理 30 天前的废弃 IndexJob（PENDING/COMPLETED） |

## Feature 目录

按功能模块组织的脚本目录，每个目录对应一个 feature。

### `ai/` — AI 对话模块

| 脚本 | 用途 |
|---|---|
| `ai-chat-polish-smoke.ts` | AI Chat PATCH 接口 smoke 测试 |
| `test-human-in-loop.ts` | Human-in-loop 测试：意图消歧 + 数字选择 |
| `test-resolve-user-disambiguate.ts` | 用户名消歧路径测试 |

### `pkm/` — 知识管理模块

| 脚本 | 用途 |
|---|---|
| `fix-note-tags.ts` | 把 noteTags 元数据追加到 SearchDocument content |
| `migrate-pkm-base64-attachments.ts` | PKM base64 附件迁移（支持断点续跑） |
| `pkm-board-smoke.ts` | PKM 页面 HTTP smoke 测试 |
| `test-async-index-pipeline.ts` | 异步索引流水线全链路测试 |

### `document/` — 文档搜索模块

| 脚本 | 用途 |
|---|---|
| `backfill-document-chunk-url.ts` | 把 chunk url 从 `/api/upload` 升级到项目文档详情页 |
| `backfill-file-asset-projectid.ts` | 回填 DOCUMENT SearchDocument 的 projectId |
| `check-project-refs.ts` | 诊断 FILE_ASSET IndexJob 状态 |
| `check-search-doc.ts` | 查 SearchDocument 各 sourceType 统计 |
| `diagnose-document-failed.ts` | 诊断 Document FAILED 原因 |
| `diagnose-document-search.ts` | 诊断文档搜索问题 |
| `diagnose-pkm-search.ts` | 诊断 PKM 知识库搜索问题 |
| `job-admin.ts` | IndexJob 管理脚本 |
| `search-admin.ts` | SearchDocument 管理脚本 |
| `test-clean-extracted-text.ts` | 清洗提取文本测试 |
| `verify-file-asset-projectid.ts` | 验证 projectId 回填结果 |

> 原 `vector-search/` 目录已合并到此

### `user/` — 用户搜索模块

| 脚本 | 用途 |
|---|---|
| `apply-search-name-column.ts` | 直接添加 User.searchName 列 |
| `backfill-user-search-names.ts` | 回填所有用户的 searchName 字段 |
| `test-user-search.ts` | User.searchName 模糊匹配测试 |

### `weekly-reports/` — 周报模块

| 脚本 | 用途 |
|---|---|
| `backfill-weekly-report-rate.ts` | 基于 createdAt 重新计算历史每日周报提交率 |
| `diagnose-weekly-reports.ts` | 诊断本周周报数据 |
| `profile-actions-unit-test.ts` | profile-actions 纯函数单元测试 |
| `reports-store-unit-test.ts` | reports-store 纯函数测试 |
| `verify-pr.ts` | PR1~PR7 完整验证套件 |
| `weekly-report-bg-job-unit-test.ts` | 周报后台任务入队逻辑测试 |
| `weekly-report-draft-summary-unit-test.ts` | 周报 AI 总结功能测试 |
| `weekly-report-store-unit-test.ts` | weekly-report-store mock 测试 |

### `ticket/` — 工单模块

| 脚本 | 用途 |
|---|---|
| `acceptance-test.ts` | 主线 ticket 模块的单元测试 |
| `overdue-scan-test.ts` | 逾期扫描集成测试 |
| `ticket-deadline-unit-test.ts` | ticket deadline 纯函数测试 |

## 运维子目录

- `deploy/` — 部署辅助（systemd unit、PostgreSQL 配置脚本）
- `ticket-project/` — ticket 项目相关脚本（预留）
- `user-responsibilities/` — 用户职责相关脚本（预留）
- `_utils/` — 跨模块通用工具（详见 `_utils/README.md`）

## 运行

```bash
# 跑根目录 tsx 脚本
npx tsx scripts/<script>.ts

# 跑 feature 目录 tsx 脚本
npx tsx scripts/<feature>/<script>.ts

# 跑 bash 脚本
bash scripts/deploy.sh
```

多数常用命令已在 `package.json` 配成 `npm run xxx` 快捷方式。
