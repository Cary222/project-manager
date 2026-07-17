# 周报 Markdown 渲染 UI 优化（PR #10166）

> 适用：project-manager 仓库（Next.js + Tailwind v4 + React）
> 目标：让未来的我 / 团队成员拿到这份文档 + 仓库 commit 后，能完整复现周报详情页 Markdown 渲染的完整改造过程。
> 关联工单：#10166

---

## 1. 目标 & 背景

### 1.1 旧版的问题

| 场景 | 旧实现 | 表现 |
|---|---|---|
| 周报正文展示 | `<pre className="whitespace-pre-wrap">` | Markdown 源码原样输出：`## 标题`、`- 列表`、`**粗体**` 全部以纯文本显示 |
| AI 总结展示 | `escapeAiSummary()` → `dangerouslySetInnerHTML` | 仅支持 `**粗体**` 和 `*斜体*`，不支持 `# 标题` / 列表序号 / 引用 / 代码块 |
| 标题样式 | 无任何 className | `## 标题` 文字无加粗、无字号区分（Tailwind preflight 重置了 h1-h6 的样式） |
| 列表序号 | 无 list-style 样式 | `1. 有序列表` 前序号不显示（Tailwind preflight 把 `list-style: none`） |
| 草稿预览 | 同 AI 总结 | 同上简陋渲染 |
| 单换行 | Markdown 默认行为 | `\n` 被折叠为空格，手动输入的单换行"消失" |

### 1.2 结论

- 周报正文 + AI 总结 + 草稿预览三个位置统一改为复用 `shared/ui/MarkdownContent` 组件，该组件基于 `react-markdown` + `remark-gfm` + `remark-breaks`
- 补全 `MarkdownContent` 内层 div 的所有 Markdown 元素样式（标题、列表、引用、代码、表格等），与项目 `brand-*` / `ink-*` 设计 token 对齐
- `remark-breaks` 插件使单换行 `\n` 渲染为 `<br>`，兼容 AI 批量生成（`\n\n` 空行段落）和用户手写（`\n` 单换行）

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|---|---|---|
| `shared/ui/MarkdownContent.tsx` | 修改 | 补全所有 Markdown 元素（h1-h6 / ul / ol / li / blockquote / code / pre / table / img / a）Tailwind 样式；追加 `remarkBreaks` 插件支持单换行 |
| `app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx` | 修改 | 周报正文 `<pre>` → `<MarkdownContent collapsible>`；AI 总结 `escapeAiSummary` → `<MarkdownContent>` |
| `features/reports/weekly-reports/ui/WeeklyDraftPanel.tsx` | 修改 | 草稿预览 `escapeAiSummary` → `<MarkdownContent>` |
| `package.json` | 修改 | 新增 `remark-breaks: ^4.0.0` 依赖 |
| `package-lock.json` | 修改 | 自动更新 |

---

## 3. 核心实现

### 3.1 MarkdownContent 样式补全（`shared/ui/MarkdownContent.tsx`）

```7:9:shared/ui/MarkdownContent.tsx
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
```

```156:154:shared/ui/MarkdownContent.tsx
<div className="min-w-0 break-words text-sm leading-6 text-ink-700
  [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-ink-900
  [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900
  [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-ink-900
  [&_h4]:mt-4 [&_h4]:mb-1.5 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-ink-900
  [&_h5]:mt-3 [&_h5]:mb-1.5 [&_h5]:text-sm [&_h5]:font-semibold [&_h5]:text-ink-900
  [&_h6]:mt-3 [&_h6]:mb-1.5 [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-ink-700
  [&_p]:my-3 [&_p]:first:mt-0 [&_p]:last:mb-0
  [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1
  [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1
  [&_li]:my-1 [&_li]:leading-6
  [&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-ink-300 [&_blockquote]:bg-ink-100 [&_blockquote]:px-3 [&_blockquote]:py-2 [&_blockquote]:text-ink-700
  [&_strong]:font-semibold [&_strong]:text-ink-900
  [&_em]:italic
  [&_del]:text-ink-400 [&_del]:line-through
  [&_hr]:my-5 [&_hr]:border-ink-200
  [&_code]:rounded [&_code]:bg-ink-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-ink-900
  [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-ink-200 [&_pre]:bg-ink-100 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:leading-5
  [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-ink-900
  [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:rounded-lg [&_table]:border [&_table]:border-ink-200
  [&_th]:border [&_th]:border-ink-200 [&_th]:bg-ink-100 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-ink-900
  [&_td]:border [&_td]:border-ink-200 [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top [&_td]:text-ink-700
  [&_img]:my-3 [&_img]:max-h-[520px] [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-ink-200 [&_img]:object-contain
  [&_a]:text-brand-600 [&_a]:underline [&_a]:decoration-dotted [&_a]:underline-offset-2 [&_a]:hover:text-brand-700">
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkBreaks]}
```

**为什么这样写**：Tailwind v4 的 `@tailwindcss/preflight` 会重置所有元素的默认样式（`h1-h6` 字号/加粗被清、`list-style` 被关），`react-markdown` 只生成 HTML 结构不生成样式，必须显式通过 `[&_tag]:` arbitrary variants 补全。

### 3.2 周报详情页接入（`WeeklyReportDetailClient.tsx`）

```76:81:app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx
      ) : aiSummary ? (
        <MarkdownContent content={aiSummary} />
      ) : null}
    </div>
  );
}

function AiSummaryPanel
```

```213:216:app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx
          {/* Content */}
          <div className="mb-6 rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
            <MarkdownContent content={report.content} collapsible collapsedHeight={480} />
          </div>
```

**为什么这样写**：正文加了 `collapsible` + `collapsedHeight={480}` 实现自动折叠（超过 480px 底部显示"展开正文"按钮），统一包裹在白色卡片边框内；AI 总结直接渲染。

