# 向量搜索故障排查指南

## 问题

搜索"图片上传失败"返回 0 条，但 psql 直接查询数据库有结果。

## 排查思路

从外到内，分层验证：

```
应用层 /api/search
    ↓ 调用的库层
lib/search.ts → searchDocumentsByVector()
    ↓ 调用的 embedding
lib/embedding.ts → fetchEmbedding()
    ↓ 调用的外部 API
Embedding API (端口 5000)
    ↓ 调用的数据库
PostgreSQL + pgvector (端口 5432)
```

---

## 第一层：数据库层（psql）

**目的**：确认数据库层面的向量搜索本身是否正常。

### 1. 检查扩展和类型

```sql
-- 检查 pgvector 扩展是否安装
SELECT extname, extversion, extnamespace::regnamespace
FROM pg_extension WHERE extname = 'vector';

-- 检查操作符是否存在
SELECT n.nspname, o.oprname, lt.typname, rt.typname
FROM pg_operator o
JOIN pg_namespace n ON o.oprnamespace = n.oid
JOIN pg_type lt ON o.oprleft = lt.oid
JOIN pg_type rt ON o.oprright = rt.oid
WHERE o.oprname IN ('<=>', '<->');
```

### 2. 测试向量操作符（关键！）

```sql
-- 最小测试：不依赖任何表
SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector;

-- 查已有向量
SELECT embedding FROM pm."SearchDocument" WHERE embedding IS NOT NULL LIMIT 1;

-- 用已有向量做向量搜索
WITH q AS (
  SELECT embedding FROM pm."SearchDocument" WHERE embedding IS NOT NULL LIMIT 1
)
SELECT d.title, (d."embedding" <=> q.embedding) AS distance
FROM pm."SearchDocument" d
CROSS JOIN q
WHERE d."embedding" IS NOT NULL
ORDER BY d."embedding" <=> q.embedding ASC
LIMIT 5;
```

**结果判定**：
- ✅ 返回距离值 → 数据库层正常
- ❌ `operator does not exist` → **操作符或类型找不到**，跳转「问题 B」
- ❌ `different vector dimensions` → 向量维度不匹配，检查 embedding API

---

## 第二层：Embedding API 层

**目的**：确认能生成向量，且维度正确。

```bash
# 健康检查
curl http://localhost:5000/health

# 获取向量维度
curl http://localhost:5000/dimension

# 测试生成向量
curl -X POST http://localhost:5000/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "测试文本"}'
```

**结果判定**：
- ✅ 返回 1024 维向量 → embedding API 正常
- ❌ 返回错误 → embedding 服务问题，检查服务日志

---

## 第三层：应用层搜索链路

**目的**：在 app 运行环境中，验证完整的搜索链路。

### 1. 确认 app 在线

```bash
curl http://localhost:3003 -o /dev/null -w "HTTP:%{http_code}"
```

### 2. 获取登录态

```bash
# 方法 A：用已有账号（需先设密码）
# 1. 找一个有密码 hash 的用户
psql "postgresql://community:community@localhost:5432/community" \
  -c "SELECT email FROM pm.\"User\" WHERE \"passwordHash\" IS NOT NULL"

# 2. 登录
CSRF=$(curl -sc /tmp/c.txt http://localhost:3003/api/auth/csrf | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
curl -sc /tmp/c.txt -b /tmp/c.txt -X POST \
  "http://localhost:3003/api/auth/callback/credentials" \
  --data-urlencode "email=你的邮箱" \
  --data-urlencode "password=你的密码" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "callbackUrl=/" > /dev/null 2>&1

# 验证登录成功
curl -s http://localhost:3003/api/auth/session -b /tmp/c.txt
```

### 3. 测试搜索 API

```bash
# 关键词搜索（应该能返回）
curl -s -b /tmp/c.txt \
  "http://localhost:3003/api/search?q=test&limit=5"

# 纯语义搜索（无关键词匹配，但向量应该能找）
curl -s -b /tmp/c.txt \
  "http://localhost:3003/api/search?q=图片上传失败&limit=5"
```

**结果判定**：
- ✅ `total > 0` → 搜索正常
- ❌ `total: 0` → 跳到第四层排查

---

## 第四层：Prisma + search_path（最常见根因）

**目的**：确认 Prisma 连接能用 `public.vector` 类型和 `<=>` 操作符。

### 根因

`?schema=pm` 设置了 `search_path = pm`，导致 `public` 不可见。

- `::vector` 类型找不到（扩展装在 public）
- `<=>` 操作符找不到（定义在 public）

