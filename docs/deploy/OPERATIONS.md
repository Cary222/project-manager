# 运维说明

## 部署脚本

如果你需要了解 `scripts/deploy.sh` 的实际执行流程、使用方式、风险与后续升级方向，请先阅读：

- [scripts/deploy.sh 使用手册与运维说明](DEPLOY_SCRIPT_MANUAL.md)

**推送即部署**：push 到 bare repo 的 `main` 分支，post-receive hook 会自动执行 `scripts/deploy.sh`，无需手动操作。

## 环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL，默认 schema 为 `pm`，并带 `search_path=pm,public` |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | 随机密钥 |
| `AUTH_TRUST_HOST=true` | 必须开启，支持局域网访问 |

**不要设置** `AUTH_URL`（**`NEXTAUTH_URL=http://localhost:3003` 已设，保留即可**——避免 0.0.0.0 被用于 redirect URL；不要额外加 `AUTH_URL`，否则会强制跳转到 localhost）。

## 首次部署

```bash
cd /home/hxy/work/personal/project-manager
npm install
npx prisma db push
npm run db:seed    # 仅初始化单号计数器
npm run build
npm run start
```

## 日常命令

```bash
npm run dev      # 开发，0.0.0.0:3003（连远程 DB，Mac 本地无需 Postgres）
npm run build    # 生产构建
npm run start    # 生产服务，0.0.0.0:3003（systemd 托管）
npm run db:seed  # 重置 Counter（不创建默认用户）
npm run db:promote -- <邮箱>  # 提权某用户为 ROOT
npm run worker   # 启动 PKM Index Worker（Mac 本地调试用；生产用 systemd）
```

## systemd 常驻（推荐）

用户级服务，开机/登出后仍运行（`Linger=yes`）：

```bash
systemctl --user enable --now project-manager.service   # 启用并启动
systemctl --user status project-manager.service         # 状态
systemctl --user restart project-manager.service        # 重启（改代码后先 npm run build）
systemctl --user stop project-manager.service           # 停止
journalctl --user -u project-manager.service -f         # 日志
```

单元文件：`~/.config/systemd/user/project-manager.service`

## 手动重启（未用 systemd 时）

```bash
fuser -k 3003/tcp 2>/dev/null
sleep 1
npm run start
```

`exit 137` 是 `fuser -k` 杀旧进程的正常现象。

## 访问地址

- 本机：http://localhost:3003
- 局域网：http://<本机IP>:3003（当前绑定 `0.0.0.0`）

## Git 远端

本地 bare 仓库：`/home/hxy/work/personal/project-manager.git`

```bash
git clone /home/hxy/work/personal/project-manager.git
# 或局域网
git clone hxy@192.168.1.14:/home/hxy/work/personal/project-manager.git
```

## 数据库注意

- 共用 `community` 库，schema 隔离为 `pm`
- 删除用户前需迁移其创建的 Ticket 和历史记录（`creatorId` / `changedById` 有 Restrict 约束）
- 改用户权限：`UPDATE pm."User" SET role = 'ROOT' WHERE email = '...'`

## Embedding 服务（端口 5000）

独立于主应用的向量化服务，使用 FastAPI + BGE-M3 模型。
**生产环境由 systemd 托管（`embedding-api.service`）**，崩溃自动重启，无需手动管理。

### 安装依赖（一次性）

```bash
# 在远程 hxy@192.168.1.14
cd /home/hxy/work/personal/project-manager/embedding
pip install -r requirements.txt
```

### 启动 / 重启 / 状态（systemd 推荐，远程）

```bash
# 状态
ssh hxy@192.168.1.14 'systemctl --user status embedding-api.service'

# 重启
ssh hxy@192.168.1.14 'systemctl --user restart embedding-api.service'

# 日志
ssh hxy@192.168.1.14 'journalctl --user -u embedding-api.service -f'
```

### 手动启动（仅本地 dev 或调试）

```bash
cd /home/hxy/work/personal/project-manager/embedding
HF_ENDPOINT=https://hf-mirror.com python3 -m uvicorn api:app --host 0.0.0.0 --port 5000
```

冷启动约 10-30 秒（首次会下载 BGE-M3 模型到 `~/.cache/huggingface/hub`）。

### 端点清单

| 端点 | 用途 |
|------|------|
| `GET /`、`GET /health`、`GET /dimension` | 存活 / 维度探活 |
| `POST /embed`、`POST /embed_batch` | 单条 / 批量向量化 |
| `POST /extract-text` | 提取附件文本（data URL → 文本）。详见 [docs/ATTACHMENT_TEXT_EXTRACTION.md](ATTACHMENT_TEXT_EXTRACTION.md) |

### 相关文档

- [向量搜索静默失败修复](向量搜索-静默失败修复.md)：embedding 写入失败被静默吞掉导致部分笔记搜不到的 bug 修复记录
