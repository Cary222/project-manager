# 研究结论：会话级"变更文件侧边栏 + 点击 diff 预览"能力核查

日期：2026-08-25 · 目标：`20260825084407-0hzmjh` Task 1

## 1. 结论（先说答案）

**插件市场没有可直接安装的成熟方案；上游参考源码 agegr/pi-web 具备该能力的"工作区级"版本；
本项目（project-manager）已移植其 UI 层但缺失服务端数据层，导致功能整体失效。
最终路线 = 复用上游源码数据层（git-changes/git-status 移植）+ 在其上实现对话级隔离追踪。**

## 2. pi.dev/packages 搜索证据

- 已抓取 <https://pi.dev/packages> 全量包索引（51 个分段）。
- 与"pi web UI"相关的唯一包：**pi-web-ui**（作者 xing-shuyin，npm: `pi-web-ui`，
  repo github.com/xing-shuyin/pi-web-ui，16.9K/月下载，更新于 15h 前）。
  - 定位：**独立运行的 pi 编码代理 Web 聊天界面**（`npx pi-web-ui` 起服务、Docker/systemd 部署）。
  - 文件相关能力（README Features 实测抓取）：Live file tree（服务器 watch）、File preview
    （行号/选择/GBK/hex/媒体 Range）、附件三模式、图片粘贴。**无"每对话变更文件清单 + diff 预览"
    侧栏的任何描述**；且它是独立替代 UI，无法作为组件嵌入本项目的 AI 工作台标签页。

## 3. 本地 skill 引用源码核查（agegr/pi-web，本地克隆 ~/workstation/pi-web-ref）

README Features 明确包含："Project file tools: browse and upload files, **inspect Git diffs**, …"

源码级证据（本地克隆实测）：

