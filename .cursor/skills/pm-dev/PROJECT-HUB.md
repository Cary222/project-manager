---
name: project-hub
description: >-
  ProjectHub 公司项目管理平台开发进度档案。覆盖项目实际完成度、数据模型、Feature 架构、下一步操作、迭代记录。激活场景：用户在 ProjectHub 项目中工作、修改代码、规划新功能、询问项目当前状态、讨论任何已上线模块（工单/PKM/RAG/AI Agent 等）、或与学习导师交互时需要项目上下文。
---

# ProjectHub — 公司项目管理平台进度档案

> **项目启动**：2026-06-04（基于 GitHub 代码实际评估）
> **仓库**：https://github.com/Cary222/project-manager
> **最后更新**：2026-07-29（LangGraph 路由重构 + 意图检测优化 + 人员活动归因）
> **当前阶段**：功能迭代中（LangGraph 状态机 + HIL 消歧）

---

## 实际完成度评估

```
已完成 ✅
  ├── 用户认证系统（NextAuth v5 + JWT + Credentials）
  ├── RBAC 权限（ROOT / USER，封禁机制，审核日志）
  ├── 项目 CRUD（创建、列表、详情、删除）
  ├── 模块管理（项目 → 职能(PROGRAM/DESIGN) → 模块）
  ├── 工单系统（Ticket，ticketNo 自增 #10000+）
  ├── 工单状态流转（DEVELOPING → READY_FOR_TEST → DONE，写状态历史）
  ├── 工单指派（多指派人，写指派历史）
  ├── Bug 单闭环（新建→指派→设计单/程序单联动，2026-06-10~17）
  ├── 工单截止日期字段（#10156，2026-07-09）
  ├── 工单优先级字段（#10146，2026-07-09）
  ├── 工单备注/讨论面板 + 图片上传全链路（#10034，2026-07-09）
  ├── 图片上传 Bug 修复（crypto.subtle HTTP 环境，2026-07-09）
  ├── Git 提交自动关联（增量同步游标、多分支追踪、commit 解析、去重展示）
  ├── Git diff 查看（CommitDiffModal 组件）
  ├── PKM 笔记系统（CRUD + 附件上传 + 图片预览 + 公开/私密，2026-06-09）
  ├── RAG 混合搜索（BGE-M3 + pgvector + FastAPI，87 条向量化，2026-06-09）
  ├── 搜索代码优化（AbortController + 防抖 + URL 同步，2026-06-18）
  ├── PKM embedding 清洗优化（#10074，2026-06-22）
  │     ├── Markdown 净化函数（cleanMarkdownForEmbedding，7 个单元测试）
  │     ├── 诊断工具（diagnose-pkm-search baseline/measure）
  │     ├── 批量重建脚本（reindex-pkm-notes，batch + concurrency）
  │     └── 辅助脚本（clear、debug、inspect）
  ├── Feature-First Design 架构（9 个 feature 模块拆分，2026-06-12）
  ├── SWR 数据获取全面接入（ticket 详情页，2026-06-05~11）
  ├── 管理后台（用户管理、角色管理、审核日志）
  ├── 管理端删除用户功能（#10085，2026-07-09）
  ├── E2E 测试（Playwright）、单元测试（Vitest）
  ├── 部署脚本（deploy.sh、环境配置）
  ├── Claude Code skill（ai-learning、project-hub、feature-first）
  ├── DOCX 附件文本提取（#10076，python-docx + chunking，2026-06-23）
  ├── PKM 异步索引化（#10044，Worker + Background Jobs，2026-06-26）
  ├── 全局访问记录系统（#10082，events/ track+compute+router+types，2026-06-25）
  ├── AI Agent 对话系统（#10144，2026-06-28 / 2026-07-07 增强 / 2026-07-29 LangGraph 重构）
  │     ├── 对话 CRUD（AiConversation + AiChatMessage 两张表）
  │     ├── SSE 流式响应（Agnes API + ReadableStream 转发）
  │     ├── RAG 自动注入（detector 关键词检测 + retrieveContext）
  │     ├── 用户画像自动生成（summarizeConversation → updateUserProfile LLM 链）
  │     ├── 周报 AI 摘要作为画像来源（PR5，2026-07-07）
  │     ├── Agnes Tool Calling 接入 + 响应速度优化（2026-07-09）
  │     ├── 后台任务队列（globalThis + 15min 冷却期 + 失败重试）
  │     ├── AI 主动问候（根据画像生成个性化开场白）
  │     ├── 7 个 Agent skill（LangGraph、LangChain、RAG 检索、流式响应…）
  │     ├── LangGraph 路由重构（#10195，2026-07-29）
  │     │     ├── StateGraph 状态机编排（detectIntent / searchKnowledge / searchStructured / decision / webSearch / generateResponse / humanConfirmation）
  │     │     ├── 意图检测增强（人员消歧、多轮对话、代词指代）
  │     │     ├── HIL 人工介入节点（humanConfirmation 节点）
  │     │     ├── 路由规则修正（auto 模式 DB 快查优先）
  │     │     └── 来源引用组件化（AiSourcesList 独立渲染）
  ├── 项目详情文档 Tab（#10081，附件上传 + DocumentPreviewModal，2026-06-24）
  ├── 管理端职能管理增强（#10080，2026-06-23）
  ├── 周报系统（PR1，2026-06-29）
  ├── 周报报表真实化（PR2，2026-06-29）
  ├── 周报本月周报率 Bug 修复（#10085，2026-07-09）
  ├── AI 画像面板（PR3 / PR4 / PR5，2026-06-29 / 2026-07-07）
  ├── Dashboard 重构（#10179，2026-07-16）
  │     ├── 响应式布局
  │     └── 数据卡片增强
  ├── FSD 架构优化（#10069，2026-07-17）
  │     ├── UI/Lib 边界重构与下沉
  │     ├── AI 对话页面拆分
  │     └── TaskBoard 组件拆分
  ├── 周报 Markdown UI 优化（#10166，2026-07-17）
  │     ├── 标题加粗、列表序号、单换行支持
  │     ├── AI 摘要 XSS 防护
  │     └── 周报周选择器增强
  └── 周报率图表 Bug 修复（#10166，2026-07-16）
        └── 修复累积算法，统一本周/本月视图数据

当前阶段 🔄  功能迭代中（2026-07-29）
            新增：LangGraph StateGraph 状态机编排
            新增：HIL 人工介入节点（humanConfirmation）
            新增：意图检测增强（人员消歧、多轮对话、代词指代）
            新增：路由规则修正（auto 模式 DB 快查优先）
            新增：来源引用组件化（AiSourcesList）
```

