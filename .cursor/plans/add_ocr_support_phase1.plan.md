# 附件文本提取服务增强计划

## 目标
修复 22 个失败的索引任务，恢复文档可搜索性

## 失败任务分析

| 类型 | 数量 | 错误原因 | 方案 |
|------|------|----------|------|
| PNG/JPG 图片 | 17 | 无 OCR | `extractors/image.py` |
| WPS 文件 | 3 | python-docx 解析失败 | `extractors/wps.py` (LibreOffice) |
| .doc 文件 | 1 | 不支持 OLE 格式 | `extractors/doc.py` (LibreOffice) |
| PDF | 1 | 待确认 | 暂不处理 |

## Phase 1: 核心文件修改

### 1. 新建 `embedding/extractors/__init__.py`
```python
"""文档提取器模块"""
```

### 2. 新建 `embedding/extractors/image.py`
```python
"""图片 OCR 提取器 — pytesseract MVP"""
import io
from PIL import Image
import pytesseract

def extract_image_text(content: bytes) -> str:
    """从图片提取文字，支持中文+英文"""
    image = Image.open(io.BytesIO(content))
    text = pytesseract.image_to_string(image, lang='eng+chi_sim')
    return text.strip()
```

### 3. 新建 `embedding/extractors/doc.py`
```python
"""旧版 .doc 提取器 — LibreOffice 转换为 docx"""
import subprocess
import tempfile
from pathlib import Path
from .docx import extract_docx

def extract_doc(content: bytes) -> str:
    """将 .doc 转换为 docx 后提取文本"""
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.doc"
        src.write_bytes(content)
        
        subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "docx", "--outdir", tmp, str(src)],
            check=True,
            capture_output=True
        )
        
        docx_file = Path(tmp) / "input.docx"
        return extract_docx(docx_file.read_bytes())
```

### 4. 新建 `embedding/extractors/wps.py`
```python
"""WPS 文件提取器 — LibreOffice 转换为标准 docx"""
import subprocess
import tempfile
from pathlib import Path
from .docx import extract_docx

def extract_wps(content: bytes) -> str:
    """将 WPS 格式转换为 docx 后提取文本"""
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "input.docx"
        src.write_bytes(content)
        
        subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "docx", "--outdir", tmp, str(src)],
            check=True,
            capture_output=True
        )
        
        docx_file = Path(tmp) / "input.docx"
        return extract_docx(docx_file.read_bytes())
```

### 5. 新建 `embedding/extractors/docx.py`
```python
"""DOCX 提取器 — 从 api.py 提取"""
from docx import Document

def extract_docx(content: bytes) -> str:
    """提取 docx 文本（段落和表格）"""
    import io
    doc = Document(io.BytesIO(content))
    parts = []
    for paragraph in doc.paragraphs:
        text = paragraph.text.strip()
        if text:
            parts.append(text)
    for table in doc.tables:
        for row in table.rows:
            row_texts = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if row_texts:
                parts.append(" | ".join(row_texts))
    return "\n".join(parts)
```

### 6. 修改 `embedding/api.py`
```python
# 添加导入
from extractors.image import extract_image_text
from extractors.doc import extract_doc
from extractors.wps import extract_wps

# 在 _extract_text_from_bytes() 中添加分支

# 图片 OCR
elif mime_type.startswith("image/"):
    return extract_image_text(raw)

# .doc 旧版格式（也处理 mime 为 octet-stream 但文件扩展名是 .doc）
elif mime_type == "application/msword" or filename.endswith(".doc"):
    return extract_doc(raw)

# WPS 格式（LibreOffice 转换）
elif mime_type in ("application/wpsoffice", "application/wps-office.docx"):
    return extract_wps(raw)
```

### 7. 修改 `embedding/requirements.txt`
```
Pillow>=10.0.0
pytesseract>=0.3.10
```

### 8. 系统依赖安装
```bash
# 中文 OCR 语言包
sudo apt install tesseract-ocr-chi-sim
```

## 验证步骤

### Step 1: 安装依赖后测试 tesseract
```bash
tesseract --list-langs  # 应包含 chi_sim
```

### Step 2: 测试 embedding 服务
```bash
cd /home/hxy/work/personal/project-manager/embedding
# 重启服务
```

### Step 3: 手动测试各类型文件
```bash
# 测试图片 OCR
curl -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3003/api/file/xxx", "mimeType": "image/png", "name": "test.png", "size": 1000}'

# 测试 .doc 转换
curl -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d '{"url": "http://localhost:3003/api/file/xxx", "mimeType": "application/msword", "name": "test.doc", "size": 1000}'
```

### Step 4: 重置失败任务并验证
```bash
# 查询失败任务
npx tsx -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const docs = await prisma.document.findMany({ 
    where: { status: 'FAILED' },
    include: { fileAsset: true }
  });
  console.log('Failed docs:', docs.length);
  docs.forEach(d => console.log(d.fileAsset.originalName, d.fileAsset.mimeType));
}
main();
"
```

## Phase 2 预留 (暂不执行)
- PDF OCR fallback
- 更细粒度错误码
- PaddleOCR 升级

## Phase 3 预留 (暂不执行)
- Apache Tika 企业级方案
