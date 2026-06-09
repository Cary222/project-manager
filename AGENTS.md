<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# project-manager Agent 指南

本地项目管理工具：项目 → 职能（程序/设计）→ 模块 → 单子（#10000+），Git 提交自动关联。

## 快速定位

| 需求 | 位置 |
|------|------|
| 架构 / API / 权限 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 部署 / 重启 / 环境变量 | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Embedding / RAG 向量化 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) / [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| 开发 skill | [.cursor/skills/pm-dev/SKILL.md](.cursor/skills/pm-dev/SKILL.md) |
| 运维 skill | [.cursor/skills/pm-ops/SKILL.md](.cursor/skills/pm-ops/SKILL.md) |

## 关键约束

- 端口 3003，生产绑定 `0.0.0.0`
- PostgreSQL schema `pm`，勿改 community 公共表
- 不设置 `AUTH_URL` / `NEXTAUTH_URL`（局域网访问）
- 注册默认 USER，ROOT 手动赋权
- 单子路由用 `/[ticketNo]`；指派/状态变更必须记历史
- 改动后 `npm run build` 再重启（生产模式）
