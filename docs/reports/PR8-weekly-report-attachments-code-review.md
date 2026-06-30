# Code Review: PR8 - Weekly Report Attachments (Excel Parsing)

**Scope:** embedding/api.py, WeeklyReportForm.tsx, WeeklyReportDetailClient.tsx, ProjectDetail.tsx, shared/lib/pkm.ts
**Review Type:** Local Changes

---

## Verdict: ✅ Approved with Suggestions

所有文件通过类型检查（`npx tsc --noEmit` 无相关错误），核心逻辑正确，安全性良好。有 2 个可优化项（1 个跨边界建议，1 个代码健壮性改进）。

---

## Findings

### Correctness

- **[WeeklyReportForm.tsx:55-57]** ✅ `attachments` state 使用函数式 initializer（`useState(() => normalizePkmAttachments(...)`），仅在首次渲染时调用，非闭包陷阱
- **[WeeklyReportForm.tsx:199,233]** ✅ POST/PATCH body 均包含 `attachments` 字段，与 title/content 一致
- **[WeeklyReportDetailClient.tsx:103-105]** ✅ `attachments` 有 `Array.isArray` 检查 + 类型断言 + 空数组兜底，处理 `undefined` 场景
- **[WeeklyReportDetailClient.tsx:197-206]** ✅ 传给 `AttachmentItem` 的 attachment 对象包含所有必需字段：`name`、`url`、`mimeType`（含 fallback `"application/octet-stream"`）、`size`（含 fallback `0`）
- **[shared/lib/pkm.ts:28-63]** ✅ `normalizePkmAttachments` 对空输入（`!Array.isArray(input)`）返回空数组；去重、size 上限（10MB）检查均完整
- **[embedding/api.py:35-36]** ✅ MIME 常量命名正确：`XLSX_MIME`（openxmlformats-officedocument.spreadsheetml.sheet）与 `XLS_MIME`（vnd.ms-excel），无重名
- **[embedding/api.py:178-197]** ✅ openpyxl 内联 import 在 try 块内，`read_only=True, data_only=True` 均已设置

### Maintainability

- **[embedding/api.py:199-200]** `.xls` raise ValueError("xls_not_supported") 与外层 try/except 配合，错误会变成 `source: "parse_error"` 响应 —— 设计一致，行为可预期
- **[shared/lib/pkm.ts:11-26]** `isPkmAttachment` 使用类型守卫（`value is PkmAttachment`），类型推导干净

### Efficiency

- **[embedding/api.py:180]** `openpyxl.load_workbook(..., read_only=True)` 防止内存问题 ✅
- **[embedding/api.py:111]** `response.read(MAX_EXTRACT_FILE_SIZE + 1)` 流式读取前做大小校验 ✅
- **[embedding/api.py:186-191]** Excel 遍历使用 `iter_rows(values_only=True)` 而非逐 cell 读取，减少对象创建 ✅

### Security

- **[embedding/api.py:46-105]** `_decode_data_url` 用正则验证 `data:` 前缀，只接受 base64/URLencode payload，不处理文本模式 `data:text/plain,...`，边界清晰 ✅
- **[embedding/api.py:219-230]** 文件大小检查有两层：读取前按请求 `size` 跳过 + 读取后按实际 `len(raw)` 二次校验，防止超尺寸 payload ✅
- **[embedding/api.py:226,235,268]** 解析错误打日志但不泄漏堆栈给客户端 ✅
- **[AttachmentItem.tsx:101-109]** 下载链接带 `rel="noreferrer"` ✅

### Edge Cases

- **[embedding/api.py:199-200]** `.xls` 文件抛出 `ValueError("xls_not_supported")`，被外层捕获后返回 `{text: "", source: "parse_error"}`，用户看到错误 toast ✅
- **[AttachmentItem.tsx:46-56]** `isPreviewable` 对 Excel 文件（`spreadsheetml.sheet` / `vnd.ms-excel`）返回 `false`，按钮变为纯"下载"——UX 合理，无需修复
- **[embedding/api.py:128]** `mime_type.split(";")[0].strip().lower()` 处理 `data:` URL 里的 MIME 片段（如 `data:application/pdf;base64,...`）✅

### Testing

- 本次 PR 未涉及测试文件（`*.test.ts`、`*.spec.ts`），无新增测试用例
- `normalizePkmAttachments` 有边界 case（undefined/null/空数组/超长 name），建议后续补充单元测试

---

## Improvements (Recommended)

### 1. **[ProjectDetail.tsx:516]** Project 文件上传 accept 字符串缺少 Excel MIME 类型

- **位置:** `features/project/ui/ProjectDetail.tsx:516`
- **当前值:**
  ```
  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
  ```
- **问题:** 缺少 Excel 的 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`（.xlsx）和 `application/vnd.ms-excel`（.xls）
- **影响:** 用户在 Project Detail 页面上传附件时，无法通过文件选择器选中 Excel 文件（但通过拖拽可能绕过此限制，取决于浏览器行为）
- **建议:** cross-mentor: 确认 Project 文档上传是否需要支持 Excel，若需要则添加上述 MIME 类型到 accept 字符串

---

## Positive Points

- Excel 解析内联 import + try/except 包装，失败时优雅降级为 `parse_error`，不影响其他文件类型
- `normalizePkmAttachments` 的 lazy initializer 用法正确，避免了闭包陷阱
- 两层大小校验（请求 size + 实际 bytes）安全可靠
- `read_only=True, data_only=True` 防止内存问题和公式求值开销

---

## Next Steps

1. 主代理决策：是否需要将 Excel MIME 类型加入 ProjectDetail 的 FileUploader accept 字符串
2. 如需新增测试，可针对 `normalizePkmAttachments` 补单元测试覆盖边界 case
3. 其他文件无需修改，可合并
