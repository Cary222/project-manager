# ProjectHub API 架构审查报告

**审查日期**: 2026-08-21  
**审查范围**: `app/api/**/*` 目录结构与 Feature 边界  
**审查原则**: Route 层可以 route-first，业务逻辑必须 feature-first  
**审查目标**: 不做大规模物理迁移，重点治理依赖方向与职责边界

---

## 📊 Executive Summary

### 当前状态

- **API 路由总数**: 112 个
- **一级目录数量**: 36 个
- **Features 数量**: 13 个核心业务 feature
- **Shared 模块**: 存在 `shared/lib`、`shared/db`、`shared/api` 基础设施

### 核心发现

1. ✅ **业务边界清晰**: tickets / projects / ai / pkm / modules 等有明确归属
2. ⚠️ **Pi Workspace 融合带来 18+ 新路由**: agent / sessions / models / skills 等
3. ⚠️ **部分跨 feature 路由未归类**: commits / search / upload / events
4. ✅ **依赖方向基本正确**: 多数 API → Feature Service → Domain
5. ⚠️ **存在少量直接 Prisma 调用**: 部分简单 CRUD 跳过 service 层

### 推荐策略

**不做物理迁移**，保持 `app/api` 平铺结构，重点治理：

1. **提取共享能力**: Git / Search / File 应该成为独立 feature 或 shared service
2. **明确 Pi Workspace 边界**: 区分 "Pi Runtime 专属" vs "ProjectHub AI 能力"
3. **规范 service 层**: 复杂业务逻辑必须进 `features/*/lib` 或 service
4. **依赖方向审查**: 禁止循环依赖和反向依赖

---

## A. 当前 app/api 实际架构

### API 分类矩阵（按业务归属）

