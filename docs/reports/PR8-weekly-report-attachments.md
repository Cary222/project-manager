# PR8 周报附件上传 + 全站 Excel 格式支持

> **开发时间**: 2026-06-30
> **目标**: 周报编辑/新建支持附件上传，全站文件上传支持 Excel 格式
> **风格**: 复现文档（参考 `dev-to-doc-recap` skill 8 段式）

---

## 1. 目标 & 背景

### 1.1 旧版的问题
- 周报（WeeklyReport）表单完全没有附件上传 UI，用户无法上传文件
- 全站文件上传点（PKM 笔记、项目文档）均不支持 Excel 格式（`.xlsx` / `.xls`）
- FastAPI `embedding/api.py` 的 `/extract-text` 端不支持 Excel MIME 类型

### 1.2 结论
- **周报附件 UI**：在 `WeeklyReportForm` 内容区下方新增 `<AttachmentEditor>` 组件（复用 PKM 附件逻辑），表单提交时附 attachments 字段
- **Excel 解析**：FastAPI 新增 `.xlsx` 分支（openpyxl 遍历所有 sheet），`.xls` 分支 raise ValueError 走 parse_error 兜底
- **ProjectDetail 文档上传**：accept 字符串新增 Excel MIME 类型，hint 文案同步更新

---

## 2. 改动清单

|| 文件 | 类型 | 作用 |
|------|------|------|
| `embedding/api.py` | 修改 | 新增 `XLSX_MIME`/`XLS_MIME` 常量，`_extract_text_from_bytes` 加 Excel 解析分支（openpyxl） |
| `embedding/requirements.txt` | 修改 | 新增 `openpyxl>=3.1.0` 依赖 |
| `features/reports/weekly-reports/ui/WeeklyReportForm.tsx` | 修改 | 表单新增 `attachments` state、`<AttachmentEditor>` UI、POST/PATCH body 加 attachments 字段 |
| `app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx` | 修改 | 附件展示升级为 `<AttachmentItem>` 组件 + `DocumentPreviewModal` 预览（Excel 无预览提示下载） |
| `features/project/ui/ProjectDetail.tsx` | 修改 | Docs tab 的 `FileUploader` accept 字符串加 Excel MIME，hint 文案加"Excel" |

**无需改动（已验证）**：
- Prisma schema（`WeeklyReport.attachments` 字段已存在）
- `weekly-report-store.ts`（已通过 `normalizePkmAttachments` 处理 attachments）
- API route（`app/api/reports/weekly-reports/route.ts` POST/PATCH zod schema 已包含 attachments）
- `PushConfirmModal` / `CreateTicketForm`（仅图片，需求不变）

---

## 3. 核心实现

### 3.1 FastAPI Excel 解析（`embedding/api.py`）

```startLine:37:embedding/api.py
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
XLS_MIME = "application/vnd.ms-excel"
```

```startLine:180:embedding/api.py
    if normalized == XLSX_MIME:
        try:
            import openpyxl

            wb = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
            sheet_parts = []
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                row_lines = []
                for row in ws.iter_rows(values_only=True):
                    cell_values = []
                    for cell in row:
                        if cell is not None and cell != "":
                            cell_values.append(str(cell))
                    if cell_values:
                        row_lines.append("\t".join(cell_values))
                if row_lines:
                    sheet_parts.append(f"[{sheet_name}]\n" + "\n".join(row_lines))
            wb.close()
            return "\n\n".join(sheet_parts)
        except Exception as exc:
            raise ValueError(f"xlsx_parse_error:{exc}") from exc

    if normalized == XLS_MIME:
        raise ValueError("xls_not_supported")
```

**为什么这样写**：
- openpyxl 内联 import（避免顶层依赖预加载）配合 try/except 单 sheet 失败不崩整个文件
- `data_only=True` + `read_only=True`：只读值不过滤公式，避免性能开销
- 空 cell 跳过，日期/数字统一 `str(cell)` 转字符串
- 行内 `\t` 分隔，sheet 之间 `\n\n` 分隔，便于 RAG 检索

### 3.2 周报表单附件（`WeeklyReportForm.tsx`）

