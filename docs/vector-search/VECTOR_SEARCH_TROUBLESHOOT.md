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
