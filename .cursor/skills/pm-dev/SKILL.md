---
name: pm-dev
description: >-
  Develop features for project-manager (Next.js + Prisma pm schema).
  Use when modifying tickets, projects, auth, API routes, or UI in
  /Users/vastgui/Desktop/project-manager.
---

# project-manager 开发

## 约定

- 端口 **3003**，绑定 `0.0.0.0`（局域网可访问）
- 单子详情路由：`/[ticketNo]`，不用 `/tickets/[id]`
- 权限：`requireRoot()` 仅 root；状态更新 `requireSession()` 即可
- 改指派人 / 状态时必须写历史表（`TicketAssigneeHistory` / `TicketStatusHistory`）
- 新建单子在事务中写首条指派与状态历史
- 模块同名用 upsert，避免唯一约束失败
- 最小 diff，匹配现有组件风格（Dashboard / ProjectDetail / TicketDetail）

## 改 schema 后

```bash
npx prisma db push
npm run build
fuser -k 3003/tcp 2>/dev/null; sleep 1; npm run start
```

## 参考

- 架构：[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- 运维：[docs/OPERATIONS.md](../../docs/OPERATIONS.md)
- ProjectHub 需求与进度：[PROJECT-HUB.md](./PROJECT-HUB.md)（项目管理 / 派单系统 / 员工 PKM / RAG 检索）
