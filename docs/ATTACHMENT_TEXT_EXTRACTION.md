# PKM 笔记附件文本提取 — 开发到测试复现手册

> 适用：project-manager 仓库（Next.js 14 + Prisma pm schema + pgvector + FastAPI + BGE-M3）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"PKM 笔记的 PDF / PPTX / 文本附件文本被 BGE-M3 向量化、全文检索能搜到"这条端到端链路。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

PKM 笔记的附件存在 `pm.PkmNote.attachments`（`Json` 字段）里，但**附件内容从未进入搜索**：

- 笔记 `content`（标题 + 作者 + 正文）→ BGE-M3 → embedding 存 `pm.SearchDocument` ✓
- 附件二进制 / 文件名 / mime → 存进 `attachments` 字段 → **不进入 `SearchDocument.content`** ✗
- 用户搜「时角」「旋转矩阵」时，**正文中完全没提这些词的笔记**（如"经纬仪文档"）搜不到 ❌
- 知识库 5 条笔记里 5 条带附件（PDF/PPTX/文本），全部"搜不到附件内容"

### 1.2 结论先行

- **不破坏旧链路**：附件为空时退化到原行为（仅正文向量化）
- **三步走**：FastAPI 加 `/extract-text` → Next.js 客户端调它拿文本 → 文本塞进 `SearchDocument.content` 一起向量化
- **覆盖三类 mime**：`text/*`（含 `text/markdown`、`text/csv`、`application/json`、`application/xml`）+ `application/pdf` + `application/vnd.openxmlformats-officedocument.presentationml.presentation`
- **降级优雅**：单附件超时 / 太大 / mime 不支持 → 跳过该附件但笔记仍能入库（source 字段记录原因）
- **数据迁移友好**：跑一次 `scripts/reindex-pkm-notes.ts --batch-size=1` 即可全量重建

---

## 2. 改动清单

| # | 文件 | 类型 | 作用 |
|---|------|------|------|
| 1 | `embedding/api.py` | 修改 | 新增 `/extract-text` 端点 + 3 个 mime 解析器（text/pdf/pptx） |
| 2 | `embedding/requirements.txt` | 修改 | 加 `pdfplumber>=0.10.0` 和 `python-pptx>=0.6.21` |
| 3 | `shared/lib/embedding.ts` | 修改 | 导出 `getEmbeddingApiUrl()` 给 search 复用 |
| 4 | `shared/lib/search.ts` | 修改 | 新增 `extractAttachmentText(s)` 客户端 + `buildSearchablePkmNoteDocument` 改 async + `syncPkmNoteSearchDocument` / `backfillSearchDocuments` 接入提取 |

无 schema 变更（`attachments` 字段早就是 `Json`）。

---

## 3. 核心实现

### 3.1 FastAPI 端点（`embedding/api.py`）

#### 3.1.1 路由分发核心

```79:135:embedding/api.py
class ExtractRequest(BaseModel):
    url: str
    mimeType: str
    name: str
    size: int = 0


def _decode_data_url(url: str) -> bytes:
    match = DATA_URL_PATTERN.match(url)
    if not match:
        raise ValueError("invalid_data_url")
    _, is_base64, payload = match.groups()
    if is_base64:
        return base64.b64decode(payload)
    from urllib.parse import unquote

    return unquote(payload).encode("utf-8")


def _fetch_http_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "project-manager/extract"})
    with urllib.request.urlopen(request, timeout=EXTRACT_TEXT_TIMEOUT_SECONDS) as response:
        return response.read(MAX_EXTRACT_FILE_SIZE + 1)


def _read_bytes(url: str) -> bytes:
    if url.startswith("data:"):
        return _decode_data_url(url)
    if url.startswith("http://") or url.startswith("https://") or url.startswith("/"):
        return _fetch_http_bytes(url)
    raise ValueError("unsupported_url_scheme")


def _extract_text_from_bytes(raw: bytes, mime_type: str) -> str:
    normalized = (mime_type or "").split(";")[0].strip().lower()

    if normalized.startswith(TEXT_MIME_PREFIXES):
        return raw.decode("utf-8", errors="replace")

    if normalized == PDF_MIME:
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages)

    if normalized == PPTX_MIME:
        presentation = Presentation(io.BytesIO(raw))
        parts = []
        for slide in presentation.slides:
            for shape in slide.shapes:
                if not shape.has_text_frame:
                    continue
                for paragraph in shape.text_frame.paragraphs:
                    text = "".join(run.text for run in paragraph.runs).strip()
                    if text:
                        parts.append(text)
        return "\n".join(parts)

    raise ValueError(f"unsupported_mime:{normalized}")
```

