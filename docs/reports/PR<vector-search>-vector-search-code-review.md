# 向量搜索硬技术审查报告

**Scope:** 向量搜索链路（embedding.ts / search.ts / embedding/api.py）
**Review Type:** 局部代码审查（非 PR）
**Date:** 2026-06-30

---

## Verdict: ⚠️ Approved with Suggestions

向量搜索链路整体架构合理，已覆盖主要错误场景。但存在**静默失败风险**和**缺失超时保护**问题，在远端服务异常时会导致用户无法感知。

---

## Findings

### Critical (Must Fix)

#### 1. **[search.ts:1097]** 向量搜索失败静默吞掉，无日志

```startLine:1095:shared/lib/search.ts
const [keywordDocuments, vectorDocuments] = await Promise.all([
  searchKeywordCandidates({ query, projectId: options.projectId, limit: keywordLimit }),
  searchVectorCandidates({ query, projectId: options.projectId, limit: vectorLimit }).catch(() => []),
]);
```

- **Impact**: Embedding API 宕机时，向量搜索静默返回空数组，用户看到关键词搜索有结果但向量搜索完全没有反馈，不知道是向量搜索失败了还是真的没有语义相关结果。
- **Suggestion**: 捕获错误并记录日志，同时返回降级标识：

```typescript
searchVectorCandidates({ query, projectId: options.projectId, limit: vectorLimit })
  .catch((error) => {
    console.error(`[search:vector] failed for query "${query}":`, error instanceof Error ? error.message : String(error));
    return [];
  })
```

---

#### 2. **[embedding.ts:97-108]** `fetchEmbeddingsBatch` 缺少 AbortController + timeout

```startLine:97:shared/lib/embedding.ts
export async function fetchEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const base = getEmbeddingApiUrl();

  const resp = await fetch(`${base}/embed_batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
  });
  if (!resp.ok) throw new Error(`embed_batch failed: ${resp.status}`);
  const { embeddings } = (await resp.json()) as { embeddings: number[][] };
  return embeddings;
}
```

- **Impact**: 当 embedding 服务响应慢或挂起时，`fetchEmbeddingsBatch` 会无限期等待（无 timeout）。这在 `syncPkmNoteSearchDocument` 的同步路径（CLI backfill）里会导致进程挂死。
- **Suggestion**: 对齐 `fetchEmbedding` 的保护模式，添加 AbortController + timeout：

```typescript
export async function fetchEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const base = getEmbeddingApiUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getEmbeddingTimeoutMs());

  try {
    const resp = await fetch(`${base}/embed_batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`embed_batch failed: ${resp.status}`);
    const { embeddings } = (await resp.json()) as { embeddings: number[][] };
    return embeddings;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("EMBEDDING_BATCH_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
```

---

### High (Recommended)

#### 3. **[search.ts:636-646]** `upsertSearchDocument` embedding 失败会抛出，但调用方吞掉了

```startLine:636:shared/lib/search.ts
  try {
    const state = await getSearchDocumentEmbeddingState(document.id);
    if (state) {
      await ensureSearchDocumentEmbedding(state);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[search:upsert] embedding failed for ${document.id} (${document.title}): ${msg}`);
    throw error;  // ← 会抛出
  }
```

- **Impact**: `upsertSearchDocument` 抛出错误后，调用方 `syncTicketSearchDocument`（677-680）和 `syncCommitSearchDocument`（708-712）都 catch 住并返回 `null`，日志可见但用户无感知。
- **Suggestion**: 这个行为**在当前架构下是合理的**（索引失败不应阻止主业务），但建议在 `SearchDocument` 表增加 `embeddingFailedAt` 时间戳列，用于后台重试队列标记。

---

#### 4. **[embedding/api.py:70-74]** `/embed` 和 `/embed_batch` 端点缺少异常处理

```startLine:70:embedding/api.py
@app.post("/embed")
async def embed(body: EmbedRequest):
    """接收单个文本，返回 1024 维向量（JSON 数组）"""
    emb = model.encode(body.text).tolist()
    return JSONResponse({"embedding": emb})
```

- **Impact**: 如果 `model.encode()` 抛出任何异常（如 GPU OOM、输入格式问题），FastAPI 会返回 500 但无结构化错误信息，客户端难以区分错误类型。
- **Suggestion**: 用 try/except 包裹，返回结构化错误：

```python
@app.post("/embed")
async def embed(body: EmbedRequest):
    try:
        emb = model.encode(body.text).tolist()
        return JSONResponse({"embedding": emb})
    except Exception as exc:
        print(f"[embed] encode failed: {exc}")
        return JSONResponse({"error": "encode_failed", "detail": str(exc)}, status_code=500)
