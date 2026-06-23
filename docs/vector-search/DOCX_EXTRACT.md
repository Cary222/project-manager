# DOCX 附件文本提取 — 开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + FastAPI + BGE-M3）
> 目标：让未来的我拿到这份文档 + commit 后，能完整复现"DOCX 附件提取到向量库"的端到端过程。
> 背景：用户上传含 docx 附件的 PKM 笔记后，docx 内容没有进入向量库，导致语义搜索搜不到附件内容。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

- `embedding/api.py` 只有 PDF / PPTX / TEXT 三种 mime 的解析器，**没有 DOCX**
- 服务器上的 `api.py` 版本比本地旧（`md5` 不一致），漏掉了 DOCX 解析分支
- `python-docx` 包未装（服务器 `requirements.txt` 缺少）
- `huggingface_hub` 模型缓存损坏 + huggingface.co 网络不通，模型加载挂死

### 1.2 结论

- 在 `embedding/api.py` 新增 `DOCX_MIME` 分支，用 `python-docx` 解析 `.docx` 文件（含段落和表格）
- 在 `embedding/requirements.txt` 加 `python-docx>=1.0.0`
- 在 `embedding/api.py` 开头设置 `HF_ENDPOINT=https://hf-mirror.com` 绕过网络问题
- 把本地完整版 `api.py` 同步到服务器，清缓存、重启服务

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `embedding/api.py` | 修改 | 新增 DOCX mime 解析分支 + HF_ENDPOINT 镜像配置 |
| `embedding/requirements.txt` | 修改 | 加 `python-docx>=1.0.0` |
| `docs/vector-search/ATTACHMENT_TEXT_EXTRACTION.md` | 修改 | 文档升级为四类 mime（补 DOCX 章节） |
| `.env.production`（服务器） | 修改 | 加 `HF_ENDPOINT=https://hf-mirror.com`（服务器手动加的，未进仓库） |

---

## 3. 核心实现

### 3.1 DOCX 解析器（`embedding/api.py`）

```1:44:embedding/api.py
"""Embedding API 服务 — FastAPI + BGE-M3，监听 0.0.0.0:5000"""
import os
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
```

第 1-3 行：开头设置 HF 镜像，解决 huggingface.co 网络超时问题（服务器在中国大陆）。

```31:34:embedding/api.py
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
```

第 34 行：DOCX MIME 常量，与 PDF/PPTX/TEXT 并列。

```140:156:embedding/api.py
    if normalized == DOCX_MIME:
        doc = Document(io.BytesIO(raw))
        parts = []
        for paragraph in doc.paragraphs:
            text = paragraph.text.strip()
            if text:
                parts.append(text)
        for table in doc.tables:
            for row in table.rows:
                row_texts = []
                for cell in row.cells:
                    cell_text = cell.text.strip()
                    if cell_text:
                        row_texts.append(cell_text)
                if row_texts:
                    parts.append(" | ".join(row_texts))
        return "\n".join(parts)
```

第 140-156 行：DOCX 解析逻辑 — 先遍历所有段落，再遍历所有表格（表格每行以 ` | ` 分隔单元格），最后拼接。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `HF_ENDPOINT` | `https://hf-mirror.com` | 服务器中国大陆必须设，本地开发无需 |
| `EMBEDDING_API_URL` | `http://localhost:5000` | Next.js 调用 FastAPI |
| FastAPI 端口 | `0.0.0.0:5000` | 同向量服务复用 |
| Python 包 | `python-docx>=1.0.0`、`pdfplumber>=0.10.0`、`python-pptx>=0.6.21` | 三种附件解析依赖 |
| BGE-M3 模型 | `BAAI/bge-m3`，维度 1024 | 向量嵌入模型 |
| DOCX MIME | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | 笔记附件格式 |
| 文本截断 | `MAX_EXTRACTED_CHARS = 2000` | 提取后超长截断 |

---

## 5. 启动 / 部署

### 5.1 本地开发（不需要改）

本地开发不需要启动 FastAPI，embedding 用 Next.js 端内处理。本地不用管这个。

### 5.2 服务器部署（关键步骤）

```bash
# 1. 同步 api.py（包含 DOCX 解析 + HF_ENDPOINT）
scp embedding/api.py hxy@192.168.1.14:/home/hxy/work/personal/project-manager/embedding/api.py

# 2. 装 python-docx
ssh hxy@192.168.1.14 "pip install python-docx>=1.0.0 -q"

# 3. 清理损坏的模型缓存（重要！）
ssh hxy@192.168.1.14 "rm -rf ~/.cache/huggingface/hub/models--BAAI--bge-m3"

# 4. 在 .env.production 加 HF_ENDPOINT（如果没有）
ssh hxy@192.168.1.14 'echo "HF_ENDPOINT=https://hf-mirror.com" >> /home/hxy/work/personal/project-manager/.env.production'

# 5. 重启 FastAPI（加载 .env.production 中的 HF_ENDPOINT）
ssh hxy@192.168.1.14 "cd /home/hxy/work/personal/project-manager/embedding && bash -c 'source /home/hxy/work/personal/project-manager/.env.production && PYTHONUNBUFFERED=1 nohup python3 -m uvicorn api:app --host 0.0.0.0 --port 5000 >> /tmp/embedding.log 2>&1 &'"

# 6. 等模型加载（约 1 分钟），确认服务就绪
sleep 60
ssh hxy@192.168.1.14 "curl http://localhost:5000/"
# 期望：{"status":"ok","model":"BAAI/bge-m3","dimension":1024}
```

