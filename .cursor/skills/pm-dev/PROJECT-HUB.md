---
name: project-hub
description: >-
  ProjectHub 项目档案（L2 事实层）。AI 协作时的事实唯一真相源。
  使用场景：用户在 ProjectHub 项目中工作、修改代码、规划新功能、询问项目当前状态、讨论任何已上线模块（工单/PKM/RAG/AI Agent 等）、或与学习导师交互时需要项目上下文。
---

# ProjectHub — 项目档案（L2 事实层）

> **📚 文档分层协议**：本仓库 AI 文档分 4 层
>
> | 层 | 文档 | 角色 | AI 何时读 |
> |---|---|---|---|
> | **L1 入口** | `AGENTS.md` | 路由表 / 必读索引 | 每个会话首读 |
> | **L2 事实层** | 👈 **本文档** | "是什么 / 在哪里 / 做了什么" — **唯一真相源** | 遇到具体业务问题时 |
> | **L3 操作层** | `pm-dev/SKILL.md` / `pm-ops/SKILL.md` / `pm-testing/SKILL.md` | "怎么做" — 仅命令/代码片段 | 要执行某操作前 |
> | **L4 长尾** | `docs/**/*.md` | 历史 PR 复现 / Bug 排查 / 学习路线 | 深挖具体场景时 |
>
> **⛔ 协议**：
> - L1 / L3 引用本文档时用 `§ 子节名` 锚点链接，**禁止复述**
> - 同一事实只在此处更新一次；其他文档若发现重复内容请删除
> - L3 命令模板变更时，**同步检查** L1 是否还引用正确

---

## 📋 项目元信息

| 字段 | 值 |
|------|-----|
| 🚀 **启动** | 2026-06-04（基于 GitHub 代码实际评估） |
| 📦 **仓库** | https://github.com/Cary222/project-manager |
| 📅 **最后更新** | 2026-08-14（视觉重构 + 部署拓扑 + AI 数据库速览 + #10208 待启动） |
| 🎯 **当前阶段** | 🔄 功能迭代中（AI 模型配置层 + 多模态三模统一 + systemd 全接管） |
| 📊 **完成度** | 13 大功能域已完成，3 个新进度待补全 |
| 🗺️ **远程拓扑** | DB / Worker / Embedding / 生产 Next.js 全在 `192.168.1.14`（详见 🚨 速查） |

## 🧭 目录索引

