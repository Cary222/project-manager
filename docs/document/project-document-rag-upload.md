# 项目文档 RAG 上传链路修复

> 适用：project-manager 仓库（Next.js + Prisma + Worker）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"项目文档上传后能被 AI RAG 搜索到"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

- 项目文档上传入口 `uploadAttachmentAsNote` 把文件存为 PKM Note 的 **base64 附件**（路线 B）
- Worker 只处理 `IndexJob.targetType = "FILE_ASSET"`，**根本不会去提取 base64 文本**
- 结果：SearchDocument 里只有一行 `"通过项目文档上传：OPERATIONS.md"`，搜文档名永远搜不到

### 1.2 结论

- 新版改用**路线 A**：`uploadFile` → FileAsset → `sourceType="PROJECT"` 的 FileReference → Worker 提取文本 → SearchDocument
- 搜索时 `projectId` 有值，RAG 能精确过滤到项目内文档

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `shared/lib/upload.ts` | 修改 | 新增 `uploadProjectFile`（路线 A + FileReference 创建） |
| `app/api/file-assets/[id]/references/route.ts` | 新增 | `POST` 创建 PROJECT 类型 FileReference（幂等） |
| `app/projects/[projectId]/page.tsx` | 修改 | 补充 `sourceType="PROJECT"` 查询，透传 `projectAttachments` |
| `features/project/ui/ProjectDetail.tsx` | 修改 | 改用 `uploadProjectFile`；DocsTab 分"项目直接上传"和"来源笔记"两区块 |
| `worker/index.ts` | 修改 | `FILE_ASSET` job 改用 `await processFileAssetJob()`（修复未 await 导致 FAILED） |

---

## 3. 核心实现

### 3.1 上传入口：`uploadProjectFile`（`shared/lib/upload.ts`）