**为什么这样写**：
- `data:` 协议是 PKM 笔记**当前唯一**的存储方式（前端把文件 base64 进 attachments.url）。`_decode_data_url` 处理带 / 不带 `;base64` 两种格式
- HTTP 路径走 `urllib.request` 而不是 `requests` —— **FastAPI 进程已经有 `pdfplumber`/`pptx` 这种重依赖**，不引入额外包
- mime 归一化在 `_extract_text_from_bytes` 里只 strip `;` 后内容（`application/json; charset=utf-8` → `application/json`）

#### 3.1.2 端点本体

```166:193:embedding/api.py
@app.post("/extract-text")
async def extract_text(body: ExtractRequest):
    """提取附件文本：data URL 走 base64；HTTP 路径走 fetch；按 mimeType 路由解析器。"""
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                extract_attachment_text,
                body.url,
                body.mimeType,
                body.name,
                body.size,
            ),
            timeout=EXTRACT_TEXT_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return JSONResponse(
            {"text": "", "source": "timeout", "name": body.name},
            status_code=200,
        )
    except Exception as exc:
        print(f"[extract-text] handler failed for {body.name}: {exc}")
        return JSONResponse(
            {"text": "", "source": "handler_error", "name": body.name},
            status_code=200,
        )

    return JSONResponse({**result, "name": body.name})
```

**为什么这样写**：
- `asyncio.to_thread` 把同步的 PDF 解析放到线程池，**不阻塞事件循环**（其他 `/embed` 请求仍能并发）
- `wait_for` 给整个提取套 15s 超时，**始终返回 200 + source 字段**，客户端按 `source` 判断
- 返回体恒有 `text` / `source` / `name` 三个字段，**客户端永远不用 try/catch**

### 3.2 Next.js 客户端（`shared/lib/search.ts`）

#### 3.2.1 单附件提取

