# 同步上游 pi-web (v0.8.11 / 28bab3c) 实施计划

## Context (背景与目标)

上游 `pi-web` 进行了重大版本迭代（从 `2a6e537` 到 `v0.8.11` / `28bab3c`），包含 164 个变更文件（+15,528 / -10,477 行代码）。
主要新特性包括：

1. **子代理系统 (Subagents Architecture)**：多代理配置（`AgentsConfig`）、代理会话切换（`AgentSessionPanel`）、工具定义展示（`ToolDefinitionsPanel`）、系统提示词管理（`SystemPromptPanel`）及多层级会话树。
2. **设置体系彻底重构 (Settings Overhaul)**：统一的 `SettingsUi` 与 `SettingsPanel` 导航，样式与全局解耦（`settings.css`）。
3. **性能与安全优化**：
   - 历史长会话祖先链分页（`tail`/`before`，修复卡顿 #509/#555）。
   - 会话生命周期安全关闭（所有 dispose 路径触发 `session_shutdown` #575）。
   - 文件浏览器搜索（`buildSearchTree`）。
   - SVG 防 XSS 注入安全响应头（#520）。
   - 扩展小部件 ANSI 颜色高亮（`AnsiText` + `ansi_up`）。
   - 浏览器 Web Push 推送通知体系（`web-push`）。

本项目（`project-manager`）在前期集成时具备深度定制逻辑（PostgreSQL 数据库存储 API Key、统一模型注册表、NextAuth 会话鉴权、对话改动文件 Diff 面板 `ConversationChangesPanel`、规则配置 `RulesConfig`、上下文窗口智能钳制等）。本计划采用 **方案 A（深度融合策略）**，在全量引入上游能力的同时，严格保留本地业务特化逻辑。

---

## Approach (方案 A 融合策略)

1. **依赖与底层基础库同步**：
   - 安装 `ansi_up` 与 `web-push` / `@types/web-push`，升级 `@earendil-works/pi-*` 核心包至 `0.84.3`。
   - 同步 `lib/` 新增纯算法与工具库（`subagents.ts`, `session-family.ts`, `session-stats.ts`, `search-tree.ts`, `web-push.ts`, `settings-navigation.ts` 等）。
2. **后端 RPC 与 API 路由权限合并**：
   - 合并 `lib/rpc-manager.ts`：融入会话安全关闭与 Subagent 运行时，保留 DB 凭证解析与 `effectiveContextWindow` 上下文窗口限制。
   - 合并 `lib/session-reader.ts`：融入分页与性能优化。
   - 合并/新增 `/api/subagents/*`、`/api/push/*`、`/api/tools/settings` 等路由，全量包装 `requireSession()` 鉴权。
   - 移除已废弃的旧 SSE 路由 `app/api/agent/running/events`。
3. **前端 UI 与设置面板无缝整合**：
   - 引入新组件 `SettingsUi.tsx`, `SettingsPanel.tsx`, `AgentsConfig.tsx`, `ToolDefinitionsPanel.tsx`, `SystemPromptPanel.tsx`, `AgentSessionPanel.tsx`, `ModelSelector.tsx`, `ProviderIcon.tsx`, `AnsiText.tsx`。
   - 在 `AppShell.tsx` 中保留 `ConversationChangesPanel` 与 `RulesConfig`，并将它们作为侧边与设置栏的专属板块。
   - 引入 `features/ai/ui/ai-workspace/styles/settings.css`，在 `app/ai-workspace/layout.tsx` 中引入，保证全局样式零污染。
4. **模型配置与注册表桥接**：
   - 保留 `lib/unified-model-registry.ts` 与 PostgreSQL `userApiKey` 持久化，前端设置页模型列表与切换器直接与本地统一模型注册表通信。

---

## Files to modify & New files (变更文件清单)

### 1. 依赖与配置

- `package.json`（新增 `ansi_up`, `web-push`, 升级 `pi-*`）

### 2. 共享与核心库 (`lib/` 及 `features/ai/ui/ai-workspace/lib/`)

