---
name: systemd统一进程管理
overview: 将 project-manager 的 4 个进程（Web、Worker、Background Worker、Embedding）全部迁移到 systemd 管理，deploy.sh 改为统一调用 systemctl。
todos:
  - id: create-web-service
    content: 创建 project-manager-web.service
    status: pending
  - id: create-embedding-service
    content: 创建 embedding-api.service
    status: pending
  - id: modify-deploy-sh
    content: 修改 deploy.sh 用 systemctl 替代 nohup/kill
    status: pending
  - id: update-pm-ops-skill
    content: 更新 pm-ops skill 中 embedding 服务描述
    status: pending
isProject: false
---

## 架构分层

```
服务器
│
├── project-manager 应用层
│   ├── project-manager-web.service          # Next.js :3003
│   ├── project-manager-worker.service      # IndexJob Worker
│   ├── project-manager-background-worker.service  # BackgroundJob Worker
│   └── embedding-api.service               # FastAPI + BGE-M3 :5000
│
└── 基础设施层（不属于项目管理范围）
    ├── PostgreSQL + pgvector (extension，非独立进程)
    └── nginx
```

**pgvector 是 PostgreSQL 的 extension，不单独管理。**

## 改动文件

### 1. 新建 `worker/project-manager-web.service`
```ini
[Unit]
Description=project-manager Next.js Web Server (:3003)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/hxy/work/personal/project-manager
Environment=NODE_ENV=production
EnvironmentFile=/home/hxy/work/personal/project-manager/.env.production
ExecStart=/home/hxy/work/personal/project-manager/node_modules/.bin/next start -H 0.0.0.0 -p 3003
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=project-manager-web

[Install]
WantedBy=default.target
```

### 2. 新建 `embedding/embedding-api.service`
```ini
[Unit]
Description=project-manager Embedding API (BGE-M3 FastAPI :5000)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/hxy/work/personal/project-manager/embedding
EnvironmentFile=/home/hxy/work/personal/project-manager/.env.production
ExecStart=/usr/bin/python3 -m uvicorn api:app --host 0.0.0.0 --port 5000
Restart=always
RestartSec=10
# 模型加载冷启动较慢，给予更长等待时间
TimeoutStartSec=120
StandardOutput=journal
StandardError=journal
SyslogIdentifier=embedding-api

[Install]
WantedBy=default.target
```

### 3. 修改 `scripts/deploy.sh`

**部署流程：**

```
发现代码更新
    ↓
git pull
    ↓
npm install + prisma generate
    ↓
npm run build
    ↓
✅ build 成功
    ↓
systemctl restart 4 个服务
    ↓
健康检查
    ↓
重置 FAILED IndexJob
    ↓
部署完成
```

**关键原则：构建阶段不动线上服务，只有构建成功后才切换。**

**删除：**
- `kill_port` 函数
- `wait_for_port_free` 函数
- 所有 `kill` / `nohup` / 端口检测逻辑

**新增逻辑：**
```bash
# build 成功后
log "重启 project-manager 服务..."

systemctl --user restart project-manager-web.service
systemctl --user restart project-manager-worker.service
systemctl --user restart project-manager-background-worker.service
systemctl --user restart embedding-api.service

# 健康检查
sleep 5
for svc in project-manager-web project-manager-worker project-manager-background-worker embedding-api; do
    if ! systemctl --user is-active --quiet "${svc}.service"; then
        log "警告: ${svc} 未达到 active 状态"
    fi
done

# HTTP health check
if curl -fsS --retry 3 --retry-delay 1 http://127.0.0.1:3003 > /dev/null 2>&1; then
    log "Web health check 通过"
else
    log "警告: Web health check 未通过，请检查日志"
fi

if curl -fsS --retry 3 --retry-delay 1 http://127.0.0.1:5000/health > /dev/null 2>&1; then
    log "Embedding API health check 通过"
else
    log "警告: Embedding API health check 未通过"
fi
```

### 4. 更新 `.cursor/skills/pm-ops/SKILL.md`

将 embedding 服务描述从 "已由 systemd 管理" 修正为带 service 文件路径，并补充完整操作命令。

## 完整服务盘点

### 代码仓库中的现有文件

