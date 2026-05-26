# 架构说明

## 领域模型

```
Project
  └── Responsibility (PROGRAM | DESIGN)
        └── Module
              └── Ticket (#10000 递增)
                    ├── assignee / assigneeHistory
                    ├── status / statusHistory
                    ├── repoBindings → Git 仓库路径
                    └── commits ← 增量同步
```

## 权限

| 角色 | 能力 |
|------|------|
| ROOT | 创建/删除项目、模块、单子；改指派人 |
| USER | 查看、更新单子状态 |

注册默认 USER。ROOT 需在数据库手动设置 `role = ROOT`。

## 路由

| 路径 | 说明 |
|------|------|
| `/` | 首页：项目列表 / 我的单子 |
| `/projects/[id]` | 项目详情：职能卡片 + 单子列表 |
| `/[ticketNo]` | 单子详情（根路径单号，如 `/10000`） |
| `/login` | 登录 / 注册 |

## API 概要

- `POST/GET /api/projects`，`DELETE /api/projects/[id]`
- `POST /api/modules`（同名 upsert）
- `POST/GET /api/tickets`，`GET/DELETE /api/tickets/[id]`
- `PATCH /api/tickets/[id]/status` — 写状态历史
- `PATCH /api/tickets/[id]/assignee` — 仅 ROOT，写指派历史
- `GET /api/tickets/mine`，`GET /api/users`
- `POST /api/sync-commits` — 扫描 `work/company` 与 `work/personal` 下 Git 仓库

单子查询支持 id 或 ticketNo：`/api/tickets/10000` 与 `/api/tickets/[cuid]` 均可。

## 技术栈

- Next.js 16 App Router + TypeScript + Tailwind
- NextAuth v5 (Credentials, JWT) + Prisma + PostgreSQL
- 独立 schema：`pm`（与 community 库共用实例）

## 关键文件

| 路径 | 用途 |
|------|------|
| `prisma/schema.prisma` | 数据模型 |
| `lib/auth.ts` | NextAuth 配置 |
| `lib/permissions.ts` | `requireSession` / `requireRoot` |
| `lib/ticket-counter.ts` | 单号分配（Counter 表） |
| `lib/git-sync/` | Git 增量扫描与提交关联 |
| `middleware.ts` | 未登录跳转 `/login` |
