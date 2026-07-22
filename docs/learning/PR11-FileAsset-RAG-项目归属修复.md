# FileAsset RAG 项目归属修复（#10081）

> 适用：project-manager 仓库（Next.js + Prisma + LangGraph）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"FileAsset 向量化时通过 FileReference 链自动填入 projectId"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

文件上传后，Worker 向量化处理生成 `SearchDocument`，**`projectId` 字段始终为 `null`**。这导致：

- AI 对话时 RAG 搜索**无法按项目过滤**（`WHERE "projectId" = $projectId` 全部失效）
- 用户在项目详情页上传的文档，AI 无法识别"这条知识属于哪个项目"
- 用户问"我们项目的文档里有 XXX 吗"，语义搜索结果与项目无关

### 1.2 结论

新增 `resolveProjectIdFromFileAsset()` helper，通过 `FileReference` 链反向查询 projectId，**零 migration**，**零改动上传入口**，在 Worker 处理阶段自动填入。

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `shared/lib/document.ts` | 修改 | 核心修复：新增 `resolveProjectIdFromFileAsset` + 在 `processFileAssetJob` 中调用并写入 `SearchDocument.projectId` |
| `docs/reviews/PR11-file-asset-projectid-code-reviewer.md` | 新增 | code-reviewer 硬层审查报告 |
| `docs/reviews/PR11-file-asset-projectid-ai-mentor.md` | 新增 | ai-learning-mentor 软层审查报告 |
| `docs/reviews/PR11-file-asset-projectid-review.md` | 新增 | Main 合并后的综合审查报告 |
| `scripts/verify-file-asset-projectid.ts` | 新增 | 本地验证脚本（可重复跑） |
| `scripts/backfill-file-asset-projectid.ts` | 新增 | 一次性回填脚本（处理旧数据） |

---

## 3. 核心实现

### 3.1 `resolveProjectIdFromFileAsset`（`shared/lib/document.ts`）

```40:77:shared/lib/document.ts
async function resolveProjectIdFromFileAsset(
  fileAssetId: string,
): Promise<string | null> {
  const ref = await prisma.fileReference.findFirst({
    where: { fileAssetId, deletedAt: null },
    select: { sourceType: true, sourceId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!ref) return null;

  switch (ref.sourceType as FileReferenceSourceType) {
    case "PKM_NOTE": {
      const note = await prisma.pkmNote.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      return note?.projectId ?? null;
    }
    case "TICKET": {
      const ticket = await prisma.ticket.findUnique({
        where: { id: ref.sourceId },
        select: { projectId: true },
      });
      return ticket?.projectId ?? null;
    }
    case "TICKET_COMMENT": {
      const comment = await prisma.ticketComment.findUnique({
        where: { id: ref.sourceId },
        select: { ticket: { select: { projectId: true } } },
      });
      return comment?.ticket.projectId ?? null;
    }
    case "PROJECT":
      return ref.sourceId;
    default:
      return null;
  }
}
```

**为什么这样写**：通过 `FileReference` 间接关联查 projectId，保持与现有 `extractFileAttachmentsFromLegacy` 一致的查询路径。取第一条引用（`orderBy createdAt asc`），因为当前业务场景下文件通常只被一个上下文引用。

### 3.2 在 `processFileAssetJob` 中调用（`shared/lib/document.ts`）

```264:304:shared/lib/document.ts
  // 查 projectId（事务外只读查询，查不到则 null，不阻塞处理）
  const projectId = await resolveProjectIdFromFileAsset(fileAssetId);

  // ... 提取文本、切块、向量化 ...

  // 事务内写 SearchDocument chunks（projectId 已在此处填入）
  for (let i = 0; i < chunks.length; i++) {
    const saved = await tx.searchDocument.create({
      data: {
        sourceType: "DOCUMENT",
        sourceId: document.id,
        documentId: document.id,
        projectId,  // ← 这里
        chunkIndex: i,
        title: fileAsset.originalName,
        content: chunks[i],
        url: `/api/upload/${fileAsset.id}`,
        metadata: { fileAssetId, hash: null } as Prisma.InputJsonValue,
      },
    });
    savedChunks.push(saved);
  }
```

**为什么事务外查 projectId**：写入在事务内，只读查询放事务外减少锁竞争。查不到时返回 `null`，不阻塞处理，保证 Worker 不会因为 projectId 查不到而整条任务失败。

### 3.3 扩展性注释（`shared/lib/document.ts` 第 34-36 行）

```34:37:shared/lib/document.ts
 * @requires 新增 sourceType 时同步更新此 switch，否则默认返回 null
 * @requires 取第一条引用（当前业务场景下文件通常只被一个上下文引用）
 *          如未来需要支持多引用，此处逻辑需改为取首个非 null projectId 或报错
```

**为什么写这个注释**：防止未来新增 `sourceType` 时忘记更新 switch case，兜底返回 `null` 不会报错但会导致 projectId 缺失。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `DATABASE_URL` | `postgresql://community:community@192.168.1.14:5432/community` | PostgreSQL 在远程服务器 |
| `EMBEDDING_API_URL` | `http://192.168.1.14:5000` | 向量化服务（BGE-M3）在远程服务器 |
| Worker | 独立进程（`npm run worker` / systemd） | 与 Next.js 服务分离 |
| Next.js | 端口 3003 | API 服务 |

---

## 5. 启动 / 部署

### 5.1 开发（本地）

```bash
# Next.js（当前终端已跑）
npm run dev

# Worker（另一个终端，需单独启动）
npm run worker

# 或用 tsx 直接跑
npx tsx worker/index.ts
```

