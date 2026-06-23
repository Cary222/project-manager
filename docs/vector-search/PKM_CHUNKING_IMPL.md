# PKM 向量搜索 Chunking 实现

## 背景

长 PKM 笔记（如向量搜索故障排查指南，22万字符）超出 BGE-M3 的 8000 token 上限时会导致静默失败。本实现将笔记分块处理，每个 chunk 独立嵌入向量。

## 改动概览

### Schema

`prisma/schema.prisma` — `SearchDocument` 模型：

```prisma
model SearchDocument {
  id          String
  sourceType  SearchDocumentSourceType
  sourceId    String
  chunkIndex  Int   @default(0)    // 新增
  // ...
  @@unique([sourceType, sourceId, chunkIndex])  // 3字段唯一键
}
```

**迁移**：`npx prisma db push --accept-data-loss`

### 核心函数

**`splitIntoChunks(text, maxChars=1500, overlapChars=200)`** (`shared/lib/search.ts`)

```
边界守卫模式：超过 maxChars 才分块，否则返回 [text]
Overlap 确保跨 chunk 关键词不遗漏
```

**`buildSearchablePkmNoteChunks(note, attachmentTexts)`** → `SearchableRecord[]`

```
将笔记内容和附件文本分别切分
每个 chunk 独立 SearchableRecord
metadata 携带 chunkIndex / totalChunks
```

**`syncPkmNoteSearchDocument(noteId)`** — 重写

```
1. deleteMany 清理旧 chunks（chunkIndex 重置）
2. buildSearchablePkmNoteChunks 生成所有 chunk
3. upsertSearchDocument(skipEmbedding=true) 批量写入 content
4. fetchEmbeddingsBatch 一次 API 调用获取所有向量
5. Promise.all 并行写入向量到 DB
```

**`upsertSearchDocument(record, chunkIndex=0, skipEmbedding=false)`**

```
新参数支持多 chunk 写入
skipEmbedding=true 时跳过向量生成（batch 时统一处理）
```

### 搜索聚合

**`searchKeywordCandidates`** — keyword 候选放大

```
take: limit * 10（放大 10 倍）
按 sourceId 聚合：同笔记多 chunk 时保留 content 最长者
返回: SearchDocumentRow[]
```

**`searchVectorCandidates`** — vector 候选聚合

```
向量搜索后按 sourceId 聚合，保留 distance 最小 chunk
返回: VectorSearchRow[]
```

**`mergeCandidates`** — key 修正

```typescript
// 旧: merged.set(document.id, candidate)
// 新: merged.set(`${sourceType}:${sourceId}`, candidate)
```

同一笔记多个 chunk 的不同命中统一聚合，不再分裂。

### Embedding 批量接口

**`fetchEmbeddingsBatch(texts: string[])`** (`shared/lib/embedding.ts`)

```
POST /embed_batch { texts: string[] }
返回: { embeddings: number[][] }
```

调用远程 `http://192.168.1.14:5000/embed_batch`

### 搜索参数调优

| 常量 | 旧值 | 新值 | 原因 |
|------|------|------|------|
| `VECTOR_CANDIDATE_MULTIPLIER` | 2 | **10** | 召回更多 chunk 后聚合 |
| `searchKeywordCandidates take` | limit | limit × 10 | keyword 侧放大 |

## 测试结果

| 笔记 | 内容长度 | Chunks | 向量 | 搜索命中 |
|------|---------|--------|------|---------|
| 向量搜索故障排查指南 | 229,488 字符 | 6 | 6/6 | 1 条（聚合） |
| PKM 链路 schema 要点 | — | 7 | 7/7 | 1 条 |
| SEO 关键词搜索 | — | 1 | 1/1 | 1 条 |
| 经纬仪文档 | — | 5 | 5/5 | 1 条 |
| CH585M 芯片手册 | — | 3 | 3/3 | 1 条 |
| git 助手 | — | 2 | 2/2 | 1 条 |

**搜索 E2E 测试**（7 个场景）：

- 长笔记向量搜索：6 chunk → 1 条聚合结果 ✓
- keyword+vector 双通道评分正常 ✓
- commit/ticket/note 跨类型聚合正确 ✓
- 耗时 100-230ms ✓

## Backfill

现有 6 篇 PKM 笔记全部重新分 chunk，共生成 24 个 chunk，全部向量嵌入成功。

```bash
# 触发同步（笔记保存时自动调用）
syncPkmNoteSearchDocument(noteId)

# 重建所有搜索文档
backfillSearchDocuments()
```

## 已知问题

1. **脚本 embedding 检测 bug**：`chunk.embedding !== undefined` 对 unsupported 类型无效，需用 DB count 确认。
2. **batch 批量大小**：笔记 chunk 过多时（>100）可能触发 embedding API 超时。已修复为每篇笔记独立 batch。

## 文件清单

```
prisma/schema.prisma                    +chunkIndex, @@unique 3字段
shared/lib/embedding.ts                 +fetchEmbeddingsBatch()
shared/lib/search-types.ts              +chunkIndex?, totalChunks?
shared/lib/search.ts                    splitIntoChunks, buildSearchablePkmNoteChunks,
                                      syncPkmNoteSearchDocument 重写,
                                      upsertSearchDocument 参数,
                                      searchKeywordCandidates 聚合,
                                      searchVectorCandidates 聚合,
                                      mergeCandidates key 修正
```

---

*生成时间: 2026-06-23*
