# OCR 支持 Phase 1 — 完整复现文档

> 适用版本：project-manager embedding 服务
> 完成日期：2026-07-29
> 目标读者：需要理解这套附件文本提取链路、能独立复现的新开发者

---

## 1. 背景

### 1.1 原始问题

2026-07-29 排查发现，embedding 服务在处理工单附件时存在大量解析失败：

- **22 个 IndexJob 任务处于失败状态**，无法将 PNG/JPG/DOC/DOCX 等附件转为可检索文本
- 根因：embedding 服务只支持 PDF/PPTX/TXT/XLSX，对图片和旧版 Office 格式（.doc/.wps）没有文本提取能力

### 1.2 目标

在 embedding 服务中新增以下格式的文本提取支持：

| 格式 | MIME Type | 提取方式 |
|------|-----------|---------|
| PNG / JPG 等图片 | `image/*` | OCR（pytesseract） |
| .doc（OLE 格式） | `application/msword` | LibreOffice 转换 → DOCX 提取 |
| WPS 文件 | `application/wpsoffice` | LibreOffice 转换 → DOCX 提取 |

> **说明**：DOCX 格式（`application/vnd.openxmlformats-officedocument.wordprocessingml.document`）在 Phase 1 之前已有 api.py 内联实现，Phase 1 将其抽取为独立模块 `extractors/docx.py`，为后续统一做准备。

### 1.3 Phase 1 成果

- 22 个失败任务中，15 个自动恢复为 **COMPLETED**
- 7 个残留失败（文件本身损坏或加密，非本系统问题）

---

## 2. 完整实现链路

### 2.1 新增文件清单

```
embedding/extractors/
├── __init__.py      # 模块导出，暴露 4 个提取函数
├── image.py         # 图片 OCR 提取器（Pillow + pytesseract）
├── docx.py          # DOCX 文本提取器（python-docx）
├── doc.py           # .doc → LibreOffice 转换 → DOCX 提取
└── wps.py           # WPS → LibreOffice 转换 → DOCX 提取
```

#### `extractors/__init__.py`

```python
"""文本提取器集合"""
from .image import extract_image_text
from .docx import extract_docx_text
from .doc import extract_doc
from .wps import extract_wps

__all__ = [
    "extract_image_text",
    "extract_docx_text",
    "extract_doc",
    "extract_wps",
]
```

这是模块的统一出口，其他模块（如 `api.py`）从这里导入，避免直接依赖内部文件名。

#### `extractors/image.py` — 图片 OCR

关键设计点：

1. **显式指定 tesseract 路径**（第 12 行）：
   - 服务进程的 PATH 环境变量不包含 `/usr/bin`，直接写 `/usr/bin/tesseract` 避免找不到命令
2. **默认语言 `eng+chi_sim`**（第 16 行）：同时支持英文和简体中文 OCR
3. **去空行处理**（第 36-37 行）：`splitlines()` 后过滤空行，返回干净的文本

```python
_TESSERACT_CMD = str(Path("/usr/bin/tesseract").resolve())
pytesseract.pytesseract.tesseract_cmd = _TESSERACT_CMD

def extract_image_text(raw: bytes, lang: str = "eng+chi_sim") -> str:
    image = Image.open(io.BytesIO(raw))
    text = pytesseract.image_to_string(image, lang=lang)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)
```

#### `extractors/docx.py` — DOCX 文本提取

抽取自 `api.py` 的原有内联逻辑，增加了对**表格**的支持（第 16-24 行）。`python-docx` 的 `Document` 对象可以直接读段落和表格，每个表格行用 ` | ` 分隔单元格。

#### `extractors/doc.py` — .doc（OLE 格式）提取

核心流程：`.doc`（Microsoft Word 97-2003 OLE 格式）无法被 python-docx 直接读取，采用**间接转换**策略：

```
.doc 原始字节
  → 写入临时文件
  → LibreOffice --headless --convert-to docx
  → 读取转换后的 .docx
  → extract_docx_text()
```

**LibreOffice 路径查找优先级**（第 12-16 行）：
```
环境变量 LIBREOFFICE_BIN  >  shutil.which("libreoffice")  >  shutil.which("soffice")
```

#### `extractors/wps.py` — WPS 文件提取

WPS 是金山办公的文件格式，本质上与 Office 兼容。LibreOffice 可以打开并转换为 docx。流程与 `doc.py` 完全一致，代码重复问题参见第 5 节技术债。