```354:404:shared/lib/search.ts
export async function extractAttachmentText(
  attachment: PkmAttachment,
): Promise<AttachmentExtraction> {
  if (attachment.size > PKM_ATTACHMENT_MAX_SIZE) {
    return { name: attachment.name, text: "", source: "skipped_too_large" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACT_TEXT_TIMEOUT_MS);

  try {
    const base = getEmbeddingApiUrl();
    const response = await fetch(`${base}/extract-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: attachment.url,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { name: attachment.name, text: "", source: `http_${response.status}` };
    }

    const payload = (await response.json()) as {
      text?: unknown;
      source?: unknown;
      name?: unknown;
    };
    const rawText = typeof payload.text === "string" ? payload.text : "";
    const text = rawText.length > MAX_EXTRACTED_CHARS
      ? `${rawText.slice(0, MAX_EXTRACTED_CHARS).trimEnd()}…`
      : rawText;
    return {
      name: attachment.name,
      text,
      source: typeof payload.source === "string" ? payload.source : "unknown",
    };
  } catch (error) {
    const source = error instanceof Error && error.name === "AbortError"
      ? "timeout"
      : "error";
    return { name: attachment.name, text: "", source };
  } finally {
    clearTimeout(timeout);
  }
}
```

**为什么这样写**：
- `PKM_ATTACHMENT_MAX_SIZE` 是**前端**先卡一道（默认 10MB，定义在 `shared/lib/pkm.ts`），省一次网络往返
- `MAX_EXTRACTED_CHARS = 2000`：防止 100 页 PDF 把 BGE-M3 喂爆（BGE-M3 推荐 512 token，2000 字符约 700 token）
- **所有失败路径**都返回 `AttachmentExtraction`（非抛异常），调用方 `Promise.all` 不会因单附件死掉

#### 3.2.2 批量 + 注入 content

```406:430:shared/lib/search.ts
export async function extractAttachmentTexts(
  attachments: PkmAttachment[],
): Promise<Map<string, string>> {
  if (attachments.length === 0) return new Map();

  const results = await Promise.all(
    attachments.map((attachment) =>
      extractAttachmentText(attachment).catch((error) => {
        console.error(
          `[search:extract] failed for ${attachment.name}:`,
          error instanceof Error ? error.message : String(error),
        );
        return { name: attachment.name, text: "", source: "error" } satisfies AttachmentExtraction;
      }),
    ),
  );

  const map = new Map<string, string>();
  for (const result of results) {
    if (result.text.length > 0) {
      map.set(result.name, result.text);
    }
  }
  return map;
}
```

注入点（`buildSearchablePkmNoteDocument`）：

```298:342:shared/lib/search.ts
export async function buildSearchablePkmNoteDocument(
  note: SearchDocumentPkmNoteRecord,
  attachmentTexts: Map<string, string> = new Map(),
): Promise<SearchableRecord> {
  const authorName = note.user.name || note.user.email;
  const title = note.title.trim();
  const attachments = normalizePkmAttachments(note.attachments);
  const cleanedContent = cleanMarkdownForEmbedding(note.content);
  const attachmentSections = attachments
    .map((attachment) => {
      const text = attachmentTexts.get(attachment.name);
      if (!text) return null;
      return `[附件 ${attachment.name} 提取]\n${text}`;
    })
    .filter((section): section is string => Boolean(section));
  const content = [
    `标题 ${title}`,
    `作者 ${authorName}`,
    note.project ? `项目 ${note.project.name}` : null,
    note.tags.length > 0 ? `标签 ${note.tags.join("、")}` : null,
    attachments.length > 0 ? `附件 ${attachments.map(formatAttachmentLabel).join("、")}` : null,
    cleanedContent ? `正文 ${cleanedContent}` : null,
    attachmentSections.length > 0 ? attachmentSections.join("\n\n") : null,
  ]
    .filter(Boolean)
    .join("\n");
```

**为什么这样写**：
- 附件文本以 `[附件 xxx 提取]\n...` 形式追加在正文后 —— 让 BGE-M3 看到「这是附件内容」的语义线索
- `Map<name, text>` 用 `attachment.name` 当 key —— 必须确保 `normalizePkmAttachments` 后 `name` 唯一（重复时后者覆盖前者，**生产环境我们没碰到重复名**）

#### 3.2.3 单条同步 + 全量回填 接入

```534:562:shared/lib/search.ts
export async function syncPkmNoteSearchDocument(noteId: string) {
  const note = await prisma.pkmNote.findUnique({
    where: { id: noteId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      project: { select: { id: true, name: true } },
    },
  });

  if (!note) {
    await prisma.searchDocument.deleteMany({
      where: {
        sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE),
        sourceId: noteId,
      },
    });
    return null;
  }

  const attachments = normalizePkmAttachments(note.attachments);
  const attachmentTexts = await extractAttachmentTexts(attachments);

  return upsertSearchDocument(
    await buildSearchablePkmNoteDocument(
      { ...note, attachments },
      attachmentTexts,
    ),
  );
}
```

```595:605:shared/lib/search.ts
await Promise.all([
    ...tickets.map((ticket) => upsertSearchDocument(buildSearchableTicketDocument(ticket))),
    ...commits.map((commit) => upsertSearchDocument(buildSearchableCommitDocument(commit))),
    ...notes.map(async (note) => {
      const attachments = normalizePkmAttachments(note.attachments);
      const attachmentTexts = await extractAttachmentTexts(attachments);
      return upsertSearchDocument(
        await buildSearchablePkmNoteDocument({ ...note, attachments }, attachmentTexts),
      );
    }),
  ]);