| 能力点 | 文件 | 说明 |
| --- | --- | --- |
| 会话侧栏"N changed files"折叠开关 | `components/SessionSidebar.tsx:1701-1708` | `explorerOpen && changesCount > 0` 时显示 |
| 文件树变更标记（目录含变更文件高亮） | `FileExplorer.tsx` (`containsChangedFiles`) | 文件行 GitStatusBadge 徽标 |
| **服务端数据层** | `lib/git-changes.ts` + `lib/git-status.ts` | `getGitStatus(cwd)`（porcelain v1 + numstat 增删行数）；`getGitFileDiff(cwd, path)`（统一 diff patch，覆盖 added/untracked/deleted/**renamed**(originalPath) 四类） |
| 类型定义 | `lib/git-types.ts` | GitStatusResponse / GitFileDiffResponse |
| diff 渲染 | `lib/patch.ts` + FileViewer | 解析 unified patch 渲染 |
| API 路由 | app/api/git/status、app/api/git/diff | GET ?cwd=&path= |

语义注意：上游是 **Git 工作区级**（当前 cwd 的未提交变更），不是严格按对话隔离——同一 cwd 下
两个并行对话会互相看到对方的文件。

## 4. project-manager 现状与缺陷根因

pm 是 pi-web 的部分移植，UI 层已就位：

- `features/ai/ui/ai-workspace/FileExplorer.tsx`：`fetchGitStatus()` → `/api/git/status`、
  GitStatusBadge 徽标、`onChangesCountChange` 上报计数（:698,:717）
- `SessionSidebar.tsx`：changesCount 开关按钮（:1702-1708，与上游逐行一致）
- `FileViewer.tsx:1081`：`fetchGitDiff()` → `/api/git/diff` 渲染 patch
- `app/api/git/status/route.ts`、`app/api/git/diff/route.ts`：存在，且都
  `import { getGitStatus/getGitFileDiff } from "@/lib/git-changes"`
- 类型：`features/ai/ui/ai-workspace/lib/git-types.ts`、`patch.ts`、`file-viewer-state.ts` 均已移植

**缺陷根因：`@/*` 映射仓库根目录（tsconfig paths），而根目录 `lib/git-changes.ts`
及其依赖 `lib/git-status.ts` 从未被移植 → 两个 API 路由模块解析失败 →
/api/git/status 与 /api/git/diff 全部报错 → 计数恒为 0、无变更列表、点击无 diff。
即用户报告的"文件变动显示还是有功能缺陷"。**

## 5. 候选能力对比

| 候选 | 变更文件列表 | add/mod/del/rename | 点击看 diff | 对话级隔离 | 可嵌入 pm | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| pi.dev/packages `pi-web-ui`（xing-shuyin） | ✗ 无此功能 | ✗ | ✗ | ✗ | ✗ 独立应用 | 不满足 |
| 上游 agegr/pi-web（源码） | ✓ | ✓ | ✓ | ✗ 工作区级 | 已部分嵌入 | 数据层可复用 |
| pm 现状 | UI 就位但数据层缺失 | — | 断链 | ✗ | — | 修复+增强 |

## 6. 最终判定：自行实现（复用上游数据层源码）

1. 市场无可安装成熟插件 → 触发"实现"分支（符合用户预设："如果插件市场有直接告诉我不用改代码"，实际没有）。
2. 用户原始要求"参考本地源码结合实现这个功能"→ 以 `~/workstation/pi-web-ref` 为参考：
   - **第一步（修复断链）**：将上游 `git-changes.ts` + `git-status.ts` 移植到根 `lib/`，
     使既有 API/UI 立即恢复工作区级变更显示与 diff 预览（最小改动、最大收益）。
   - **第二步（对话级隔离）**：在数据层之上增加按会话的事件归因层（turn-written-files 提取 +
     基线快照 + 持久化），满足并行对话不串线、刷新/重启恢复、外部改动/切分支安全降级的合同。
3. 排除项不变：不改 WifiCamera 仓库；不做完整 IDE。

---

# 实现记录（2026-08-26，Task 3–5 完成）

## 架构：重放归因（replay-based attribution）

不维护增量事件流，而是以**服务端持久化的消息流**为唯一事实源：每次消息更新时纯函数
重放全部轮次，提取本对话成功写入过的文件路径。性质：刷新/重启自动恢复（幂等）、
并行会话天然隔离、无事件管道。localStorage 仅作即时恢复缓存，非事实源。

```
ChatWindow (每消息变更)
  └─ extractConversationWrittenFiles(messages, cwd)   ← 纯重放，幂等
       └─ 变更守卫（JSON 比对，流式期间零开销）→ saveConversationPaths(sessionId, paths)
            └─ notify → ConversationChangesPanel 重读 localStorage + refetch /api/git/status
面板行 = buildConversationChangeRows(touchedPaths, gitStatus)  ← 纯合并，绝对↔相对路径映射
点击变更行 → handleOpenFile(displayPath, name, { modeHint: "diff" }) → FileViewer diff 视图
```

## 修改/新增文件清单（本次交付）

| 文件 | 性质 | 内容 |
| --- | --- | --- |
| `features/ai/ui/ai-workspace/lib/conversation-changes.ts` | 新增 | 数据层：重放提取、持久化+订阅通知、`buildConversationChangeRows` 状态合并 |
| `features/ai/ui/ai-workspace/lib/__tests__/conversation-changes.test.ts` | 新增 | 13 个行为测试（归因/隔离/持久化重启/安全降级/add-mod-del-rename） |
| `features/ai/ui/ai-workspace/ConversationChangesPanel.tsx` | 新增 | 右侧折叠面板：徽标、选中态、滚动、空态=隐藏、clean 行安全降级 |
| `features/ai/ui/ai-workspace/ChatWindow.tsx` | 修改（仅 2 处） | import + 重放 effect（含变更守卫防 fetch 风暴）。注：该文件另有约 1400 行存量 prettier 重排，**非本次改动** |
| `features/ai/ui/ai-workspace/AppShell.tsx` | 修改（仅 1 处） | 右面板 TabBar 上方挂载 ConversationChangesPanel |
| `lib/i18n/messages/en.ts` / `zh-CN.ts` | 修改（各 2 键） | `changes.panelTitle`、`changes.resolved` |
| 本文档 | 新增 | 研究结论 + 实现记录 |

未触碰的存量脏文件：`app/api/models/route.ts`、`app/api/sessions/[id]/route.ts`、
`lib/pi-types.ts`、`lib/rpc-manager.ts`、ChatWindow 存量重排、未跟踪目录 `.pi*`/`piolium`/`export/`。

## 验证结果

- vitest 全量：**28 文件 / 238 测试全绿**（含新增 13 个行为测试）
- `tsc --noEmit`：通过；项目 eslint 对全部新文件：0 问题
- ChatWindow/AppShell 的 24 个存量 `react-hooks/*` 错误均为 HEAD 基线已存在的模式
  （逐行核对，无一落在本次插入区间）；未修——超出范围
- 浏览器端到端验证受限：agent-browser 二进制缺失。UI 层以与上游逐行同构的组件结构
  （GitStatusBadge 同款徽标/TurnWrittenFiles 同款行按钮）+ 数据层行为测试替代验证

## 设计取舍（安全降级合同落实情况）

- **外部改动**：会话写过但 git 不再报告的路径显示 "✓ 已解决"（提交/回退/切分支后均正确），
  点击按普通文件打开而非空 diff
- **切分支检测**：显式分支字段不存在（GitStatusResponse 无 branch/HEAD），但 diff 天然相对当前 HEAD
  重算，语义始终一致；显式提示留作后续增强
- **对话中途提交**：早前 diff 会消失（HEAD 前移）——显示为"已解决"，符合语义
- **存量脏文件污染**：若文件在会话开始前已有未提交改动，diff 含先前改动（基线取 HEAD 而非会话起点快照）——
  接受的近似，已在代码注释标注升级路径（写入时快照 baseline content）
- **空态**：0 变更时面板整体隐藏（与上游 changesCount>0 门控同构），不占空间
