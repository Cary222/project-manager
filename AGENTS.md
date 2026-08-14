<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# project-manager Agent 指南（L1 入口）

本地项目管理工具：项目 → 职能（程序/设计）→ 模块 → 单子（#10000+），Git 提交自动关联。

> **📚 文档分层协议**：本仓库 AI 文档分 4 层
>
> | 层 | 文档 | 角色 | AI 何时读 |
> |---|---|---|---|
> | **L1 入口** | 👈 **本文档** | 路由表 / 必读索引 / 关键约束 | 每个会话首读 |
> | **L2 事实层** | [.cursor/skills/pm-dev/PROJECT-HUB.md](.cursor/skills/pm-dev/PROJECT-HUB.md) | "是什么 / 在哪里 / 做了什么" — 唯一真相源 | 遇到具体业务问题时 |
> | **L3 操作层** | `pm-dev/SKILL.md` / `pm-ops/SKILL.md` / `pm-testing/SKILL.md` | "怎么做" — 仅命令/代码片段 | 要执行某操作前 |
> | **L4 长尾** | `docs/**/*.md` | 历史 PR 复现 / Bug 排查 / 学习路线 | 深挖具体场景时 |
>
> **⛔ 协议**：
> - L1 / L3 **不复述** L2 的事实；用 `§ 子节名` 锚点链接
> - 同一事实只更新一次（在 L2）；L1/L3 引用即可
> - AI 阅读顺序建议：先 L1 路由表 → 命中 L2 子节 → 不够再进 L3 / L4
>
> 🚨 **核心必读**：项目档案上下文全在 L2 PROJECT-HUB.md（585 行）。

---

## 🧭 快速定位（按场景，指向 L2 / L3 / L4）

| 需求 | 位置 | 状态 |
|------|------|------|
| 🚨 **远程部署 / 拓扑 / 服务位置** | [.cursor/skills/pm-dev/PROJECT-HUB.md § 🚨 部署拓扑速查](.cursor/skills/pm-dev/PROJECT-HUB.md) | ✅ |
| 🏁 **项目实际完成度 + 当前新增** | [.cursor/skills/pm-dev/PROJECT-HUB.md § 🏁 实际完成度评估](.cursor/skills/pm-dev/PROJECT-HUB.md) | ✅ |
| 🧬 **数据库结构（知识图谱式 13 链）** | [.cursor/skills/pm-dev/PROJECT-HUB.md § 🧬 AI 数据库速览](.cursor/skills/pm-dev/PROJECT-HUB.md) | ✅ |
| 📦 **具体字段 + 关系细节** | [prisma/schema.prisma](prisma/schema.prisma)（1032 行权威） | ✅ |
| 🎫 **工单系统专项架构**（领域模型 / 权限 / 路由）| [docs/ticket-project/ARCHITECTURE.md](docs/ticket-project/ARCHITECTURE.md) | ✅ |
| ⚙️ **运维（部署脚本 / 环境变量 / systemd）** | [docs/deploy/OPERATIONS.md](docs/deploy/OPERATIONS.md) + [.cursor/skills/pm-ops/SKILL.md](.cursor/skills/pm-ops/SKILL.md) | ✅ |
| 🛠️ **开发 skill（约定 / 不要做 / 怎么改）** | [.cursor/skills/pm-dev/SKILL.md](.cursor/skills/pm-dev/SKILL.md) | ✅ |
| 🧪 **测试（Vitest / Playwright / acceptance）** | [.cursor/skills/pm-testing/SKILL.md](.cursor/skills/pm-testing/SKILL.md) + [.cursor/skills/pm-testing/progress.json](.cursor/skills/pm-testing/progress.json) | ✅ |
| 🔍 **Embedding / RAG 向量化原理** | [docs/document/PKM_CHUNKING_IMPL.md](docs/document/PKM_CHUNKING_IMPL.md) + [docs/document/VECTOR_SEARCH_TROUBLESHOOT.md](docs/document/VECTOR_SEARCH_TROUBLESHOOT.md) | ✅ |
| 🤖 **AI Agent（LangGraph / LLM / Model Registry）** | [.cursor/skills/pm-dev/PROJECT-HUB.md § 🤖 AI 模块结构](.cursor/skills/pm-dev/PROJECT-HUB.md) | ✅ |
| 📊 **周报 / 报销 / 项目报表** | [docs/reports/](docs/reports/)（30+ PR 复现文档）| ✅ |
| 🐛 **已知 Bug + 修复方案** | [.cursor/skills/pm-dev/PROJECT-HUB.md § 💣 踩坑记录](.cursor/skills/pm-dev/PROJECT-HUB.md) + [docs/debug-log.md](docs/debug-log.md) | ✅ |