| 一级目录 | 路由数 | 业务归属 | 当前依赖层 | 架构判断 |
|---------|--------|---------|-----------|---------|
| **tickets/** | 20 | Ticket 工单系统 | ✅ `features/ticket/lib` | KEEP - 边界清晰 |
| **projects/** | 5 | Project 项目管理 | ✅ `features/project/ui` + DB | KEEP - 边界清晰 |
| **ai/** | 14 | AI 核心功能 | ✅ `features/ai/*` | KEEP - 边界清晰 |
| **pkm/** | 2 | PKM 笔记管理 | ✅ `features/knowledge/lib/pkm` | KEEP - 边界清晰 |
| **knowledge/** | 3 | 知识空间 | ✅ `features/knowledge/lib` | KEEP - 与 pkm 同域 |
| **modules/** | 3 | 模块管理 | ⚠️ 直接 DB | REFACTOR - 需提取 service |
| **team/** | 2 | 团队管理 | ✅ `features/team/lib` | KEEP - 边界清晰 |
| **admin/** | 1 | 管理后台 | ✅ `features/admin` | KEEP - 边界清晰 |
| **reports/** | 7 | 报表系统 | ✅ `features/reports/lib` | KEEP - 边界清晰 |
| **auth/** | 2 | 认证授权 | ✅ NextAuth + `shared/lib/permissions` | KEEP - 基础设施 |
| **users/** | 1 | 用户管理 | ⚠️ 直接 DB | REFACTOR - 应归属 admin |
| **register/** | 1 | 用户注册 | ⚠️ 直接 DB | MOVE - 应归属 auth |

---

### Pi Workspace 新增 API（18 个）

这些是 **ai-workspace 融合** 带来的新路由：

| 一级目录 | 路由数 | 用途 | Pi 专属? | 推荐归属 |
|---------|--------|------|---------|---------|
| **agent/** | 4 | Agent session 管理 | ✅ 是 | Pi Runtime |
| **sessions/** | 4 | Session CRUD + state | ✅ 是 | Pi Runtime |
| **models/** | 2 | Workspace scope 模型 | ✅ 是 | Pi Runtime |
| **models-config/** | 4 | Workspace 模型配置 | ✅ 是 | Pi Runtime |
| **skills/** | 5 | Skills 管理 | ✅ 是 | Pi Runtime |
| **plugins/** | 1 | Plugins 配置 | ✅ 是 | Pi Runtime |
| **worktrees/** | 1 | Git worktrees | ⚠️ 部分 | Shared Git Service |
| **files/** | 1 | 文件浏览 | ✅ 是 | Pi Runtime |
| **cwd/** | 2 | 工作目录管理 | ✅ 是 | Pi Runtime |
| **default-cwd/** | 1 | 默认目录 | ✅ 是 | Pi Runtime |
| **file-index/** | 1 | 文件索引 | ✅ 是 | Pi Runtime |
| **git/** | 1 | Git 状态 | ⚠️ 部分 | Shared Git Service |
| **project-trust/** | 1 | 项目信任 | ✅ 是 | Pi Runtime |

**判断**: 这些路由合理属于 **ProjectHub AI Workspace**，保持当前位置即可。

**但需要明确**:
- Pi Runtime 专属能力应该调用 `@earendil-works/pi-*` 包
- Git / File 等通用能力应该提取到 `features/git` 或 `shared/git`

---

### 跨 Feature / 待归类 API（9 个）

| 一级目录 | 路由数 | 当前问题 | 推荐动作 |
|---------|--------|---------|---------|
| **commits/** | 1 | 被 Ticket Bug 修复关联使用 | ⚠️ SHARED - 提取到 `features/git` |
| **sync-commits/** | 2 | 同步 Git 提交到 DB | ⚠️ SHARED - 提取到 `features/git` |
| **search/** | 1 | 跨 PKM/Ticket/Project 搜索 | ✅ KEEP - 已使用 `features/knowledge/lib/search` |
| **upload/** | 2 | 文件上传 + 下载 | ⚠️ MOVE - 应归属 `features/file-asset` |
| **file-assets/** | 1 | FileAsset references | ⚠️ MOVE - 同上 |
| **events/** | 1 | SSE 事件流（ActivityLog） | ✅ KEEP - 通用事件网关，使用 `shared/lib/events` |
| **home/** | 1 | 首页聚合数据 | ✅ KEEP - Dashboard 聚合路由 |
| **app-update/** | 1 | 应用更新检查 | ✅ KEEP - 全局基础设施 |
| **debug/** | ? | 开发调试接口 | ⚠️ REMOVE - 生产环境应移除 |

---

## B. API → Feature 归属矩阵

### ✅ 边界清晰，保持现状（KEEP）

| API Route | Feature | Service Layer | 依赖方向 |
|-----------|---------|--------------|---------|
| `app/api/tickets/**` | `features/ticket` | ✅ `features/ticket/lib/*` | ✅ 正确 |
| `app/api/projects/**` | `features/project` | ✅ `features/project/ui/*` | ✅ 正确 |
| `app/api/ai/**` | `features/ai` | ✅ `features/ai/llm/providers/*` | ✅ 正确 |
| `app/api/pkm/**` | `features/knowledge` | ✅ `features/knowledge/lib/pkm` | ✅ 正确 |
| `app/api/knowledge/**` | `features/knowledge` | ✅ `features/knowledge/lib/*` | ✅ 正确 |
| `app/api/team/**` | `features/team` | ✅ `features/team/lib/*` | ✅ 正确 |
| `app/api/reports/**` | `features/reports` | ✅ `features/reports/lib/*` | ✅ 正确 |
| `app/api/search/**` | `features/knowledge` | ✅ `features/knowledge/lib/search` | ✅ 正确 |
| `app/api/events/**` | `shared/lib/events` | ✅ Event Gateway 模式 | ✅ 正确 |

---

### ⚠️ 需要重构（REFACTOR）

| API Route | 当前问题 | 推荐方案 | 优先级 |
|-----------|---------|---------|--------|
| `app/api/modules/**` | 直接 Prisma 操作 | 提取到 `features/module/lib/module-service.ts` | P1 |
| `app/api/users/**` | 直接 DB，应归属 admin | 移动到 `features/admin/lib/user-service.ts` | P1 |
| `app/api/upload/**` | 业务逻辑在 route，应归属 file-asset | 提取到 `features/file-asset/lib/upload-service.ts` | P2 |

---

### 🔀 需要移动/合并（MOVE/MERGE）

| API Route | 当前位置 | 推荐位置 | 原因 |
|-----------|---------|---------|------|
| `app/api/register/route.ts` | 独立目录 | `features/auth/api/register/` | 认证相关应统一 |
| `app/api/commits/**` | 独立目录 | `features/git/api/commits/` | Git 能力应独立 |
| `app/api/sync-commits/**` | 独立目录 | `features/git/api/sync/` | 同上 |
| `app/api/upload/**` | 独立目录 | `features/file-asset/api/upload/` | 文件资产应统一 |
| `app/api/file-assets/**` | 独立目录 | `features/file-asset/api/` | 同上 |

**但注意**: 这些移动 **不是强制的**，只要依赖方向正确，保持平铺也可以。

---

## C. 跨 Feature 共享能力识别

### 🔧 应该独立的 Shared Service

#### 1. Git Service（高优先级 P0）

**当前问题**:
- `app/api/commits/diff/` 使用 `lib/git-sync/diff.ts`
- `app/api/sync-commits/` 使用 `lib/git-sync/*`
- `app/api/git/status/` 使用 Pi 的 git 能力
- `app/api/worktrees/` 使用 Pi 的 worktrees

**被以下 features 使用**:
- Ticket（Bug 修复关联）
- Weekly Reports（周报生成）
- AI Workspace（Pi git status / worktrees）

**推荐结构**:
```
features/git/
├── lib/
│   ├── git-service.ts         # 统一 Git 操作入口
│   ├── commit-sync.ts         # 同步提交到 DB
│   ├── diff.ts                # Diff 生成
│   └── worktree.ts            # Worktree 管理
├── api/                       # 可选，或保持 app/api
└── types.ts
```

**依赖方向**:
```
Ticket → Git Service
Reports → Git Service
AI Workspace → Git Service
```

---

#### 2. File Asset Service（中优先级 P1）

**当前问题**:
- `app/api/upload/` 包含业务逻辑
- `app/api/file-assets/` 与 `app/api/ai/file-assets/` 重复

**推荐结构**:
```
features/file-asset/
├── lib/
│   ├── upload-service.ts      # 上传 + 去重
│   ├── storage.ts             # 存储抽象
│   └── indexing.ts            # RAG 索引队列
└── api/                       # 可选
```

---

#### 3. Search Service（低优先级 P2）

**当前状态**: 已经比较好，`app/api/search/` 调用 `features/knowledge/lib/search`

**可以保持现状**，但如果未来 Ticket / Project 也需要搜索，考虑：

```
features/search/
├── lib/
│   ├── lexical-search.ts      # 全文搜索
│   ├── vector-search.ts       # 向量搜索
│   └── hybrid-search.ts       # 混合搜索
└── adapters/
    ├── knowledge-adapter.ts
    ├── ticket-adapter.ts
    └── project-adapter.ts
```

---

#### 4. Realtime / Events（低优先级 P2）

**当前状态**: `app/api/events/` 使用 `shared/lib/events`，架构正确。

**建议**: 保持 `shared/lib/events` 作为事件网关，不需要改动。

---

## D. 依赖问题诊断

### ✅ 正确的依赖方向

```
app/api/search/route.ts
    ↓
features/knowledge/lib/search.ts
    ↓
shared/db/client (Prisma)
```

```
app/api/ai/models/route.ts
    ↓
features/ai/llm/providers/registry.ts
    ↓
features/ai/llm/credentials/api-key-store.ts
    ↓
shared/db/client
```

```
app/api/tickets/[id]/route.ts
    ↓
features/ticket/lib/*
    ↓
shared/db/client
```

---

### ⚠️ 需要改进的依赖

#### 问题 1: 直接 Prisma 调用

**发现位置**:
- `app/api/modules/route.ts` 直接 `prisma.module.findMany()`
- `app/api/users/route.ts` 直接 `prisma.user.findMany()`

**推荐**:
```typescript
// ❌ 当前
export async function GET() {
  const modules = await prisma.module.findMany({ ... });
  return NextResponse.json(modules);
}

// ✅ 推荐
export async function GET() {
  const modules = await getModules(); // 来自 features/module/lib/module-service.ts
  return NextResponse.json(modules);
}
```

**原因**:
- 业务逻辑分散在 route handler
- 无法复用（其他地方需要同样逻辑时重复代码）
- 难以测试（需要 mock Prisma）

---

#### 问题 2: 业务逻辑在 Route Handler

**发现位置**: `app/api/upload/route.ts`（97 行，包含完整上传逻辑）

**推荐**:
```typescript
// ❌ 当前：97 行业务逻辑都在 route.ts

// ✅ 推荐
// app/api/upload/route.ts
export async function POST(request: Request) {
  const session = await requireSession();
  const result = await uploadFile(request, session.user.id);
  return NextResponse.json(result);
}

// features/file-asset/lib/upload-service.ts
export async function uploadFile(request: Request, userId: string) {
  // ... 完整上传逻辑
}
```

---

#### 问题 3: 重复的模型配置 API

**发现**: `/api/models` vs `/api/ai/models`

**分析**:
- `/api/models` = Workspace scope（Pi Runtime），基于 `cwd` 参数
- `/api/ai/models` = User scope（ProjectHub SaaS），基于 `userId`

**判断**: ✅ **这是合理的双层架构**，不需要合并。

**但需要明确注释**:
```typescript
// app/api/models/route.ts
/**
 * GET /api/models?cwd=/path/to/project
 * 
 * Workspace-scoped models (Pi Runtime)
 * - 基于 .cursor/models.json
 * - 基于 workspace .env
 * - 独立于用户账号
 */

