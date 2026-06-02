# 运维说明

## 部署脚本

如果你需要了解 `scripts/deploy.sh` 的实际执行流程、使用方式、风险与后续升级方向，请先阅读：

- [scripts/deploy.sh 使用手册与运维说明](DEPLOY_SCRIPT_MANUAL.md)

## 环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL，带 `?schema=pm` |
| `AUTH_SECRET` / `NEXTAUTH_SECRET` | 随机密钥 |
| `AUTH_TRUST_HOST=true` | 必须开启，支持局域网访问 |

**不要设置** `AUTH_URL` / `NEXTAUTH_URL`，否则会强制跳转到 localhost。

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
npm run dev      # 开发，0.0.0.0:3003，--webpack
npm run build    # 生产构建
npm run start    # 生产服务，0.0.0.0:3003
npm run db:seed  # 重置 Counter（不创建默认用户）
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
