---
name: pm-dev
description: >-
  ProjectHub 开发操作手册（L3 操作层）。仅放命令/约定/代码片段。
  事实数据（部署拓扑/数据库位置/端点表）见 L2 PROJECT-HUB.md。
  使用场景：修改工单/项目/auth/API 路由/UI 时。
---

# project-manager 开发操作手册（L3 操作层）

> **📚 文档分层**：本文档是 **L3 操作层**，只放 "怎么做" 的命令/约定/代码片段。
> 事实数据（部署拓扑 / 数据库位置 / 端点表 / 13 业务链）见 L2 [PROJECT-HUB.md](./PROJECT-HUB.md)
> L1 入口见 [AGENTS.md](../../../AGENTS.md)

---

## ⚡ 一行代码场景（立刻能跑）

| 场景 | 命令 |
|------|------|
| 🏃 起 dev server | `cd /Users/vastgui/Desktop/project-manager && npm run dev` |
| 🗄️ 同步 schema 到远程 DB | `npx prisma db push` |
| 🖼️ 可视化远程 DB | `npx prisma studio` |
| 🌱 Seed Counter | `npm run db:seed` |
| 👑 提权某用户为 ROOT | `npm run db:promote -- <邮箱>` |
| 🧪 跑单元测试 | `npm run test` |
| 🎭 跑 E2E（连远程 DB）| `npm run test:e2e` |
| 🏗️ 生产构建（远程）| `ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && npm run build'` |
| 🔄 重启生产（远程）| `ssh hxy@192.168.1.14 'systemctl --user restart project-manager.service'` |
| 📜 看生产日志 | `ssh hxy@192.168.1.14 'journalctl --user -u project-manager.service -f'` |
| 🧠 看 Embedding 健康 | `curl http://192.168.1.14:5000/health` |
| 💻 直连远程 DB | `psql "postgresql://community:community@192.168.1.14:5432/community?options=-c search_path=pm,public"` |

> ⛔ **不要 `localhost:5432` / `localhost:5000` / `0.0.0.0:3003` 直连** —— 这些都不在 Mac 本地。详见 PROJECT-HUB § ⚠️ 常见误判预防。

---

## 📐 开发约定（code 风格）

| # | 约定 |
|---|------|
| 1️⃣ | **路由**：单子详情用 `/tickets/[ticketId]`，**不要**用 `/[ticketNo]`（已废） |
| 2️⃣ | **权限**：`requireRoot()` 仅 root；状态更新 `requireSession()` 即可 |
| 3️⃣ | **审计**：改指派人 / 状态时必须写 `TicketAssigneeHistory` / `TicketStatusHistory`（事务内） |
| 4️⃣ | **新建单子**：事务中写首条指派与状态历史 |
| 5️⃣ | **模块同名**：用 `upsert`，避免唯一约束失败 |
| 6️⃣ | **DB 跨 schema**：保持 `pm,public` search_path |
| 7️⃣ | **代码风格**：最小 diff，匹配现有组件（`Dashboard` / `ProjectDetail` / `TicketDetail`） |
| 8️⃣ | **feature 边界**：FSD 9 模块，跨模块访问通过 `features/<name>/lib` |
| 9️⃣ | **TypeScript**：严格模式；组件用 `function` 不用箭头 |
| 🔟 | **commit 前**：跑 `npm run lint` + `npm run test`，不要带 console.log / debugger |

> ⚠️ **Next.js 16 + Prisma 6 + LangGraph 1.x 都有 breaking changes** —— 不要凭训练数据推断 API。

---

## 🔄 改 schema 后的完整流程

```bash
# 1. Mac 本地：编辑 prisma/schema.prisma
# 2. Mac 本地：生成 client + 推送到远程 DB
npx prisma generate
npx prisma db push

# 3. Mac 本地：本地 dev 验证（自动连远程 DB）
npm run dev

# 4. 远程：build + 重启生产
ssh hxy@192.168.1.14 'cd /home/hxy/work/personal/project-manager && npm run build && systemctl --user restart project-manager.service'

# 5. 远程：看日志确认启动
ssh hxy@192.168.1.14 'journalctl --user -u project-manager.service -f'
```

> 💡 日常开发用 `npm run dev` 即可，**不必每改一次 schema 都重启生产**。

---