### 3.3 草稿预览接入（`WeeklyDraftPanel.tsx`）

```1:3:features/reports/weekly-reports/ui/WeeklyDraftPanel.tsx
import { useState } from "react";
import { MarkdownContent } from "@/shared/ui/MarkdownContent";
```

```248:250:features/reports/weekly-reports/ui/WeeklyDraftPanel.tsx
                  <div className="rounded-xl border border-ink-200 bg-white p-4">
                    <MarkdownContent content={draft.rawMarkdown} />
                  </div>
```

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|---|---|---|
| `remark-breaks` | `^4.0.0` | 新增依赖，单换行 → `<br>` |
| `react-markdown` | `^10.1.0` | 已有，Markdown 渲染核心 |
| `remark-gfm` | `^4.0.1` | 已有，GFM 扩展（表格、任务列表等） |
| 端口 | 3003 | Next.js 开发/生产端口 |
| `AUTH_URL` / `NEXTAUTH_URL` | 不设置 | 局域网访问模式 |

---

## 5. 启动 / 部署

```bash
# 1. 安装新依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 启动开发服务器（如已在运行会自动热重载）
npm run dev

# 3. 确认服务存活
curl -s http://localhost:3003 | head -c 100
```

> 如果是生产模式：先 `npm run build` 再重启服务。改动涉及 `package.json`（新增依赖）和 `shared/ui/MarkdownContent.tsx`，构建时必须重新编译。

---

## 6. 测试 & 验证

### 6.1 浏览器手测清单

**周报正文渲染测试**

打开或创建一份周报，在正文中输入以下内容并保存：

```
## 本周完成内容

完成了用户认证模块的重构。

1. 实现 JWT 过期自动刷新
2. 修复了登录页面的 XSS 漏洞
3. 优化了数据库查询性能

### 技术细节

- 使用 `jsonwebtoken` 库处理 token
- 新增 `middleware.ts` 做 token 校验

> 备注：此功能已在测试环境验证通过。

下周计划：

- [ ] 编写单元测试
- [ ] 更新 API 文档
```

**期望看到**：
- `## 本周完成内容` → 加粗 + `text-lg` 字号，`text-ink-900`
- `### 技术细节` → 加粗 + `text-base` 字号
- `1.` 有序列表 → 显示 "1." "2." "3." 序号
- `-` 无序列表 → 显示实心圆点
- `>` 引用 → 左边框 + 浅灰背景
- `` `jsonwebtoken` `` → 背景灰底 + 等宽字体
- `- [ ]` 任务列表 → GFM 渲染为 checkbox
- `下周计划：` 后紧跟单换行 → 渲染为两行（不是一行）

**AI 总结渲染测试**

1. 新建或编辑周报 → 填写标题 + 周范围 → 点击"AI 总结"按钮
2. 等待 AI 生成完成后，在右侧草稿面板查看预览
3. 插入到正文 → 查看详情页 AI 总结区域

**期望看到**：AI 总结中的 `## / ###` 标题有样式，`1.` / `-` 列表有序号和圆点，`**粗体**` 加粗。

**草稿预览测试**

1. 在周报表单填写周范围
2. 点击"AI 总结"
3. 右侧草稿面板"预览"区域应展示与详情页一致的 markdown 渲染效果

### 6.2 TypeScript 编译验证

```bash
cd /Users/vastgui/Desktop/project-manager
npx tsc --noEmit
```

**期望输出**：Exit code 0（本次改动文件无类型错误）

---

## 7. 复现 Checklist

- [ ] `npm install` 确认 `remark-breaks ^4.0.0` 已安装
- [ ] `npm run build` 确认构建成功（无 import 错误）
- [ ] 打开周报列表页 `/reports/weekly-reports`
- [ ] 新建一份周报，填写标题 + 周范围 + 正文（包含 `##`、`1.`、`-`、`**`、`>` 等 markdown 语法）
- [ ] 保存后查看详情页，确认标题加粗、列表有序号、引用有边框
- [ ] 在正文中输入单换行（无空行），确认换行生效（不是折叠为空格）
- [ ] 点击"AI 总结"按钮，等待生成完成
- [ ] 查看 AI 总结区域，确认 markdown 元素样式正确
- [ ] 查看草稿面板预览区域，确认样式一致
- [ ] `npx tsc --noEmit` 确认类型正确

---

## 8. 踩坑记录

### 坑 1：标题和列表序号不显示

**现象**：改造完成后，`## 标题` 文字没有加粗，`1. 有序列表` 没有序号显示。

**原因**：Tailwind v4 的 `@tailwindcss/preflight` 会重置 HTML 元素的默认样式：
- `h1-h6` → `font-size: inherit; font-weight: inherit`（所有标题失去字号和加粗）
- `ul / ol` → `list-style: none`（列表失去序号和圆点）

原 `MarkdownContent` 组件内层 div 只有 `space-y-3` + 少量 `[&_img]:` / `[&_pre]:` / `[&_table]:` 选择器，漏掉了 h1-h6 / ul / ol / li / blockquote / code / strong 等所有其他元素。

**解法**：给内层 div 补全所有 `[&_tag]:` Tailwind arbitrary variants 样式。

```tsx
[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-900
[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6
[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6
[&_strong]:font-semibold [&_strong]:text-ink-900
```

---

## 关联文档

- [周报功能架构](../ARCHITECTURE.md#周报模块)
- [项目 UI 美化规范](../../.cursor/skills/pretty-ui/SKILL.md)

## 更新日志

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-07-17 | v1.0 | 初始版本：周报 Markdown UI 优化，remarkBreaks 单换行支持 |