```

> `backfillSearchDocuments` 被 `lib/git-sync/scan.ts:170` 在 git-sync 流程里自动调，所以**新笔记 / 改动会自动同步**。

---

## 4. 环境与配置

| 项 | 值 | 说明 |
|----|----|------|
| FastAPI 端口 | `0.0.0.0:5000` | 同向量服务复用 |
| `EMBEDDING_API_URL` | `http://localhost:5000` | 主应用 `.env.production` / `.env` 都需要 |
| Python 包 | `pdfplumber>=0.10.0`、`python-pptx>=0.6.21` | 新加，已写进 `embedding/requirements.txt` |
| 前端超时 | `EXTRACT_TEXT_TIMEOUT_MS = 15_000` | `shared/lib/search.ts:34` |
| 前端大小上限 | `PKM_ATTACHMENT_MAX_SIZE` | `shared/lib/pkm.ts`，默认 10MB |
| 文本截断 | `MAX_EXTRACTED_CHARS = 2000` | `shared/lib/search.ts:35`，PDF/PPTX 提取后超长会被截 |
| 服务端超时 | `EXTRACT_TEXT_TIMEOUT_SECONDS = 15` | `embedding/api.py:23` |
| 服务端大小上限 | `MAX_EXTRACT_FILE_SIZE = 10 * 1024 * 1024` | `embedding/api.py:25` |

---

## 5. 启动 / 部署

### 5.1 装 Python 依赖（新增）

```bash
ssh hxy@192.168.1.14
cd /home/hxy/work/personal/project-manager/embedding
pip install -r requirements.txt
```

### 5.2 重启 FastAPI

```bash
# 找旧进程
ps aux | grep "uvorn.*5000" | grep -v grep
# 杀掉
kill <PID>
# 重启（带 --reload-dir 才能热重载我们改的两个文件）
nohup python3 -m uvicorn api:app --host 0.0.0.0 --port 5000 \
  --reload-dir /home/hxy/work/personal/project-manager/embedding \
  > /tmp/embedding.log 2>&1 &
```

**冷启动约 10-30s**（加载 BGE-M3）。判断就绪：

```bash
curl -s http://localhost:5000/dimension
# 期望：{"dimension":1024}
```

### 5.3 推送代码 + 重建主应用

```bash
# 本地仓库
cd /Users/vastgui/Desktop/project-manager

# 1. 把远端代码拉下来
ssh hxy@192.168.1.14 "cd /home/hxy/work/personal/project-manager && git pull origin main"

# 2. 在本地编辑完后，commit + push（推送即部署）
git add embedding/api.py embedding/requirements.txt shared/lib/embedding.ts shared/lib/search.ts
git commit -m "embedding: 新增 /extract-text 端点，PKM 附件正文进入向量搜索"
git push origin main
```

部署钩子会跑 `scripts/deploy.sh`（详见 [OPERATIONS.md](./OPERATIONS.md)）。

### 5.4 重启主应用（如果 deploy hook 没自动重启）

```bash
ssh hxy@192.168.1.14
cd /home/hxy/work/personal/project-manager
npm run build
fuser -k 3003/tcp 2>/dev/null; sleep 1; npm run start
```

> `fuser -k` 报 `exit 137` 是正常的（杀旧进程）。

### 5.5 确认服务都活着

```bash
# 主应用
curl -s -o /dev/null -w "app=%{http_code}\n" http://localhost:3003
# 期望：app=200

# Embedding API
curl -s -w "\nemb=%{http_code}\n" http://localhost:5000/dimension
# 期望：{"dimension":1024} emb=200
```

---

## 6. 测试 & 验证

### 6.1 单元 / 端点测试：三 mime 路由

构造三类样本附件的 data URL，调 `/extract-text`：