```

---

#### 5. **[search.ts:1097]** `searchVectorCandidates` 缺少独立错误日志

`searchVectorCandidates` 内部调用 `fetchEmbedding`（913-918），如果 embedding 服务不可达，会抛出错误被外层 catch 返回 `[]`。但日志只在 `searchDocuments` 级别统一打印，用户无法区分是哪个子步骤失败。

- **Suggestion**: 在 `searchVectorCandidates` 内部 catch 并记录具体错误：

```typescript
async function searchVectorCandidates(options: { ... }) {
  try {
    const vector = await fetchEmbedding(options.query);
    // ... SQL 查询 ...
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[search:vector] fetchEmbedding failed: ${msg}`);
    return [];
  }
}
```

---

### Medium

#### 6. **[search.ts:262-269]** `updateSearchDocumentEmbedding` 缺少 `search_path` 显式设置

```startLine:262:shared/lib/search.ts
async function updateSearchDocumentEmbedding(id: string, vector: number[]) {
  const literal = vectorToSqlLiteral(vector);
  await prisma.$executeRaw`
    UPDATE pm."SearchDocument"
    SET embedding = ${literal}::public.vector
    WHERE id = ${id}
  `;
}
```

- **Impact**: 代码已使用 `::public.vector` 显式 schema 前缀，比 `::vector` 更安全。但根据 `VECTOR_SEARCH_TROUBLESHOOT.md` 的记录，根因是 `DATABASE_URL` 的 `search_path` 配置。如果用户环境配置有误，`::public.vector` 仍可能找不到。
- **Suggestion**: 这不是代码问题，是部署配置问题。已在 `VECTOR_SEARCH_TROUBLESHOOT.md` 有记录，提醒主代理确保 `.env.production` 的 `DATABASE_URL` 包含 `options=-c%20search_path%3Dpm,public`。

---

#### 7. **[embedding/api.py:108]** `MAX_EXTRACT_FILE_SIZE` 在 `_fetch_http_bytes` 中硬编码为 `10MB`

```startLine:108:embedding/api.py
with urllib.request.urlopen(request, timeout=EXTRACT_TEXT_TIMEOUT_SECONDS) as response:
    return response.read(MAX_EXTRACT_FILE_SIZE + 1)
```

- **Impact**: 硬编码边界，检查发生在读完数据之后。如果网络返回超大 payload（>10MB），已经占用了内存。建议在读取前检查 `Content-Length` header。
- **Suggestion**: 添加预检：

```python
content_length = response.headers.get("Content-Length")
if content_length and int(content_length) > MAX_EXTRACT_FILE_SIZE:
    raise ValueError("file_too_large")
```

---

### Low (Nitpicks)

#### 8. **[embedding.ts:4]** `DEFAULT_EMBEDDING_TIMEOUT_MS = 30000` 对批量请求可能偏短

- `fetchEmbedding` (单条): 30s timeout 合理
- `fetchEmbeddingsBatch` (批量 n 条): 30s 对大批量可能不够
- **Suggestion**: 考虑让批量请求 timeout 与文本数量成比例，如 `30s * ceil(texts.length / 10)`。

---

#### 9. **[search.ts:262]** `vectorToSqlLiteral` 缺少 float 精度保护

```startLine:258:shared/lib/search.ts
function vectorToSqlLiteral(vector: number[]) {
  return `[${vector.join(",")}]`;
}
```

- **Impact**: JavaScript `toString()` 可能产生超长小数位（如 `0.10000000001`），增加 SQL payload 大小。
- **Suggestion**: 截断到合理精度：

```typescript
function vectorToSqlLiteral(vector: number[]) {
  return `[${vector.map((v) => v.toFixed(6)).join(",")}]`;
}
```

---

## Positive Points

- **`coerceMetadata` 防御充分**：正确处理 null / non-object / array 输入，返回空对象而非抛出。
- **`canAccessSearchResult` 权限检查完善**：对 metadata 缺失和 null 情况都有明确分支，笔记权限逻辑正确。
- **`searchDocuments` 双路并行**：关键词 + 向量并行查询，互不阻塞，提升响应速度。
- **向量候选保留独立 chunk**：`mergeCandidates` 不做去重，允许多个 chunk 竞争，避免答案丢失。
- **truncate 逻辑合理**：chunk 边界保留完整内容（800 chars 内），避免答案被切断。
- **Embedding API `/health` 和 `/dimension` 端点**：健康检查和维度验证端点完备，便于监控。

---

## 对照已有踩坑记录

| 已有坑 | 代码是否修复 |
|--------|------------|
| `search_path` 导致 `::vector` 找不到 | ✅ 已使用 `::public.vector` 显式前缀（search.ts:266, 932） |
| metadata NULL 导致 `canAccessSearchResult` 静默丢弃 | ✅ 已加 `if (!item.metadata) return false;` 防御（search.ts:996） |
| 静默失败无日志 | ❌ **仍存在** — searchVectorCandidates 失败被 `.catch(() => [])` 吞掉 |

---

## Next Steps

1. **Critical #1, #2** 必须修复：添加向量搜索失败日志 + 给 `fetchEmbeddingsBatch` 加 timeout
2. **High #4** 建议修复：embedding API 端点加 try/except
3. 确认 `.env.production` 的 `DATABASE_URL` 包含 `options=-c%20search_path%3Dpm,public`
4. 考虑增加 `embeddingFailedAt` 列支持索引重试队列

---

*报告由 code-reviewer 子代理生成*