### 验证方法

在 Node.js 里直接测（模拟 app 环境）：

```javascript
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://community:community@localhost:5432/community?schema=pm' } }
});

// 测试向量操作符
try {
  const r = await prisma.$queryRaw`SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector AS d`;
  console.log('OK');
} catch (e) {
  console.error(e.message);  // ← 看这里
}
```

**预期错误**：
- `type "vector" does not exist` → search_path 没有 public
- `operator does not exist: public.vector <=> public.vector` → search_path 没有 public

### 修复

改 `.env.production` 中的 `DATABASE_URL`：

```diff
- DATABASE_URL="postgresql://community:community@localhost:5432/community?schema=pm"
+ DATABASE_URL="postgresql://community:community@localhost:5432/community?options=-c%20search_path%3Dpm,public"
```

验证修复：

```javascript
// 用修复后的 URL
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://community:community@localhost:5432/community?options=-c%20search_path%3Dpm,public' } }
});
const r = await prisma.$queryRaw`SELECT '[1,2,3]'::vector <=> '[1,2,3]'::vector AS d`;
// ✅ 应返回 [{"d":0}]
```

---

## 第五层：searchDocumentsByVector SQL 细节

如果第四层通过但搜索仍失败，检查 `lib/search.ts` 里的 SQL：

```sql
-- 模拟 lib/search.ts 的实际 SQL
SELECT
  d."id", d."title",
  (d."embedding" <=> $query_vector::vector) AS "distance"
FROM pm."SearchDocument" d
WHERE d."embedding" IS NOT NULL
ORDER BY d."embedding" <=> $query_vector::vector ASC
LIMIT $limit
```

常见问题：
1. `::public.vector` vs `::vector` — 只要 search_path 对了，两种都可以
2. 向量维度不匹配 — embedding API 返回维度和数据库不一致
3. embedding 字段为 NULL — 数据写入时失败，检查 `upsertSearchDocument` 日志

---

## 总结

| 层级 | 工具 | 验证什么 |
|------|------|----------|
| 数据库 | psql | `::vector <=>` 操作符是否工作 |
| Embedding API | curl | 能否生成正确维度的向量 |
| 应用层 | curl + cookie | `/api/search` 是否返回结果 |
| Prisma 连接 | Node.js 脚本 | Prisma 能否执行 `::vector` |
| SQL 细节 | psql 直接跑 | SQL 语句本身是否正确 |

---

## 本次问题

**问题**：`DATABASE_URL` 中的 `?schema=pm` 导致 PostgreSQL 连接层 `search_path = pm`，`public` schema 不可见，使 `::vector` 类型和 `<=>` 操作符无法解析，向量搜索静默失败（被 try/catch 吞掉）。

**修复**：在 `.env.production` 的 `DATABASE_URL` 中加 `options=-c search_path=pm,public`，让 `public` 始终在搜索路径中。

```bash
# 修改前
DATABASE_URL="postgresql://community:community@localhost:5432/community?schema=pm"

# 修改后
DATABASE_URL="postgresql://community:community@localhost:5432/community?options=-c%20search_path%3Dpm,public"
```

**为什么这么做**：
- `pgvector` 扩展装在 `public` schema，类型和操作符都在 `public` 里
- Prisma 的 `?schema=pm` 只设置了**默认表搜索路径**，不影响扩展对象的可见性
- 但连接层的 `search_path` 被设为 `pm`，导致跨 schema 引用 `vector` 类型时找不到
- `options=-c search_path=pm,public` 显式设置搜索路径，让 `public` 始终可访问

---

## 排查：笔记存在但搜不到（metadata 为 NULL）

**问题现象**：DOCX 附件笔记"光污染设计需求文档"关键词搜不到，向量搜不到，但数据库里 content 和 embedding 都正常。

**排查链路**（从外到内）：

```
/api/search 返回 0 条
  → 关键词候选有 1 条（搜 title "光污染" 有）
  → 向量候选有 1 条（embedding 正常）
  → mergeCandidates → 0 条 ← 静默丢弃
    → canAccessSearchResult() 返回 false
      → item.metadata.noteIsPublic === true → false ← metadata 是 {}
        → coalesce 后 noteIsPublic = undefined → undefined === true = false
```

**诊断 SQL**：