```startLine:1:features/reports/weekly-reports/ui/WeeklyReportForm.tsx
import { AttachmentEditor } from "@/shared/ui/AttachmentEditor";
import { normalizePkmAttachments, type PkmAttachment } from "@/shared/lib/pkm";
```

```startLine:50:features/reports/weekly-reports/ui/WeeklyReportForm.tsx
  const [attachments, setAttachments] = useState<PkmAttachment[]>(() =>
    normalizePkmAttachments(initialReport?.attachments)
  );
```

```startLine:366:features/reports/weekly-reports/ui/WeeklyReportForm.tsx
        {/* 附件 */}
        <div>
          <label className="mb-1.5 block text-sm font-medium text-ink-700">
            附件
            <span className="ml-1.5 text-xs font-normal text-ink-400">（可选，最多 8 个，单个不超过 10 MB）</span>
          </label>
          <AttachmentEditor
            attachments={attachments}
            onChange={setAttachments}
            onError={(msg) => toast.error(msg)}
          />
        </div>
```

POST/PATCH body 均加 `attachments` 字段（`WeeklyReportForm.tsx` 第 195、227 行）。

**为什么这样写**：复用 `AttachmentEditor` 组件保证全站附件上传体验一致；`normalizePkmAttachments` 保证数据类型安全；无需改 store/API（已支持）。

### 3.3 周报详情附件展示（`WeeklyReportDetailClient.tsx`）

```startLine:8:app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx
import { AttachmentItem, type PreviewableFile } from "@/shared/ui/AttachmentItem";
import { DocumentPreviewModal } from "@/shared/ui/DocumentPreviewModal";
```

```startLine:91:app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx
  const [previewFile, setPreviewFile] = useState<PreviewableFile | null>(null);
```

附件区域替换为 `<AttachmentItem onPreview={setPreviewFile} />`，Excel 文件 `isPreviewable` 返回 false，UI 显示"暂不支持预览此格式，可下载查看"。

---

## 4. 环境与配置

|| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| FastAPI 依赖 | `openpyxl>=3.1.0` | 装在 FastAPI 服务器环境，不是 Next.js |
| `embedding/requirements.txt` | 第 11 行 | 追加在 `python-docx` 之后 |
| 服务端口 | FastAPI `0.0.0.0:5000` | Next.js `0.0.0.0:3003` |
| 周报附件字段 | `pm.WeeklyReport.attachments` (Json?) | schema 已存在，无需 migration |

---

## 5. 启动 / 部署

### 5.1 安装 FastAPI Excel 依赖

```bash
# 在 FastAPI 服务器上执行
cd /path/to/project/embedding
pip install -r requirements.txt
# 验证 openpyxl 可导入
python -c "import openpyxl; print('openpyxl OK', openpyxl.__version__)"
```

### 5.2 重启 FastAPI 服务

```bash
# 查看当前 FastAPI 进程
ps aux | grep uvicorn | grep 5000

# 优雅重启（热加载，无停机）
kill -HUP <uvicorn_pid>
# 或直接重启
systemctl restart embedding-api   # 或你的启动脚本
```

### 5.3 验证 FastAPI 存活

```bash
curl http://localhost:5000/health
# 期望: {"status": "healthy"}
```

---

## 6. 测试 & 验证

### 6.1 FastAPI Excel 提取（curl）

```bash
# 准备测试 xlsx 文件（用任意 xlsx 内容 base64 编码）
# 这里用最小 xlsx 示例
XLSX_B64=$(echo -n "UEsDBBQABgAIAAAAIQD..." | base64 -d | base64)  # 替换为真实 xlsx 文件
curl -s -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d '{
    "url": "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,'$XLSX_B64'",
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "name": "test.xlsx",
    "size": 1024
  }' | jq .

# 期望: {"text": "...sheet name...\tcell1\tcell2...","source":"ok","name":"test.xlsx"}
```

### 6.2 TypeScript 类型检查

```bash
cd /Users/vastgui/Desktop/project-manager
npx tsc --noEmit 2>&1 | head -20

# 期望: 仅历史遗留错误（e2e/module-edit.spec.ts、features/admin/admin.test.ts、API routes）
# 期望: PR8 改动的 4 个文件零新增错误
```

