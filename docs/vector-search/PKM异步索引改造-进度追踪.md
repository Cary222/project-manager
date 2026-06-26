# 笔记向量索引异步化改造 — 进度追踪

> 适用：project-manager 仓库
> 状态：规划中
> 日期：2026-06-26

---

## 一、涉及的知识领域

### 1.1 RAG（Retrieval-Augmented Generation）

**什么是 RAG**：将文档切块、向量化存储于向量数据库，检索时通过向量相似度匹配找到最相关的块，再送入 LLM 生成答案。本项目的向量搜索本质上是一个轻量版 RAG——没有 LLM 调用层，只有检索层（向量 + 关键词混合召回）。

**相关概念**：
- `Chunking`：将长文档切分成小段，每段独立编码向量。本项目 `CHUNK_SIZE=1500`, `CHUNK_OVERLAP=200`，分页最大 6 轮。
- `Embedding`：将文本转为 1024 维向量的过程，由 `embedding/api.py`（BGE-M3 模型）提供。
- `Vector Store`：本项目用 PostgreSQL + `pgvector` 扩展（`public.vector`），不是 Milvus / Pinecone / Weaviate 等独立向量库。

### 1.2 向量搜索架构（全链路）

```
用户搜索 "BLE"
    ↓
API /api/search?q=BLE
    ↓
PostgreSQL $queryRaw（pgvector <-> 语义匹配）→ 候选集
    ↓
关键词兜底（ILIKE）→ 候选集
    ↓
RRF 融合 + 排序
    ↓
canAccessSearchResult 权限过滤
    ↓
返回结果
```

**向量存储层**：`pm.SearchDocument` 表，`embedding` 列类型为 `Unsupported("public.vector")`，存储 1024 维浮点数组。

### 1.3 索引写入链路

```
笔记保存（POST/PATCH /api/pkm/notes）
    ↓
Prisma: PkmNote.create/update
    ↓
syncPkmNoteSearchDocument(noteId)
    ├─ prisma.pkmNote.findUnique（查 note 内容）
    ├─ extractAttachmentTexts(attachments)        ← 【阻塞点 1】
    │   └─ fetch POST embedding:5000/extract-text
    │       ├─ [1] pdfplumber 解析 PDF
    │       ├─ [2] python-pptx 解析 PPTX
    │       ├─ [3] python-docx 解析 DOCX
    │       └─ [4] 文本直接 decode
    │   60s 超时（AbortController + asyncio.wait_for）
    │
    ├─ buildSearchablePkmNoteChunks()（拼装 chunk）
    ├─ deleteMany SearchDocument（清理旧索引）
    ├─ upsertSearchDocument（content 写入，embedding=NULL）
    │   └─ fetchEmbeddingsBatch → updateSearchDocumentEmbedding
    │   【阻塞点 2】：embedding 服务调用
    │
    └─ 返回 NextResponse
```

### 1.4 同步 vs 异步索引

| 维度 | 同步索引（现状） | 异步索引（目标） |
|---|---|---|
| **响应时间** | 笔记保存被附件解析阻塞，最坏 60s+ | 保存 API 即时返回（<200ms） |
| **可重试性** | 超时=失败，只能手动 reindex | 失败自动重试，指数退避 |
| **失败率** | 高（大 PDF 超时率高） | 低（重试掩盖瞬时失败） |
| **可靠性** | 进程重启 = job 丢失 | 持久化队列，宕机不丢 |
| **可观测性** | 无任务状态 | 有 pending/running/done/failed |
| **扩展性** | 单 worker | 多 worker 横向扩展 |

---

## 二、引发这次改造的核心问题

### 2.1 直接触发事件

**2026-06-25：CH585M 芯片手册无法被向量搜索命中**

用户粘贴笔记正文中的 "BLE" 关键词，全局搜索无法找到 `CH585M芯片手册`。手动 `npm run search:reindex <noteId>` 后恢复正常。

### 2.2 根因分析

**问题链路（第一层：静默失败）**：

`upsertSearchDocument` 内部的 `ensureSearchDocumentEmbedding` 调用 embedding 服务失败 → 被 try/catch 吞掉 → `content` 写入 DB 但 `embedding` 列永远是 `NULL` → 向量搜索依赖 pgvector 匹配，该笔记永远不在结果中。

**第一轮修复（2026-06-25）**：让 embedding 失败向上抛出，各 sync 函数自行容错（content 已入库，降级为 keyword-only）。

**问题链路（第二层：根本矛盾）**：