| # | 章节 | 一句话摘要 |
|---|------|----------|
| 1 | 🚨 [部署拓扑速查](#-部署拓扑速查ai-必读) | 远程/本机分工 + 端点表 + 误判预防 |
| 2 | 🏁 [实际完成度评估](#-实际完成度评估) | 已完成功能清单 + 当前新增 |
| 3 | 🧬 [AI 数据库速览](#-ai-数据库速览知识图谱式数据链) | 13 条业务链 + 15 个关键枚举 + Top 10 模型 |
| 4 | 📦 [数据模型（实际）](#-数据模型实际) | 实体字段细节 |
| 5 | 🧱 [Feature 架构](#-feature-架构2026-06-12-重构后) | FSD 9 模块拆分 |
| 6 | 🤖 [AI 模块结构](#-ai-模块结构2026-08-14-更新) | LangGraph + LLM + Jobs 子模块 |
| 7 | ➡️ [下一步操作](#-下一步操作) | 优先级 1/2 待办 |
| 8 | 📜 [记录](#-记录) | 按时间轴的开发事件 |
| 9 | 💣 [踩坑记录](#-踩坑记录) | 已修复 Bug 与解法 |

---

## 🚨 部署拓扑速查（AI 必读）

> **核心事实**：本项目**不在 Mac 本地跑服务**，所有持久化服务（DB / Embedding / Worker / 生产 Next.js）都在远程开发机 `192.168.1.14`。Mac 本地只做代码编辑 + dev server。
> **作用**：避免 AI 误判"连接 localhost:5432 失败"或"找不到 worker"。

### 🌐 一图速览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🖥️  Mac 本地（你是 vastgui）                                                    │
│ /Users/vastgui/Desktop/project-manager                                     │
│ ├─ 📝 代码编辑 + 单元测试 / E2E / dev 模式跑 Next.js（npm run dev → :3003）  │
│ ├─ 🧠 Cursor 编辑器 + Cursor Agent（我）                                       │
│ ├─ 🌐 网络代理：HTTP_PROXY=http://127.0.0.1:7890 (Clash)                       │
│ └─ 🔗 .env → DATABASE_URL → 远程 192.168.1.14:5432                            │
│     ⚠️  本地不装 Postgres、不跑 Embedding、不跑 Worker                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                  ↕ ssh (hxy@192.168.1.14)
                                  ↕ TCP 5432/5000/3003（局域网）
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🗄️  远程开发机（hxy@192.168.1.14）                                              │
│ /home/hxy/work/personal/                                                     │
│ ├─ 📁 project-manager/            # 工作区（git checkout）                      │
│ ├─ 📁 project-manager.git/        # bare 裸仓（origin 推送目标）                 │
│ ├─ 📁 embedding/                  # FastAPI + BGE-M3（独立仓库）                │
│ └─ 📁 community*, company-*       # 其他项目                                    │
│                                                                             │
│ 🐘 数据库：postgresql 14 (apt 安装)                                              │
│ ├─ DB: community             schema: pm                                     │
│ ├─ 用户: community / community                                                │
│ ├─ 端口: 5432   协议: TCP                                                    │
│ └─ 仅监听 192.168.1.x 局域网（不暴露公网）                                    │
│                                                                             │
│ ⚙️  服务（systemd --user 托管，运行在 hxy 用户下）                                │
│ ├─ ⏸️  project-manager.service         # 生产 Next.js :3003（inactive ⚠️）     │
│ ├─ 💤 project-manager-web.service      # 预留 / 占位                        │
│ ├─ ✅ project-manager-worker.service   # Index Worker（PKM 异步索引）       │
│ ├─ ✅ project-manager-background-worker.service                            │
│ │                                       # Background Worker（AI 生图/视频） │
│ ├─ ✅ embedding-api.service             # FastAPI + BGE-M3 :5000           │
│ └─ 🔄 所有服务 Restart=always + RestartSec=5 崩溃自动重启                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 🔌 关键端点速查表

| 用途 | 地址 | 用户 / Key | 备注 |
|------|------|-----------|------|
| 🐘 **PostgreSQL** | `192.168.1.14:5432`<br/>DB=`community` schema=`pm` | `community` / `community` | URL 模板见下 |
| 🧠 **Embedding API** | `http://192.168.1.14:5000` | 无需鉴权（局域网） | `/health`、`/dimension`、`POST /embed` |
| 🏭 **生产 Next.js** | `http://192.168.1.14:3003` | NextAuth session | `0.0.0.0` 绑定，局域网可达 |
| 🛠️ **Dev Next.js（本机）** | `http://localhost:3003` | 同上 | Mac 本地 `npm run dev` |
| 🔍 **Tavily（联网搜索）** | `https://api.tavily.com` | `TAVILY_API_KEY` in `.env` | AI 联网检索 |
| 🤖 **Agnes AI** | `https://apihub.agnes-ai.com/v1` | `AGNES_API_URL` in `.env` | 需代理 |

### 📝 DATABASE_URL 标准模板

```
postgresql://community:community@192.168.1.14:5432/community?options=-c%20search_path%3Dpm,public
```

> **⚠️ 不要改 schema 为 public**——`pm` schema 是命名空间隔离（community 公共表与本项目业务表分离）。`?options=-c search_path=pm,public` 强制优先查 pm。

### 🌐 跨机器操作清单

| 你想做 | 在哪台机器 | 命令 |
|--------|-----------|------|
| 📝 改代码 | Mac 本地 | 编辑器改 → `git push origin main` |
| 📜 看生产日志 | Mac 本地 → 远程 | `ssh hxy@192.168.1.14 'journalctl --user -u <service> -f'` |
| 🔄 重启服务 | Mac 本地 → 远程 | `ssh hxy@192.168.1.14 'systemctl --user restart <service>'` |
| 🗄️ 跑 schema 迁移 | Mac 本地 | `npx prisma db push`（连远程 DB） |
| 🧠 看 Embedding 健康 | Mac 本地 | `curl http://192.168.1.14:5000/health` |
| ⚙️ 看 Worker 队列 | Mac 本地 | `npx prisma studio`（连远程 DB，看 BackgroundJob 表） |
| 💻 进 psql 远程 DB | Mac 本地 | `psql 'postgresql://community:community@192.168.1.14:5432/community?options=-c search_path=pm,public'` |
| 🎭 跑 E2E 测试 | Mac 本地 | `npm run test:e2e`（连远程 DB，注意数据隔离）|

### ⚠️ 常见误判预防（AI 必看）

| 错误假设 | 实际 |
|----------|------|
| ❌ "localhost:5432 应该有 Postgres" | ✅ Postgres 在远程，本地无 DB |
| ❌ "Embedding 在 5000 = 本地" | ✅ `:5000` 也在远程（systemd 托管） |
| ❌ "Worker 进程在 Mac" | ✅ Worker 全在远程 systemd |
| ❌ "端口 3003 冲突" | ✅ 远程 :3003（生产 inactive）+ 本地 :3003（dev active），物理隔离 |
| ❌ "找不到 .next 缓存" | ✅ Mac 本地 1.3G 缓存（dev 模式），远程用 start 模式无缓存 |
| ❌ "重启前 cd /home/hxy/work/..." | ⚠️ 那是远程 hxy 视角。Mac 本地操作 `cd /Users/vastgui/Desktop/project-manager` |
| ❌ "代码 push 到 origin 就要 ssh" | ✅ push origin = 远程裸仓，常规 git push 即可，ssh 已配 |

---

## 🏁 实际完成度评估

> **状态图例**：✅ 已完成 ｜ 🔄 进行中 ｜ ⬜ 待启动

### 🔐 权限与认证

| ✅ | 功能 | 单号 / 日期 | 备注 |
|---|------|------------|------|
| ✅ | 用户认证系统 | — | NextAuth v5 + JWT + Credentials |
| ✅ | RBAC 权限 | — | ROOT / USER，封禁机制，审核日志 |
| ✅ | 管理后台 | — | 用户管理 / 角色管理 / 审核日志 |
| ✅ | 管理端删除用户 | #10085 (2026-07-09) | — |
| ✅ | 全局访问记录 | #10082 (2026-06-25) | events/ track+compute+router+types |

### 🎫 工单系统

| ✅ | 功能 | 单号 / 日期 | 备注 |
|---|------|------------|------|
| ✅ | 工单系统 Ticket | — | ticketNo 自增 #10000+ |
| ✅ | 工单状态流转 | — | DEVELOPING → READY_FOR_TEST → DONE，写历史 |
| ✅ | 工单指派（多对多 + 审计） | — | TicketAssignee + History |
| ✅ | Bug 单闭环 | — (2026-06-10~17) | 新建→指派→设计/程序单联动 |
| ✅ | 工单截止日期字段 | #10156 (2026-07-09) | — |
| ✅ | 工单优先级字段 | #10146 (2026-07-09) | — |
| ✅ | 工单备注/讨论 + 图片上传 | #10034 (2026-07-09) | crypto.subtle HTTP Bug 修复 |

### 🔗 Git 集成

| ✅ | 功能 | 单号 / 日期 | 备注 |
|---|------|------------|------|
| ✅ | Git 提交自动关联 | — | 增量游标 + 多分支追踪 + 去重展示 |
| ✅ | Git diff 查看 | — | CommitDiffModal 组件 |

### 📚 PKM & RAG 检索

| ✅ | 功能 | 单号 / 日期 | 备注 |
|---|------|------------|------|
| ✅ | PKM 笔记系统 | — (2026-06-09) | CRUD + 附件 + 图片预览 + 公开/私密 |
| ✅ | RAG 混合搜索 | — (2026-06-09) | BGE-M3 + pgvector + FastAPI，87 条向量化 |
| ✅ | 搜索代码优化 | — (2026-06-18) | AbortController + 防抖 + URL 同步 |
| ✅ | PKM embedding 清洗优化 | #10074 (2026-06-22) | 7 单元测试 + 诊断工具 + 重建脚本 |
| ✅ | DOCX 文本提取 | #10076 (2026-06-23) | python-docx + chunking |
| ✅ | PKM 异步索引化 | #10044 (2026-06-26) | Worker + Background Jobs |

### 🤖 AI Agent 对话系统（持续迭代）

| ✅ | 功能 | 单号 / 日期 | 备注 |
|---|------|------------|------|
| ✅ | AI Agent 对话系统 | #10144 (2026-06-28) | AiConversation + AiChatMessage 两表 |
| ✅ | SSE 流式响应 | — | Agnes API + ReadableStream 转发 |
| ✅ | RAG 自动注入 | — | detector 关键词检测 + retrieveContext |
| ✅ | 用户画像自动生成 | — | summarizeConversation → updateUserProfile LLM 链 |
| ✅ | 周报 AI 摘要作画像来源 | PR5 (2026-07-07) | ProfileAiSummary 重构 |
| ✅ | Agnes Tool Calling + 响应优化 | — (2026-07-09) | — |
| ✅ | 后台任务队列 | — | globalThis + 15min 冷却 + 失败重试 |
| ✅ | AI 主动问候 | — | 根据画像生成个性化开场白 |
| ✅ | 7 个 Agent skill | — | LangGraph、LangChain、RAG 检索… |
| ✅ | LangGraph 路由重构 | #10195 (2026-07-29) | StateGraph 状态机 + 意图增强 + HIL 消歧 + 来源组件化 |
| ✅ | AI 模型配置层 | #10199 (2026-07-31) | Model Registry + 三级凭证 + 用户 Provider + Model Routing + DeepSeek 404 修复 |
| ✅ | AI 模型选择器重构 | #10204 (2026-08-12) | Provider Registry + 语音音频 |
| ✅ | AI agents 重构 | #10205 (2026-08-12) | Work 模式 + 后台任务集成 |
| ✅ | AI 生图/视频进度条 | #10206 (2026-08-13) | I2I 修复 + Worker 图片解析 + 刷新持久化 |
| ✅ | 视频生成多 Bug 修复 | #10112 (2026-08-13~14) | inputFileIds I2V + attachment 验证 + 503 退避 + 持久化 + userImageLightbox |
| ⬜ | Chat 模式识图 | #10208 (待启动) | 三模统一多模态输入 + AiFileAsset.ownerId |

### 📊 周报 / 报表

| ✅ | 功能 | 单号 / 日期 | 备注 |
|---|------|------------|------|
| ✅ | 周报系统 | PR1 (2026-06-29) | — |
| ✅ | 周报报表真实化 | PR2 (2026-06-29) | — |
| ✅ | AI 画像面板 | PR3/PR4/PR5 (2026-06-29 / 07-07) | 只读 + 入队 + 摘要 |
| ✅ | 周报本月周报率 Bug | #10085 (2026-07-09) | — |
| ✅ | 周报 Markdown UI 优化 | #10166 (2026-07-17) | 标题加粗 + 列表序号 + 单换行 + XSS 防护 |
| ✅ | 周报率图表 Bug | #10166 (2026-07-16) | 累积算法修复，统一本周/本月视图 |

### 🏗️ 架构与基础设施

| ✅ | 功能 | 单号 / 日期 | 备注 |
|---|------|------------|------|
| ✅ | Feature-First Design 架构 | — (2026-06-12) | 9 个 feature 模块拆分 |
| ✅ | SWR 数据获取全面接入 | — (2026-06-05~11) | ticket 详情页 |
| ✅ | 项目详情文档 Tab | #10081 (2026-06-24) | 附件上传 + DocumentPreviewModal |
| ✅ | 管理端职能管理增强 | #10080 (2026-06-23) | — |
| ✅ | Dashboard 重构 | #10179 (2026-07-16) | 响应式布局 + 数据卡片增强 |
| ✅ | FSD 架构优化 | #10069 (2026-07-17) | UI/Lib 边界重构 + AI 对话 + TaskBoard |
| ✅ | Claude Code skill | — | ai-learning / project-hub / feature-first |
| ✅ | 月度报销多用户分摊 | #10196 (2026-07-31) | 看板重构 + 查看他人详情 + ROOT 编辑 |
| ✅ | 图片 OCR + .doc/.wps 提取 | #10197 (2026-07-31) | embedding 文档处理增强 |
| ✅ | E2E 测试 (Playwright) + 单元测试 (Vitest) | — | 已有 acceptance + 零散 Playwright 用例 |
| ✅ | 部署脚本 (deploy.sh) | — | 环境配置 |
| ✅ | systemd 接管所有服务 | — (2026-08-13) | pm / worker / bg-worker / embedding-api |

### 🔥 当前新增（2026-08-01~14）

| 🔄 | 增量 | 单号 / 日期 |
|---|------|------------|
| 🔄 | AI 模型选择器重构 + Provider Registry + 语音音频 | #10204 |
| 🔄 | AI agents 重构 + Work 模式 + 后台任务系统 | #10205 |
| 🔄 | AI 生图/视频进度条 + I2I 修复 + Worker 图片解析 | #10206 |
| 🔄 | 视频生成多 Bug 修复（#10112）+ 图生视频 + 刷新持久化 | — |
| 🔄 | systemd 统一接管 project-manager / worker / embedding-api | — |
| ⬜ | Chat 模式识图（三模统一多模态输入 + AiFileAsset.ownerId） | #10208 |

---

## 🧬 AI 数据库速览（知识图谱式数据链）

> **目的**：让 AI 在读 PROJECT-HUB.md 时 5 秒内抓出整个数据库的实体骨架 + 业务主链。
> **约束**：只列关键字段、关系、枚举值，省略次要字段；结构按"业务域"聚类，而非字母序。

### 🗺️ 数据链全景图（核心 13 条链）

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 链 1 权限核心         User ─┬─ Account/Session (NextAuth)                │
│                            ├─ ModerationLog (管理审计)                  │
│                            ├─ UserOnProject / UserResponsibility        │
│                            └─ UserApiKey (三级凭证：SYSTEM/USER/ENV)     │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 2 项目骨架         Project ── Responsibility(PROGRAM|DESIGN)        │
│                            └── Module ── Ticket (#10000+)               │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 3 工单联动         Ticket ─┬─ TicketAssignee (多对多)               │
│                            ├─ TicketAssigneeHistory / StatusHistory     │
│                            ├─ TicketComment + CommentImage (Json)       │
│                            ├─ DesignProgramBinding (设计→程序)          │
│                            ├─ BugProgramBinding (Bug→程序双向)          │
│                            ├─ TicketRepoBinding + TicketCommit          │
│                            └─ Notification                              │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 4 Git 自动关联     Ticket ── TicketRepoBinding ── SyncCursor         │
│                                            └─ TicketCommit (去重展示)   │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 5 RAG 检索         SearchDocument(embedding vector) ←── 多源          │
│     ├── project: Project (FK)                                           │
│     ├── document: Document (FK，PR11 后改读这里)                        │
│     └── sourceType: TICKET | COMMIT | KNOWLEDGE_DOC | PKM_NOTE | ...    │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 6 文档处理         FileAsset(uploader) ─┬─ Document (1:1 派生)       │
│                                            ├─ FileReference (反查引用)  │
│                                            └─ IndexJob (异步任务)        │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 7 PKM 笔记         PkmNote(userId, projectId?)                       │
│     └── AsyncEmbed → SearchDocument(type=PKM_NOTE)                     │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 8 AI 对话          AiConversation(userId) ─┬─ AiChatMessage           │
│                                                ├─ AiMessageAttachment   │
│                                                ├─ AiConversationRuntimeState │
│                                                └─ WorkflowRun (WORK类)  │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 9 AI 资产/凭证     AiFileAsset(storageType=DATABASE/REMOTE_URL/...) │
│     ├── UserApiKey (SYSTEM→USER→ENV 三级降级)                            │
│     └── AiUserProfile (LLM 生成的画像 Json)                              │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 10 后台任务        BackgroundJob(type, status) ─┬─ JobOutput          │
│     └── AiFileAsset (任务输出落 AiFileAsset)     │                      │
│                                                    ├─ correlationId      │
│                                                    ├─ traceId (链路追踪) │
│                                                    └─ parentJobId (子)   │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 11 周报/项目关联   WeeklyReport ── WeeklyReportProject ── Project    │
│     └── aiSummary (LLM 生成) + workflowRunId (软链)                     │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 12 月度报销        MonthlyExpense(userId) ── ExpenseShare(userId)    │
│     └── 多用户分摊，ROOT 可编辑 (#10196)                                │
├──────────────────────────────────────────────────────────────────────────┤
│ 链 13 系统运维         SystemSetting(updatedBy) + ActivityLog + Counter  │
│     └── systemd: project-manager / worker / embedding-api 三服务托管     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 📑 13 条链 → 业务速查（表格版）

| 链 | 业务主题 | 核心表 | 关键流向 |
|----|---------|--------|---------|
| 1 | 🔐 权限核心 | User, UserApiKey | NextAuth 登录 → RBAC 校验 → Key 注入 |
| 2 | 🏗️ 项目骨架 | Project, Responsibility, Module, Ticket | 自上而下四层组织结构 |
| 3 | 🎫 工单联动 | Ticket + 7 历史/绑定表 | 状态/指派/绑定/通知 全审计 |
| 4 | 🔗 Git 关联 | TicketRepoBinding, TicketCommit, SyncCursor | 增量同步 + commit 去重展示 |
| 5 | 🔍 RAG 检索 | SearchDocument(vector) | 多源汇集（TICKET/COMMIT/PKM…） |
| 6 | 📎 文档处理 | FileAsset, Document, FileReference, IndexJob | 上传 → 1:1 派生 → Embedding |
| 7 | 📝 PKM 笔记 | PkmNote → SearchDocument | 用户笔记异步入向量库 |
| 8 | 💬 AI 对话 | AiConversation + 附件 + 运行时 | CHAT/WORK 两类，含 HIL 状态 |
| 9 | 🎨 AI 资产 | AiFileAsset, UserApiKey, AiUserProfile | 三级凭证降级 + 用户画像 |
| 10 | ⚙️ 后台任务 | BackgroundJob → JobOutput → AiFileAsset | 任务队列 + 输出落盘 |
| 11 | 📅 周报关联 | WeeklyReport + Project 多对多 | AI 摘要 + workflowRunId 软链 |
| 12 | 💰 月度报销 | MonthlyExpense → ExpenseShare | 多用户分摊 |
| 13 | 🛡️ 系统运维 | SystemSetting, ActivityLog, Counter | 自增计数 + 操作审计 |

### 🏷️ 关键枚举速查

| 枚举 | 取值 | 业务含义 |
|------|------|----------|
| `UserRole` | ROOT / USER | 权限分级 |
| `ResponsibilityKind` | PROGRAM / DESIGN | 项目职能分类 |
| `TicketStatus` | DEVELOPING → READY_FOR_TEST → DONE | 工单状态机 |
| `BackgroundJobStatus` | PENDING / PROCESSING / COMPLETED / FAILED | 任务队列状态 |
| `BackgroundJobType` | IMAGE / VIDEO / AI_SUMMARY / DOC_INDEX / ... | Worker handler 路由 |
| `JobOutputStatus` | PENDING / GENERATING / COMPLETED / FAILED | 任务产物状态 |
| `AiFileStorageType` | DATABASE / REMOTE_URL / BASE64 / LOCAL_PATH | 文件存储策略 |
| `AiAttachmentDirection` | INPUT / OUTPUT | 用户上传 vs AI 输出 |
| `AiAttachmentType` | IMAGE / VIDEO / AUDIO / DOCUMENT | 附件类型 |
| `AiMessageExecutionStatus` | COMPLETED / PROCESSING / FAILED | 流式状态标记 |
| `FileReferenceSourceType` | TICKET_COMMENT / PROJECT_DOC / ... | 反查引用源 |
| `DocumentStatus` | PENDING / INDEXING / READY / FAILED | 文档处理状态 |
| `ExpenseType` | MEAL / TRAVEL / OFFICE / OTHER | 报销分类 |
| `ExpenseStatus` | PENDING / APPROVED / REJECTED | 报销审批 |
| `SearchDocumentSourceType` | TICKET / COMMIT / KNOWLEDGE_DOC / PKM_NOTE / ... | RAG 来源类型 |

### 🎯 业务主链关系密度（Top 10 核心模型）

| 模型 | 核心关系 | 关键唯一索引 | 业务地位 |
|------|---------|-------------|---------|
| 👤 **User** | → 11 个反向 relation | email @unique | 权限与身份根 |
| 🎫 **Ticket** | ← Module ← Responsibility ← Project | ticketNo @unique | 工单系统核心 |
| 🏗️ **Project** | → Module/Responsibility/Ticket/WeeklyReport/PkmNote | — | 项目骨架根 |
| 💬 **AiConversation** | → AiChatMessage/AiConversationRuntimeState/WorkflowRun | — | AI 对话容器 |
| 📝 **AiChatMessage** | ← AiConversation, → AiMessageAttachment | — | AI 对话条目 |
| 🎨 **AiFileAsset** | ← AiMessageAttachment, ← JobOutput | — | AI 资产根（BASE64/REMOTE_URL） |
| ⚙️ **BackgroundJob** | → JobOutput | @@index(status,priority,createdAt) | 任务队列根 |
| 📦 **JobOutput** | ← BackgroundJob, → AiFileAsset | @@unique(jobId,sequence) | 任务产物根 |
| 📎 **FileAsset** | → Document(1:1), → FileReference | @@unique(hash,size) | 通用文件根 |
| 🔑 **UserApiKey** | ← User(?) | — | AI 凭证根（三级降级） |

---

## 📦 数据模型（实际）

### 🎫 工单核心链

```
Project
  └── Responsibility (PROGRAM | DESIGN)  [unique: projectId + kind]
        └── Module                        [unique: responsibilityId + name]
              └── Ticket (#10000 递增)
                    ├── TicketAssignee         [多对多]
                    ├── TicketAssigneeHistory  [变更审计]
                    ├── TicketStatusHistory    [状态审计]
                    ├── TicketRepoBinding      [关联 Git 仓库]
                    └── TicketCommit           [提交记录，关联 commit SHA]
```

### 👤 用户与权限

```
User
  ├── Role: ROOT | USER
  ├── bannedAt: 软封禁
  └── ModerationLog: 管理操作审计
```

### ⚙️ 全局基础设施

| 模型 | 作用 |
|------|------|
| `SyncCursor` | 增量 Git 同步游标 |
| `Counter` | ticketNo 自增分配 |
| `SearchDocument` | 向量搜索文档（type: TICKET \| COMMIT \| KNOWLEDGE_DOC）|

---

## 🧱 Feature 架构（2026-06-12 重构后）

> **FSD** (Feature-Sliced Design) 渐进式架构，9 个 feature 模块独立自治。

| Feature 模块 | 职责 | 关键 UI / 子目录 |
|-------------|------|-----------------|
| 🛠️ `admin/` | 管理后台 UI | 用户管理 / 角色管理 / 审核日志 |
| 📊 `dashboard/` | 首页仪表盘 | 数据卡片 / 趋势图 |
| 📤 `dispatch/` | 派单功能 | 派单面板 |
| 📚 `knowledge/` | 知识搜索 + PKM 笔记 | `ui/KnowledgeSearchPanel`、`ui/KnowledgeSearchResults`、`pkm/PkmBoard` |
| 🏗️ `project/` | 项目管理 UI | ProjectDetail 详情页 |
| 🔗 `repo/` | Git 仓库 UI | 仓库列表 / 提交面板 |
| ⚙️ `settings/` | 设置页面 | 用户设置 / API Key 配置 |
| 🧩 `task/` | 任务 UI | TaskBoard 看板 |
| 🎫 `ticket/` | 工单系统 | `create/CreateTicketForm` + action、`ui/TicketsList` + `ui/ticket-detail/{Bug,Design,Program,Ticket}Detail` + `ui/TicketPushPanel` |

---

## 🤖 AI 模块结构（2026-08-14 更新）

### 🧠 `graph/` LangGraph 状态机核心

| 子模块 | 职责 |
|--------|------|
| `agent.ts` | StateGraph 组装 + 路由定义 |
| `state.ts` | AgentState Annotation 定义 |
| `types.ts` | PendingHumanAction / DisambiguationCandidate |
| `edges/routing.ts` | 8 个路由函数（routeAfterDetectIntent 等）|
| `nodes/detect-intent.ts` | 意图检测 + 实体提取 |
| `nodes/model-select.ts` | 模型选择节点 🆕 |
| `nodes/search-knowledge.ts` | RAG 向量检索 |
| `nodes/search-structured.ts` | DB 结构化查询 |
| `nodes/decision.ts` | 消歧决策节点 |
| `nodes/human-confirmation.ts` | HIL 确认节点 |
| `nodes/web-search.ts` | 联网搜索 |
| `nodes/generate-response.ts` | LLM 生成回答 |

### ⚡ `llm/` LLM 层（2026-07-31 重构）

| 子模块 | 职责 |
|--------|------|
| `providers/registry.ts` | 动态模型发现（Model Registry） |
| `providers/types.ts` | ModelCatalogEntry / ApiFormat |
| `providers/init.ts` | 初始化系统 Provider |
| `providers/user-providers.ts` | 用户 Provider |
| `credentials/api-key-store.ts` | 三级降级链路（SYSTEM → USER → ENV） |
| `credentials/encryption.ts` | API Key 加密（AES-256-GCM） |
| `model-routing.ts` | selectModel 任务类型路由 |
| `model-runtime-config.ts` | 运行时配置 |
| `proxy.ts` | Agnes 代理 |
| `agnes-provider.ts` | Agnes LLM 提供者 |
| `summarizer.ts` | 对话摘要 |

### 🗂️ 其他子模块

| 子模块 | 职责 |
|--------|------|
| 📋 `core/` | queries / resolvers / formatters / search-structured-core |
| 🔍 `search/` | detector / rag / speculation-cache |
| 🛠️ `tools/` | 工具集 |
| ⚙️ `jobs/` | 后台任务（BackgroundJob 队列处理） |
| 💾 `store/` | 会话存储 |
| 📐 `types/` | 类型定义 |
| 🖼️ `ui/` | UI 组件（AaMessageBubble / AiChatPanel 等 17 个组件） |

---

## ➡️ 下一步操作

### 🎯 优先级 1：多模态三模统一（当前阶段）

| ✅ / ⬜ | 任务 | 进展 / 备注 |
|--------|------|------------|
| ✅ | LangGraph StateGraph 状态机编排 | 2026-07-29 |
| ✅ | HIL 人工介入节点（humanConfirmation） | 2026-07-29 |
| ⬜ | **LangGraph 测试用例执行** | 测试计划见 `.cursor/plans/langgraph-测试用例_b2c7d3f1.md` |
| ⬜ | 多轮对话状态累积验证 | — |
| ⬜ | Vercel AI SDK 流式响应框架 | — |
| ⬜ | **#10208 Chat 模式识图** | 三模统一多模态输入计划已就绪 |

### 🧪 优先级 2：RAG 调参验证

| ✅ / ⬜ | 任务 | 进展 / 备注 |
|--------|------|------------|
| ✅ | Markdown 清洗 + 诊断工具链建成 | — |
| ⬜ | 跑 diagnose baseline 选测试笔记 | — |
| ⬜ | 跑 diagnose measure 取改前分数 | — |
| ⬜ | 调 ranking 权重参数（keyword vs semantic）| — |

---

## 📜 记录

> **图例**：🌱 基础建设 ｜ 🎫 工单 ｜ 🤖 AI ｜ 🔧 架构/重构 ｜ 🐛 Bug 修复 ｜ ⚙️ 运维

### 🌱 第一阶段：基础建设（2026-06-04 ~ 06-12）

| 日期 | 完成事项 | 单号 / 备注 |
|------|---------|------------|
| 2026-06-04 | 🌱 评估实际代码 | 通过 GitHub 仓库确认项目真实完成度 |
| 2026-06-04 | 🌱 建立学习路线 | 三条路线：RAG 落地 + 排错基本功 + 进阶功能 |
| 2026-06-05 | ⚙️ SWR + 通知 + 管理端 | #10045 #10046 #10049 |
| 2026-06-08 | 🤖 RAG ③④ 实操 | BGE-M3 模型部署 + pgvector 安装 + 语义搜索验证 |
| 2026-06-09 | 🤖 RAG ⑤ 上线 + PKM 上线 | 混合搜索 + 笔记 CRUD，87 条向量化 |
| 2026-06-11 | ⚙️ SWR 全面接入 + 错误处理 | #10049 #10062 |
| 2026-06-12 | 🔧 FSD 架构重构 | #10069 拆分为 9 个 feature 模块 |

### 🎫 第二阶段：业务扩展（2026-06-15 ~ 07-09）

| 日期 | 完成事项 | 单号 / 备注 |
|------|---------|------------|
| 2026-06-10 | 🎫 Bug 单闭环 | #10039 三单状态逻辑打通 |
| 2026-06-17 | 🎫 Bug 单详情页 | #10068 commit 去重展示 + 推送面板搜索 |
| 2026-06-18 | 🎫 搜索优化 + 图片压缩 + 状态同步 | #10043 #10067 #10066 |
| 2026-06-22 | 🤖 embedding 清洗 + Bug 单重构 | #10074 #10075 |
| 2026-06-23 | 🤖 DOCX 附件提取 + 管理端职能 | #10076 #10080 |
| 2026-06-24 | 🔧 项目文档 Tab | #10081 附件上传 + DocumentPreviewModal |
| 2026-06-25 | 🔧 访问记录 + 构建修复 | #10082 + #10037 |
| 2026-06-26 | 🤖 PKM 异步索引化 | #10044 Worker + Background Jobs |
| 2026-06-26 | 🤖 访问记录 UI | #10082 |
| 2026-06-28 | 🤖 **AI Agent 对话系统上线** | #10144 — 项目进入 AI 时代 |
| 2026-06-29 | 🤖 PR1 周报系统 + PR2 报表真实化 | 详见 [PR1](../../../docs/reports/PR1-weekly-reports.md) / [PR2](../../../docs/reports/PR2-stats-and-reports.md) |
| 2026-06-29 | 🤖 PR3 AI 画像面板（只读） | [PR3](../../../docs/reports/PR3-ai-profile.md) |
| 2026-06-29 | 🤖 PR4 周报→画像入队 + 手动触发 | [PR4](../../../docs/reports/PR4-weekly-report-ai-enqueue.md) |
| 2026-07-07 | 🤖 **PR5 周报 AI 画像增强** | 周报摘要作为画像来源 + ProfileAiSummary 重构 |
| 2026-07-09 | 🤖 Agnes Tool Calling + 响应优化 | #10144 响应速度优化 |
| 2026-07-09 | 🎫 工单截止日期 + 优先级字段 | #10156 + #10146 |
| 2026-07-09 | 🎫 工单备注/讨论面板 + 图片上传 | #10034 + crypto.subtle Bug 修复 |
| 2026-07-09 | 🐛 周报本月周报率 Bug 修复 | #10085 |
| 2026-07-09 | 🐛 管理端删除用户功能 | #10085 |

### 🔧 第三阶段：架构优化（2026-07-15 ~ 07-31）

| 日期 | 完成事项 | 单号 / 备注 |
|------|---------|------------|
| 2026-07-15 | 🤖 AI 工具链优化 | 步数限制 + 预缓存 + 错误处理 |
| 2026-07-16 | 🔧 **Dashboard 重构** | 响应式布局 + 数据卡片增强（#10179） |
| 2026-07-16 | 🐛 周报率图表 Bug 修复 | 累积算法修复（#10166） |
| 2026-07-16 | 🎫 周报周选择器增强 | AI 摘要 XSS 防护（#10166） |
| 2026-07-17 | 🔧 FSD 架构优化 | UI/Lib 边界重构 + AI 对话 + TaskBoard（#10069） |
| 2026-07-17 | 🎫 周报 Markdown UI 优化 | 标题加粗 + 列表序号 + 单换行（#10166） |
| 2026-07-29 | 🤖 **LangGraph 路由重构** | StateGraph 状态机 + 意图增强 + HIL 消歧（#10195） |
| 2026-07-29 | 🐛 人员活动归因修复 | 修复 searchStructured 的 TicketCommit 列表加载 |
| 2026-07-29 | 🐛 文件处理多 Bug 修复 | 多 chunk OOM + 纯文本解码 + 项目文档 RAG 映射 |
| 2026-07-31 | 🤖 **AI 模型配置层完整上线** | Model Registry + 三级凭证 + 用户 Provider（#10199） |
| 2026-07-31 | 🎫 月度报销多用户分摊 | 月度报销看板重构（#10196） |
| 2026-07-31 | 🤖 图片 OCR + .doc/.wps 提取 | embedding 文档处理增强（#10197） |

### 🔥 第四阶段：多模态 + 模型层深耕（2026-08-12 ~ 当前）🆕

| 日期 | 完成事项 | 单号 / 备注 |
|------|---------|------------|
| 2026-08-12 | 🔥 🤖 AI 模型选择器重构 + Provider Registry + 语音音频 | #10204 |
| 2026-08-12 | 🔥 🤖 AI agents 重构 + Work 模式 + 后台任务系统集成 | #10205 |
| 2026-08-13 | 🔥 🤖 AI 生图/视频进度条 + I2I 修复 + Worker 图片解析 | #10206（Agnes API 格式修复 + Storage Layer 抽象） |
| 2026-08-13 | 🔥 ⚙️ **systemd 接管所有服务** | project-manager / worker / embedding-api（systemd unit + Restart=always） |
| 2026-08-13~14 | 🔥 🐛 视频生成多 Bug 修复（#10112）| inputFileIds I2V + attachment 验证 + 503 退避 + 类型守卫 + 持久化 + userImageLightbox |
| 2026-08-14 | 🔥 🤖 **Chat 模式识图计划落地**（待启动）| #10208 — 三模统一多模态输入 + AiFileAsset.ownerId 基础安全修复 |

---

## 💣 踩坑记录

### 🖼️ 图片上传 crypto.subtle Bug（2026-07-09）

| 项 | 内容 |
|----|------|
| 🐛 **问题** | 用户通过 HTTP IP 地址访问时，`crypto.subtle` API 不可用导致图片上传崩溃 |
| 🔍 **根因** | `crypto.subtle` 只能在安全上下文（https:// 或 localhost）中使用 |
| ✅ **解法** | `shared/lib/hash.ts`：添加 `crypto?.subtle` 检查，非安全上下文返回 `null`<br>`shared/lib/upload.ts`：只有 `clientHash` 有值时才上传 hint |
| 📄 | 详见 [debug-log.md](../../../docs/debug-log.md) |

### 🧭 LangGraph 路由文件踩坑（2026-07-29）

| 项 | 内容 |
|----|------|
| 🐛 **问题** | 原始 `routing.ts` 中 auto 模式判断写反，导致应该走 DB 快查的请求走了 RAG 向量检索 |
| 🔍 **根因** | `routeAfterSearchKnowledge` 导出了但从未在 `addConditionalEdges` 中使用<br>Graph 固定链 `searchKnowledge → searchStructured → generateResponse` 硬编码，路由形同虚设 |
| ✅ **解法** | 修正 `routeByMode` 对 auto 模式的判断：<br>• auto + 浅层查询（工单号/项目名/统计/vcs）→ `searchStructured`（DB 快查）<br>• auto + 深层内容（文档/笔记/详情）→ `searchKnowledge`（RAG 向量检索） |
| 📄 | 详见 [docs/ai/PR10144-LangGraph-Routing-Recap.md](../../../docs/ai/PR10144-LangGraph-Routing-Recap.md) |

### 🎬 I2V 视频生成多 Bug 修复（2026-08-13~14，#10112）

| 项 | 内容 |
|----|------|
| 🐛 **问题** | 图生视频链路 7 处 bug 累积，导致 `inputFileIds` 无法稳定工作 |
| 🔍 **根因** | • worker handler 缺 `inputFileIds` 字段透传<br>• `taskId/videoId` 非空断言错误<br>• video-route.ts 语法错误 + `error?.message` 类型错误<br>• Agnes API 503 服务端临时错误无指数退避<br>• 刷新页面后 userImages 仅在 assistant 分支构造，input 分支丢图<br>• `userImageLightbox` 提取位置过低，只在 assistant 分支可见 |
| ✅ **解法** | • worker handler 透传 `inputFileIds: string[]` 字段<br>• 类型守卫 + 防御性抛错（videos 空数组 / video.url 为空）<br>• 503 指数退避<br>• route.ts 修复 `errorMessage: error instanceof Error ? error.message : String(error)`<br>• 改从 **INPUT** attachments 构建 userImages 实现持久化<br>• `userImageLightbox` 提到外层使 input/assistant 都可见 |

### 📷 Chat 模式不识图（2026-08-14，#10208 待启动）

| 项 | 内容 |
|----|------|
| 🐛 **问题** | `AiChatInput.handleImageUpload` 走 `/api/upload` 知识库通道，图片只渲染不传 LLM |
| 🔍 **根因** | • 图片没写 `AiMessageAttachment(direction=INPUT)`<br>• `buildMessages` 只把字符串 content 丢给 `HumanMessage` → chat 模型看不见图 |
| ✅ **解法（7 步）** | • **Step 0**：AiFileAsset 加 `ownerId`（nullable migration）<br>• **Step 1**：抽取 `uploadImageToFileAsset` helper，改走 `/api/ai/file-assets` JSON 通道<br>• **Step 2**：messages API 入参加 `inputImageIds`<br>• **Step 3**：messages-builder 支持纯数据多模态 content（pure function）<br>• **Step 4**：route.ts 按严格时序：校验→建消息→建附件→resolve→buildMessages<br>• **Step 5**：历史多轮 user message 按 batch attachments 重建多模态<br>• **Step 6**：Image/Video 模式统一走 `uploadImageToFileAsset`（去重）|
| 📄 | 详见 [.cursor/plans/chat-vision-completion_d9d797fd.plan.md](../../../.cursor/plans/chat-vision-completion_d9d797fd.plan.md) |
