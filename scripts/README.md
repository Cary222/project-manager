# scripts/ — 一次性脚本

全部是手跑或自动化辅助脚本（**不是常驻服务**）。常驻进程见：
- `worker/` — Node.js 异步索引 Worker
- `embedding/` — Python FastAPI 向量服务

## 根目录脚本

| 脚本 | 类型 | 用途 |
|---|---|---|
| `deploy.sh` | bash | git post-receive hook 触发：拉新代码 → npm install → build → 重启 Next.js |
| `test-async-index-pipeline.ts` | tsx | 异步索引流水线 E2E 测试（API 同步路径 + Worker + 幂等 + 重试 + stale 恢复 + DELETE 清理） |
| `check-search-doc.ts` | tsx | 一次性查 SearchDocument 各 sourceType 的总数 / 有向量数 |
| `acceptance-test.ts` | tsx | 主线 ticket 模块的单元测试 |

## 子目录

- `deploy/` — 部署辅助（systemd unit、PostgreSQL 配置脚本）
- `vector-search/` — 向量搜索管理 CLI & 诊断脚本（见 `vector-search/README.md`）
- `ticket-project/` — ticket 项目相关脚本
- `_utils/` — 跨模块通用工具（详见 `_utils/README.md`）

## 运行

```bash
# 跑 tsx 脚本
npx tsx scripts/<script>.ts

# 跑 bash 脚本
bash scripts/deploy.sh
```

多数常用命令已在 `package.json` 配成 `npm run xxx` 快捷方式。