---

## 🚨 关键约束（不要违反）

### 🔧 环境与运行

| 约束 | 含义 |
|------|------|
| 🚪 **端口 3003** | `npm run dev` 和 `npm run start` 都绑 `-H 0.0.0.0 -p 3003`，局域网可访问 |
| 🌐 **远程拓扑** | DB / Embedding / Worker / 生产 Next.js **全在 `192.168.1.14`**，Mac 本地只跑 dev（详见 PROJECT-HUB § 部署拓扑） |
| 🐘 **DB schema** | `pm`（用 `?options=-c search_path=pm,public`），**勿改 community 公共表** |
| 🔐 **NEXTAUTH_URL** | `.env.local` 已设 `http://localhost:3003`（避免 0.0.0.0 用于 redirect），**保留即可**；**不要**设置 `AUTH_URL` |
| 🚫 **不要 schema public** | community 与本项目业务表靠 schema 命名空间隔离 |

### 🔐 权限

| 约束 | 含义 |
|------|------|
| 👤 **注册默认 USER** | 新注册用户 `role = USER`，**不能**自动提权 |
| 👑 **ROOT 手动赋权** | `npm run db:promote -- <邮箱>` 或数据库手动 `role = ROOT` |
| 🚫 **封禁 = bannedAt** | 软封禁，被封禁用户登录直接返回 null；操作记 `ModerationLog` |

### 🎫 工单

| 约束 | 含义 |
|------|------|
| 🛣️ **路由** | 单子详情用 `/tickets/[ticketId]`，**不是** `/[ticketNo]`（旧文档已废） |
| 📝 **状态/指派变更** | 必须写 `TicketStatusHistory` / `TicketAssigneeHistory`（事务内） |
| 🔢 **ticketNo 自增** | `Counter` 表管理，从 #10000 起；upsert 模块避免唯一约束失败 |

### 🔨 开发流程

| 约束 | 含义 |
|------|------|
| 📦 **改完 build 再重启** | 生产模式必须 `npm run build` 后 `systemctl --user restart project-manager.service` |
| 🧪 **提交前** | 跑 `npm run lint` + `npm run test`（Vitest）+ 必要时 `npm run test:e2e` |
| 📝 **git commit** | 强制走 git-commit-assistant skill（用户级，`~/.cursor/skills/git-commit-assistant/SKILL.md`）：必带工单单号 + `Co-authored-by: Cursor`；规则钩子见 [.cursor/rules/git-commit-required.mdc](.cursor/rules/git-commit-required.mdc) |
| 🚫 **不要 commit** | `.env` / `*.key` / `node_modules/` / `.next/` 等含密钥或可再生文件 |
| 🌿 **git push** | 默认推 `origin`（远程裸仓 `/home/hxy/work/personal/project-manager.git`）；**不主动**推 `github` |

---

## 📂 项目结构速查

```
/Users/vastgui/Desktop/project-manager
├─ app/                       # Next.js App Router（页面 + API 路由）
│  ├─ api/auth/[...nextauth]/ # NextAuth v5 入口
│  ├─ tickets/[ticketId]/     # 工单详情页
│  ├─ projects/[projectId]/   # 项目详情（含 documents/[fileAssetId]）
│  └─ admin/users/[userId]/   # 管理端
├─ features/                  # FSD 9 个 feature 模块（详见 PROJECT-HUB § 🧱）
│  ├─ ai/                     # LangGraph + LLM + Jobs + UI 17 组件
│  ├─ ticket/ project/ ...    # 业务模块
├─ worker/                    # 后台 Worker（systemd 托管）
│  ├─ index.ts                # PKM Index Worker
│  └─ background/             # Background Worker（AI 生图/视频/任务）
├─ prisma/schema.prisma       # 数据库 schema（44 个 model + 19 个 enum）
├─ docs/                      # 项目文档（详见下）
│  ├─ ticket-project/         # 工单系统架构 + 状态流转
│  ├─ deploy/                 # 部署脚本 + 运维
│  ├─ document/               # 文档处理 / RAG / Embedding
│  ├─ ai/                     # AI 模块 PR 复现（17 个）
│  ├─ reports/                # 各 PR 复现文档（30+）
│  ├─ reviews/                # Code Review 产物（50+）
│  ├─ debug/                  # Bug 排查日志
│  ├─ migrations/             # 数据迁移文档
│  └─ learning/               # 学习路线（LangGraph / 月度报销）
├─ .cursor/
│  ├─ skills/                 # Cursor skills（pm-dev/pm-ops/pm-testing/pretty-ui/...）
│  └─ plans/                  # 实施方案文档（19 个）
├─ scripts/                   # 运维脚本（acceptance / vector-search / job-admin）
└─ .env / .env.local          # 本地配置（DATABASE_URL 指向远程 DB）
```

