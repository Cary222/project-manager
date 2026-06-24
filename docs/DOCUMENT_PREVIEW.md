# 文档附件预览 功能开发到测试复现手册

> 适用：`project-manager` 仓库（Next.js App Router + TypeScript + Prisma + Tailwind）
>
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"PKM 笔记附件上传与预览"功能的端到端过程。
>
> 背景：本功能于 2026-06-24 交付，包含 PDF 预览、Word (.docx) 预览、图片预览三个入口，统一由 `DocumentPreviewModal` 提供内嵌预览，辅以附件上传组件 `FileUploader`。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- PKM 笔记只能纯文本，无法附加任何文件（PDF / Word / 图片）
- 附件上传没有前端 UI，用户不知道如何上传
- 预览需要下载到本地才能查看，体验割裂

### 1.2 结论

- 新增 `FileUploader`（上传入口）和 `AttachmentItem`（附件列表展示）两个可复用组件
- 新增 `DocumentPreviewModal`，支持 PDF（react-pdf）、Word（mammoth）、图片三类文件的内嵌预览
- 附件以 data URL（base64）形式通过 PKM 笔记 API 存储（单文件 ≤ 10 MB，最多 8 个附件）
- Docx 预览从 `mammoth.extractRawText` 升级为 `mammoth.convertToHtml`，保留表格结构和基本格式

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `shared/ui/DocumentPreviewModal.tsx` | **新增** | 文档预览弹窗，支持 PDF / docx / 图片三种格式内嵌预览 |
| `shared/ui/FileUploader.tsx` | **新增** | 通用文件上传按钮，含 loading 状态和成功/失败 toast |
| `shared/ui/AttachmentItem.tsx` | **新增** | 单个附件行，展示文件名、类型 badge、大小；提供"预览"和"下载"按钮 |
| `shared/ui/NoteAttachments.tsx` | **新增** | 附件列表容器，组合 `AttachmentItem` + `DocumentPreviewModal` |
| `shared/lib/upload.ts` | **新增** | `fileToDataUrl`（File → base64）和 `uploadAttachmentAsNote`（上传为 PKM 笔记）两个工具函数 |
| `types/mammoth.d.ts` | **新增** | `mammoth/mammoth.browser` 的 TypeScript 类型声明 |
| `app/globals.css` | **修改** | 新增 `.docx-preview` 样式表，为 mammoth 输出的 HTML 补上表格边框、标题等视觉样式 |
| `public/pdf.worker.min.mjs` | **新增** | pdf.js 1 MB worker 文件，从 `react-pdf` 包的 `legacy` 构建复制而来 |
| `next.config.ts` | **修改** | `serverActions.bodySizeLimit` 从默认 1MB 扩到 10MB，支撑 base64 附件 POST |
| `package.json` / `package-lock.json` | **修改** | 新增 `mammoth@^1.12.0` 和 `react-pdf@^10.4.1` 两个依赖 |
| `shared/lib/pkm.ts` | **已存在** | 附件类型 `PkmAttachment`、去重/大小校验逻辑、data URL 图片提取 |
| `app/api/pkm/notes/route.ts` | **已存在** | 已支持 `attachments` 字段写入 PKM 笔记 |
| `app/pkm/notes/[id]/page.tsx` | **已存在** | 笔记详情页已集成 `<NoteAttachments />` |
| `features/project/ui/ProjectDetail.tsx` | **已存在** | 项目详情页已集成文件上传入口 |

---

## 3. 核心实现

### 3.1 `shared/ui/DocumentPreviewModal.tsx`

预览弹窗核心逻辑。根据 `mimeType` 分三路：

```1:60:shared/ui/DocumentPreviewModal.tsx
const isPdf = file.mimeType === "application/pdf";
const isDocx =
  file.mimeType ===
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const isImage = file.mimeType.startsWith("image/");
```