### 2.2 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `embedding/api.py` | 新增图片/`.doc`/WPS 三个 MIME 分支（第 203-221 行），调用对应提取器 |
| `embedding/requirements.txt` | 新增 `Pillow>=10.0.0` 和 `pytesseract>=0.3.10` |
| `embedding/extractors/__init__.py` | 新增，模块统一导出 |

### 2.3 `api.py` 中的路由逻辑

`api.py` 第 122-223 行的 `_extract_text_from_bytes()` 函数是整个提取链路的分发中心（dispatcher），用 MIME type 和文件名后缀双重判断：

```python
# 图片 OCR（第 203-207 行）
if normalized.startswith("image/"):
    from extractors.image import extract_image_text
    return extract_image_text(raw)

# .doc OLE 格式（第 209-213 行）
if normalized == "application/msword" or name.lower().endswith(".doc"):
    from extractors.doc import extract_doc
    return extract_doc(raw)

# WPS 文件（第 215-221 行）
if normalized in ("application/wpsoffice", "application/wps-office.docx") \
   or name.lower().endswith((".wps", ".wpt")):
    from extractors.wps import extract_wps
    return extract_wps(raw)
```

> **为什么要用 `name.lower().endswith()` 做兜底判断？**
> 实际场景中，HTTP 上传的文件 MIME type 有时不准确（如服务器未识别 WPS），用扩展名做兜底可以提高成功率。

---

## 3. 技术实现细节

### 3.1 图片 OCR 依赖链

```
应用层:  extractors/image.py (pytesseract API)
        ↓
底层库:  pytesseract (Python binding)
        ↓
系统层:  tesseract-ocr (apt 安装)
        ↓
语言包:  tesseract-ocr-chi-sim (简体中文)
```

**系统依赖（必须安装）**：

```bash
# Ubuntu/Debian
sudo apt-get install tesseract-ocr tesseract-ocr-chi-sim

# 验证安装
tesseract --version
```

### 3.2 LibreOffice 转换链路

```
用户上传 .doc / .wps
    ↓
embedding 服务
    ↓
写入 tempfile (input.doc / input.wps)
    ↓
subprocess.run([
    "libreoffice",
    "--headless",          # 无 GUI
    "--convert-to", "docx", # 输出 docx
    "--outdir", tmpdir,     # 同目录输出
    input_path,
])
    ↓
读取 output.docx → extract_docx_text()
```

**超时控制**：LibreOffice 转换最多等待 120 秒（第 44 行），超时报 `doc_convert_timeout` / `wps_convert_timeout`。

### 3.3 错误处理约定

所有提取器使用统一的 `ValueError` 异常格式，供 `api.py` 捕获并映射为 `source` 字段：

| 异常信息 | `source` | 含义 |
|---------|---------|------|
| `image_open_error:xxx` | `parse_error` | Pillow 无法打开图片 |
| `ocr_error:xxx` | `parse_error` | tesseract OCR 失败 |
| `libreoffice_not_found` | `parse_error` | LibreOffice 未安装 |
| `doc_convert_timeout` | `parse_error` | LibreOffice 转换超时 |
| `wps_convert_failed:xxx` | `parse_error` | WPS 转换失败 |

---

## 4. 部署步骤

### 4.1 安装系统依赖

```bash
# tesseract 主程序
sudo apt-get install tesseract-ocr

# 简体中文语言包（必须，否则 OCR 中文全是乱码）
sudo apt-get install tesseract-ocr-chi-sim

# 可选：英文语言包（一般已内置）
sudo apt-get install tesseract-ocr-eng
```

### 4.2 安装 Python 依赖

```bash
cd /home/hxy/work/personal/project-manager/embedding
pip install Pillow>=10.0.0 pytesseract>=0.3.10
```

或直接使用 requirements.txt：

```bash
pip install -r requirements.txt
```

### 4.3 验证 tesseract

```bash
# 检查 tesseract 是否在 /usr/bin/tesseract
ls -la /usr/bin/tesseract

# 验证简体中文可用
echo "测试" | tesseract stdin stdout -l chi_sim
```

### 4.4 验证 LibreOffice

```bash
# 检查 libreoffice 是否在 PATH
which libreoffice
# 或
which soffice

# 如果不在 PATH，通过环境变量指定
export LIBREOFFICE_BIN=/opt/libreoffice24.8/program/soffice
```

### 4.5 重启 embedding 服务

```bash
# 查看当前进程
ps aux | grep embedding

# 重启（具体命令参考 docs/OPERATIONS.md）
# ...
```

---

## 5. 验证方法

### 5.1 API 直接测试