```sql
-- 1. 确认 embedding 和向量都有
SELECT title, (embedding IS NOT NULL) AS has_vector, (metadata IS NULL) AS meta_null,
       metadata->>'noteIsPublic' AS is_public,
       metadata->>'noteUserId'  AS owner
FROM pm."SearchDocument"
WHERE "sourceType" = 'PKM_NOTE'
ORDER BY "updatedAt" DESC LIMIT 5;

-- 2. 对比：正常笔记 metadata 是 object，异常笔记是 NULL
-- 正常: meta_null=f, is_public=true
-- 异常: meta_null=t (metadata 整列为 NULL)
```

### 根因

`canAccessSearchResult` 权限过滤逻辑：

```startLine:815:shared/lib/search.ts
function canAccessSearchResult(item: SearchResultItem, viewerUserId?: string | null) {
  if (item.type !== "note") return true;
  if (!item.metadata) return false;                              // ← 加了防御
  if (item.metadata.noteUserId && viewerUserId && item.metadata.noteUserId === viewerUserId) return true;
  return item.metadata.noteIsPublic === true;                   // ← undefined === true = false
}
```

当 `metadata` 为 NULL（`coerceMetadata(null)` → `{}`）时，`noteIsPublic` 是 `undefined`，`undefined === true` → **false**，笔记被静默丢弃。

### 为什么 metadata 会是 NULL

**时间线确认**：

| 时间 | 事件 |
|------|------|
| 03:36 | 笔记创建（`PkmNote.createdAt`） |
| 10:50 | chunking 代码部署（8e4429b 上线） |
| 12:54 | `syncPkmNoteSearchDocument` 执行，SearchDocument 写入（`createdAt=updatedAt`） |
| 12:54 | embedding 写入成功（向量存在） |
| 14:25 | SQL UPDATE 修复 metadata |

代码链路完整正确——`buildSearchablePkmNoteChunks` → `buildMetadataWithEmbeddingHash` → `upsertSearchDocument`，每一步都应该在 metadata 里写入值。

**这条记录确实是 chunking 改造后的**：`totalChunks=1, chunkIndex=0`（有 chunk 头信息），不是旧记录。

**根因无法 100% 复现**，但最可能的原因是 Prisma 写入层的极端情况：

1. **事务半提交**：Prisma `upsert` 的 `create` 分支写入时，content/url/title 等字段先落盘，metadata 作为 JSON 字段在事务提交前的某个中间状态失败，导致 content 写入成功但 metadata 列保持 NULL
2. **Prisma JSON 序列化偶发问题**：在 `metadata as Prisma.InputJsonValue` 类型转换时，极小概率下 `undefined` 值被跳过（但 `buildMetadataWithEmbeddingHash` 不应该产生 undefined）
3. **连接层截断**：embedding 写入（`updateSearchDocumentEmbedding`）是独立 SQL，但 metadata 是在 upsert 里一起写的，如果 embedding 写入成功但 upsert 的 metadata 字段在 DB 层被截断

> **用户猜测**：可能是 chunking 改造前的旧记录。但 25 条 PKM 笔记 SearchDocument 中 24 条 metadata 正常、且该记录 `createdAt=updatedAt=12:54`（chunking 代码部署后），表明是改造后写入的。不过代码层面的偶发写入失败仍是最合理的解释。

### 验证记录类型

### 修复

**1. 数据热修复（本次操作）**：直接 SQL 补全缺失的 metadata：

```sql
UPDATE pm."SearchDocument"
SET metadata = jsonb_build_object(
  'noteUserId',    '<note.userId>',
  'noteUserName',  '<note.user.name>',
  'noteIsPublic', true,
  'noteTags',     ARRAY['<tag1>'],
  'projectId',    '<note.projectId>',
  'projectName',  '<note.project.name>',
  'author',       '<note.user.name>',
  'chunkIndex',   0,
  'totalChunks',  1
)
WHERE id = '<doc_id>';
```

### 验证记录类型

确认是否 chunking 改造前的旧记录（通过 `createdAt` 对比 `@@unique` 键是否有 `chunkIndex`）：

```sql
-- 旧记录（chunkIndex 字段默认值 0，unique 键只有 2 个字段）
-- @@unique([sourceType, sourceId]) → 无 chunkIndex

-- 新记录（chunking 改造后，@@unique 为 3 个字段）
-- @@unique([sourceType, sourceId, chunkIndex])

-- 判断：查 metadata + chunkIndex
SELECT title, "chunkIndex",
       metadata->>'totalChunks' AS total_chunks,
       metadata->>'chunkIndex'   AS meta_chunk,
       (metadata IS NULL) AS meta_null
FROM pm."SearchDocument"
WHERE "sourceType" = 'PKM_NOTE'
ORDER BY "updatedAt" DESC;

-- 如果 meta_chunk 有值 → 新版写入（经过了 buildSearchablePkmNoteChunks）
-- 如果 meta_chunk 为 NULL 且 metadata 不是 NULL → 可能是旧版
-- 如果 metadata IS NULL → 写入有问题
```

