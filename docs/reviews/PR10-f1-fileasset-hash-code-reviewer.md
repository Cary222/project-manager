<!-- reviewer: code-reviewer (硬层) -->

# PR10 F1 — FileAsset Rename + Hash Code Review

**Scope:** `prisma/schema.prisma`, `prisma/migrations/20260701142100_file_asset_rename/migration.sql`, `shared/lib/hash.ts`, `shared/lib/upload.ts`, `app/api/upload/route.ts`, `app/api/upload/[id]/route.ts`

**Review Type:** Local Changes (F1 hard-layer only)

---

## 1. 整体评价

F1 核心逻辑实现正确：服务端重算 hash 做去重、设计与实现一致、迁移安全。但存在 **3 个 tsc 错误**直接由 F1 改动引起（`pkm.ts` 的 `FileAttachment` 删除了 `url` 字段导致下游组件类型不匹配），需要修复后方可合并。

---

## 2. 逐文件发现

### 2.1 `prisma/schema.prisma` — FileAsset model

**✅ 优点**
- `hash String?` + `status FileAssetStatus` + `FileAssetStatus` enum 添加正确
- `@@unique([hash, size])` 与 partial index 设计一致，兼容旧数据 NULL hash
- `@@index([status, createdAt(sort: Desc)])` 索引合理，支持按状态过滤 + 排序
- `@@map("UploadedFile")` 保留旧表名，现有数据无需迁移

**⚠️ 发现**
- **[schema.prisma:565]** `hash` 字段注释写"sha256 hex (64 字符)"，但 schema 无 `@db.VarChar(64)` 约束
  - Impact：数据库层面无长度校验，若写入非 64 字符 hash（如空字符串或错误格式）不会报错
  - Suggestion：考虑加 `@db.VarChar(64)` 或 `@length(min: 64, max: 64)`（Prisma 扩展），但不影响 F1 合并

**❌ 无问题**

---

### 2.2 `prisma/migrations/20260701142100_file_asset_rename/migration.sql`

**✅ 优点**
- `ADD COLUMN hash VARCHAR(64)` nullable，兼容旧数据
- `ADD COLUMN status ... DEFAULT 'ACTIVE'`，有默认值不锁表
- **关键：partial unique index** `WHERE "hash" IS NOT NULL` 正确处理 NULL 值问题
  - PostgreSQL 多行 NULL 在 `UNIQUE` 中互不相等，故旧数据多条 NULL hash 不会冲突 ✅

**❌ 无问题。迁移设计安全。**

---

### 2.3 `shared/lib/hash.ts` — 新建文件

**✅ 优点**
- `sha256Hex`：Node.js crypto API 使用正确；`Buffer.isBuffer` 分支处理正确
- `sha256File`：Web Crypto API 使用正确；`padStart(2, "0")` 保证小写 hex 格式一致
- 注释清晰说明"客户端 hint / 服务端权威"的职责分离

**❌ 无问题。**

---

### 2.4 `shared/lib/upload.ts`

**✅ 优点**
- `MAX_SIZE` = 10MB 与服务端一致 ✅
- 空文件 `size === 0` 检查覆盖边界 case ✅
- `clientHash` 传入 `formData` 作为 hint，服务端不信任 ✅
- `uploadImage` deprecated 标记清晰 ✅

**❌ 无问题。**

---

### 2.5 `app/api/upload/route.ts` — 服务端上传入口

**✅ 优点**
- `sha256Hex(bytes)` 服务端重算，客户端 hash 仅作 hint，设计正确 ✅
- `findUnique({ where: { hash_size: ... } })` 使用 Prisma composite unique 查询 ✅
- 命中去重时返回 `deduplicated: true`，客户端可感知 ✅
- 所有错误分支返回明确 error code + HTTP status ✅
- `Buffer.from(await file.arrayBuffer())` 一次性读取，服务端不会内存爆炸（受 MAX_SIZE 10MB 保护）✅

**⚠️ 发现：MIME type 未验证**
- **[route.ts:52]** `file.type` 来自客户端 `Content-Disposition` header，完全可由客户端伪造
  - Impact：攻击者可上传 SVG（内含 `<script>`）但 mimeType 标为 `image/png`，`GET /api/upload/[id]` 会以 `image/png` 返回，浏览器仍会执行 SVG 中的脚本（SVG 不是 `<img>` 的 safe type）
  - Suggestion（F1 scope 外）：用 `fileTypeSniff` 库从 bytes 读 magic number 验证真实类型；或限制 SVG 上传