### 5.2 生产部署（hxy@192.168.1.14）

```bash
# SSH 到服务器
ssh hxy@192.168.1.14

# 进入工作区
cd /home/hxy/work/personal/project-manager

# 拉取最新代码
git pull

# 构建 Next.js
npm run build

# 重启 Next.js
fuser -k 3003/tcp 2>/dev/null; sleep 1; npm run start

# 重启 Worker（systemd 托管）
systemctl --user restart project-manager-worker.service

# 验证 Worker 存活
systemctl --user status project-manager-worker.service
journalctl --user -u project-manager-worker.service -n 20
```

### 5.3 Embedding 服务（已在 systemd 托管）

```bash
# 状态
systemctl --user status embedding-api.service

# 重启（如需要）
systemctl --user restart embedding-api.service

# 验证
curl http://localhost:5000/health
```

---

## 6. 测试 & 验证

### 6.1 验证脚本（本地直接跑）

```bash
npx tsx scripts/verify-file-asset-projectid.ts
```

**期望输出**：
```
[verify] === 文件附件 projectId 验证 ===
[verify] ✅ test1 — 暂无 DOCUMENT 类型的 SearchDocument，跳过 — 数据为空
[verify] ✅ test2 — 没有 projectId 为空的 DOCUMENT SearchDocument — 无需回填
[verify] ✅ test3 — resolveProjectId 逻辑验证：PKM_NOTE → 有值 — 预期 projectId: cmpv0x7qa...
[verify] ✅ test4 — FileAsset 暂无 Document 记录，跳过 — 该文件未触发过处理
[verify] === 4 passed, 0 failed ===
```

### 6.2 端到端验证

1. 在项目详情页 → Docs Tab 上传一个 PDF/Word 文件
2. 观察 Worker 日志（`journalctl --user -u project-manager-worker.service -f`）确认任务被处理
3. 再次跑验证脚本确认 projectId 已填入
4. 在 AI 对话问"项目文档里有什么"或"关于 XXX 的文档"，验证能搜到刚上传的文件

**期望**：
- Worker 日志出现 `FILE_ASSET indexing completed`
- `SearchDocument` 表中该文件的 `projectId` 不为 `null`
- AI 对话 RAG 搜索结果包含该文件

### 6.3 回填旧数据（如需要）

```bash
npx tsx scripts/backfill-file-asset-projectid.ts
```

**期望**：`updated: N` 大于 0 表示有旧数据被回填。

---

## 7. 复现 Checklist

- [ ] SSH 到 `hxy@192.168.1.14`
- [ ] `cd /home/hxy/work/personal/project-manager && git pull`
- [ ] `npm run build` 成功（无 TypeScript / ESLint 报错）
- [ ] `fuser -k 3003/tcp; npm run start` 重启 Next.js
- [ ] `systemctl --user restart project-manager-worker.service` 重启 Worker
- [ ] `journalctl --user -u project-manager-worker.service -n 5` 确认 Worker 在线
- [ ] 本地浏览器访问 `http://192.168.1.14:3003`
- [ ] 进入某个项目 → Docs Tab → 上传一个测试 PDF
- [ ] 等 10 秒，观察 Worker 日志有 `FILE_ASSET indexing completed`
- [ ] `npx tsx scripts/verify-file-asset-projectid.ts` 确认 projectId 有值
- [ ] AI 对话问项目相关问题，验证知识文档出现在 RAG 结果中

---

## 8. 踩坑记录

### 坑 1：本地 dev server 的 Worker 不生效

**现象**：本地跑 `npm run dev` 看不到 Worker 处理日志，RAG 仍然搜不到项目文档。

**原因**：Worker 是独立进程，`npm run dev` 只启动 Next.js。数据库虽然连的是远端 `192.168.1.14`，但 Worker 跑的是旧代码（未拉取最新 commit）。

**解法**：必须把代码部署到远端服务器。Worker 在 `hxy@192.168.1.14` 上用 systemd 托管，`git pull` 后 `systemctl --user restart project-manager-worker.service` 才是生效的操作。

### 坑 2：旧数据 SearchDocument 没有 projectId

**现象**：数据库中 `SearchDocument` 表里 `projectId` 为 `null`，但 `FileReference` 链路完整。

**原因**：PR11 上线前 Worker 用旧代码处理过文件，`projectId` 字段从未被写入。

**解法**：上线后跑一次性回填脚本 `scripts/backfill-file-asset-projectid.ts`，遍历所有 `projectId IS NULL` 的 `DOCUMENT` SearchDocument，通过 FileReference 链反查并更新。

### 坑 3：ts-node ESM 报错

**现象**：`ts-node scripts/verify-file-asset-projectid.ts` 报错 `TypeError: Unknown file extension ".ts"`。

**原因**：项目使用 ESM（`"type": "module"` in package.json），`ts-node` 默认不支持 ESM。

**解法**：用 `npx tsx` 替代 `ts-node`。

### 坑 4：DOCUMENT 类型的 SearchDocument 数量为 0

**现象**：回填脚本跑出来 `没有需要回填的 DOCUMENT SearchDocument`。

**原因**：Worker 根本没有处理过任何文件（IndexJob 表里没有 FILE_ASSET 类型的任务），可能是上线前 FileReference 到 IndexJob 的触发链路未接通，或旧文件上传入口走的是 `uploadAttachmentAsNote`（data URL 路径）而非 FileAsset 路线。

**解法**：确认上传入口触发的是哪个路线（见 `docs/features/file-upload.md`），以及 `enqueueIndexJob` 是否被正确调用。