"光污染"这条记录 `totalChunks=1, chunkIndex=0`，**是 chunking 改造后新版写入**，不是旧记录遗留。

**2. 代码防御（已合入 `shared/lib/search.ts`）**：

在 `canAccessSearchResult` 开头加 `if (!item.metadata) return false;`，确保 metadata 为 null/undefined 时明确返回 false（而不是静默继续导致后续访问 `undefined.noteIsPublic` 报错或产生意外行为）。

### 验证修复

```sql
-- metadata 已修复：is_public=true, owner=用户ID
SELECT title, (metadata IS NULL) AS null_meta,
       metadata->>'noteIsPublic' AS pub,
       metadata->>'noteUserId'  AS owner
FROM pm."SearchDocument"
WHERE title LIKE '%光污染%';
```

修复后搜索"光污染"、"夜空亮度"均可召回文档，score > 0。

### 预防

未来如有笔记 metadata 缺失，可通过监控发现：

```sql
-- 发现所有 metadata 为 NULL 的 SearchDocument
SELECT id, title, "sourceType", "sourceId", (embedding IS NOT NULL) AS has_vec
FROM pm."SearchDocument"
WHERE metadata IS NULL;
```

---

## 本次问题（三）：笔记 embedding 历史缺失导致向量搜索无结果（2026-07-21）

**问题现象**：用户问"BLE_UUID_SUMMARY 笔记是什么内容"，AI 回答"系统中不存在标题为 BLE_UUID_SUMMARY 的笔记"，但该笔记确实存在（keyword 搜索能召回）。

**AI 回答原文**：
> "Cary，经检索，系统中不存在标题为 'BLE_UUID_SUMMARY' 的笔记。"

**排查链路**（从外到内）：

```
用户问 "BLE_UUID_SUMMARY 笔记是什么内容"
  → shouldUseRag() = true（消息含"内容"）
  → retrieveContext() → searchDocuments()
  → keywordCandidates: 有 1 条 BLE_UUID_SUMMARY（keywordScore=9）
  → vectorCandidates: 0 条 ← embedding 历史缺失
  → mergeCandidates(): 笔记 + 4 个 commit 竞争
    → commit semantic=0.46 → score=4.63
    → 笔记 keyword=9 但 semantic=0 → score=11.0
    → 笔记排第一，但 semantic=0（无向量分）
  → 排序结果含笔记（keyword=9）
  → searchKnowledge tool 返回含笔记的结果给 LLM
  → ❓ LLM 仍回答"未找到"
```

**注意**：searchDocuments 确实返回了笔记（keyword=9），但 AI 回答"未找到"的原因需要进一步确认——可能是 LangGraph 流程中 tool 结果没有正确注入 LLM 上下文，或 `detectIntent` 的 `routeByMode` 没有正确路由到 `searchKnowledge`（mode=chat 时跳过 RAG）。

### 诊断步骤

**Step 1 — 确认 embedding 是否缺失**：

```bash
# 本地跑 CLI 搜索（带 viewer）
cd /Users/vastgui/Desktop/project-manager
source .env.local
npm run search:search "BLE_UUID_SUMMARY" -- --limit=5

# 如果出现 semantic=0.00 说明 embedding 历史缺失
━━━ 笔记 (1 条) ━━
  [11.00] keyword=9 semantic=0.00 | BLE_UUID_SUMMARY userId=cmpuz9zt isPublic=true
```

**Step 2 — 确认 embedding 状态（精确）**：

```bash
npm run search:inspect
# 找 BLE_UUID_SUMMARY 那行
# emb=false → embedding 历史缺失
```

**Step 3 — 补 embedding（热修复）**：

```bash
# 通过 reindex 补 embedding
npm run search:reindex -- <noteId>
# 或搜笔记标题获取 noteId
npm run search:search "BLE_UUID_SUMMARY" | grep "cmr"
# 然后
npm run search:reindex -- cmrmymqtu00b7jlw9pjv67r2r
```

**Step 4 — 验证修复**：

```bash
npm run search:search "BLE_UUID_SUMMARY" -- --limit=5
# 期望：semantic > 0（如 semantic=0.68）
━━━ 笔记 (2 条) ━━
  [17.84] keyword=9 semantic=0.68 | BLE_UUID_SUMMARY
```

