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
| ROOT | 创建/删除项目、模块、单子；改指派人；用户管理（改角色、封禁/解封） |
| USER | 查看、更新单子状态 |

注册默认 USER。ROOT 需通过命令行设置 `npm run db:promote -- <邮箱>` 或在数据库手动设置 `role = ROOT`。

### 用户封禁

- `bannedAt != null` 表示用户被封禁，被封禁用户登录时直接返回 null（无法登录）
- 所有管理操作记录到 `ModerationLog` 表（BAN_USER / UNBAN_USER / UPDATE_ROLE）

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

## Embedding 服务（RAG 向量化）

独立部署于 `embedding/` 目录，使用 FastAPI + BGE-M3 模型。

### 文件结构

```
embedding/
├── api.py              # FastAPI 服务入口
├── client.py           # Python 客户端（搜索/存储）
├── test_pgvector.py    # pgvector 写入测试脚本
└── requirements.txt   # Python 依赖
```

### API 端点

| 端点 | 方法 | 请求体 | 说明 |
|------|------|--------|------|
| `/` | GET | - | 服务状态 |
| `/health` | GET | - | 健康检查 |
| `/dimension` | GET | - | 返回向量维度 (1024) |
| `/embed` | POST | `{"text": "..."}` | 单条文本向量化 |
| `/embed_batch` | POST | `{"texts": [...]}` | 批量向量化 |

### 数据表

`pm.document_embeddings`：存储文档向量，支持按余弦相似度搜索。

| 字段 | 类型 | 说明 |
|------|------|------|
| source_type | text | 来源类型，如 `ticket` |
| source_id | text | 来源 ID，如单号 |
| content | text | 原始文本 |
| embedding | vector(1024) | 向量 |

### 客户端使用

```python
from embedding.client import search, store_embedding

# 语义搜索
results = search("搜索功能不好用", top_k=3)

# 存储向量
store_embedding("用户注册后无法收到验证邮件", "ticket", "10002")
```

### 集成 RAG Agent

LangChain / LlamaIndex 调用示例：

```python
import requests

resp = requests.post(
    "http://localhost:5000/embed",
    json={"text": "用户搜索结果不准确"}
)
vector = resp.json()["embedding"]
```