- **新增文件**：
  - `lib/subagents.ts`, `lib/subagent-runtime.ts`, `lib/subagent-extension.ts`, `lib/subagent-input.ts`, `lib/subagent-prompt.ts`, `lib/subagent-settings.ts`, `lib/subagent-profile-precedence.ts`
  - `lib/session-family.ts`, `lib/session-stats.ts`, `lib/session-tree.ts`, `lib/session-tool-selection.ts`
  - `lib/search-tree.ts`, `lib/settings-navigation.ts`, `lib/skill-frontmatter.ts`
  - `lib/web-push.ts`, `lib/push-client.ts`, `lib/chat-only.ts`, `lib/powershell-settings.ts`, `lib/tool-result-images.ts`
  - `lib/i18n/messages/zh-TW.ts`
- **修改合并**：
  - `lib/rpc-manager.ts`（合并上游 shutdown/subagent/push，保留 DB Key/contextWindow 钳制）
  - `lib/session-reader.ts`（合并上游分页/stats/worktree）
  - `lib/api-types.ts`, `lib/pi-types.ts`, `lib/types.ts`
  - `lib/i18n/messages/en.ts`, `lib/i18n/messages/zh-CN.ts`

### 3. 后端 API 路由 (`app/api/`)

- **新增路由**：
  - `app/api/subagents/[id]/route.ts`, `app/api/subagents/profiles/route.ts`, `app/api/subagents/settings/route.ts`
  - `app/api/push/config/route.ts`, `app/api/push/subscribe/route.ts`
  - `app/api/tools/settings/route.ts`
  - `app/api/sessions/[id]/entries/[entryId]/tool-result-image/route.ts`
- **修改路由（均保留 `requireSession`）**：
  - `app/api/sessions/[id]/context/route.ts`（支持 `tail`/`before`）
  - `app/api/sessions/[id]/route.ts`（支持 `computeSessionStats` & projectInfo）
  - `app/api/sessions/route.ts`
  - `app/api/agent/running/route.ts`
  - `app/api/app-update/route.ts`
  - `app/api/skills/route.ts`
  - `app/api/files/[...path]/route.ts`（SVG 安全补丁）
- **删除废弃**：
  - `app/api/agent/running/events/route.ts`
  - `app/api/auth/all-providers/route.ts`

### 4. 前端组件与样式 (`features/ai/ui/ai-workspace/` & `app/ai-workspace/`)

- **新增组件/资源**：
  - `features/ai/ui/ai-workspace/SettingsUi.tsx`, `SettingsPanel.tsx`
  - `features/ai/ui/ai-workspace/AgentsConfig.tsx`, `AgentSessionPanel.tsx`, `ToolDefinitionsPanel.tsx`, `SystemPromptPanel.tsx`
  - `features/ai/ui/ai-workspace/ModelSelector.tsx`, `ProviderIcon.tsx`, `AnsiText.tsx`
  - `features/ai/ui/ai-workspace/styles/settings.css`
  - `public/provider-icons.svg`
- **修改组件（保留 PM 定制）**：
  - `AppShell.tsx`（集成新 SettingsPanel、Subagent 切换，保留 `ConversationChangesPanel` 与 `RulesConfig`）
  - `SessionSidebar.tsx`（集成子代理会话树与文件搜索 `buildSearchTree`）
  - `ChatWindow.tsx`, `ChatInput.tsx`, `MessageView.tsx`（支持子代理调用详情、模型选择器、Ansi 文本渲染）
  - `FileExplorer.tsx`, `FileViewer.tsx`, `DirectoryPicker.tsx`
  - `hooks/useAgentSession.ts`, `hooks/useI18n.tsx`
  - `app/ai-workspace/layout.tsx`（引入 `settings.css`）

---

## Reuse (复用与特化保留)

- **鉴权体系**：复用 `@/shared/lib/permissions` 的 `requireSession()`，保持与本项目 User/Admin 权限系统一致。
- **凭证存储**：复用 `@/lib/user-api-keys` 与 `prisma.userApiKey`，多租户 API Key 隔离。
- **模型注册表**：复用 `@/lib/unified-model-registry.ts` 与模型管理中心。
- **会话改动审查**：复用 `features/ai/ui/ai-workspace/ConversationChangesPanel.tsx`。
- **规则配置**：复用 `features/ai/ui/ai-workspace/RulesConfig.tsx`。
- **智能窗口钳制**：复用 `rpc-manager.ts` 中的 `effectiveContextWindow` 计算逻辑。

---

## Steps (实施步骤清单)

