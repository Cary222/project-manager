# project-manager 异步索引 Worker

独立 Node.js 进程，从 `pm.IndexJob` 表轮询任务并异步生成向量索引。

## 跟 embedding/ 目录是平级关系

| 目录 | 角色 | 端口 |
|---|---|---|
| `embedding/` | Python FastAPI 服务（BGE-M3 向量化 + 附件文本提取） | 5000 |
| `worker/` | Node.js 任务调度服务（消费 `IndexJob` 表，调 `embedding/`） | — |

主应用（Next.js / `app/`）通过 `shared/lib/jobs.ts` 入队任务，Worker 拉任务执行。
**两个进程可独立部署、独立重启**。

## 启动

```bash
# 开发（前台运行，看日志）
npm run worker

# 生产
npm run worker:prod

# 跑测试（不需要启服务，验证任务流水线）
npm run test:async-index
```

## 部署（systemd user-level）

参考 `worker/project-manager-worker.service`：

```bash
mkdir -p ~/.config/systemd/user
cp worker/project-manager-worker.service ~/.config/systemd/user/
# 按需修改 WorkingDirectory / ExecStart / EnvironmentFile 路径
systemctl --user daemon-reload
systemctl --user enable --now project-manager-worker.service

# 验证
systemctl --user status project-manager-worker.service

# 看日志
journalctl --user -u project-manager-worker.service -f
```

## 跟主应用部署的顺序

`scripts/deploy.sh`（git post-receive hook 触发）只重启 Next.js，不会重启 Worker。
所以代码改动分两步：

```bash
# 1. 拉新代码（post-receive 自动跑 deploy.sh，重启 Next.js）
git push origin main

# 2. Worker 单独重启（systemd Restart=always 不会热重载 ts 代码）
systemctl --user restart project-manager-worker.service
```

## 队列管理 CLI

```bash
npm run job:status        # 队列状态（pending/processing/completed/failed 计数）
npm run job:inspect <noteId>   # 某 note 的最近 10 个 jobs
npm run job:retry <jobId>      # 单个 job 重置到 PENDING
npm run job:retry-note <noteId>   # 某 note 的所有失败 job 重置
npm run job:clear-pending      # 删所有 PENDING（慎用）
npm run job:purge -- --older-than-days=7   # 清理老 COMPLETED
```

## 索引流水线文档

- `docs/vector-search/PKM异步索引改造-详细计划.md` — 完整设计
- `docs/vector-search/PKM异步索引改造-进度追踪.md` — 进度
- `docs/vector-search/向量搜索-静默失败修复.md` — 历史背景
