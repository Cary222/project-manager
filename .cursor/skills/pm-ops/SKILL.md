---
name: pm-ops
description: >-
  ProjectHub 运维操作手册（L3 操作层）。仅放运维命令/systemd 清单/误判排查。
  事实数据（部署拓扑/数据库位置/端点表）见 L2 PROJECT-HUB.md。
  使用场景：重启服务/部署/build/查日志/改 env/git 远端操作。
---

# project-manager 运维操作手册（L3 操作层）

> **📚 文档分层**：本文档是 **L3 操作层**，只放 "怎么做" 的运维命令。
> 事实数据（部署拓扑 / 数据库位置 / 端点表 / 误判预防）见 L2 [PROJECT-HUB.md](../pm-dev/PROJECT-HUB.md)
> L1 入口见 [AGENTS.md](../../../AGENTS.md)

> 🔁 **远程视角**：所有持久化服务在 `hxy@192.168.1.14`。
> 🖥️ **本地视角**（vastgui Mac）：只做代码编辑 + dev 模式跑 Next.js。

---

## ⚡ 一行运维场景（立刻能跑）

| 场景 | 命令 |
|------|------|
| 🏃 Mac 起 dev | `cd /Users/vastgui/Desktop/project-manager && npm run dev` |
| 🏗️ 远程 build | `ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && npm run build'` |
| 🔄 远程重启生产 Next.js | `ssh hxy@192.168.1.14 'systemctl --user restart project-manager.service'` |
| 🔄 远程重启 Index Worker | `ssh hxy@192.168.1.14 'systemctl --user restart project-manager-worker.service'` |
| 🔄 远程重启 Background Worker | `ssh hxy@192.168.1.14 'systemctl --user restart project-manager-background-worker.service'` |
| 🔄 远程重启 Embedding | `ssh hxy@192.168.1.14 'systemctl --user restart embedding-api.service'` |
| 📜 看生产日志 | `ssh hxy@192.168.1.14 'journalctl --user -u <service> -f'` |
| 📊 看服务状态 | `ssh hxy@192.168.1.14 'systemctl --user status <service>'` |
| 🧠 Embedding 健康 | `curl http://192.168.1.14:5000/health` |
| 💻 直连远程 DB | `psql "postgresql://community:community@192.168.1.14:5432/community?options=-c search_path=pm,public"` |
| 🗄️ 同步 schema | `npx prisma db push`（Mac 本地执行，连远程 DB）|
| 📤 推送（默认 origin）| `git push origin main` |
| 🔍 看后台任务队列 | `npx prisma studio` → `BackgroundJob` 表 |

---

## ⚙️ systemd 服务详细清单（均在远程 hxy@192.168.1.14）

| service unit | 作用 | 状态 | 备注 |
|--------------|------|------|------|
| `project-manager.service` | 生产 Next.js :3003 | ⚠️ inactive | 开发期用 Mac dev，生产部署才启用 |
| `project-manager-web.service` | 预留 / 占位 | — | 早期 Next.js service 副本，可删 |
| `project-manager-worker.service` | Index Worker（PKM 异步索引）| ✅ active | 监听 `IndexJob` 表 |
| `project-manager-background-worker.service` | Background Worker（AI 生图/视频/任务）| ✅ active | 监听 `BackgroundJob` 表 |
| `embedding-api.service` | FastAPI + BGE-M3 :5000 | ✅ active | 独立仓库 `~/work/personal/embedding` |
| `community*.service` | 其他项目 | — | 不在本 skill 范围 |
| `company-dashboard*.service` | 其他项目 | — | 不在本 skill 范围 |
| `nas-work-backup.service` | NAS 备份 | — | cron-like |

```bash
# 重启任意服务（推荐）
ssh hxy@192.168.1.14 'systemctl --user restart <name>.service'

# 状态
ssh hxy@192.168.1.14 'systemctl --user status <name>.service'

# 看实时日志
ssh hxy@192.168.1.14 'journalctl --user -u <name>.service -f'

# 看最近 100 行日志
ssh hxy@192.168.1.14 'journalctl --user -u <name>.service -n 100 --no-pager'
```

> 所有 systemd 服务 `Restart=always` + `RestartSec=5`，崩溃自动重启。

### 🔧 修改 systemd unit

unit 文件位置：`~/.config/systemd/user/<name>.service`

```bash
# 1. Mac 编辑 / 上传到远程
# 2. 重载配置
ssh hxy@192.168.1.14 'systemctl --user daemon-reload'
# 3. 重启生效
ssh hxy@192.168.1.14 'systemctl --user restart <name>.service'
# 4. 开机自启
ssh hxy@192.168.1.14 'systemctl --user enable <name>.service'
```

---

## 🚀 生产部署完整流程

```bash
# 1. Mac 本地：commit + push origin
git add <精确文件列表>
git commit -m "10044: 描述"
git push origin main

# 2. 远程：拉取（如果用 ssh 触发 hook 则自动）
ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && git pull'

# 3. 远程：build
ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && npm run build'

# 4. 远程：重启服务
ssh hxy@192.168.1.14 'systemctl --user restart project-manager.service'

# 5. 远程：看日志确认启动
ssh hxy@192.168.1.14 'journalctl --user -u project-manager.service -f'
```