### 根因

笔记在创建时（或某次更新时）触发了 `syncPkmNoteSearchDocument`，但当时的 embedding 服务调用失败，导致 `content` 写入 `SearchDocument` 成功而 `embedding` 列为 NULL。后续 `upsertSearchDocument` 检测到 content hash 未变，跳过了 embedding 写入。

> 参考：[向量搜索-静默失败修复.md](./向量搜索-静默失败修复.md) 记录的旧版静默失败问题，修复后 `syncPkmNoteSearchDocument` 仍可能因网络抖动/超时导致 embedding 缺失。

### IndexJob 表状态

远程 `IndexJob` 表记录了完整的索引历史：

```sql
-- SSH 到远程查
ssh hxy@192.168.1.14
psql "postgresql://community:community@localhost:5432/community?options=-c%20search_path%3Dpm,public" -t -c "
SELECT * FROM \"IndexJob\" ORDER BY \"createdAt\" DESC LIMIT 10;"
```

**关键发现**：
- `PKM_NOTE` `BLE_UUID_SUMMARY` → `COMPLETED`（2026-07-16 + 2026-07-21 两次均成功）
- `FILE_ASSET` 多个 → `FAILED`（`fetch failed` / `UNSUPPORTED_MIME: .docx`）

**Worker 正常运行**，但历史上某些笔记创建时 embedding 写入失败未被捕获。

### Worker 失败分析

| 失败类型 | 数量 | 具体错误 | 原因 |
|----------|------|----------|------|
| `fetch failed` | 3 | `FILE_ASSET` 索引 | Worker 连不上文件 URL（可能是内网路径不可达） |
| `UNSUPPORTED_MIME: .docx` | 4 | `FILE_ASSET` 索引 | WPS 保存的 `.docx`（`application/vnd.openxmlformats-officedocument.wordprocessingml.document`）被 `python-docx` 拒绝 |

> WPS 的 `.docx` 和标准 Office 的 `.docx` MIME type 相同，但内部 XML 结构有差异，`python-docx` 不兼容。参考 [DOCX_EXTRACT.md](./DOCX_EXTRACT.md)。

### 预防措施

1. **定期巡检缺失 embedding 的笔记**：

```sql
-- 发现所有 embedding 为 NULL 的 PKM 笔记 SearchDocument
SELECT d.id, d.title, d."sourceId", d."updatedAt"::text
FROM "SearchDocument" d
WHERE d."sourceType" = 'PKM_NOTE'
  AND d."embedding" IS NULL
ORDER BY d."updatedAt" DESC;
```

2. **批量补 embedding**：

```bash
cd /Users/vastgui/Desktop/project-manager
source .env.local
# 找出所有无 embedding 的 PKM 笔记 noteId，逐个补
npm run search:embed
```

3. **长期方案**：完成 [PKM异步索引改造-详细计划.md](./PKM异步索引改造-详细计划.md) 中的异步索引改造，笔记保存 API 不再同步等待 embedding 写入，Worker 负责异步补全，失败自动重试。

### 相关文件

- 搜索核心：`shared/lib/search.ts`
- 诊断 CLI：`scripts/vector-search/search-admin.ts`
- 向量调用：`shared/lib/embedding.ts`
- 后台作业：`shared/lib/jobs.ts`
- 异步索引计划：[PKM异步索引改造-详细计划.md](./PKM异步索引改造-详细计划.md)

---

## 附录：embedding 历史缺失的完整根因分析

### 三类来源

远程 DB 现状：

```sql
SELECT d."sourceType", COUNT(*) AS null_count
FROM "SearchDocument" d
WHERE d."embedding" IS NULL
GROUP BY d."sourceType"
ORDER BY COUNT(*) DESC;
```

```
 COMMIT     | 127   ← git-sync commit 时 embedding 服务抖动
 TICKET     |  23   ← 同步 ticket 时 embedding 服务抖动
 PKM_NOTE   |  17   ← 笔记创建时 embedding 服务抖动
```

> `BLE_UUID_SUMMARY`（`PKM_NOTE`）属于第三类。

### 根因链路

**旧版链路（`syncPkmNoteSearchDocument` 改造前）**：