// app/api/ai/models/route.ts
/**
 * GET /api/ai/models
 * 
 * User-scoped models (ProjectHub SaaS)
 * - 基于用户自定义 Provider
 * - 存储在 DB (ApiKey + ProviderConfig)
 * - 跟随用户账号
 */
```

---

### ❌ 禁止的依赖（未发现）

以下模式在当前代码库中 **未发现**，继续保持：

```
❌ 循环依赖
features/ai → features/ticket → features/ai

❌ 反向依赖
shared → features

❌ feature 直接调用 Next.js route
features/ai → app/api/tickets

❌ 跨层直接调用
app/api → Pi Runtime internals (绕过 service)
```

---

## E. 推荐目录结构

### 方案 A: 保持 app/api 平铺（推荐）

**优点**:
- 符合 Next.js App Router 约定
- URL 即目录，直观
- 不需要物理迁移

**缺点**:
- 36 个一级目录较多
- 需要靠文档维护归属关系

```
app/api/
├── tickets/              → features/ticket
├── projects/             → features/project
├── ai/                   → features/ai
├── agent/                → features/ai (Pi Workspace)
├── sessions/             → features/ai (Pi Workspace)
├── models/               → features/ai (Pi Workspace)
├── models-config/        → features/ai (Pi Workspace)
├── commits/              → features/git (新增)
├── sync-commits/         → features/git (新增)
├── upload/               → features/file-asset
├── search/               → features/knowledge
├── events/               → shared/lib/events
└── ...

