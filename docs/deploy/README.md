# 部署 / 运维

## 文档

| 文件 | 内容 |
|------|------|
| `DEPLOY_SCRIPT_MANUAL.md` | `deploy.sh` 完整使用手册（前提、流程、参数、回滚） |
| `OPERATIONS.md` | 日常运维说明（环境变量、端口、推送即部署） |

## 脚本

| 脚本 | 用途 |
|------|------|
| `deploy.sh` | 一键部署：git pull → build → 重启服务（端口 3003） |
| `configure-postgres-remote.sh` | 配置 PostgreSQL 远程访问 |
| `fix-pg-hba.sh` | 修复 `pg_hba.conf` 允许远程连接 |
| `fix-bare-repo.sh` | 修复裸仓库 HEAD 从 master 指向 main |

## 推送即部署

push 到 bare repo `main` 分支 → post-receive hook 自动执行 `deploy.sh`，无需手动操作。

## 部署前提

- 服务器 SSH 可达
- bare repo 路径：`/home/hxy/work/personal/project-manager.git`
- 服务端口：3003
- PostgreSQL：`192.168.1.14:5432`
