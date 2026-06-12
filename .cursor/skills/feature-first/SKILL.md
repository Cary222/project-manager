---
name: feature-first
description: >
  Feature-Sliced Design (FSD) 渐进式架构迁移。
  当用户在这个项目中工作、修改代码、创建新文件、
  询问架构升级方案、或提到 FSD/feature-first/重构/代码组织时，
  自动加载此 skill。
---

# Feature-First 渐进式架构升级

## 核心理念

> **不是停下手头功能专门重构，而是每次开发顺带迁一块，半年后自然全迁完。**

项目是典型企业级业务系统（项目管理 + 派单 + PKM + RAG）。按技术分层（components/hooks/services）只适合小项目。FSD 核心规则只有一条：**层级只能向下依赖，不能横跨或向上**。

用学大模型的类比：**FSD 就是给代码库做 embedding——同一业务的代码聚合在一起，语义越近距离越近。**

---

## 目标态 FSD 四层

```
app/
 ├── features/       ← 用户行为（verb）：Server Actions、表单、弹窗
 ├── entities/       ← 业务实体（noun）：类型、只读展示、Prisma 查询
 └── shared/         ← 零业务感知基础设施：UI Kit、Prisma 单例、工具函数

依赖方向：features → entities → shared
```

App 同时引用 features 和 entities，不存在单向链。Features 依赖 Entities，Entities 依赖 Shared。

---

## 目标态目录结构

```
project-manager/
│
├── app/                           ← Next.js 路由，保持原样
│   ├── page.tsx
│   ├── [ticketNo]/page.tsx
│   └── api/...
│
├── components/                    ← 过渡层（Legacy）
│   ├── common/                   ← ImageLightbox, Providers, icons
│   ├── dispatch/
│   ├── ticket/
│   └── ...
│
├── features/                      ← ★ 新建（verb）
│   ├── create-dispatch/
│   │   ├── action.ts             ← Server Actions colocation
│   │   └── CreateDispatchForm.tsx
│   ├── push-dispatch/
│   └── search-knowledge/
│
├── entities/                      ← ★ 新建（noun）
│   ├── ticket/
│   │   ├── model/
│   │   │   └── types.ts
│   │   ├── api/
│   │   └── ui/
│   ├── project/
│   ├── user/
│   └── search-document/
│
├── shared/                        ← ★ 新建
│   ├── ui/                       ← Button, Modal, Skeleton, icons
│   ├── db/client.ts              ← Prisma 单例（原 lib/db.ts）
│   ├── api/                      ← fetchJson, SWR config
│   └── lib/                      ← auth, permissions
│
└── lib/                           ← 渐进迁入 shared/ 或 entities/
    ├── db.ts
    ├── auth.ts
    └── ...
```

**新代码不再进入 components/。只允许修改已有组件。新文件优先：features/ > entities/ > shared/。**

**Server Actions 统一 colocation 在对应 feature 下**，不在独立 `actions/` 目录。

### 为什么不用 `src/`、`screens/`、`widgets/`？

| 原始设计 | 问题 | 决策 |
|---|---|---|
| `src/` 外层 | 73 文件规模小，加 `src/` 只改 import 路径，收益低 | 不加，保留根目录 `@/*` |
| `screens/` | Next.js App Router 约定就是 `page.tsx`，改 `screens/` 增加心智负担 | 不改，`app/` 就是 screens |
| `widgets/` | 只有跨 2+ 页面复用才需要，当前没有这种场景 | 暂不加，按需触发 |

---

## 迁移原则

1. 不专门重构
2. 开发功能顺手迁
3. 新文件直接进 FSD
4. 老文件按需迁
5. build 通过再提交

### 新建文件判断

```
触发：用户要求新建任何 .tsx/.ts 文件

展示数据              → entities/
用户操作              → features/
纯通用组件            → shared/ui/
通用工具              → shared/lib/
Prisma 单例           → shared/db/
Server Action         → features/<feature>/action.ts

例外（保持现状不动）：
  - app/ 下的 route.ts / page.tsx
  - prisma/
  - embedding/（Python 服务）
  - 测试文件
```

### 修改已有文件判断

```
触发：用户要修改一个还在旧位置的文件

文件在 lib/ 下：
  只被 1 个 feature/entity 使用？        → 迁入对应 entity 或 shared
  只被 2-3 处引用且同一业务领域？         → 迁入对应 entity
  跨多个业务领域？                       → 保持（true shared，迁了反而乱）

文件在 components/ 下（非 feature 子目录）：
  被 ≥ 2 个 import 引用且可整体移入？    → 提议顺手迁

import 路径改动 ≥ 3 个文件时：            → 批量迁，减少碎片
```

---

## 禁止

- 一次性迁全项目
- 为 FSD 而 FSD
- 提前创建大量空目录
- widgets/screens 滥用

---

## AI 决策优先级

当无法判断放置位置时：

1. shared
2. entities
3. features

优先保持现状，不为架构而重构。

- 迁移收益不明显？不迁。
- 新增目录只为符合 FSD？不创建。

**目标是降低复杂度，而不是提高 FSD 纯度。**