- [x] **Step 1: 依赖安装与公共静态资源同步**
  - [x] 在 `package.json` 中加入 `ansi_up` (^6.0.6), `web-push` (^3.6.7), `@types/web-push` (^3.6.4)，并将 `@earendil-works/pi-*` 升级至 `0.84.3`。
  - [x] 复制 `public/provider-icons.svg`。
  - [x] 复制 `features/ai/ui/ai-workspace/styles/settings.css` 并在 `app/ai-workspace/client.tsx` 中按需引入。

- [x] **Step 2: 核心库与工具函数同步 (`lib/`)**
  - [x] 复制并适配 Subagents 算法库（`subagents.ts`, `subagent-runtime.ts`, `subagent-extension.ts`, `subagent-input.ts`, `subagent-prompt.ts`, `subagent-settings.ts`, `subagent-profile-precedence.ts`）。
  - [x] 复制并适配 Session 扩展库（`session-family.ts`, `session-stats.ts`, `session-tree.ts`, `session-tool-selection.ts`, `chat-only.ts`, `search-tree.ts`, `settings-navigation.ts`, `skill-frontmatter.ts`, `web-push.ts`, `push-client.ts`, `tool-result-images.ts`）。
  - [x] 合并 `lib/types.ts`, `lib/pi-types.ts`, `lib/api-types.ts`。
  - [x] 合并多语言文件 `lib/i18n/messages/en.ts`, `zh-CN.ts`, `zh-TW.ts`。

- [x] **Step 3: 后端 RPC 与 API 路由合并与鉴权封装**
  - [x] 合并 `lib/rpc-manager.ts`：注入子代理运行时、会话安全 dispose 生命周期、Web Push 触发，保留 DB Key 解析与 `effectiveContextWindow`。
  - [x] 合并 `lib/session-reader.ts`：增加分页、会话统计与项目元数据。
  - [x] 新增 `/api/subagents/*`、`/api/push/*`、`/api/tools/settings` 路由并添加 `requireSession()`。
  - [x] 升级现有 `/api/sessions/[id]/context`（支持 `tail`/`before` 分页）及 `/api/files/[...path]`（SVG 防 XSS）。
  - [x] 删除废弃路由 `app/api/agent/running/events` 与 `app/api/auth/all-providers`。

- [x] **Step 4: 前端 Workspace 组件与全新设置面板接入**
  - [x] 添加全新 UI 组件：`SettingsUi.tsx`, `SettingsPanel.tsx`, `AgentsConfig.tsx`, `AgentSessionPanel.tsx`, `ToolDefinitionsPanel.tsx`, `SystemPromptPanel.tsx`, `ModelSelector.tsx`, `ProviderIcon.tsx`, `AnsiText.tsx`。
  - [x] 重构 `AppShell.tsx`：挂载全新 `SettingsPanel`，保留 `ConversationChangesPanel` 与 `RulesConfig` 入口。
  - [x] 升级 `SessionSidebar.tsx`（支持子代理多会话家族和文件树过滤）、`ChatWindow.tsx`、`ChatInput.tsx`、`MessageView.tsx`、`FileExplorer.tsx`。
  - [x] 升级 `hooks/useAgentSession.ts` 与 `hooks/useI18n.tsx`。

- [x] **Step 5: 验证与排错**
  - [x] 运行 TypeScript 类型检查与 `npm run lint`。
  - [x] 运行单元测试 `npm run test`。
  - [x] 确认 Next.js 页面编译通过，AI 工作台各功能正常运行。
---

## Verification (验证方案)

1. **类型与代码规范检查**：
   - 运行 `npx tsc --noEmit`，确保无类型错误。
   - 运行 `npm run lint`，确保代码风格与无未使用的依赖错误。
2. **单元测试集验证**：
   - 运行 `npm run test`（包括新增的 `search-tree.test.mjs`, `session-family.test.mjs`, `subagent-*.test.mjs` 等）。
3. **工作台全流程功能验收**：
   - **基础会话**：新建会话、发送消息、工具调用（Bash/Read/Write/Grep）流式输出。
   - **子代理与会话树**：触发子代理，检查 `AgentSessionPanel` 会话分支切换是否流畅。
   - **设置面板**：打开 Settings，验证 Models、System、Tools、Subagents、Skills、Plugins 六大 Tab 切换无误。
   - **本地定制功能**：验证 `ConversationChangesPanel` 正常识别会话改动文件并展示 Diff 预览，验证数据库 API Key 正常注入。
   - **文件查看与搜索**：侧边栏 Explorer 搜索过滤文件，打开各类型文件（Markdown/代码/图片/DOCX）。
