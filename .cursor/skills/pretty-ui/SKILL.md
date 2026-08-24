---
name: pretty-ui
description: >
  ProjectHub 前端 UI 美化与一致性规范。基于 app/globals.css 里已落地的
  brand / ink / success / warning / danger design token 与阴影 / 圆角变量。
  当用户要求"美化"、"改好看"、"统一风格"、"modern UI"、"加间距 / 颜色 /
  圆角"、"做卡片 / 按钮 / 表单 / 弹窗 / 表格"、"为什么页面丑"或任何
  「写一个新页面 / 改一个旧页面」时激活。约束 AI 用统一的 Tailwind v4
  Token 写视觉，避免硬编码颜色和尺寸。
---

# pretty-ui · ProjectHub 前端美化规范

> 基于 `app/globals.css` 的 `@theme` 设计 token（`--color-brand-*`、`--color-ink-*`、
> `--radius-*`、`--shadow-*`）与 `shared/ui/headers/index.tsx` 已存在的复用组件，
> 统一所有新页面与旧页面改造的视觉规则。所有 Tailwind class 名直接使用 token，
> **禁止硬编码颜色值、硬编码 px 阴影、硬编码圆角数**。

---

## 1. 设计原则（每次写页面先过一遍）

1. **简洁留白，少即是多**：每屏只突出 1 个主操作；其他动作进次级按钮或菜单。
2. **复用优先**：返回箭头、页面 header、Splitter、EmptyState、Badge、Avatar 全部走
   `shared/ui/*`，不重新发明。**禁止自己写新的 Back 按钮 / 顶部条**。
3. **视觉层次靠 token，不靠花哨**：阴影 / 圆角 / 间距节奏已经定义好，禁用渐变、
   玻璃、毛玻璃、霓虹等高饱和特效（与 ProjectHub「后台管理」定位冲突）。
4. **状态可读**：加载 / 空态 / 错误 / 成功都必须有视觉，骨架用 `HeaderSkeleton`，
   空态给一句人话 + 一个主操作。
5. **动效短且克制**：统一 `transition-colors duration-200` / `duration-150`，
   入场统一走 `.pm-fade-in`（已在 `globals.css` 里）。
6. **可访问性默认**：`hover` 必有 `focus-visible`；图标按钮必有 `aria-label`；
   颜色不是唯一信息载体（状态色配图标 / 文字）。

---

## 2. Design Token 速查表（直接抄）

### 2.1 颜色 · 永远从这些里选

| 用途 | 类名前缀 | 备注 |
|---|---|---|
| 主色（按钮、链接、激活态） | `brand-600` | hover `brand-700`，active `brand-800` |
| 主色弱化背景（badge、tag） | `brand-50` / `brand-100` | 配 `brand-700` / `brand-800` 文字 |
| 危险 | `bg-red-*` / `text-red-*` | 删除、错误，**不要和 `danger`** 混用 |
| 成功 | `bg-emerald-*` / `text-emerald-*` | 完成、已发布 |
| 警告 | `bg-amber-*` / `text-amber-*` | 待处理、超期临近 |
| 紫色（辅助） | `bg-purple-*` / `text-purple-*` | 仅在 reports / knowledge 强调用 |
| 文本标题 | `text-ink-900` | |
| 文本正文 | `text-ink-700` | |
| 文本辅助 | `text-ink-500` | |
| 文本禁用 / 占位 | `text-ink-400` | |
| 边框默认 | `border-ink-200` | |
| 边框 hover / 强调 | `border-ink-300` | |
| 输入框边框 | `border-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20` | |
| 页面背景 | `bg-ink-100` | 不要用纯白做页面背景 |
| 卡片背景 | `bg-white` | |
| 悬浮背景 | `hover:bg-ink-100` / `hover:bg-brand-50` | |
| 危险文字 | `text-danger` | Token，定义在 `globals.css` |

**禁止**：`bg-[#xxx]`、`text-[#xxx]`、`bg-blue-500`（除非 `shared/ui/repo-style.ts` 已有映射）。
**例外**：状态徽标可以适当用 Tailwind 默认色（emerald/amber/rose/violet）做差异化。

### 2.2 圆角（4 档，够用）

| 场景 | 类名 |
|---|---|
| 极小元素（chip、tag） | `rounded`（4px） |
| 输入框 / 小按钮 | `rounded-md`（8px） |
| 卡片 / 按钮 / 弹窗小元素 | `rounded-lg`（12px） |
| 模态框 / 大容器 | `rounded-xl` 或 `rounded-2xl` |
| 头像 / 圆形按钮 | `rounded-full` |

**禁止**：`rounded-sm`（除非 chip）、`rounded-3xl`、`rounded-[6px]`。

### 2.3 阴影（3 档，对应 token）

| 场景 | 类名 |
|---|---|
| 卡片默认 | `shadow-sm` |
| 卡片 hover / dropdown / popover | `shadow`（即 `--shadow-base`） |
| 模态框 / drawer | `shadow-xl` |
| 描边替代阴影（更克制，推荐） | `border border-ink-200` |