```bash
# 假设你已生成 3 个样本文件：sample.txt / sample.pdf / sample.pptx
# 编码成 data URL
TXT_URL="data:text/markdown;base64,$(base64 -i sample.txt | tr -d '\n')"
PDF_URL="data:application/pdf;base64,$(base64 -i sample.pdf | tr -d '\n')"
PPTX_URL="data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,$(base64 -i sample.pptx | tr -d '\n')"

# 文本
curl -s -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$TXT_URL\",\"mimeType\":\"text/markdown\",\"name\":\"sample.txt\",\"size\":$(stat -f%z sample.txt)}"
# 期望：{"text":"...","source":"ok","name":"sample.txt"}

# PDF
curl -s -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$PDF_URL\",\"mimeType\":\"application/pdf\",\"name\":\"sample.pdf\",\"size\":$(stat -f%z sample.pdf)}"
# 期望：{"text":"目 录\n一、坐标系...","source":"ok","name":"sample.pdf"}

# PPTX
curl -s -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$PPTX_URL\",\"mimeType\":\"application/vnd.openxmlformats-officedocument.presentationml.presentation\",\"name\":\"sample.pptx\",\"size\":$(stat -f%z sample.pptx)}"
# 期望：{"text":"...","source":"ok","name":"sample.pptx"}

# 不支持的 mime
curl -s -X POST http://localhost:5000/extract-text \
  -H "Content-Type: application/json" \
  -d '{"url":"data:application/zip;base64,UEsDBA==","mimeType":"application/zip","name":"x.zip","size":5}'
# 期望：{"text":"","source":"parse_error","name":"x.zip"}（zip 走 raw.decode 失败，parse_error 兜底）
```

### 6.2 端到端：reindex 全部 5 条 PKM 笔记

```bash
ssh hxy@192.168.1.14
cd /home/hxy/work/personal/project-manager
set -a && source .env.production && set +a
npx tsx scripts/reindex-pkm-notes.ts --batch-size=1
```

**期望输出**（节选）：

```
[search:reindex-pkm] discovered 5 PkmNote rows / 5 existing SearchDocument rows
[search:reindex-pkm] starting batch reindex: notes=5 batches=5 batchSize=1 concurrency=1
[search:reindex-pkm] batch 1/5 done=1 errors=0 avgMs=4897    # CH585M PDF 1.5MB
[search:reindex-pkm] batch 2/5 done=1 errors=0 avgMs=6       # 纯文本
[search:reindex-pkm] batch 3/5 done=1 errors=0 avgMs=13      # 纯文本
[search:reindex-pkm] batch 4/5 done=1 errors=0 avgMs=9       # 纯文本
[search:reindex-pkm] batch 5/5 done=1 errors=0 avgMs=12683  # 经纬仪 2 个 PDF 共 3MB
[search:reindex-pkm] finished total=5 processed=5 failed=0 elapsedMs=17608
```

**关键指标**：`errors=0` 全程 + 末尾 `failed=0`。

### 6.3 端到端：验证 PDF 文本确实进了 SearchDocument

```bash
ssh hxy@192.168.1.14
cd /home/hxy/work/personal/project-manager
set -a && source .env.production && set +a

# 用 psql 直接查"经纬仪文档"那条的 SearchDocument.content
psql "$DATABASE_URL" -c "
SELECT
  length(content) AS content_len,
  substring(content from 1 for 800) AS head,
  substring(content from length(content) - 600) AS tail
FROM pm.\"SearchDocument\"
WHERE \"sourceType\" = 'PKM_NOTE'
  AND title = '经纬仪文档';
"
```

**期望看到**：

- `head` 含：
  ```
  标题 经纬仪文档
  作者 freeeeeG
  项目 寻星望远镜
  附件 经纬仪误差补偿算法V2.2(1).pdf (application/pdf)、经纬仪控制文档(3).pdf (application/pdf)
  正文 世轩写的经纬仪算法
  使用三次解析来约束新的矩阵
  [附件 经纬仪误差补偿算法V2.2(1).pdf 提取]
  目 录
  一、坐标系建立与符号表示...
  ```
- `tail` 含：`时角 (HourAngle, HA)` 之类的正文（来自第二个 PDF「经纬仪控制文档(3).pdf」）
- `content_len > 1000`（之前没附件时是 100 字符内）

### 6.4 业务验证：搜附件内容能召回

打开 http://192.168.1.14:3003 知识库页 → 搜「时角」或「旋转矩阵」。

**期望**：「经纬仪文档」出现在结果列表（之前完全搜不到）。

### 6.5 降级路径：单附件失败不影响整条

手动构造一条笔记：附件是损坏 PDF。期望：

