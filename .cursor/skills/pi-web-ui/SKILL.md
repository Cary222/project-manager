# pi-web-ui Reference Skill

> AI 对话 Tab UI 重构的设计参考库
> 来源: [github.com/agegr/pi-web](https://github.com/agegr/pi-web)
> 本地克隆: `~/workstation/pi-web-ref/`

## 触发词（自动加载）

- 重构 AI 助手 / AI 助手 tab / 改 chat UI / 加 artifact 面板
- 美化 AI 助手 / 改 chat 流式 UI
- artifact / ChatPanel / 双面板布局
- 参考 pi-web 的 UI 实现

---

## 源码结构速查

```
~/workstation/pi-web-ref/
├── components/              # React UI 组件
│   ├── AppShell.tsx         # 主应用壳，布局容器
│   ├── ChatWindow.tsx       # 聊天消息窗口
│   ├── ChatInput.tsx        # 输入框，支持 thinking 菜单
│   ├── ChatMinimap.tsx      # 消息缩略导航
│   ├── SessionSidebar.tsx   # 会话列表侧边栏
│   ├── FileExplorer.tsx     # 文件浏览器
│   ├── FileViewer.tsx       # 文件预览器
│   ├── MessageView.tsx      # 单条消息渲染
│   ├── MarkdownBody.tsx     # Markdown 渲染
│   ├── MermaidBlock.tsx     # Mermaid 图表渲染
│   ├── ImagePreview.tsx     # 图片预览
│   ├── TabBar.tsx           # 文件 Tab 栏
│   ├── BranchNavigator.tsx  # Git 分支导航
│   ├── ExtensionStatusBar.tsx  # 扩展状态栏
│   ├── ExtensionWidgets.tsx    # 扩展小部件
│   ├── ModelsConfig.tsx     # 模型配置面板
│   ├── PluginsConfig.tsx    # 插件配置面板
│   ├── SkillsConfig.tsx     # Skills 配置面板
│   ├── ProjectTrustDialog.tsx  # 项目信任对话框
│   ├── TurnWrittenFiles.tsx # 本轮写入文件列表
│   └── ...
├── hooks/                   # React Hooks
│   ├── useAgentSession.ts   # Agent 会话管理
│   ├── useAudio.ts          # 音频播放
│   ├── useDragDrop.ts       # 拖拽上传
│   ├── useI18n.tsx          # 国际化
│   ├── useIsMobile.ts       # 移动端检测
│   ├── useKeyboardShortcuts.ts  # 快捷键
│   ├── useResizablePanel.ts # 可调整面板
│   ├── useTheme.ts          # 主题切换
│   └── useViewportHeight.ts # 视口高度
├── lib/                     # 工具库
│   ├── agent-client.ts      # Agent API 客户端
│   ├── markdown.ts          # Markdown 处理
│   ├── file-paths.ts        # 文件路径处理
│   └── ...
└── app/                     # Next.js App Router
    └── api/                  # API 路由
```

---

## 核心 UI 组件示例

### 1. AppShell — 主布局容器

**路径**: `~/workstation/pi-web-ref/components/AppShell.tsx`

```tsx
// AppShell.tsx 核心布局结构
// - 左侧: SessionSidebar (可折叠)
// - 右侧: 主内容区
//   - 顶部: BranchNavigator + ExtensionStatusBar
//   - 中部: ChatWindow (flex-1)
//   - 底部: ChatInput
```

### 2. ChatWindow — 聊天消息窗口

**路径**: `~/workstation/pi-web-ref/components/ChatWindow.tsx`

```tsx
// ChatWindow.tsx 核心结构
// - 消息列表渲染 (MessageView)
// - 流式消息处理
// - 快捷操作菜单
```

### 3. ChatInput — 输入框组件

**路径**: `~/workstation/pi-web-ref/components/ChatInput.tsx`

```tsx
// ChatInput.tsx 核心功能
// - 文本输入 (支持多行)
// - Thinking 模式切换菜单
// - 文件拖拽上传
// - 快捷键发送 (Cmd/Ctrl + Enter)
```

### 4. SessionSidebar — 会话侧边栏

**路径**: `~/workstation/pi-web-ref/components/SessionSidebar.tsx`

```tsx
// SessionSidebar.tsx 核心功能
// - 按项目分组显示会话
// - 新建/删除/重命名会话
// - Git Worktree 切换
```

---

## 样式设计 Token

```css
/* Tailwind 主题配置参考 */
--color-brand: hsl(262 83% 58%);      /* 品牌色 */
--color-muted: hsl(220 14% 96%);      /* 背景色 */
--color-muted-foreground: hsl(220 9% 46%);  /* 次要文字 */
--radius: 0.5rem;                      /* 圆角 */
--shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1);  /* 阴影 */
```

---

## 与 project-manager 的关系

- **解耦原则**: UI 改动不破坏 work agent 现有功能
- **通信方式**: 通过 `/api/ai/work/run` SSE 接口通信
- **参考策略**: 按需引用具体组件实现，不要全盘复制

---

## 使用建议

### 触发时机与加载顺序

| 用户需求 | 必读 Skills | 加载顺序 |
|---------|------------|---------|
| 重构 AI 助手 tab | `pi-web-ui` → `pretty-ui` → `llm-streaming-response-handler` | 1→2→3 |
| 加 artifact 面板 | `pi-web-ui` | 1 |
| 美化 AI 助手 | `pi-web-ui` + `pretty-ui` | 1→2 |
| 改 chat 流式 UI | `pi-web-ui` + `llm-streaming-response-handler` | 1→2 |

### 调用流程（示例）

```
用户: "参考 pi-web 重构 AI 助手 Tab"
  → 读 pi-web-ui → 理解 components/ 目录结构
  → 按需读具体组件源码 (ChatWindow.tsx 等)
  → 读 pretty-ui → 拿颜色/圆角 token
  → 读 llm-streaming-response-handler → 拿 SSE 流式实现
  → 落地到 features/ai/ui/ai-workspace/
```