> ⚠️ 步骤 3 清理模型缓存必须做，否则 `huggingface_hub` 会尝试从 huggingface.co 下载并超时挂死。

---

## 6. 测试 & 验证

### 6.1 生成测试 DOCX 并验证提取

```bash
# 生成测试文件
ssh hxy@192.168.1.14 "python3 -c \"
from docx import Document
d = Document()
d.add_heading('测试文档', 0)
d.add_paragraph('第一段测试内容。')
d.add_paragraph('第二段，含中文和英文。')
table = d.add_table(rows=2, cols=2)
table.rows[0].cells[0].text = '列1'
table.rows[0].cells[1].text = '列2'
table.rows[1].cells[0].text = '数据A'
table.rows[1].cells[1].text = '数据B'
d.save('/tmp/test.docx')
\""

# 转 base64 并调 API
ssh hxy@192.168.1.14 "BASE64=\\\$(base64 -w0 /tmp/test.docx) && curl -s -X POST http://localhost:5000/extract-text -H 'Content-Type: application/json' -d \\\"{\\"url\\":\\"data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,\\\\\\\${BASE64}\\",\\"mimeType\\":\\"application/vnd.openxmlformats-officedocument.wordprocessingml.document\\",\\"name\\":\\"test.docx\\",\\"size\\":0}\\\""
```

**期望输出**：

```json
{"text":"测试文档\n第一段测试内容。\n第二段，含中文和英文。\n列1 | 列2\n数据A | 数据B","source":"ok","name":"test.docx"}
```

### 6.2 验证真实笔记同步到向量库

```bash
ssh hxy@192.168.1.14 "source /home/hxy/work/personal/project-manager/.env.production && psql \"\$DATABASE_URL\" -t -c \"SELECT title, length(content) as len, (embedding IS NOT NULL) as has_vector FROM pm.\\\"SearchDocument\\\" WHERE \\"sourceType\\" = 'PKM_NOTE' ORDER BY \\"updatedAt\\" DESC LIMIT 3;\""
```

**期望**：
```
光污染设计需求文档 | 2039 | t
```

- `len` 应该 >= 2000（之前只有 42 字节元数据，修复后有 docx 正文）
- `has_vector = t`（向量已写入）

---

## 7. 复现 Checklist

- [ ] 确认服务器 FastAPI 正在运行（`ps aux | grep uvicorn | grep 5000`）
- [ ] 确认 `curl http://localhost:5000/` 返回 `{"status":"ok"...}` 且 `dimension:1024`
- [ ] 生成测试 DOCX，调 `/extract-text` 验证返回 `"source":"ok"` 且文本包含段落和表格
- [ ] 用 psql 查 `pm."SearchDocument"` 确认有笔记的 `content_len >= 2000` 且 `embedding IS NOT NULL`
- [ ] 在前端搜索笔记里的关键词（如"光污染"），确认能召回

---

## 8. 常见坑（避雷）

1. **模型加载挂死** — 服务器 huggingface.co 不通，必须清缓存 + 设 `HF_ENDPOINT=https://hf-mirror.com`
2. **api.py 不同步** — 本地改了但没推，服务器跑的还是旧版。部署前 `scp` 同步到服务器
3. **旧进程占端口** — 重启前先 `pkill -9 -f 'uvicorn.*5000'`，否则新进程起不来
4. **python-docx 未装** — `pip install python-docx>=1.0.0` 必须跑，否则 import 失败
5. **静默失败被忽略** — `extractAttachmentTexts` 里的 catch 只打日志，附件提取失败时笔记仍能入库（只是 content 里没有附件内容）
6. **向量搜索不召回** — 如果 `embedding IS NULL`，搜什么都不会命中。确认 FastAPI 可达且 `/embed_batch` 返回正常

---

## 9. 相关文档

- [附件文本提取（总览）](ATTACHMENT_TEXT_EXTRACTION.md) — 四类 mime 的完整实现链路
- [向量搜索故障排查](VECTOR_SEARCH_TROUBLESHOOT.md) — embedding 失败 / 静默吞异常的排查方法
- [PKM 分块实现](PKM_CHUNKING_IMPL.md) — SearchDocument 入库逻辑