```bash
# 测试图片 OCR（将 test.png 转为 base64）
curl -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d '{
    "url": "data:image/png;base64,$(base64 -w0 test.png)",
    "mimeType": "image/png",
    "name": "test.png",
    "size": 102400
  }'

# 测试 .doc 提取
curl -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:3003/uploads/test.doc",
    "mimeType": "application/msword",
    "name": "test.doc",
    "size": 204800
  }'
```

### 5.2 查看数据库中的 IndexJob 状态

```sql
SELECT id, status, error_message, created_at
FROM pm."IndexJob"
WHERE status = 'FAILED'
  AND created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

执行 OCR 支持后，失败任务应该自动重试并变为 `COMPLETED`（因为 embedding 服务 `/extract-text` 接口现已支持这些格式）。

### 5.3 查看 embedding 服务日志

```bash
tail -f /home/hxy/work/personal/project-manager/embedding/api.log | grep -E "(extract-text|image_open|ocr_error|doc_convert|wps_convert)"
```

---

## 6. 技术债与 Phase 2 建议

### 6.1 已知问题

#### 问题 1：两套 DOCX 实现并存

- `api.py` 第 159-175 行：原有内联 DOCX 提取（无表格支持）
- `extractors/docx.py`：新版抽取实现（有表格支持）

两个实现对表格的处理不同，`api.py` 中的分支不会调用 `extractors/docx_text()`。建议 Phase 2 统一。

#### 问题 2：`doc.py` 和 `wps.py` 代码重复

两个文件有约 80% 完全相同的代码（LibreOffice 转换链路），可以抽取为共享的 `_convert_via_libreoffice()` 辅助函数。

#### 问题 3：缺少单元测试

目前没有针对提取器的测试用例。Phase 2 应补充：

- `test_image.py`：测试正常图片、损坏图片、大图的边界情况
- `test_doc.py`：测试正常 .doc、损坏 .doc、超大文件
- `test_wps.py`：测试正常 WPS 文件

### 6.2 Phase 2 优先级建议

| 优先级 | 任务 | 理由 |
|-------|------|------|
| P0 | 统一 DOCX 提取逻辑 | 当前两套实现长期维护成本高 |
| P1 | 抽取 `_convert_via_libreoffice()` 共享函数 | 消除 doc.py/wps.py 重复 |
| P2 | 添加提取器单元测试 | 保证重构不破坏现有功能 |
| P3 | 支持 `.xls`（老版 Excel） | 已有 `xls_not_supported` 占位 |

---

## 7. 文件变更汇总

### 7.1 新增文件

| 文件路径 | 行数 | 核心导出函数 |
|---------|------|-------------|
| `embedding/extractors/__init__.py` | 13 | 模块统一导出 |
| `embedding/extractors/image.py` | 37 | `extract_image_text()` |
| `embedding/extractors/docx.py` | 26 | `extract_docx_text()` |
| `embedding/extractors/doc.py` | 63 | `extract_doc()` |
| `embedding/extractors/wps.py` | 64 | `extract_wps()` |

### 7.2 修改文件

| 文件路径 | 关键改动 |
|---------|---------|
| `embedding/api.py` | 第 203-221 行新增图片/doc/WPS 三个分支 |
| `embedding/requirements.txt` | 新增 `Pillow>=10.0.0` 和 `pytesseract>=0.3.10` |

---

## 8. 关键设计决策回顾

| 决策点 | 选型 | 备选方案 | 为什么选这个 |
|-------|------|---------|------------|
| 图片 OCR 库 | pytesseract | EasyOCR / Tesseract.js | pytesseract 直接调用系统 tesseract-ocr，中文识别率最高 |
| tesseract 路径 | 硬编码 `/usr/bin/tesseract` | `shutil.which("tesseract")` | embedding 服务进程可能 PATH 不完整，硬编码更可靠 |
| .doc 解析方案 | LibreOffice 转换 | antiword / olefile | LibreOffice 支持所有 Office 格式，无格式丢失风险 |
| WPS 支持方式 | 同 .doc，LibreOffice 转换 | 专用 WPS Python 库 | WPS 与 Office 兼容，LibreOffice 转换链路零新增依赖 |
| WPS MIME 判断 | MIME type + 扩展名双重判断 | 只用扩展名 | 部分 WPS 文件上传时 MIME type 不准确，扩展名是可靠兜底 |

---

*文档生成时间：2026-07-29*
*生成工具：ai-learning-mentor (docx 抽取自 api.py + image/doc/wps 新增提取器)*