即使 embedding 不超时，`extractAttachmentTexts`（调 `embedding:5000/extract-text` 解析 PDF/DOCX/PPTX）本身可能超时（pdfplumber 解析 2.7MB PDF 可能跑满 60s），导致 chunk 里只有标题没有正文 → 向量存在但内容和关键词"不相关" → 搜索"BLE"找不到。

### 2.3 为什么"把超时从 15s 改到 60s"不够

1. **大文件 PDF 解析本身就需要 60s**，再增加也不会根本解决问题
2. **解析是同步的**，即使 120s，笔记保存 API 也要等 120s，用户体验差
3. **没有重试机制**，一次失败只能手动 reindex
4. **无法处理未来 KG 重建 / 批量 embedding**，需要横向扩展 worker

### 2.4 为什么工单/提交不受影响

| 内容类型 | content 来源 | 附件解析 | 可靠性 |
|---|---|---|---|
| **Ticket** | DB 字段（title + description + assignees） | ❌ 无附件 | ✅ 稳定 |
| **Commit** | DB 字段（message + files） | ❌ 无附件 | ✅ 稳定 |
| **PKM Note** | DB 字段 + 附件提取文本 | ✅ 有（PDF/DOCX/PPTX） | ❌ 可能超时 |

**核心差异**：工单/提交的 `content` 全部来自数据库纯文本字段，没有外部 IO。笔记的 content 需要从附件（二进制文件）里"提取"出来，这一步才是脆弱点。

### 2.5 超时的具体含义

**不是"向量召回超时"**，而是：

| 超时环节 | 谁触发 | 发生阶段 | 后果 |
|---|---|---|---|
| 客户端 60s | `search.ts` AbortController | 提取附件 | chunk 缺正文，向量为空或短文本 |
| 服务端 60s | `api.py` asyncio.wait_for | 提取附件 | 同上，但 API 侧返回 200 + `"source":"timeout"` |
| embedding 超时 | `fetchEmbeddingsBatch` 30s | 生成向量 | content 入库但 embedding=NULL，keyword 搜索仍可用 |

---

## 三、改造目标

### 3.1 核心目标

把笔记附件索引（`extractAttachmentTexts` + `fetchEmbeddingsBatch`）从同步链路中解耦，改成**异步、可重试、带持久化的索引流水线**。

### 3.2 架构决策

| 决策项 | 选择 | 理由 |
|---|---|---|
| **队列基础设施** | 自建 `IndexJob` 表（pg-boss 风格） | 无 Redis 依赖，PostgreSQL 即可；未来 KG/RAG/graph traversal 同理 |
| **Worker 形态** | 独立进程（`npm run worker`） | Next.js 重启不丢 job；可横向扩缩容；CPU 密集型解析不影响 API latency |
| **写入时机** | 笔记保存 API **同步**写入 chunk content（skip embedding），**异步**生成向量 | 保证笔记内容立即可被 keyword 搜索到 |
| **重试策略** | 指数退避（1s, 5s, 30s, 2min, 10min），5 次失败后标记 `failed` | 覆盖大多数瞬时故障（大 PDF 解析属永久性故障，需人工介入） |
| **幂等性** | `IndexJob` 用 `noteId` + `attempt` 做唯一约束；并发时用 `ON CONFLICT DO UPDATE status` | 同一 note 的多次更新/保存不产生冲突 |
| **取消逻辑** | 新 job 入队时 `delete from IndexJob where noteId=? and status='pending'` | 快速连续保存只保留最新一次任务 |

### 3.3 预期效果

- 笔记保存 API 响应时间：**<200ms**（不再等附件解析）
- 附件索引成功率：大幅提升（指数退避重试掩盖瞬时故障）
- 可观测性：所有 job 有状态（`pending` / `processing` / `completed` / `failed`）
- 扩展路径：KG 重建、batch reindex、multi-hop reasoning worker 全部复用同一队列基础设施

---

## 四、进度 Checklist

- [x] 问题根因分析（同步链路 vs 异步链路的本质差异）
- [x] 现有代码全链路梳理（Prisma schema / search.ts / embedding api.py）
- [x] 技术约束清单整理
- [ ] 详细实现计划输出
- [ ] Phase 1：自建 IndexJob 表 + Prisma migration
- [ ] Phase 2：改造 `syncPkmNoteSearchDocument` 为"写 content + 入队 job"
- [ ] Phase 3：Worker 进程实现（fetch job → extract → embed → update）
- [ ] Phase 4：重试逻辑 + 幂等性 + 取消去重
- [ ] Phase 5：npm scripts（`npm run worker`）
- [ ] Phase 6：DELETE 笔记时清理 IndexJob
- [ ] Phase 7：CLI 工具支持（`npm run search:status` 显示 job 队列状态）
- [ ] 测试验证