**禁止**：硬编码 `shadow-[0_4px_12px_rgba(...)]`。

### 2.4 间距节奏（4px 网格）

| 用途 | 类名 |
|---|---|
| 组件内紧凑 | `gap-2` / `p-2` |
| 元素间标准 | `gap-3` / `p-3` |
| 卡片内边距 | `p-4 lg:p-6` |
| 区块间留白 | `space-y-6` / `py-8` |
| 页面侧边 | `px-4 sm:px-6 lg:px-8` |

**禁止**：混用 `mt-4 mb-2` 这种不一致的边距，**统一用 `space-y-*` 或 `gap-*`**。

---

## 3. 必须复用的组件（不重新发明）

下面这些组件已在 `shared/ui/` 下存在，AI 写新页面时**必须 import 并使用**，
禁止自己写等价组件。

| 组件 | 路径 | 何时用 |
|---|---|---|
| `BackLink` / `BackPageHeader` / `SimplePageHeader` / `HeaderSkeleton` | `shared/ui/headers/index.tsx` | 任何返回按钮、详情页标题、加载占位 |
| `AppShell` | `shared/ui/AppShell.tsx` | `app/**/page.tsx` 的最外层包装，**不要再写自己的 layout** |
| `SearchInput` | `shared/ui/SearchInput.tsx` | 搜索框 |
| `TaskStatsCards` | `shared/ui/TaskStatsCards.tsx` | 工作台上的指标卡 |
| `ImageLightbox` | `shared/ui/ImageLightbox.tsx` | 图片预览 |
| `AssigneePicker` | `shared/ui/AssigneePicker.tsx` | 单子负责人选择 |
| `Toaster` | `sonner` | 全局提示，已经在 AppShell 挂载 |
| `BackLink` 写法示例 | 见下 | |

```tsx
// 详情页标准 header：用 BackPageHeader，禁止自己拼
import { BackPageHeader } from "@/shared/ui/headers";

<BackPageHeader
  backHref="/projects"
  backLabel="返回项目列表"
  title={project.name}
  subtitle={project.code}
/>
```

```tsx
// 列表页 + 主操作按钮
import { SimplePageHeader } from "@/shared/ui/headers";

<div className="flex items-center justify-between">
  <SimplePageHeader title="项目" subtitle={`共 ${count} 个`} />
  <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700">
    新建项目
  </button>
</div>
```

---

## 4. 常见组件的「标准写法」速查

### 4.1 按钮

```tsx
// Primary
"rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none"

// Secondary（描边）
"rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100"

// Ghost（卡片内、表格行内操作）
"rounded-lg px-3 py-1.5 text-sm text-ink-500 transition hover:bg-ink-100 hover:text-ink-900"

// Danger
"rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-red-700"
```

按钮高度统一 `py-2`（约 36px），不要 32 / 40 混用。

### 4.2 卡片

```tsx
<div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm transition hover:border-ink-300 hover:shadow lg:p-6">
  <h3 className="text-base font-semibold text-ink-900">标题</h3>
  <p className="mt-2 text-sm text-ink-500">描述</p>
</div>
```

### 4.3 输入框

```tsx
<input className="w-full rounded-md border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none" />
```

### 4.4 Badge / Tag

```tsx
// 状态色：背景弱色 + 文字深色
const BADGE = {
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-brand-100 text-brand-800",
  neutral: "bg-ink-100 text-ink-700",
} as const;

<span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${BADGE.success}`}>
  已完成
</span>
```

### 4.5 空态

```tsx
<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white p-12 text-center">
  <div className="rounded-full bg-ink-100 p-3 text-ink-400">
    <IconInbox className="h-6 w-6" />
  </div>
  <h3 className="mt-4 text-sm font-semibold text-ink-900">还没有项目</h3>
  <p className="mt-1 text-sm text-ink-500">创建一个项目开始协作</p>
  <button className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700">
    新建项目
  </button>
</div>
```

### 4.6 加载骨架（与 HeaderSkeleton 配合）

- 表格行：`<div className="h-4 animate-pulse rounded bg-ink-100" />`
- 卡片：`<div className="h-32 animate-pulse rounded-xl bg-ink-100" />`

### 4.7 表格

```tsx
<table className="w-full text-sm">
  <thead className="border-b border-ink-200 bg-ink-100 text-xs uppercase tracking-wide text-ink-500">
    <tr><th className="px-4 py-3 text-left font-medium">名称</th></tr>
  </thead>
  <tbody className="divide-y divide-ink-200">
    <tr className="transition hover:bg-ink-100">
      <td className="px-4 py-3 text-ink-900">项目 A</td>
    </tr>
  </tbody>
