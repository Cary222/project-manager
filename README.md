# project-manager

本地项目管理工具：项目树、任务单（从 10000 递增）、进度跟踪、Git 提交自动关联。

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
npm run dev
```

访问 http://localhost:3003（3000 端口通常被 community 占用）

局域网访问：`http://<本机IP>:3003`（服务已绑定 `0.0.0.0`，同网段机器可直接打开）

## Git 远端

本地 bare 仓库：`/home/hxy/work/personal/project-manager.git`

```bash
git remote add origin /home/hxy/work/personal/project-manager.git
git push -u origin main
```

默认账号：

- root：`root@example.com` / `root123456`（可创建项目、模块、任务单）
- user：`user@example.com` / `user123456`（可更新任务进度）

## Git 提交规范

在 `work/company` 与 `work/personal` 下的仓库提交时使用：

```
10012: 修复登录跳转
```

刷新页面后点击「刷新 Git 提交」，系统会增量扫描各仓库并将匹配提交挂到对应任务单。

## 脚本

- `npm run db:push` — 同步 Prisma schema（`npx prisma db push`）
- `npm run db:seed` — 初始化用户与单号计数器
- `npm run test:acceptance` — 运行验收测试