## 🐘 Prisma 直接连远程 DB

```bash
# 生成 client（改 schema 后必跑）
npx prisma generate

# 推 schema 到远程 DB（开发期用 db push，正式用 migrate）
npx prisma db push

# 跑 migration（生产）
npx prisma migrate dev --name <name>
npx prisma migrate deploy   # 远程生产

# Seed Counter / 测试数据
npx prisma db:seed

# 可视化（浏览器）
npx prisma studio   # 自动连 DATABASE_URL
```

> 详细 schema 看 `prisma/schema.prisma`（1032 行）；13 业务链速查看 PROJECT-HUB § 🧬。

---

## 🎫 改工单状态 / 指派的标准模式

> 关键：**事务内**写主表 + 历史表，避免不一致。

```typescript
// 标准模式：事务 + 历史
await prisma.$transaction(async (tx) => {
  await tx.ticket.update({
    where: { id },
    data: { status: newStatus, assigneeIds: { set: newIds } },
  })

  await tx.ticketStatusHistory.create({
    data: {
      ticketId: id,
      fromStatus: oldStatus,
      toStatus: newStatus,
      changedBy: session.user.id,
    },
  })

  // 多指派人变更时，记录每个变更
  const added = newIds.filter(i => !oldIds.includes(i))
  const removed = oldIds.filter(i => !newIds.includes(i))
  await tx.ticketAssigneeHistory.createMany({
    data: [
      ...added.map(userId => ({ ticketId: id, userId, action: 'ADDED', byUserId: session.user.id })),
      ...removed.map(userId => ({ ticketId: id, userId, action: 'REMOVED', byUserId: session.user.id })),
    ],
  })
})
```

---

## 🤖 改 AI 模块的注意事项

- `features/ai/` 详见 PROJECT-HUB § 🤖 AI 模块结构（graph/llm/core/search/tools/jobs/store/types/ui 8 子模块）
- **LangGraph StateGraph** 修改节点 → 看 `features/ai/graph/agent.ts` + `edges/routing.ts`
- **Model Registry** 修改 Provider → 看 `features/ai/llm/providers/registry.ts`
- **三级凭证降级** 改顺序 → 看 `features/ai/llm/credentials/api-key-store.ts`
- ⚠️ 改完跑 `npm run test` 至少保证编译通过；LangGraph 路由改动后跑 e2e

---

## 📦 提交前自检清单

```
[ ] npm run lint   → 0 error
[ ] npm run test   → all pass
[ ] git status     → 只 commit 改过的文件（无 .next / node_modules）
[ ] git diff       → 没有 console.log / debugger / TODO 半成品
[ ] commit message → 必带工单单号（#10044）+ Co-authored-by: Cursor <cursoragent@cursor.com>
[ ] push           → 默认 origin；不主动推 github（除非用户明确）
```

完整 commit 纪律见用户级 skill `~/.cursor/skills/git-commit-assistant/SKILL.md`
+ 项目钩子 [.cursor/rules/git-commit-required.mdc](../../../.cursor/rules/git-commit-required.mdc)

---

## 🔗 必读链接

| 事实 | 指向 |
|------|------|
| 🚨 部署拓扑（DB/Embedding/Worker 在哪）| PROJECT-HUB § 🚨 部署拓扑速查 |
| 🧬 数据库结构（13 业务链 / 15 枚举 / Top 10 模型）| PROJECT-HUB § 🧬 AI 数据库速览 |
| 🏁 项目完成度（哪些已做 / 待启动）| PROJECT-HUB § 🏁 实际完成度评估 |
| ⚙️ systemd 服务清单 | PROJECT-HUB § 🚨 部署拓扑 → 远程开发机 → 服务清单 |
| 🎫 工单专项架构（领域模型 / 权限）| [docs/ticket-project/ARCHITECTURE.md](../../../docs/ticket-project/ARCHITECTURE.md) |
| 📦 字段细节 | [prisma/schema.prisma](../../../prisma/schema.prisma) |
| 🛠️ 运维操作 | [.cursor/skills/pm-ops/SKILL.md](../pm-ops/SKILL.md) |
| 🧪 测试路线 | [.cursor/skills/pm-testing/SKILL.md](../pm-testing/SKILL.md) |
| 🏠 项目入口 | [AGENTS.md](../../../AGENTS.md) |