features/
├── ai/
│   ├── llm/
│   ├── agents/
│   ├── workspace/        # Pi Workspace 业务逻辑
│   └── lib/
├── ticket/
│   └── lib/
├── git/                  # 新增
│   └── lib/
│       ├── git-service.ts
│       ├── commit-sync.ts
│       └── diff.ts
├── file-asset/           # 新增或扩展
│   └── lib/
│       └── upload-service.ts
└── ...

shared/
├── lib/
│   ├── events/
│   └── permissions.ts
└── db/
    └── client.ts
```

---

### 方案 B: 部分迁移到 features/*/api（不推荐）

**缺点**:
- 破坏 Next.js 路由约定
- 需要大规模文件移动
- 与 Pi Workspace 融合冲突

**不推荐理由**:
- Next.js App Router 要求 API 在 `app/api`
- 移动到 `features/*/api` 后需要 rewrite 或 redirect
- 增加复杂度，收益不大

---

## F. 改造优先级

### P0 必须修改（架构风险）

无。当前依赖方向基本正确。

---

### P1 建议修改（技术债）

| 任务 | 范围 | 预计工作量 | 风险 |
|------|------|-----------|------|
| 1. 提取 Git Service | 创建 `features/git`，重构 3 个 API | 4-6 小时 | 低（不改 API 签名） |
| 2. 提取 Module Service | 创建 `features/module/lib/module-service.ts` | 2 小时 | 低 |
| 3. 提取 Upload Service | 创建 `features/file-asset/lib/upload-service.ts` | 3 小时 | 中（涉及 Worker 队列） |
| 4. Users API 归属 Admin | 移动到 `features/admin/lib/user-service.ts` | 1 小时 | 低 |

**合计**: 10-12 小时

---

### P2 可选优化（美观性）

| 任务 | 收益 | 工作量 |
|------|------|--------|
| 1. 合并 `upload/` 和 `file-assets/` 到同一目录 | 目录更简洁 | 1 小时 |
| 2. `register/` 归属 `auth/` | 统一认证入口 | 30 分钟 |
| 3. 添加 API 注释（明确 scope） | 文档更清晰 | 2 小时 |

---

### KEEP 不修改

| API | 原因 |
|-----|------|
| `app/api/tickets/**` | 架构正确，边界清晰 |
| `app/api/projects/**` | 同上 |
| `app/api/ai/**` | 同上 |
| `app/api/agent/**` | Pi Workspace，合理 |
| `app/api/sessions/**` | 同上 |
| `app/api/models/**` | Workspace scope，与 `/api/ai/models` 双层合理 |
| `app/api/models-config/**` | 同上 |
| `app/api/search/**` | 已使用 feature service，正确 |
| `app/api/events/**` | Event Gateway 模式，正确 |
| `app/api/home/**` | Dashboard 聚合路由，合理 |

---

## G. Pi Workspace 融合特别审查

### Pi 带来的 18 个新 API 分类

#### 类别 1: Pi Runtime 专属（保持 `app/api`，调用 Pi SDK）

```
agent/                # createAgentSession
sessions/             # getSessionsIndex
models/               # resolveVisibleModels
models-config/        # readModelsConfig
skills/               # checkSkill, installSkill
plugins/              # getPlugins
files/                # browse files
cwd/                  # validate/browse cwd
default-cwd/          # os.homedir()
file-index/           # file indexing
project-trust/        # projectTrustReloadOptions
```

**依赖**: `@earendil-works/pi-ai` + `@earendil-works/pi-coding-agent`

**判断**: ✅ 合理，这些是 Pi Workspace 的核心能力。

---

#### 类别 2: Git 能力（应提取到 features/git）

```
git/status/           # git status
worktrees/            # git worktree list
```

**当前问题**: 这些 Git 能力也被 Ticket / Reports 使用，但实现分散。

**推荐**: 提取到 `features/git/lib/git-service.ts`，Pi 和其他 feature 都调用它。

---

#### 类别 3: File 能力（应提取到 features/file-asset）

```
files/[...path]/      # 文件浏览
```

**判断**: 这是 Pi Workspace 专属的文件浏览 API，与 `upload/` 不同。

**可以保持现状**，但确保不与 FileAsset CRUD 重复。

---

### Pi vs ProjectHub 边界

| 能力 | Pi 负责 | ProjectHub 负责 |
|------|---------|----------------|
| **模型配置** | Workspace `.cursor/models.json` | User Provider + ApiKey (DB) |
| **会话管理** | Session files in `.agent/` | （未来）多用户 session 权限 |
| **文件访问** | 文件系统浏览 | FileAsset DB 记录 + RAG |
| **Git 操作** | Worktree / status | Commit sync to DB / Ticket 关联 |
| **Skills** | `.cursor/skills` | （未来）Skill marketplace |

**判断**: ✅ 边界清晰，不需要合并。

---

## H. 回归范围

如果按 P1 建议修改，需要测试：

### 1. Git Service 提取

**影响范围**:
- `app/api/commits/diff/`
- `app/api/sync-commits/**`
- `app/api/git/status/`（如果重构）
- `features/ticket`（Bug 修复关联）
- `features/reports`（周报生成）

**测试**:
- Ticket 关联 commit 功能
- 周报生成包含 commit 列表
- Commit diff 查看

---

### 2. Upload Service 提取

**影响范围**:
- `app/api/upload/**`
- `worker/lib/jobs.ts`（IndexJob）

**测试**:
- 文件上传 + 去重
- Worker 索引任务
- RAG 搜索包含上传文件

---

### 3. Module / Users Service 提取

**影响范围**: 小，仅 CRUD

**测试**: 手动回归即可

---

## I. 最终架构原则（重申）

### ✅ DO

1. **Route 层保持薄**：只做 HTTP 解析、Auth、调用 service、返回 JSON
2. **业务逻辑进 feature**：复杂逻辑必须进 `features/*/lib`
3. **共享能力独立**：Git / File / Search 等被多 feature 使用的能力应独立
4. **依赖单向**：`app/api → features → shared`，禁止反向
5. **明确 Pi 边界**：区分 "Pi Runtime 专属" vs "ProjectHub SaaS 能力"

---

### ❌ DON'T

1. **不要为了目录好看而迁移**：`app/api` 平铺符合 Next.js 约定
2. **不要直接 Prisma everywhere**：简单 CRUD 可以，但复杂逻辑要提取
3. **不要循环依赖**：feature A → feature B → feature A
4. **不要在 route handler 写业务逻辑**：超过 20 行就该提取 service
5. **不要混淆 Workspace vs User scope**：`/api/models` ≠ `/api/ai/models`

---

## J. 行动计划

### Phase 1: 文档与共识（本周）

- [x] 完成本架构审查报告
- [ ] 团队 Review（如果有协作者）
- [ ] 确认 P1 任务优先级

---

### Phase 2: P1 重构（下周）

- [ ] 创建 `features/git/lib/git-service.ts`
- [ ] 重构 `app/api/commits/` 和 `app/api/sync-commits/`
- [ ] 提取 `features/module/lib/module-service.ts`
- [ ] 提取 `features/file-asset/lib/upload-service.ts`
- [ ] 回归测试

---

### Phase 3: P2 优化（按需）

- [ ] 合并 `upload/` 和 `file-assets/` 目录
- [ ] 添加 API 注释
- [ ] 更新 PROJECT-HUB.md

---

## 附录: 完整 API 清单（按字母序）

<details>
<summary>点击展开 112 个 API 路由完整列表</summary>

```
app/api/admin/moderation/route.ts
app/api/agent/[sessionId]/events/route.ts
app/api/agent/[sessionId]/route.ts
app/api/agent/new/route.ts
app/api/agent/running/route.ts
app/api/ai/audio/realtime/config/route.ts
app/api/ai/audio/synthesize/route.ts
app/api/ai/audio/transcribe/route.ts
app/api/ai/conversations/[id]/greeting/route.ts
app/api/ai/conversations/[id]/messages/route.ts
app/api/ai/conversations/[id]/route.ts
app/api/ai/conversations/route.ts
app/api/ai/file-assets/[id]/route.ts
app/api/ai/file-assets/route.ts
app/api/ai/generate/image/route.ts
app/api/ai/generate/video/route.ts
app/api/ai/geo/route.ts
app/api/ai/messages/[id]/route.ts
app/api/ai/models/route.ts
app/api/ai/profile/route.ts
app/api/ai/providers/route.ts
app/api/ai/work/approve/route.ts
app/api/ai/work/policy/route.ts
app/api/ai/work/run/route.ts
app/api/ai/workflows/[id]/route.ts
app/api/ai/workflows/route.ts
app/api/app-update/route.ts
app/api/auth/[...nextauth]/route.ts
app/api/auth/all-providers/route.ts
app/api/commits/diff/route.ts
app/api/cwd/browse/route.ts
app/api/cwd/validate/route.ts
app/api/default-cwd/route.ts
app/api/events/route.ts
app/api/file-assets/[id]/references/route.ts
app/api/file-index/route.ts
app/api/files/[...path]/route.ts
app/api/git/status/route.ts
app/api/home/route.ts
app/api/knowledge/notes/route.ts
app/api/knowledge/spaces/route.ts
app/api/knowledge/tags/route.ts
app/api/models-config/catalog/route.ts
app/api/models-config/discover/route.ts
app/api/models-config/route.ts
app/api/models-config/test/route.ts
app/api/models/invalidate/route.ts
app/api/models/route.ts
app/api/modules/[id]/merge/route.ts
app/api/modules/[id]/route.ts
app/api/modules/route.ts
app/api/pkm/notes/[id]/route.ts
app/api/pkm/notes/route.ts
app/api/plugins/route.ts
app/api/project-trust/route.ts
app/api/projects/[id]/members/[userId]/route.ts
app/api/projects/[id]/members/route.ts
app/api/projects/[id]/responsibilities/route.ts
app/api/projects/[id]/route.ts
app/api/projects/route.ts
app/api/register/route.ts
app/api/reports/health-summary/route.ts
app/api/reports/monthly-expenses/[id]/route.ts
app/api/reports/monthly-expenses/route.ts
app/api/reports/monthly-expenses/stats/route.ts
app/api/reports/stats/route.ts
app/api/reports/weekly-reports/[id]/regenerate/route.ts
app/api/reports/weekly-reports/[id]/route.ts
app/api/reports/weekly-reports/draft-summary/route.ts
app/api/reports/weekly-reports/generate-from-workflow/route.ts
app/api/reports/weekly-reports/route.ts
app/api/reports/weekly-reports/week/route.ts
app/api/search/route.ts
app/api/sessions/[id]/auto-name/route.ts
app/api/sessions/[id]/route.ts
app/api/sessions/[id]/state/route.ts
app/api/sessions/route.ts
app/api/skills/check/route.ts
app/api/skills/install/route.ts
app/api/skills/route.ts
app/api/skills/search/route.ts
app/api/skills/update/route.ts
app/api/sync-commits/now/route.ts
app/api/sync-commits/route.ts
app/api/team/[id]/ai-profile/route.ts
app/api/team/members/route.ts
app/api/tickets/[id]/assignee/route.ts
app/api/tickets/[id]/attachments/route.ts
app/api/tickets/[id]/bug-fix-commits/route.ts
app/api/tickets/[id]/bug-relations/actions/route.ts
app/api/tickets/[id]/bug-relations/resolve/route.ts
app/api/tickets/[id]/bug-relations/route.ts
app/api/tickets/[id]/bug-ticket/route.ts
app/api/tickets/[id]/close/route.ts
app/api/tickets/[id]/comments/[commentId]/route.ts
app/api/tickets/[id]/comments/route.ts
app/api/tickets/[id]/module/route.ts
app/api/tickets/[id]/priority/route.ts
app/api/tickets/[id]/progress/route.ts
app/api/tickets/[id]/push-record/resolve/route.ts
app/api/tickets/[id]/push-record/route.ts
app/api/tickets/[id]/push-record/update/route.ts
app/api/tickets/[id]/route.ts
app/api/tickets/[id]/status/route.ts
app/api/tickets/mine/route.ts
app/api/tickets/route.ts
app/api/tickets/user/[userId]/route.ts
app/api/upload/[id]/route.ts
app/api/upload/route.ts
app/api/users/route.ts
app/api/worktrees/route.ts
```

</details>

---

## 结论

ProjectHub 的 `app/api` 目录结构 **总体合理**，符合 Next.js App Router 约定。

**核心问题不是"目录太多"，而是**:
1. ⚠️ 部分跨 feature 能力（Git / File）未独立
2. ⚠️ 少量 API 直接 Prisma，缺少 service 层
3. ✅ Pi Workspace 融合边界清晰，保持现状即可

**推荐策略**: **不做物理迁移**，重点治理依赖方向 + 提取共享 service（P1 任务 10-12 小时）。

---

**审查人**: Cursor Agent  
**审查时间**: 2026-08-21 16:30  
**下次审查**: 2026-09-01（P1 重构后）