---

## 🔗 docs/ 子目录索引

| 子目录 | 内容 | 关键文件 |
|--------|------|---------|
| 📁 `docs/ticket-project/` | 工单系统专项 | `ARCHITECTURE.md`（领域模型/权限/路由） / `BUG_DESIGN_PROGRAM_TICKET_LOOP.md` / `DESIGN_TO_PROGRAM_PUSH_FLOW.md` |
| 📁 `docs/deploy/` | 部署 + 运维 | `OPERATIONS.md` / `DEPLOY_SCRIPT_MANUAL.md` / `README.md` |
| 📁 `docs/document/` | 文档处理 / RAG | `PKM_CHUNKING_IMPL.md` / `VECTOR_SEARCH_TROUBLESHOOT.md` / `ATTACHMENT_TEXT_EXTRACTION.md` / `DOCX_EXTRACT.md` |
| 📁 `docs/ai/` | AI 模块 PR 复现（17 个）| `PR10144-LangGraph-Routing-Recap.md` / `PR10199-ai-model-config-recap.md` / `model-selector-refactor.md` / `ai-tool-optimization-recap.md` |
| 📁 `docs/reports/` | 各 PR 复现文档（30+）| `PR1-weekly-reports.md` ~ `PR11-file-asset-projectid-...` |
| 📁 `docs/reviews/` | Code Review 产物（50+）| 双审查：`<PR>-code-reviewer.md` + `<PR>-ai-mentor.md` + 合并版 |
| 📁 `docs/debug/` | Bug 排查 | `realtime-voice-crash-diagnosis.md` / `voice-input-no-text.md` |
| 📁 `docs/migrations/` | 数据迁移 | `PR10-pkm-base64-to-file-asset.md` / `PR11-FileAsset-RAG-项目归属修复.md` |
| 📁 `docs/learning/` | 学习路线 | `LangGraph-Architecture-Roadmap.md` / `LangGraph-实战学习计划.md` |
| 📁 `docs/features/` | 功能实现 | `video-generation-storage-refactor.md` / `voice-audio-implementation.md` |
| 📁 `docs/ui/` | UI 实现 | `IMAGE_LIGHTBOX_IMPLEMENTATION.md` |
| 📁 `docs/ocr-support-phase1.md` | OCR 阶段 1 | （独立 MD） |

---

## ⚡ AI 协作快记

| 任务 | 第一动作 |
|------|----------|
| 🆕 接到新需求 | 读 PROJECT-HUB.md § 🏁 实际完成度评估 → § 🧬 数据库速览，再判断 |
| 🔧 修改业务代码 | 读 `pm-dev/SKILL.md`（约定 + 不要做）+ `AGENTS.md` § 关键约束 |
| 🚀 部署 / 重启 / 改 env | 读 `pm-ops/SKILL.md` + `docs/deploy/OPERATIONS.md` |
| 🐛 排查 Bug | PROJECT-HUB § 💣 踩坑记录 → `docs/debug-log.md` → `docs/debug/` |
| 🧠 改 AI Agent | `features/ai/` 目录 + PROJECT-HUB § 🤖 AI 模块结构 |
| 🧪 写测试 | `pm-testing/SKILL.md` + 选对应 stage |
| 📤 commit / push | `git-commit-assistant/SKILL.md`（必问工单单号 + `Co-authored-by`） |
| 🏗️ 大重构 / 跨模块 | `.cursor/rules/subagent-coordination-sop.mdc` SOP |

---

## 🧷 元规则

- **AI 进项目第一步**：永远先加载 `.cursor/skills/pm-dev/PROJECT-HUB.md`
- **不要凭训练数据推断**：Next.js 16 / Prisma 6 / LangGraph 1.x 都有 breaking changes
- **不要瞎改 schema**：community 公共表是其他项目共用的
- **不要绕过 git-commit-assistant**：必带单号 + Co-authored-by
- **不要默认推 github**：默认 `origin`（局域网裸仓）