</table>
```

### 4.8 Tab / 分段切换

```tsx
<div className="flex gap-1 rounded-lg bg-ink-100 p-1">
  {tabs.map(t => (
    <button key={t.id}
      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
        active === t.id
          ? "bg-white text-ink-900 shadow-sm"
          : "text-ink-500 hover:text-ink-700"
      }`}>
      {t.label}
    </button>
  ))}
</div>
```

---

## 5. 动效与微交互

- **入场**：列表 / 卡片首次渲染加 `pm-fade-in`（类名已存在于 `globals.css`）。
- **状态切换**：所有颜色 / 阴影过渡用 `transition-colors duration-200` 或 `transition-shadow duration-150`。
- **按钮点击**：不需要 `whileTap` scale，色彩变化已足够。
- **拖拽 / 重排序**：用 `@dnd-kit`，不要新引第三方。
- **禁止**：`framer-motion`（除非已有 `features/ai/ui/AiFloatingButton` 那种悬浮按钮），
  不要为了视觉效果引大库。

---

## 6. 响应式断点（Tailwind v4 默认）

| 断点 | 适用 |
|---|---|
| `sm:` (640px) | 表格列隐藏 |
| `md:` (768px) | 两列网格 |
| `lg:` (1024px) | 主内容区，sidebar 已固定 |
| `xl:` (1280px) | 三列网格 |
| `2xl:` (1536px) | 大屏数据表 |

**移动端**：所有页面必须可用，侧边栏用 AppShell 已有 drawer，**不要单独写移动端逻辑**。

---

## 7. 常见反模式（必须避免）

| ❌ 错误 | ✅ 正确 |
|---|---|
| `className="mt-4 mb-2 pl-3 pr-3 pt-2 pb-2"` | `className="space-y-4 p-2"` 或 `p-2 gap-4` |
| `bg-[#2563eb]` | `bg-brand-600` |
| `text-[#666666]` | `text-ink-500` |
| `shadow-[0_4px_12px_rgba(0,0,0,0.05)]` | `shadow` |
| `rounded-[6px]` | `rounded-md` |
| 自己写 `<button onClick={router.back}>` 返回按钮 | `import { BackLink } from "@/shared/ui/headers"` |
| 一行内多个不同圆角（卡片 16、按钮 4、tag 12） | 按 §2.2 选择 |
| 大量 emoji 当装饰（🚀✨🔥） | 用 lucide 风格 icon（`shared/ui/icons.tsx`） |
| `div` 套所有语义（缺 header/main/section） | 用语义化标签 |
| 主操作藏在 kebab 菜单 | 主操作始终是 `bg-brand-600` 实心按钮 |
| `text-white` 当主文本颜色 | `text-ink-900`（页面底色是浅灰，必须深色） |
| hover 没有 transition | 加 `transition-colors duration-200` |

---

## 8. 工作流（AI 接到任务后的步骤）

1. **先扫现状**：用 `Grep` / `Glob` 查这个页面或相邻页面有没有 `BackPageHeader` / `AppShell` /
   已有色值，避免重复造。
2. **复用现有**：能 import 就不重写。
3. **写前过 §1 原则** + **§2 token 速查**。
4. **写组件时对照 §4**，复制标准模板，不发明 className 组合。
5. **写完用 §7 反模式清单扫一遍**。
6. **改旧页面**：保留原功能，**只换 token + 复用组件**，不要趁机重构逻辑。

---

## 9. 校验清单（提交前 self-check）

- [ ] 主操作是 `bg-brand-600` 实心按钮，不是 outline / ghost？
- [ ] 所有文本颜色都来自 `text-ink-*`，没有 `text-white` / `text-[#xxx]`？
- [ ] 圆角在 4 档里？
- [ ] 卡片有 `border border-ink-200 bg-white`，阴影用 token？
- [ ] hover / focus 都有 transition？
- [ ] 返回箭头 / 页面 header / 搜索框都走 `shared/ui/*`？
- [ ] 移动端能看（sidebar 自动收折由 AppShell 处理）？
- [ ] 空态 / 加载态有视觉？
- [ ] 没有 emoji 装饰？
- [ ] 没有引新依赖（framer-motion / clsx 组合库 / icon 库）？

---

## 10. 联动资源

- **设计 token 定义**：`app/globals.css` 的 `@theme { ... }` 块
- **复用组件**：`shared/ui/`（headers、AppShell、icons、SearchInput…）
- **现有页面参考**：
  - 工作台 `app/page.tsx`
  - 项目详情 `features/project/ui/ProjectDetail.tsx`
  - 单子看板 `features/task/TasksBoard.tsx`
  - 报表 dashboard `features/reports/ui/ReportsDashboard.tsx`
- **Figma 设计图**：通过 `user-Figma` MCP 读 `get_design_context` 拉取设计稿，
  把 hex 值换到 `brand-*` / `ink-*` token，而不是直接抄 hex。
- **全局规则**：`~/.cursor/rules/ultimate-frontend-development-guide.mdc`（架构层面）
  与本 skill 是「上层规则 + 本项目 token 落地」的组合。
- **AI 对话 UI 参考**：[`pi-web-ui-reference`](https://github.com/badlogic/pi-mono/tree/main/mariozechner/pi-web-ui)（`~/.cursor/skills/pi-web-ui-reference/SKILL.md`）：
  AI 对话页面改造时，**先读 pi-web-ui-reference 拿布局模式**，再读本 skill 拿颜色/圆角 token。