### 6.3 UI 手测（浏览器）

1. 打开 `http://localhost:3003/reports/weekly-reports`
2. 点击"新建周报"
3. 填标题、周范围、内容
4. 在内容区下方找到"附件"区块
5. 上传一个 `.xlsx` 文件 → 期望：文件出现在附件列表
6. 点击"提交周报" → 期望：创建成功，附件被保存
7. 打开刚创建的周报 → 期望：详情页显示附件列表，点击"预览"对 Excel 显示"暂不支持预览此格式，可下载查看"

---

## 7. 复现 Checklist

- [ ] 服务器端 FastAPI 执行 `pip install openpyxl>=3.1.0`
- [ ] 重启 FastAPI 服务（`kill -HUP` 或 `systemctl restart`）
- [ ] `curl http://localhost:5000/health` 确认存活
- [ ] `npx tsc --noEmit` 零新增错误（仅历史遗留可忽略）
- [ ] 打开周报新建页，确认"附件"区块出现
- [ ] 上传 `.xlsx` 文件，附件列表显示
- [ ] 提交周报后详情页附件正常展示
- [ ] 周报编辑页附件正常回填
- [ ] ProjectDetail Docs tab 上传 Excel 文件成功
- [ ] Excel 附件点击"预览"提示"暂不支持预览，可下载查看"

---

## 8. 踩坑记录

### 坑 1：Excel 空 cell 导致多余分隔符

**现象**：某行只有部分列有值，但代码用 `\t` 连接所有位置，导致 RAG 提取文本包含大量 `\t\t` 空分隔符。

**原因**：遍历 `iter_rows` 时，空 cell（`None`）也被当作空字符串添加到 `cell_values`，造成行末多余 `\t`。

**解法**：判断 `cell is not None and cell != ""` 才加入，精确保留有效内容：

```python
for cell in row:
    if cell is not None and cell != "":
        cell_values.append(str(cell))
if cell_values:
    row_lines.append("\t".join(cell_values))
```

### 坑 2：`.xls`（Excel 97-2003）格式无法解析

**现象**：旧系统导出的 `.xls` 文件 `openpyxl` 直接报错 `Unsupported format, or corrupt file: Expected XLSX file`。

**原因**：`openpyxl` 只支持 OOXML 格式（`.xlsx`），不支持二进制 `.xls`。

**解法**：`.xls` 分支直接 `raise ValueError("xls_not_supported")`，FastAPI handler 捕获后返回 `parse_error`，用户收到提示"文件格式不支持"。业务上建议用户将 `.xls` 另存为 `.xlsx`。

### 坑 3：React Fragment 嵌套错误

**现象**：`WeeklyReportDetailClient.tsx` JSX 中出现两个相邻的 `<>` fragment 起始标签，导致 tsc 报错"JSX fragment has no corresponding closing tag"。

**原因**：编辑时在 `return (` 后插入 `<>`，但没有发现原代码已在 `return (` 后有 `<>`，导致重复。

**解法**：定位 `return (` 后的第一个 `<>`，确认是否已有 fragment 再决定是替换还是直接添加内容。

---

## 附录：关键文件行号索引

| 文件 | 关键行 |
|------|--------|
| `embedding/api.py` MIME 常量 | 第 37-39 行 |
| `embedding/api.py` Excel 解析分支 | 第 180-203 行 |
| `embedding/requirements.txt` | 第 11 行 |
| `WeeklyReportForm.tsx` 导入 | 第 6-8 行 |
| `WeeklyReportForm.tsx` attachments state | 第 50-52 行 |
| `WeeklyReportForm.tsx` 附件 UI | 第 366-377 行 |
| `WeeklyReportForm.tsx` POST/PATCH body | 第 195、227 行 |
| `WeeklyReportDetailClient.tsx` 导入 | 第 8-10 行 |
| `WeeklyReportDetailClient.tsx` previewFile state | 第 91 行 |
| `WeeklyReportDetailClient.tsx` 附件展示 | 第 190-205 行 |
| `ProjectDetail.tsx` accept 字符串 | 第 351 行 |