```startLine:115:shared/lib/upload.ts
/**
 * 将文件作为项目文档上传到指定项目。
 * 流程：
 * 1. uploadFile → FileAsset 表（bytes 存 DB）→ 入队 IndexJob（Worker 提取文本 → SearchDocument）
 * 2. 创建 sourceType="PROJECT" 的 FileReference（projectId 关联）
 * 3. refresh 路由刷新列表
 * @throws 文件超限或 API 返回错误时抛出 Error。
 */
export async function uploadProjectFile(
  file: File,
  projectId: string,
  router: { refresh: () => void },
): Promise<void> {
  // Step 1: 上传到 FileAsset
  const result = await uploadFile(file);

  // Step 2: 创建 PROJECT 类型引用（触发 resolveProjectIdFromFileAsset）
  const res = await fetch(`/api/file-assets/${result.fileId}/references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceType: "PROJECT", sourceId: projectId }),
  });
  const refData = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(refData.error || "创建文件引用失败");
  }

  // Step 3: 刷新列表
  router.refresh();
}
```

**为什么这样写**：FileAsset 创建时会自动入队 `IndexJob(targetType=FILE_ASSET)`，FileReference 建立了 projectId 关联。Worker 处理时通过 `resolveProjectIdFromFileAsset` 反查 projectId，写入 SearchDocument。

### 3.2 FileReference 创建接口（`app/api/file-assets/[id]/references/route.ts`）

```startLine:1:app/api/file-assets/[id]/references/route.ts
export async function POST(
  request: Request,
  { params }: RouteParams,
) {
  // 幂等：已存在直接返回
  const existing = await prisma.fileReference.findFirst({
    where: { fileAssetId, sourceType: body.sourceType as "PROJECT", sourceId: body.sourceId, deletedAt: null },
  });
  if (existing) {
    return NextResponse.json({ id: existing.id, deduplicated: true });
  }
  const ref = await prisma.fileReference.create({
    data: { fileAssetId, sourceType: body.sourceType as "PROJECT", sourceId: body.sourceId },
  });
  return NextResponse.json({ id: ref.id, deduplicated: false });
}
```

**为什么幂等**：同一次上传可能触发多次（客户端重试），重复创建会报 unique constraint 错误，幂等避免此问题。

### 3.3 Worker 修复（`worker/index.ts`）

```startLine:74:worker/index.ts
    } else if (job.targetType === "FILE_ASSET") {
      // Feature 2: process FileAsset → Document → SearchDocument
      await processFileAssetJob(job.targetId);
      await prisma.indexJob.update({ ... });
```

**为什么加 `await`**：旧版 `processFileAssetJob` 是 `async` 函数但没 `await`，Promise 抛出的未捕获异常直接导致 IndexJob 进入 FAILED 状态。

### 3.4 `resolveProjectIdFromFileAsset`（`shared/lib/document.ts`）

```startLine:40:shared/lib/document.ts
async function resolveProjectIdFromFileAsset(fileAssetId: string): Promise<string | null> {
  const ref = await prisma.fileReference.findFirst({
    where: { fileAssetId, deletedAt: null },
    select: { sourceType: true, sourceId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!ref) return null;

  switch (ref.sourceType as FileReferenceSourceType) {
    case "PROJECT": return ref.sourceId; // sourceId 就是 projectId
    case "PKM_NOTE": { const note = await prisma.pkmNote.findUnique(...); return note?.projectId ?? null; }
    case "TICKET": { const ticket = await prisma.ticket.findUnique(...); return ticket?.projectId ?? null; }
    case "TICKET_COMMENT": { ... }
    default: return null;
  }
}
```

---

## 4. 环境与配置

| 变量 | 值 | 说明 |
|------|----|------|
| `DATABASE_URL` | `postgresql://user:pass@192.168.1.14:5432/pm` | 远端 PostgreSQL |
| `EMBEDDING_API_URL` | `http://192.168.1.14:5000` | Python OCR/PDF 解析服务 |
| 服务端口 | 3003 | Next.js 生产绑定 `0.0.0.0` |
| Worker 端口 | 无（独立进程） | 通过 systemd 管理 |

---

## 5. 启动 / 部署

```bash
# 1. 拉取最新代码（远端服务器）
cd /home/hxy/project-manager
git pull origin main

# 2. 构建 Next.js（生产模式）
npm run build

# 3. 重启 Next.js 服务
sudo systemctl restart project-manager.service

# 4. 重启 Worker（处理 IndexJob）
sudo systemctl restart project-manager-worker.service

# 5. 确认服务存活
curl -s http://localhost:3003/api/health | head -c 100
journalctl --user -u project-manager-worker.service -n 20 --no-pager
```

---

## 6. 测试 & 验证

### 6.1 诊断脚本（本地可跑）

```bash
cd /Users/vastgui/Desktop/project-manager
npx tsx scripts/diagnose-document-search.ts
```

**期望输出**：

```
=== 诊断 1: 检查所有 sourceType 数量 ===
  PROJECT: 5          ← 有数量表示新路线通了
  COMMIT: 286
  TICKET: 164
  PKM_NOTE: 66

=== 诊断 2: 检查 DOCUMENT 类型 SearchDocument ===
  hasEmbedding=true    ← 有值表示 Worker 处理成功
```

### 6.2 端到端手动测试

1. 打开项目详情页 → 文档 Tab
2. 上传一个 PDF/Word/Excel 文件
3. 确认出现"项目直接上传"区块（不是"来源笔记"）
4. 等 30 秒（Worker 轮询间隔 2s）
5. 在 AI 对话里搜索上传的文件名
6. 期望：该文档出现在 RAG 结果中，且能过滤到项目

### 6.3 Worker 日志查看

```bash
# 远端服务器
journalctl --user -u project-manager-worker.service -f | grep FILE_ASSET

# 期望看到
[worker] job xxx FILE_ASSET indexing completed
```

---

## 7. 复现 Checklist

- [ ] `git pull` 拉取最新代码（含 `uploadProjectFile`、`references/route.ts`）
- [ ] `npm run build` 构建成功，无 TypeScript 错误
- [ ] `sudo systemctl restart project-manager.service` 重启 Next.js
- [ ] `sudo systemctl restart project-manager-worker.service` 重启 Worker
- [ ] 项目文档 Tab 上传一个测试 PDF
- [ ] 确认页面显示"项目直接上传"（不是"来源笔记"）
- [ ] 等 30s 后跑诊断脚本，确认 `DOCUMENT` SearchDocument 有数据
- [ ] AI 对话搜索文件名，确认出现在 RAG 结果
- [ ] `journalctl` 确认 Worker 无 FAILED 日志

---

## 8. 踩坑记录

### 坑 1：历史 Document 全部 FAILED（两种原因）

**现象**：`diagnose-document-failed.ts` 输出大量 `error=UNSUPPORTED_MIME` 或 `error=fetch failed`

**原因**：
- `UNSUPPORTED_MIME`：上线前代码的 `SUPPORTED_MIME_TYPES` 还没加入 `.docx` / `.xlsx` / `image/*`
- `fetch failed`：Worker 机器网络不通 `192.168.1.14:5000`（embedding 服务）

**解法**：历史遗留，**无需处理**。新上传的文件走新版代码，不再出现此问题。可写脚本重处理（见 `scripts/reprocess-failed-documents.ts`，TODO）。

### 坑 2：`processFileAssetJob` 未 await 导致 FAILED

**现象**：所有新上传的 FILE_ASSET IndexJob 都 FAILED，`error=[object Object]`

**原因**：Worker 里 `processFileAssetJob` 是 `async` 函数但没有 `await`，Promise rejection 冒泡导致 IndexJob 直接 FAILED

**解法**：加 `await processFileAssetJob(job.targetId)`

### 坑 3：`references/route.ts` 从未提交

**现象**：`git status` 显示 `app/api/file-assets/[id]/references/route.ts` 被删

**原因**：文件从未 commit（历史遗漏），`git pull` 时被删掉了

**解法**：重新创建文件（见 3.2 节代码）

### 坑 4：Document `error` 字段存了 Error 对象而非字符串

**现象**：`diagnose-document-failed.ts` 显示 `error=[object Object]`（不是人类可读的错误信息）

**原因**：Worker 捕获异常后直接 `error: msg`，但 `msg` 是 `String(error)` 对 Error 对象调用导致 `[object Object]`

**解法**：确保 `error instanceof Error` 分支返回 `error.message`（新版代码已修复）
