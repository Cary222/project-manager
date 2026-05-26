# project-manager

本地项目管理工具：项目树、任务单（从 10000 递增）、状态跟踪、Git 提交自动关联。

## 文档

- [架构说明](docs/ARCHITECTURE.md) — 领域模型、路由、API、权限
- [运维说明](docs/OPERATIONS.md) — 部署、重启、局域网、环境变量

## 技术栈

- Next.js App Router + TypeScript + Tailwind
- NextAuth (Credentials) + Prisma + PostgreSQL（`pm` schema）

## 快速开始

```bash
cd /home/hxy/work/personal/project-manager
cp .env.example .env
# 确保 PostgreSQL 可连接，并执行：CREATE SCHEMA IF NOT EXISTS pm;
npm install
npx prisma db push
npm run db:seed
npm run build
npm run start
```

- 本机：http://localhost:3003
- 局域网：`http://<本机IP>:3003`

## Git 远端

本地 bare 仓库：`/home/hxy/work/personal/project-manager.git`

```bash
git remote add origin /home/hxy/work/personal/project-manager.git
git push -u origin main
```

账号通过登录页注册（默认为 user 权限），root 权限需在数据库中手动设置。

## Git 提交规范

在 `work/company` 与 `work/personal` 下的仓库提交时使用：

```
10012: 修复登录跳转
```

刷新页面后点击「刷新 Git 提交」，系统会增量扫描各仓库并将匹配提交挂到对应任务单。

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式（0.0.0.0:3003） |
| `npm run build` | 生产构建 |
| `npm run start` | 生产服务 |
| `npm run db:seed` | 初始化单号计数器 |
| `npm run test:acceptance` | 验收测试 |