**⚠️ 发现：旧迁移报告**
- 本 PR 无对应 `docs/reports/PR10-*.md`，无法对照"踩坑记录"

---

### 2.6 `app/api/upload/[id]/route.ts` — 文件代理

**✅ 优点**
- ID 格式校验 `/^[a-z0-9]+$/i.test(id)` 防止注入 ✅
- 不做权限校验（comment 解释合理： cuid 不可枚举 + DB 存储有限）✅
- `cache-control: public, max-age=..., immutable` 正确 ✅
- `content-disposition: inline` + `encodeURIComponent(originalName)` 防文件名注入 ✅
- `new Uint8Array(record.bytes)` 转换正确 ✅

**⚠️ 发现：未校验 `status` 字段**
- **[route.ts:20-22]** `findUnique` 查询未加 `where: { status: "ACTIVE" }` 过滤
  - Impact：软删除（status=DELETED）的 FileAsset 仍可通过 URL 被读取
  - Suggestion：加 `where: { status: "ACTIVE" }` 或在 SELECT 加 `status` 判断后 404

**❌ 无其他问题。**

---

## 3. 关键风险点（Top 3）

| # | 风险 | 严重度 | 文件 |
|---|------|--------|------|
| 1 | **3 个 tsc 错误**：F1 改动 `shared/lib/pkm.ts` 删除了 `FileAttachment` 的 `url` 字段，导致 `WeeklyReportDetailClient.tsx`、`ProjectDetail.tsx`、`WeeklyReportForm.tsx` 类型不匹配 | **Critical** | 多文件 |
| 2 | `GET /api/upload/[id]` 未校验 `status=ACTIVE`，软删除文件仍可被读取 | **Medium** | `app/api/upload/[id]/route.ts:20` |
| 3 | 服务端不验证文件真实 MIME type（依赖客户端 `file.type`），SVG 等可被标为图片类型返回 | **Low**（scope 外） | `app/api/upload/route.ts:52` |

---

## 4. 建议（改进项，非必须）

### Improvements (Recommended)
- **[app/api/upload/[id]/route.ts:20]** 在 `findUnique` 加 `where: { status: "ACTIVE" }` 过滤，确保软删除后文件不可访问
- **[prisma/schema.prisma:565]** `hash` 字段考虑加 `@db.VarChar(64)` 约束，确保数据库层面长度为 64（防止未来写入错误 hash）
- **[app/api/upload/route.ts:52]** 考虑用 `file-type` 库从 bytes  sniffing 验证真实 MIME type（长期安全加固）

### Nitpicks (Optional)
- **[route.ts:20-22]** `select` 可加上 `status` 以便未来审计/调试

---

## 5. 结论

### Verdict: ❌ CHANGES_REQUIRED

### 必须修复（Critical）
1. **tsc errors — 3 个类型不匹配**：由 F1 `pkm.ts` 改动引起，非历史遗留，需修复
   - `app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx:201` — `url` 不存在于 `FileAttachment`
   - `features/project/ui/ProjectDetail.tsx:607` — `PkmAttachment` 缺少 `fileId` 字段
   - `features/reports/weekly-reports/ui/WeeklyReportForm.tsx:372-373` — `PkmAttachment[]` 与 `FileAttachment[]` 类型不兼容

### 次要（建议修复后合并）
2. `GET /api/upload/[id]` 未过滤 `status=DELETED` 的 FileAsset

### 不阻塞（scope 外 / 低风险）
3. MIME type sniffing 未实现（低频攻击面，建议作为独立任务跟进）

---

## 附：tsc 错误清单（与 F1 相关）

```
app/reports/weekly-reports/[id]/WeeklyReportDetailClient.tsx(201,23): error TS2353: Object literal may only specify known properties, and 'url' does not exist in type 'FileAttachment'.
features/project/ui/ProjectDetail.tsx(607,21): error TS2741: Property 'fileId' is missing in type 'PkmAttachment' but required in type 'FileAttachment'.
features/reports/weekly-reports/ui/WeeklyReportForm.tsx(372,13): error TS2322: Type 'PkmAttachment[]' is not assignable to type 'FileAttachment[]'.
features/reports/weekly-reports/ui/WeeklyReportForm.tsx(373,13): error TS2322: Type 'Dispatch<SetStateAction<PkmAttachment[]>>' is not assignable to type '(next: FileAttachment[]) => void'.
```

> 注：`features/admin/admin.test.ts` 的 `@/lib/db` 错误和 `e2e/module-edit.spec.ts` 的 Playwright 断言错误为**历史遗留**，不属于 F1 范围。