---

## 🌐 局域网跳转 localhost 排查

| 现象 | 真因 | 解决 |
|------|------|------|
| 局域网访问跳转 `localhost:3003` | `AUTH_URL` / `NEXTAUTH_URL` 配置错误 | 确认 `.env.local` 有 `NEXTAUTH_URL=http://localhost:3003`（**已设 OK**）+ `AUTH_TRUST_HOST=true`；**不要**额外加 `AUTH_URL` |

> ⚠️ `.env.local` 里 `NEXTAUTH_URL=http://localhost:3003` **保留即可**（env 注释解释了：避免 0.0.0.0 被用于 redirect URL）。改了反而会破坏局域网访问。

---

## 🧠 Embedding 服务（端口 5000，远程 FastAPI）

**架构**：独立仓库 `~/work/personal/embedding`（不在 project-manager 内） + FastAPI + BGE-M3 模型。

### 重启

```bash
ssh hxy@192.168.1.14 'systemctl --user restart embedding-api.service'
```

### 验证

```bash
# 健康
curl http://192.168.1.14:5000/health

# 输出维度（项目用 1024）
curl http://192.168.1.14:5000/dimension

# 单条 embed
curl -X POST http://192.168.1.14:5000/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "hello world"}'

# 看日志
ssh hxy@192.168.1.14 'journalctl --user -u embedding-api.service -f'
```

> embedding-api.service 由 systemd 托管（`Restart=always`），崩溃自动重启，无需手动拉起。

---

## 🐘 数据库运维（远程 PostgreSQL）

```bash
# Mac 直连 psql
psql "postgresql://community:community@192.168.1.14:5432/community?options=-c search_path=pm,public"

# 推 schema（Mac 本地执行，连远程 DB）
npx prisma db push

# 仅 Counter seed
npm run db:seed

# 可视化管理
npx prisma studio     # 浏览器打开，自动连远程
```

> ⚠️ schema 必须是 `pm`，**勿改 community 公共表**（属于其他项目）。

---

## 🌿 Git 远端操作

| 场景 | 命令 |
|------|------|
| 📤 推送（默认 origin）| `git push origin main` |
| 🌐 推送 github | ⚠️ **需用户明确才推**（双远端保护，详见 [.cursor/rules/git-commit-required.mdc](../../rules/git-commit-required.mdc)） |
| 📥 远程拉取 | `ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && git pull'` |
| 🔍 看远程提交 | `git log --oneline origin/main -10` |
| 🆚 对比远程 | `git fetch origin && git log --oneline HEAD..origin/main` |

**远程仓库**：
- 裸仓：`/home/hxy/work/personal/project-manager.git`（在 192.168.1.14）
- 工作区：`/home/hxy/work/personal/project-manager`
- Mac 本地工作区：`/Users/vastgui/Desktop/project-manager`
- Mac → origin：常规 `git push` 即可，ssh 已配 authorized_keys

**双远端注意**：
- `origin`（生产局域网）默认推
- `github`（公开）需用户明确才推

---

## 🚨 常见误判排查清单

| 症状 | 真因 | 解决 |
|------|------|------|
| `localhost:5432 connection refused` | DB 在远程，不在 Mac | 用 `192.168.1.14:5432` |
| `localhost:5000 connection refused` | Embedding 在远程 | 用 `http://192.168.1.14:5000` |
| `ECONNREFUSED 0.0.0.0:3003` from Mac | 远程生产 inactive | Mac 本地用 `npm run dev` 起，或远程 `systemctl --user start project-manager.service` |
| Worker 不处理任务 | 远程 systemd inactive | `ssh ... 'systemctl --user status project-manager-background-worker.service'` |
| Prisma 连不上 | schema 不匹配 / 网络问题 | `npx prisma db push`（需要远程网络可达）|
| Agnes API 超时 | 国内不可达 | 确认 `.env` 有 `HTTP_PROXY=http://127.0.0.1:7890` |
| 局域网跳转 localhost | `AUTH_URL` 多余 | 删除 `AUTH_URL`，保留 `NEXTAUTH_URL=http://localhost:3003` |

---

## 🔗 必读链接

| 事实 | 指向 |
|------|------|
| 🚨 远程拓扑 / 端点 / DATABASE_URL | PROJECT-HUB § 🚨 部署拓扑速查 |
| ⚠️ 误判预防（全文）| PROJECT-HUB § ⚠️ 常见误判预防 |
| ⚙️ 服务清单（简版）| PROJECT-HUB § 🚨 → 远程开发机 → 服务清单 |
| 🏭 部署脚本细节 | [docs/deploy/OPERATIONS.md](../../../docs/deploy/OPERATIONS.md) |
| 🏠 项目入口 | [AGENTS.md](../../../AGENTS.md) |
| 🛠️ 开发命令 | [.cursor/skills/pm-dev/SKILL.md](../pm-dev/SKILL.md) |