| 路径 | 内容 | 状态 |
|------|------|------|
| `worker/project-manager-worker.service` | Index Worker | ✅ 已有 |
| `worker/background/project-manager-background-worker.service` | Background Worker | ✅ 已有 |
| `worker/project-manager-web.service` | Next.js :3003 | ❌ 缺失，需新建 |
| `embedding/embedding-api.service` | Embedding :5000 | ❌ 缺失，需新建 |

### package.json 中的 worker 入口

```json
"worker:prod": "NODE_ENV=production tsx worker/index.ts"
"worker:background:prod": "NODE_ENV=production tsx worker/background/index.ts"
```

### 本次需要新建的 service 文件

**1. `worker/project-manager-web.service`**

```ini
[Unit]
Description=project-manager Next.js Web Server (:3003)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/hxy/work/personal/project-manager
Environment=NODE_ENV=production
EnvironmentFile=/home/hxy/work/personal/project-manager/.env.production
ExecStart=/home/hxy/work/personal/project-manager/node_modules/.bin/next start -H 0.0.0.0 -p 3003
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=project-manager-web

[Install]
WantedBy=default.target
```

**2. `embedding/embedding-api.service`**

```ini
[Unit]
Description=project-manager Embedding API (BGE-M3 FastAPI :5000)
After=network.target

[Service]
Type=simple
WorkingDirectory=/home/hxy/work/personal/project-manager/embedding
EnvironmentFile=/home/hxy/work/personal/project-manager/.env.production
ExecStart=/usr/bin/python3 -m uvicorn api:app --host 0.0.0.0 --port 5000
Restart=always
RestartSec=10
TimeoutStartSec=120
StandardOutput=journal
StandardError=journal
SyslogIdentifier=embedding-api

[Install]
WantedBy=default.target
```

### 最终服务清单

| 服务名 | 作用 | ExecStart | 已有/新建 |
|--------|------|-----------|-----------|
| `project-manager-web.service` | Next.js :3003 | `next start` | 新建 |
| `project-manager-worker.service` | IndexJob Worker | `tsx worker/index.ts` | 已有 |
| `project-manager-background-worker.service` | BackgroundJob Worker | `tsx worker/background/index.ts` | 已有 |
| `embedding-api.service` | BGE-M3 FastAPI :5000 | `uvicorn api:app` | 新建 |

### 不纳入 systemd 管理

| 项目 | 原因 |
|------|------|
| PostgreSQL | 基础设施，应由服务器独立管理 |
| pgvector | PostgreSQL extension，非独立进程 |
| `prisma generate` | 一次性构建命令，非常驻服务 |
| `tsx -e` 脚本 | 一次性命令，非常驻服务 |

## 一次性迁移步骤（在服务器执行）

```bash
# 1. 停止旧进程（nohup / 手动启动的）
kill $(lsof -t -i:3003) 2>/dev/null || true
pkill -9 -f 'uvicorn.*5000' 2>/dev/null || true

# 2. 确认 linger 已开启
loginctl enable-linger hxy
loginctl show-user hxy -p Linger  # 应输出 Linger=yes

# 3. 安装 service 文件
cp worker/project-manager-web.service ~/.config/systemd/user/
cp worker/project-manager-worker.service ~/.config/systemd/user/
cp worker/background/project-manager-background-worker.service ~/.config/systemd/user/
cp embedding/embedding-api.service ~/.config/systemd/user/

# 4. 重载并启用
systemctl --user daemon-reload
systemctl --user enable --now project-manager-web.service
systemctl --user enable --now project-manager-worker.service
systemctl --user enable --now project-manager-background-worker.service
systemctl --user enable --now embedding-api.service

# 5. 验证
systemctl --user list-units --type=service 'project-manager-*' 'embedding*'
```

## 后续运维命令（统一规范）

```bash
# 查看所有 project-manager + embedding 进程状态
systemctl --user list-units --type=service 'project-manager-*' 'embedding*'

# 重启全部应用服务
systemctl --user restart \
  project-manager-web.service \
  project-manager-worker.service \
  project-manager-background-worker.service \
  embedding-api.service

# 查看日志
journalctl --user -u project-manager-web.service -f
journalctl --user -u project-manager-worker.service -f
journalctl --user -u project-manager-background-worker.service -f
journalctl --user -u embedding-api.service -f

# 停止全部服务
systemctl --user stop \
  project-manager-web.service \
  project-manager-worker.service \
  project-manager-background-worker.service \
  embedding-api.service
```