**PDF 分支**：动态导入 `react-pdf`，worker 指向 `public/pdf.worker.min.mjs`（规避 webpack 5 + eval-source-map 与 pdfjs-dist ESM 不兼容问题，参考 [pdf.js#20478](https://github.com/mozilla/pdf.js/issues/20478)）。分两阶段加载：外层 `useEffect` 先设 `pdfUrl`，内层 `PdfViewer` 组件再动态 import `Document` 和 `Page`。

**DOCX 分支**：用 `mammoth/mammoth.browser`（浏览器专用入口，绕过 Node.js 依赖）：

```82:155:shared/ui/DocumentPreviewModal.tsx
if (isDocx) {
  fetch(file.url)
    .then((r) => r.arrayBuffer())
    .then((buf) =>
      import("mammoth/mammoth.browser").then((mod) => {
        const convertToHtml = mod.convertToHtml ?? mod.default?.convertToHtml;
        convertToHtml({ arrayBuffer: buf })
          .then(({ value, messages }) => {
            setContent(
              <div
                className="docx-preview max-h-[70vh] overflow-auto rounded-lg border border-ink-200 bg-white p-6 text-sm leading-relaxed text-ink-800"
                dangerouslySetInnerHTML={{ __html: value }}
              />
            );
          })
```

关键：**不用 `extractRawText`**（只输出纯文本，丢失表格结构），改用 `convertToHtml`（输出带 `<table>/<tr>/<td>/<thead>` 语义的 HTML）。mammoth 官方保证输出不含 `<script>`，可以直接 `dangerouslySetInnerHTML`。

### 3.2 `app/globals.css` — `.docx-preview` 样式

mammoth 只输出语义 HTML，不带任何视觉样式。表格默认没有边框。这里用 CSS 补齐：

```154:178:app/globals.css
.docx-preview table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.8em 0;
  font-size: 0.9em;
  table-layout: auto;
}
.docx-preview th,
.docx-preview td {
  border: 1px solid var(--color-ink-300);
  padding: 6px 10px;
  vertical-align: top;
  text-align: left;
}
.docx-preview th {
  background: var(--color-ink-100);
  font-weight: 600;
  color: var(--color-ink-900);
}
.docx-preview tr:nth-child(even) td {
  background: #fafafa;
}
```

**设计原则**：mammoth 专注语义转换，视觉样式全由 CSS 控制，便于后续通过 `styleMap` 自定义。如果 Word 原文中表格使用了命名样式（如"表格网格"），可进一步用 mammoth 的 `styleMap` 映射到自定义 CSS 类。

### 3.3 `shared/lib/upload.ts` — 附件上传

前端文件转 base64 data URL，通过 PKM 笔记 API 写入：

```18:49:shared/lib/upload.ts
export async function uploadAttachmentAsNote(
  file: File,
  projectId: string,
  router: { refresh: () => void },
): Promise<void> {
  if (file.size > MAX_SIZE) {
    throw new Error(`文件不能超过 ${formatBytes(MAX_SIZE)}`);
  }
  const url = await fileToDataUrl(file);
  const title = file.name.replace(/\.[^.]+$/, "") || "无标题文档";
  const res = await fetch("/api/pkm/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      content: "",
      tags: [],
      projectId,
      isPublic: true,
      attachments: [{ name: file.name, url, mimeType: file.type, size: file.size }],
    }),
  });
  router.refresh();
}
```

- `MAX_SIZE = 10 * 1024 * 1024`（10 MB）
- 后端 `serverActions.bodySizeLimit` 已设为 `"10mb"`（`next.config.ts`）
- 附件不单独建表，统一存在 `PkmNote.attachments: Json?` 字段

### 3.4 `shared/lib/pkm.ts` — 附件类型与校验

```1:62:shared/lib/pkm.ts
export type PkmAttachment = {
  name: string;
  url: string;  // base64 data URL
  mimeType: string;
  size: number;
};

export function normalizePkmAttachments(input: unknown) {
  // 去重（name + size + url 前120字符 hash）
  // 单文件 ≤ 10MB，最多 8 个
  return attachments;
}
```

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `react-pdf` | `^10.4.1` | PDF 渲染，legacy 构建已废弃，改用 worker 文件方案 |
| `pdfjs-dist` | `^5.4.296` | 通过 react-pdf 间接引入 |
| `mammoth` | `^1.12.0` | docx → HTML 转换 |
| `serverActions.bodySizeLimit` | `"10mb"` | base64 附件 POST 上限 |
| 端口 | `3003` | `npm run dev` 默认 |
| 预览文件存放 | `PkmNote.attachments` (Prisma `Json?`) | 不单独建表，随笔记存 |

---

## 5. 启动 / 部署

```bash
# 1. 安装依赖（包含 mammoth + react-pdf）
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 推送 Prisma schema（如有字段变更）
npx prisma db push

# 3. 启动开发服务
npm run dev
# 访问：http://localhost:3003

# 4. （可选）局域网访问
# npm run dev 后手机/其他设备访问 http://<本机IP>:3003
```

**PDF worker 文件**：`public/pdf.worker.min.mjs`（1 MB）已在仓库中，如需重新生成：

```bash
# 从 react-pdf legacy 构建复制（仅 Node.js 环境）
cp node_modules/react-pdf/dist/legacy/pdf.worker.min.mjs public/
```

---

## 6. 测试 & 验证

### 6.1 端到端验证

**前置**：已登录，进入任意项目详情页或 PKM 笔记页。

**测试步骤**：

1. 在项目详情页或 PKM 笔记页找到**上传附件**按钮（蓝色虚线框 + "+" 图标）
2. 选择一个本地 `.docx` 文件（含表格）上传
3. 上传成功后，附件行出现在列表中
4. 点击附件行的**预览**按钮
5. 弹窗出现，检查：
   - 标题栏显示文件名
   - 内容区显示 HTML 渲染的 docx（含表格边框）
   - 右上方**下载**按钮可用
6. 关闭弹窗，ESC 键同样生效

**期望输出**：

- 上传按钮旁出现绿色 "上传成功" 提示
- 附件列表出现新行，带文件类型 badge（PDF 红色 / DOC 蓝色 / 图片紫色）
- 预览弹窗宽度 ~820px，高度 ~85vh，背景有半透明遮罩
- docx 表格有边框（`border: 1px solid #d1d5db`）、表头灰底、斑马纹

### 6.2 PDF 预览验证

1. 上传一个本地 PDF 文件
2. 点击预览
3. 期望：PDF 逐页渲染，有加载 spinner，无 worker 报错

### 6.3 图片预览验证

1. 上传任意 `.jpg` / `.png` 图片
2. 点击预览
3. 期望：图片居中展示，最大高度 70vh，比例不变

### 6.4 Mammoth 降级验证（已知局限）

mammoth 官方声明：**不复制视觉格式**（字体颜色、行距、精确列宽）。以下**不期望**出现：

- Word 里的字体、字号、颜色
- 表格列宽精确还原
- 高亮、删除线等复杂样式

如需更高保真，建议 mammoth 官方 `styleMap` 自定义映射到 CSS，或使用 LibreOffice headless 转为 PDF 再用 react-pdf 渲染。

---

## 踩坑记录

以下是在这次开发过程中实际遇到并解决过的问题，按时间顺序排列，可作为未来排查同类问题的参考。

### 坑 1：mammoth.browser 动态 import 没有类型

**现象**：动态 `import("mammoth/mammoth.browser")` 返回的模块没有 TypeScript 类型，TS 报错"找不到名称 convertToHtml"。

**原因**：mammoth 包本身带类型，但动态 `import()` 的结果在 TypeScript 眼里是 `any`，类型声明文件默认不覆盖动态 import。

**解法**：新建 `types/mammoth.d.ts`，手动声明 `mammoth/mammoth.browser` 模块：

```typescript
declare module "mammoth/mammoth.browser" {
  export function convertToHtml(options: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string; messages: unknown[] }>;
}
```

### 坑 2：d.ts 只写了 extractRawText，代码改用 convertToHtml 后漏同步

**现象**：最初 d.ts 只写了 `extractRawText`，后来代码改为调用 `convertToHtml`，但 d.ts 没有同步更新，导致 TS 报错"属性 convertToHtml 不存在"。

**教训**：修改 API 后必须同步更新对应的类型声明，不要只改代码忘改 d.ts。

**当前 d.ts** 已包含 `convertToHtml`，可直接使用。

### 坑 3：mammoth ESM 模块导出方式不确定（有无 default 导出）

**现象**：尝试 `import { mammoth }` 或 `import mammoth` 均报错，mammoth.browser 的实际导出结构未知。

**解法**：用双层兜底兼容：

```typescript
const convertToHtml =
  mod.convertToHtml ??
  (mod as unknown as { default?: { convertToHtml?: Function } }).default?.convertToHtml;
```

**注**：`mammoth/mammoth.browser` 是 ESM browser bundle，没有 Node.js 依赖。

### 坑 4：react-pdf + webpack 5 + eval-source-map 导致 worker 加载失败

**现象**：PDF 预览报错 `Object.defineProperty called on non-object`。

**原因**：react-pdf 10 搭配 Next.js 16（webpack 5.98）时，`eval-source-map` devtool 与 pdfjs-dist ESM 互操作不兼容。react-pdf 的 legacy build（以前用来绕过此问题的方案）现在也已废弃。

**解法**：把 pdf.js worker 文件手动复制到 `public/` 下，用绝对路径加载：

```typescript
// 动态 import react-pdf 后立即设置 workerSrc
const { pdfjs } = await import("react-pdf");
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
```

Worker 文件生成命令（从 react-pdf 包复制）：

```bash
cp node_modules/react-pdf/dist/legacy/pdf.worker.min.mjs public/
```

**参考**：[pdf.js#20478](https://github.com/mozilla/pdf.js/issues/20478)、[next.js#89177](https://github.com/vercel/next.js/issues/89177)。

### 坑 5：base64 文件上传超过 Next.js Server Action 默认 bodySizeLimit

**现象**：上传几 MB 的 PDF 或 docx 时，请求被静默截断，API 返回 413 或数据不完整。

**原因**：Next.js Server Action 默认 bodySizeLimit 为 1MB，base64 编码会额外增加 ~33% 大小，一张普通 PDF 很容易超标。

**解法**：在 `next.config.ts` 中配置：

```typescript
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};
```

### 坑 6：PkmBoard 本地 `formatBytes` 与 `shared/lib/upload.ts` 导出冲突

**现象**：构建报错，提示 `formatBytes` 被定义了两次。

**原因**：重构时 `upload.ts` 导出了 `formatBytes`，但 `PkmBoard.tsx` 内部也定义了一个同名函数。两处签名完全一致，TS 合并时产生冲突。

**解法**：删除 `PkmBoard.tsx` 内部的 `formatBytes` 定义，统一从 `@/shared/lib/upload` 导入。

### 坑 7：`AppRouterInstance` 不是有效的构建路径

**现象**：构建报错 "`AppRouterInstance` is not defined" 或导入失败。

**原因**：`next/dist/shared/lib/app-router-context` 是 Next.js 内部路径，在不同版本之间不稳定，不应在业务代码中直接引用。

**解法**：改用最小兜底类型：

```typescript
export async function uploadAttachmentAsNote(
  file: File,
  projectId: string,
  router: { refresh: () => void }, // 最小必需接口
): Promise<void>
```

所有接收 `useRouter()` 返回值的函数均可用此类型，无需引入完整的 Router 类型。

---

## 7. 复现 Checklist

- [ ] `npm install` 成功，无 mammoth / react-pdf 安装报错
- [ ] `public/pdf.worker.min.mjs` 存在于仓库（1 MB 左右）
- [ ] `next.config.ts` 中 `serverActions.bodySizeLimit` 为 `"10mb"`
- [ ] `npx prisma db push` 无报错
- [ ] `npm run dev` 启动成功（http://localhost:3003）
- [ ] 登录后进入任意项目页面，找到上传入口
- [ ] 上传 `.docx` 附件（≤ 10 MB），看到"上传成功"
- [ ] 点击预览，表格有边框和斑马纹
- [ ] 按 ESC 或点击遮罩关闭弹窗
- [ ] 上传 `.pdf` 附件，点击预览，PDF 逐页渲染
- [ ] 上传图片附件，点击预览，图片正常显示
- [ ] 上传超过 10 MB 的文件，看到"文件不能超过 10.0 MB"报错
- [ ] 浏览器控制台无红色报错（mammoth messages 警告可忽略）
- [ ] 硬刷新（Cmd+Shift+R）后功能正常（排除缓存干扰）