---

## 数据模型（实际）

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

User
  ├── Role: ROOT | USER
  ├── bannedAt: 软封禁
  └── ModerationLog: 管理操作审计

SyncCursor (增量 Git 同步游标)
Counter (ticketNo 自增分配)
SearchDocument (向量搜索文档，type: TICKET | COMMIT | KNOWLEDGE_DOC)
```

---

## Feature 架构（2026-06-12 重构后）

```
features/
  ├── admin/       管理后台 UI
  ├── dashboard/   首页仪表盘
  ├── dispatch/    派单功能
  ├── knowledge/   知识搜索 + PKM 笔记
  │     ├── ui/    KnowledgeSearchPanel, KnowledgeSearchResults
  │     └── pkm/   PkmBoard
  ├── project/     项目管理 UI
  ├── repo/        Git 仓库 UI
  ├── settings/    设置页面
  ├── task/        任务 UI
  └── ticket/      工单系统
        ├── create/    CreateTicketForm + action
        └── ui/        TicketsList + ticket-detail/{Bug,Design,Program,Ticket}Detail + TicketPushPanel
```

---

## AI 模块结构（2026-07-29 LangGraph 重构后）

```
features/ai/
├── graph/                    # LangGraph 状态机核心
│   ├── agent.ts             # StateGraph 组装 + 路由定义
│   ├── state.ts             # AgentState Annotation 定义
│   ├── types.ts             # PendingHumanAction / DisambiguationCandidate
│   ├── edges/
│   │   └── routing.ts       # 7 个路由函数（routeAfterDetectIntent 等）
│   └── nodes/
│       ├── detect-intent.ts       # 意图检测 + 实体提取
│       ├── search-knowledge.ts    # RAG 向量检索
│       ├── search-structured.ts    # DB 结构化查询
│       ├── decision.ts            # 消歧决策节点
│       ├── human-confirmation.ts  # HIL 确认节点
│       ├── web-search.ts          # 联网搜索
│       └── generate-response.ts    # LLM 生成回答
├── core/
│   ├── queries/             # 查询解析器
│   │   ├── query-parser.ts       # 解析查询类型
│   │   ├── query-ticket.ts       # 工单查询
│   │   ├── query-user.ts         # 用户查询
│   │   ├── query-project.ts      # 项目查询
│   │   ├── query-weekly-report.ts # 周报查询
│   │   ├── query-commit.ts       # 提交查询
│   │   ├── query-note.ts         # 笔记查询
│   │   ├── query-profile.ts      # 画像查询
│   │   └── query-ambiguous.ts    # 歧义处理
│   ├── resolvers/
│   │   └── query-parser.ts       # 查询解析核心
│   │   └── user-resolver.ts     # 用户解析
│   ├── formatters.ts         # 格式化工具
│   └── search-structured-core.ts # 结构化搜索核心
├── search/
│   ├── detector.ts           # 意图检测（shouldUseRag）
│   ├── rag.ts                # RAG 检索
│   └── speculation-cache.ts   # 预缓存
├── tools/
│   ├── index.ts              # 工具配置
│   ├── web-search.ts         # 联网搜索工具
│   ├── search-knowledge.ts   # 知识库搜索工具
│   └── search-structured.ts  # 结构化搜索工具
├── jobs/
│   ├── background-jobs.ts    # 后台任务队列
│   └── profile-cleanup.ts    # 画像清理
├── llm/
│   ├── agnes-provider.ts     # Agnes LLM 提供者
│   └── summarizer.ts         # 对话摘要
├── types/
│   ├── index.ts              # 类型导出
│   ├── modes.ts              # AgentMode 类型
│   ├── structured.ts          # 结构化数据类型
│   └── thinking.ts           # Thinking 类型
└── ui/                       # UI 组件
    ├── AiSourcesList.tsx     # 来源引用组件
    ├── AiMessageBubble.tsx   # 消息气泡
    └── AiChatPanel.tsx       # 聊天面板