- HTTP `/extract-text` 返回 `{"text":"","source":"parse_error",...}` （200 不是 500）
- SearchDocument 仍写入（只是不包含这段附件文本）
- 客户端日志打印 `[search:extract] failed for ...`

---

## 7. 复现 Checklist

```markdown
- [ ] ssh hxy@192.168.1.14 连上远端
- [ ] 确认 .env.production 里有 EMBEDDING_API_URL=http://localhost:5000
- [ ] 装好 pdfplumber + python-pptx（pip install -r requirements.txt）
- [ ] 重启 FastAPI（kill 旧 PID + nohup uvicorn ... &）
- [ ] curl http://localhost:5000/dimension 返回 {"dimension":1024}
- [ ] 本地 commit + push 到 main（推送即部署）
- [ ] 远端 npm run build + fuser -k 3003/tcp + npm run start
- [ ] curl http://localhost:3003 返回 200
- [ ] 跑 6.1 三个 curl 验证三类 mime 解析器（期望 text/source=ok）
- [ ] 跑 6.2 reindex（期望 5/5 成功，0 errors）
- [ ] 跑 6.3 psql 查 SearchDocument.content（期望看到 [附件 xxx 提取] 段落）
- [ ] 浏览器手测 6.4（搜「时角」能召回「经纬仪文档」）
- [ ] 跑 6.5 损坏 PDF 降级（期望 source=parse_error 但笔记仍入库）
```

---

## 8. 常见坑

1. **`EMBEDDING_API_URL` 没设** → `extractAttachmentText` 抛 `EMBEDDING_API_URL_MISSING`，reindex 中止。**检查 `.env.production`**
2. **FastAPI 没重启** → 改了 `api.py` 但 `--reload-dir` 没包含新文件路径，命中旧版本逻辑
3. **`pdfplumber` 没装** → 第一次 PDF 请求会 `ModuleNotFoundError`，但 `/extract-text` 兜底成 `parse_error`（不会 500），表现为 PDF 搜不到 —— **不容易察觉**。**先单独 curl 一份 PDF 验证**
4. **PDF 是扫描件** → `pdfplumber.extract_text()` 返回空。这是已知限制，**本功能不支持 OCR**
5. **附件 `size` 字段不准** → `attachments` JSON 里的 `size` 是前端计算的 base64 字节数，**不是原始文件大小**。当前实现用 `size` 做粗筛，**不会出 bug** 但精度有差
6. **PKM_ATTACHMENT_MAX_SIZE 改了** → 在 `shared/lib/pkm.ts`，需要重启主应用

---

## 9. 附录

### 9.1 source 字段值清单

| 值 | 含义 |
|----|------|
| `ok` | 解析成功 |
| `skipped_too_large` | 超过 10MB 直接跳过（客户端或服务端都可能返回） |
| `timeout` | 客户端 15s 超时 或 服务端 15s 超时 |
| `parse_error` | mime 不支持 / base64 损坏 / 文档结构异常 |
| `read_error` | HTTP URL 下载失败 |
| `handler_error` | 兜底异常 |
| `http_4xx` / `http_5xx` | FastAPI 返回非 200 |
| `error` | 客户端 `Promise.all` 兜底 |

### 9.2 关键源文件位置

- 路由分发：`embedding/api.py:104-135`
- 端点本体：`embedding/api.py:166-193`
- 客户端单条：`shared/lib/search.ts:354-404`
- 客户端批量：`shared/lib/search.ts:406-430`
- 注入 content：`shared/lib/search.ts:298-342`
- 同步入口：`shared/lib/search.ts:534-562`
- 全量回填：`shared/lib/search.ts:564-606`

### 9.3 相关文档

- 架构总览：[docs/ARCHITECTURE.md](./ARCHITECTURE.md)
- 运维说明：[docs/OPERATIONS.md](./OPERATIONS.md)
- 向量搜索清洗（前置优化）：[docs/PKM_SEARCH_CLEANING.md](./PKM_SEARCH_CLEANING.md)
- 故障排查：[docs/VECTOR_SEARCH_TROUBLESHOOT.md](./VECTOR_SEARCH_TROUBLESHOOT.md)
