# Ticket / Project 领域

## 文档

| 文件 | 内容 |
|------|------|
| `ARCHITECTURE.md` | 领域模型总览：Project → Responsibility → Module → Ticket → Commit |
| `BUG_DESIGN_PROGRAM_TICKET_LOOP.md` | Bug 单·设计单·程序单 状态闭环全链路手册 |
| `DESIGN_TO_PROGRAM_PUSH_FLOW.md` | 设计单完成后创建/绑定程序单的完整交付流程 |

## 脚本

| 脚本 | 用途 |
|------|------|
| `acceptance-test.ts` | 核心逻辑验收测试（commit subject 解析、ticketNo 分配等） |

## 关键模型

```
Project
  └── Responsibility (PROGRAM | DESIGN)
        └── Module
              └── Ticket (#10000 递增)
                    ├── assignee / status 流转
                    ├── repoBindings → Git 仓库
                    └── commits ← 增量同步
```