```

---

## 下一步操作

### 优先级 1：LangGraph 深入理解 + 测试验证（当前阶段）

- [x] LangGraph StateGraph 状态机编排（2026-07-29）
- [x] HIL 人工介入节点（humanConfirmation，2026-07-29）
- [ ] LangGraph 测试用例执行（测试计划见 `.cursor/plans/langgraph-测试用例_b2c7d3f1.md`）
- [ ] 多轮对话状态累积验证
- [ ] Vercel AI SDK 流式响应框架

### 优先级 2：RAG 调参验证

- [x] Markdown 清洗 + 诊断工具链建成
- [ ] 跑 diagnose baseline 选测试笔记
- [ ] 跑 diagnose measure 取改前分数
- [ ] 调 ranking 权重参数（keyword vs semantic）

---

## 记录

| 日期       | 完成事项                       | 备注                                           |
| ---------- | ------------------------------ | ---------------------------------------------- |
| 2026-06-04 | 评估实际代码                   | 通过 GitHub 仓库确认项目真实完成度             |
| 2026-06-04 | 建立学习路线                   | 三条路线：RAG 落地 + 排错基本功 + 进阶功能     |
| 2026-06-05 | SWR + 通知 + 管理端            | #10045 #10046 #10049                           |
| 2026-06-08 | RAG ③④ 实操                   | BGE-M3 模型部署 + pgvector 安装 + 语义搜索验证 |
| 2026-06-09 | RAG ⑤ 上线 + PKM 上线          | 混合搜索 + 笔记 CRUD，87 条向量化              |
| 2026-06-10 | Bug 单闭环                     | #10039 三单状态逻辑打通                        |
| 2026-06-11 | SWR 全面接入 + 错误处理        | #10049 #10062                                  |
| 2026-06-12 | FSD 架构重构                   | #10069 拆分为 9 个 feature 模块                |
| 2026-06-17 | Bug 单详情页                   | #10068 commit 去重展示 + 推送面板搜索          |
| 2026-06-18 | 搜索优化 + 图片压缩 + 状态同步 | #10043 #10067 #10066                           |
| 2026-06-22 | embedding 清洗 + Bug 单重构    | #10074 #10075                                  |
| 2026-06-23 | DOCX 附件提取 + 管理端职能     | #10076 #10080                                  |
| 2026-06-24 | 访问记录 + 项目文档Tab         | #10082 #10081                                  |
| 2026-06-25 | 访问记录全局整合 + 构建修复    | #10082 #10037                                  |
| 2026-06-26 | PKM 异步索引化 + 访问记录 UI   | #10044 #10082                                  |
| 2026-06-28 | AI Agent 对话系统上线          | #10144                                         |
| 2026-06-29 | PR1 周报系统 + PR2 报表真实化  | 详见 [PR1 周报复现](docs/reports/PR1-weekly-reports.md) / [PR2 报表真实化复现](docs/reports/PR2-stats-and-reports.md) |
| 2026-06-29 | PR3 AI 画像面板（只读）         | 详见 [PR3 AI 画像复现](docs/reports/PR3-ai-profile.md) |
| 2026-06-29 | PR4 周报→画像入队 + 手动触发   | 详见 [PR4 周报 AI 入队复现](docs/reports/PR4-weekly-report-ai-enqueue.md) |
| 2026-07-07 | PR5 周报 AI 画像增强           | 周报摘要作为画像来源 + ProfileAiSummary 重构   |
| 2026-07-09 | Agnes Tool Calling + 响应优化   | #10144 响应速度优化                           |
| 2026-07-09 | 工单截止日期 + 优先级字段      | #10156 + #10146                                |
| 2026-07-09 | 工单备注/讨论面板 + 图片上传   | #10034 + crypto.subtle Bug 修复               |
| 2026-07-09 | 周报本月周报率 Bug 修复        | #10085                                         |
| 2026-07-09 | 管理端删除用户功能             | #10085                                         |
| 2026-07-15 | AI 工具链优化                 | 步数限制 + 预缓存 + 错误处理                   |
| 2026-07-16 | Dashboard 重构                 | 响应式布局 + 数据卡片增强（#10179）           |
| 2026-07-16 | 周报率图表 Bug 修复            | 累积算法修复（#10166）                        |
| 2026-07-16 | 周报周选择器增强               | AI 摘要 XSS 防护（#10166）                    |
| 2026-07-17 | FSD 架构优化                   | UI/Lib 边界重构 + AI 对话 + TaskBoard（#10069）|
| 2026-07-17 | 周报 Markdown UI 优化           | 标题加粗 + 列表序号 + 单换行（#10166）        |
| 2026-07-29 | LangGraph 路由重构             | StateGraph 状态机 + 意图检测增强 + HIL 消歧（#10195）|
| 2026-07-29 | 人员活动归因修复               | 修复 searchStructured 的 TicketCommit 列表加载 |
| 2026-07-29 | 文件处理多 Bug 修复           | 多 chunk OOM + 纯文本解码 + 项目文档 RAG 映射 |

---

## 踩坑记录

### 图片上传 crypto.subtle Bug（2026-07-09）

**问题**：用户通过 HTTP IP 地址访问时，`crypto.subtle` API 不可用导致图片上传崩溃。

**根因**：`crypto.subtle` 只能在安全上下文（https:// 或 localhost）中使用。

**解法**：
- `shared/lib/hash.ts`：添加 `crypto?.subtle` 检查，非安全上下文返回 `null`
- `shared/lib/upload.ts`：只有 `clientHash` 有值时才上传 hint

详见 [debug-log.md](docs/debug-log.md)

### LangGraph 路由文件踩坑（2026-07-29）

**问题**：原始 `routing.ts` 中 auto 模式判断写反了，导致应该走 DB 快查的请求走了 RAG 向量检索。

**根因**：
- `routeAfterSearchKnowledge` 导出了但从未在 `addConditionalEdges` 中使用
- Graph 固定链 `searchKnowledge → searchStructured → generateResponse` 是硬编码的，导致路由函数形同虚设

**解法**：
- 修正 `routeByMode` 对 auto 模式的判断
- auto + 浅层查询（工单号/项目名/统计/vcs）→ searchStructured（DB 快查）
- auto + 深层内容（文档/笔记/详情）→ searchKnowledge（RAG 向量检索）

详见 [docs/ai/PR10144-LangGraph-Routing-Recap.md](docs/ai/PR10144-LangGraph-Routing-Recap.md)