```
用户创建笔记
  → syncPkmNoteSearchDocument()
    → upsertSearchDocument(record)
      → upsert content (title/url/content/metadata)
      → upsertSearchDocument 内部调 ensureSearchDocumentEmbedding()
        → fetchEmbeddingsBatch() → ❌ embedding 服务抖动/超时
        → 抛出异常
    → ❌ 被 syncPkmNoteSearchDocument 的 catch 捕获
    → fallback: return prisma.searchDocument.findFirst(saved)
    → ✅ 返回已保存的 document（content 有，embedding=NULL）
  → ✅ NextResponse 返回 200（用户感知笔记创建成功）
  → ❌ SearchDocument.embedding = NULL（静默失败）
```

**后续 reindex 为何没有补上**：

```
npm run search:reindex -- <noteId>
  → syncPkmNoteSearchDocument()
    → upsertSearchDocument(chunk, idx, true)  ← skipEmbedding=true，写 content
    → upsertSearchDocument 内部调 ensureSearchDocumentEmbedding()
      → content hash 未变（相同 content）→ hasReusableEmbedding() 返回 true
      → ✅ 跳过 embedding 写入（误判为"已有有效向量"）
    → ❌ embedding 永远是 NULL，不会重新生成
```

**`hasReusableEmbedding` 判断逻辑**：

```typescript
// shared/lib/search.ts
function hasReusableEmbedding(
  metadata: CoercedMetadata,
  newHash: string,
  hasEmbedding: boolean,
): boolean {
  // 如果 metadata 里存了 hash 且相同 → 内容没变，跳过
  if (metadata._embeddingHash && metadata._embeddingHash === newHash && hasEmbedding) {
    return true;  // ← BLE_UUID_SUMMARY 在第一版写入时 hash 就在 metadata 里
  }
  return false;
}
```

关键：`metadata._embeddingHash` 在第一次 `upsertSearchDocument` 时就写入了（content 写入前就计算了 hash）。即使 embedding 写入失败，hash 已经在 metadata 里。后续 reindex 时 hash 没变，`hasEmbedding=true`（数据库里 embedding 是 NULL 但 `hasEmbedding` 是在 upsert 时从 DB 读出来的）——等等，`hasEmbedding` 是 `embedding IS NOT NULL`，所以 `hasEmbedding=false`，那么这个条件不会触发。

实际重放：`ensureSearchDocumentEmbedding` 读取 DB：`embedding IS NOT NULL = false`（因为 NULL），所以 `hasReusableEmbedding` 返回 `false`，然后 `fetchEmbeddingsBatch` 再次失败，抛出异常，被 `syncPkmNoteSearchDocument` 的 catch 吞掉，继续返回已保存的 chunk（embedding=NULL）。

### 为什么 commit/ticket 有 150 条没有 embedding

git-sync 和 ticket 更新触发同步索引时，embedding 服务抖动会导致内容入库但向量为空。`syncCommitSearchDocument` 的 catch 直接返回 `null`，不记录错误到 DB，事后无法追踪是"没进索引"还是"进了但缺向量"。

### 预防方案（优先级排序）

| 优先级 | 方案 | 实施成本 | 效果 |
|--------|------|----------|------|
| **P0** | 立即跑 `npm run search:embed` 补全 150 条缺失向量 | 低（CLI） | 消除当前存量 |
| **P1** | `npm run search:embed` 加入 deploy hook / cron | 低 | 防增量 |
| **P2** | 异步索引改造（`IndexJob` + Worker）| 高（见详细计划） | 根治：笔记保存不等 embedding 写入 |
| **P3** | `upsertSearchDocument` 写入 `_embeddingHash` 前先检查 embedding 是否真的写入成功 | 中 | 防止 hash 已写但向量缺失的静默失败 |

**P0 — 立即执行**：

```bash
cd /Users/vastgui/Desktop/project-manager
source .env.local
npm run search:embed
```

输出应显示 "补 embedding" 进度。完成后验证：

```bash
npm run search:status
# 期望：PKM_NOTE 的 emb=false 行数归零
```

**P1 — 自动化巡检**：

在 `.cursor/skills/pm-ops/SKILL.md` 或 cron 里加入：

```bash
# 每天凌晨 3 点巡检 + 补 embedding
0 3 * * * cd /home/hxy/work/personal/project-manager && \
  source .env.production && \
  npm run search:embed >> /var/log/search-embed.log 2>&1
```

**P2 — 根治（异步索引改造）**：

详见 [PKM异步索引改造-详细计划.md](./PKM异步索引改造-详细计划.md)。核心改动：笔记保存 API 只写 content + 入 IndexJob queue，不等 embedding；Worker 异步处理，失败自动重试（指数退避），IndexJob 表记录完整生命周期。
