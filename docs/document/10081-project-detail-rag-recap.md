# 工单 #10081 项目详情页与 RAG 全链路 — 开发到测试复现手册

> 适用：`project-manager` 仓库（Next.js 15 + Prisma 6 + PostgreSQL + BGE-M3 Embedding + LangGraph）
> 工单：#10081「项目详情页」（DEVELOPING，P2）
> 文档目标：拿到这份文档 + 对应 11 条 commit，**任何同事 / 未来的我**都能完整复现"项目详情页 + RAG 项目文档/工单提交"两个能力从开发到上线的全部步骤。

---

## 1. 目标 & 背景

### 1.1 旧版的问题

工单 #10081 拆开是两个互锁的子目标，**每一项旧版都至少有一条缺陷**：

| 子目标 | 旧版问题 | 用户感受 |
|---|---|---|
| 项目详情页 UI | 单 tab 文档附件上传/预览只能套用笔记页接口，无法在项目维度集中管理 | 上传文档后预览空白、无法与项目内其他笔记协同 |
| AI RAG 引用项目文档 | Worker 索引出 DOCUMENT chunks，但检索层用废弃常量 `KNOWLEDGE_DOC` 映射类型 → 在 `toResultType` 阶段被静默过滤 | AI 答"知识库中未找到" |
| AI 参考来源点开"项目文档" | `SearchDocument.url` 指向 `/api/upload/<fileAssetId>`，浏览器拿到原始 Markdown 流 | 点击乱码（Markdown 当 attachment 渲染） |
| AI 答"某工单的最新提交记录" | `searchKnowledge` 走向量检索对纯数字 ID 区分度差；`searchStructured` 只查工单、不查 commit | AI 答"知识库中未找到" |
| Worker 公平队列 | `claimNextJob` 按 `createdAt ASC`，`handleJobError` 重试时把 `updatedAt` 设成 `new Date(...) + delayMs`，导致延迟任务霸占队首 | 新任务阻塞 |
| Worker OOM | `splitIntoChunks` 当尾部 < overlap 时游标不前进 | Node 堆崩溃 |
| Worker 纯文本提取乱码 | `fileAsset.bytes.toString("utf-8")` 把 `Uint8Array` 当作 `Uint8Array.prototype.toString()`，输出"35,32,65,73..." | 文档虽然 chunk & embedding 但按正文搜不到 |

### 1.2 结论

#10081 一共 11 条 commit，分两条主线：

- **A 线 项目详情页（6 条）**：`3c4283d → bc93b6e → c880a76 → 46e479a → 6d0ebed`，交付项目详情页 UI、附件上传/预览、文档 tab、AI 引用、FileAsset → projectId 自动填入。
- **B 线 RAG / Worker 全链路修复（7 条，均在 2026-07-22 完成）**：`704b8cb → 313cc19 → ad43144 → 16b6afe → a7dc219 → 843f989`，修队列公平性 + Worker OOM + 纯文本解码 + DOCUMENT 类型映射 + 详情页路由 + 提交记录归属。

修完后：
- AI 检索 `ai-tool-optimization-recap.md` 这种项目文档能稳定命中，参考来源点开是详情页（不再乱码）；
- AI 问 `#10081 单的最新提交记录` 直接列出最近 5 条 commit 的 SHA / 主题 / 作者 / 时间 / 分支；
- Worker 不再 OOM，老任务不再霸占队首；
- 纯文本文件正文能按真实文本被检索到。

---

## 2. 改动清单

### A 线：项目详情页（2026-06-24 → 2026-07-22）

| Commit | 时间 | 文件（行数变化） | 作用一句话 |
|---|---|---|---|
| `3c4283d` | 2026-06-24 | 26 files / +2259 / -218 | 项目详情页附件上传/预览组件 + DocumentPreviewModal + mammoth types |
| `bc93b6e` | 2026-07-22 | 7 files / +1250 / -36 | FileAsset 向量化时通过 FileReference 链自动填入 projectId |
| `c880a76` | 2026-06-30 | 3 files / +14 / -8 | 修复 ProfileAiSummary 的 `length` TypeError |
| `46e479a` | 2026-06-30 | (rebase 同主题) | 同上 PR 的进一步修复 |
| `6d0ebed` | 2026-07-22 | 8 files / +262 / -132 | AI 对话/文件引用/项目详情多功能模块增强 |

### B 线：RAG / Worker 全链路修复（2026-07-22 当天）

| Commit | SHA | 文件（行数变化） | 作用一句话 |
|---|---|---|---|
| `704b8cb` | 704b8cb | 7 files / +185 / -7 | 修复 Worker 文件提取队列公平性 + splitIntoChunks OOM + 加 cleanup-old-jobs.ts |
| `313cc19` | 313cc19 | 1 file / +2 / -1 | 移除 `SearchDocument.documentId` 的 `@unique` 约束，让多 chunk 能正常写入 |
| `ad43144` | ad43144 | 2 files / +17 / -2 | 纯文本文件用 `Buffer.from(bytes).toString("utf-8")` 解码，回归测试 |
| `16b6afe` | 16b6afe | 3 files / +22 / -5 | `SEARCH_DOCUMENT_SOURCE_TYPES.KNOWLEDGE_DOC` → `DOCUMENT`，加 search.test.ts 映射回归 |
| `a7dc219` | a7dc219 | 4 files / +391 / -3 | 新增项目文档详情页 `/projects/[projectId]/documents/[fileAssetId]` + backfill script |
| `843f989` | 843f989 | 1 file / +99 / -14 | `queryTicket` 自动附带 TicketCommit 列表，`queryCommit` 支持 `filters.ticketNo` |

---

## 3. 核心实现

### 3.1 Worker 公平队列（704b8cb）

```175:193:shared/lib/jobs.ts
export async function claimNextJob() {
  // ...
  const found = await tx.indexJob.findFirst({
    where: { status: "PENDING" },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
```

**为什么**：旧版 `createdAt ASC` 会让 `handleJobError` 把 `updatedAt` 推到 `now+delayMs` 的任务永远排在队首。新版用 `updatedAt ASC` + 双 tie-breaker（`createdAt`、`id`）保证公平 + 确定性。

```140:170:worker/index.ts
        data: {
          status: "PENDING",
          attempt: nextAttempt,
          error: msg,
          startedAt: null,
          updatedAt: new Date(),   // 关键：不再 + delayMs，让重试任务按公平规则排队
        },
```

### 3.2 splitIntoChunks 防 OOM（704b8cb）

```1:61:shared/lib/chunk.ts
export function splitIntoChunks(
  text: string,
  maxChars = DEFAULT_MAX_CHARS,
  overlap = DEFAULT_OVERLAP,
): string[] {
  if (!Number.isInteger(maxChars) || maxChars <= 0) throw new Error("CHUNK_MAX_CHARS_INVALID");
  if (!Number.isInteger(overlap) || overlap < 0 || overlap >= maxChars) throw new Error("CHUNK_OVERLAP_INVALID");
  // ...
  while (cursor < normalized.length) {
    const end = Math.min(cursor + maxChars, normalized.length);
    let slice = normalized.slice(cursor, end);
    // ... 自然断点 ...
    const chunk = slice.trim();
    if (chunk) chunks.push(chunk);
    if (end === normalized.length) break;          // 终止条件
    cursor += Math.max(1, slice.length - overlap);  // 游标永远 ≥ 1，绝不死循环
  }
```

**为什么**：旧版当尾部 < overlap 时 `cursor` 不前进，触发 OOM。`Math.max(1, slice.length - overlap)` 是核心一行。

### 3.3 纯文本字节正确解码（ad43144）

```275:292:shared/lib/document.ts
    if (
      fileAsset.mimeType === "text/markdown" ||
      fileAsset.mimeType === "text/plain"
    ) {
      // Prisma Bytes 静态类型是 Uint8Array；显式转 Buffer 后再按 UTF-8 解码。
      return { text: decodeTextBytes(fileAsset.bytes) };
    }
```

```92:97:shared/lib/document.ts
export function decodeTextBytes(bytes: Uint8Array): string {
  // Prisma Bytes 是 Buffer 子类，但静态类型是 Uint8Array。
  // Buffer.from(bytes) 显式构造 Buffer，再 .toString("utf-8") 按字符解码（不是把每个字节转成 0-255 数字）。
  return Buffer.from(bytes).toString("utf-8");
}
```

**为什么**：`Uint8Array.prototype.toString("utf-8")` 不被支持，会回退到默认 `Array.prototype.toString` 输出"35,32,65,73..."。`Buffer.from(bytes).toString("utf-8")` 才会真的按 UTF-8 解码。

### 3.4 RAG 类型映射从 KNOWLEDGE_DOC → DOCUMENT（16b6afe）

```13:24:features/knowledge/lib/search-types.ts
export const SEARCH_DOCUMENT_SOURCE_TYPES = {
  TICKET: "TICKET",
  COMMIT: "COMMIT",
  DOCUMENT: "DOCUMENT",  // 旧值 KNOWLEDGE_DOC 是 Prisma 真正使用的 DOCUMENT 的废弃别名
  PKM_NOTE: "PKM_NOTE",
} as const;
```

```1:15:features/knowledge/lib/search.ts
export function toResultType(sourceType: string): SearchResultType | null {
  if (sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.TICKET) return "ticket";
  if (sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.COMMIT) return "commit";
  if (sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE) return "note";
  if (sourceType === SEARCH_DOCUMENT_SOURCE_TYPES.DOCUMENT) return "doc";   // 关键
  return null;
}
```

**为什么**：Worker 写入 `sourceType="DOCUMENT"`，但 `toResultType` 还在映射废弃常量 `KNOWLEDGE_DOC` → "doc"，所以 `DOCUMENT` chunk 在前端被过滤成 `null` → RAG 静默丢弃。

### 3.5 项目文档详情页路由（a7dc219）

```1:60:app/projects/[projectId]/documents/[fileAssetId]/page.tsx
export default async function ProjectDocumentDetailPage({ params }: Params) {
  await requireSession();
  const { projectId, fileAssetId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: fileAssetId },
    select: { id: true, originalName: true, mimeType: true, size: true, status: true,
              createdAt: true,
              document: { select: { id: true, status: true, version: true, extractedText: true,
                                    pageCount: true, error: true, updatedAt: true } } },
  });
```

**为什么**：旧版 `SearchDocument.url = /api/upload/<fileAssetId>`，AI 参考来源点开就是原始字节流。新版路由复用 `MarkdownContent` 渲染 `Document.extractedText`，并附带状态/页数/索引版本元数据。

```312:325:shared/lib/document.ts
      const chunkUrl = projectId
        ? `/projects/${projectId}/documents/${fileAsset.id}`
        : `/api/upload/${fileAsset.id}`;     // projectId 不可解析时保留旧下载入口，避免硬 404
```

### 3.6 searchStructured 附带 TicketCommit 列表（843f989）

```159:225:features/ai/tools/search-structured.ts
    if (ticket) {
      const assigneeNames = ticket.assignees.map((a) => a.user.name || a.user.email).join("、");
      const deadlineStr = ticket.deadline ? `，截止 ${new Date(ticket.deadline).toLocaleDateString("zh-CN")}` : "";
      // 该工单的提交记录（按时间倒序，最新 5 条）。从 TicketCommit 反查，
      // 不依赖语义搜索对数字工单 ID 的命中率（向量嵌入对纯数字 ID 区分度差）。
      const commits = await prisma.ticketCommit.findMany({
        where: { ticketNo: ticket.ticketNo },
        orderBy: { committedAt: "desc" },
        take: 5,
        select: { id: true, commitSha: true, subject: true, author: true,
                  committedAt: true, branches: true },
      });

      const summaryLines = [`工单 #${ticket.ticketNo} ${ticket.title}`,
        `状态：${ticket.status}，优先级：${ticket.priority}（1最高）`,
        `项目：${ticket.project.name} / ${ticket.module.name}`,
        `指派给：${assigneeNames || "无人"}`,
        `创建者：${ticket.creator.name}${deadlineStr}`,
        `创建时间：${new Date(ticket.createdAt).toLocaleString("zh-CN")}`];

      const sources: SourceReference[] = [{ index: 1, title: `#${ticket.ticketNo} ${ticket.title}`,
                                            url: `/tickets/${ticket.id}`, type: "ticket" as const }];

      if (commits.length > 0) {
        summaryLines.push("", `最新提交（共 ${commits.length} 条）：`);
        commits.forEach((c) => summaryLines.push(
          `${c.commitSha.slice(0, 7)} ${c.subject} | ${c.author} | ${new Date(c.committedAt).toLocaleString("zh-CN")} | 分支 ${c.branches.join(", ") || "无"}`,
        ));
        commits.forEach((c, idx) => sources.push({
          index: idx + 2,
          title: `${c.commitSha.slice(0, 7)} ${c.subject}`,
          url: `/tickets/${ticket.id}`,
          type: "commit" as const,
        }));
      } else {
        summaryLines.push("", "该工单暂无关联提交记录。");
      }
      return { summary: summaryLines.join("\n"), sources };
    }
```

**为什么**：向量嵌入对纯数字 ID 区分度差，问 `#10081单的最新提交记录` 时 RAG 返回的 5 条全是邻近 ID（#10068/#10066/#10075）。直接走 SQL 反查 TicketCommit 是 100% 准确的入口。

---

## 4. 环境与配置

| 项 | 值 | 说明 |
|---|---|---|
| Node.js | v22.22.2 | 服务器 / 本地一致 |
| Next.js | 15.x | App Router |
| Prisma | 6.19.3 | schema 在 `prisma/schema.prisma` |
| PostgreSQL | pm schema | 与 community schema 隔离 |
| Embedding 服务 | BGE-M3 FastAPI，端口 5000 | systemd 用户单元 `embedding-api.service` |
| 主应用 | Next.js production build，端口 3003 | `project-manager.service` |
| Worker | Node.js，`worker/index.ts` | `project-manager-worker.service` |
| DATABASE_URL | `.env.local` 里的 `DATABASE_URL=...` | 服务器上 `~/work/personal/project-manager/.env.local` |
| `AUTH_TRUST_HOST` | `true` | 不设 `AUTH_URL` / `NEXTAUTH_URL`，局域网访问 |
| 系统服务管理 | systemd **用户级** | `systemctl --user ...` |
| 代码路径 | `/home/hxy/work/personal/project-manager` | 服务器工作区 |
| Git 远端 | `origin` = `hxy@192.168.1.14:work/personal/project-manager.git`（局域网）<br/>`github` = `git@github.com:Cary222/project-manager.git`（公开） |

---

## 5. 启动 / 部署

```bash
# === 本地（开发机） ===
cd /Users/vastgui/Desktop/project-manager
npm install
npx prisma generate
npm run build

# === 服务器（hxy@192.168.1.14，生产）===
ssh hxy@192.168.1.14
cd ~/work/personal/project-manager
git pull origin main
npm install --no-audit --no-fund
npx prisma generate
rm -rf .next
npm run build

# 重启 systemd 用户单元（必须 --user，前面已确认 service 文件在 ~/.config/systemd/user/）
systemctl --user restart project-manager.service project-manager-worker.service
sleep 4
systemctl --user is-active project-manager.service project-manager-worker.service

# 端口存活
ss -ltn | grep -E "3003|5000"
# 期望：
# LISTEN 0  511  0.0.0.0:3003  0.0.0.0:*
# LISTEN 0  2048 0.0.0.0:5000  0.0.0.0:*
```

---

## 6. 测试 & 验证

### 6.1 单元 / 脚本验证

```bash
# BGE-M3 健康
curl -s http://localhost:5000/health
# 期望：{"status":"ok"}

# chunk + 纯文本解码回归
npx vitest run shared/lib/chunk.test.ts shared/lib/document.test.ts
# 期望：2 files passed

# search 类型映射回归
npx vitest run shared/lib/search.test.ts
# 期望：1 file passed（覆盖 TICKET/COMMIT/PKM_NOTE/DOCUMENT 4 种 sourceType → result type）

# 一次性回填脚本（生产）
ssh hxy@192.168.1.14 'cd ~/work/personal/project-manager && npx tsx scripts/backfill-document-chunk-url.ts --dry-run'
# 期望：
#  找到 30 条 chunk 待处理
#  ✅ "ai-tool-optimization-recap.md" (9 chunks) → /projects/<id>/documents/<fileAssetId>
#  ⚠ ... 20 条无 projectId 的 docx 周报，跳过
ssh hxy@192.168.1.14 'cd ~/work/personal/project-manager && npx tsx scripts/backfill-document-chunk-url.ts --force'
```

### 6.2 端到端验证

```bash
# 1. RAG 检索类型分布
ssh hxy@192.168.1.14 'cd ~/work/personal/project-manager && npx tsx -e "
import { loadEnvConfig } from \"@next/env\";
import { prisma } from \"./shared/db/client\";
loadEnvConfig(process.cwd());
(async () => {
  const grouped = await prisma.searchDocument.groupBy({ by: [\"sourceType\"], _count: { _all: true } });
  console.log(grouped);
  const legacy = await prisma.searchDocument.count({ where: { sourceType: \"DOCUMENT\", url: { startsWith: \"/api/upload/\" } } });
  const fresh = await prisma.searchDocument.count({ where: { sourceType: \"DOCUMENT\", url: { startsWith: \"/projects/\" } } });
  console.log({ legacy, fresh });
  await prisma.\$disconnect();
})();
"'
# 期望：
#  [[TICKET 165], [COMMIT 311], [DOCUMENT 30], [PKM_NOTE 66]]
#  legacy ≥ 20（无 projectId 的 docx 周报），fresh ≥ 10（已切到详情页）

# 2. AI chat 检索项目文档
curl -s -b /tmp/cookies.txt -X POST http://localhost:3003/api/ai/conversations \
  -H "Content-Type: application/json" -d "{}" > /tmp/conv.json
CONV=$(python3 -c "import json;print(json.load(open('/tmp/conv.json'))['data']['id'])")
curl -s -b /tmp/cookies.txt -X POST "http://localhost:3003/api/ai/conversations/$CONV/messages" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"ai-tool-optimization-recap.md这个文档是什么\",\"mode\":\"search\"}" \
  --max-time 90 -o /tmp/ai.txt
tail -c 1500 /tmp/ai.txt
# 期望：响应里出现"项目文档"和 5 条 commit/url 形式的来源，URL 都是 /projects/<id>/documents/<fileAssetId>

# 3. AI chat 查询某工单的提交记录
curl -s -b /tmp/cookies.txt -X POST http://localhost:3003/api/ai/conversations \
  -H "Content-Type: application/json" -d "{}" > /tmp/conv2.json
CONV=$(python3 -c "import json;print(json.load(open('/tmp/conv2.json'))['data']['id'])")
curl -s -b /tmp/cookies.txt -X POST "http://localhost:3003/api/ai/conversations/$CONV/messages" \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"#10081单的最新提交记录\",\"mode\":\"search\"}" \
  --max-time 90 -o /tmp/ai2.txt
tail -c 1500 /tmp/ai2.txt
# 期望：响应里准确列出 #10081 的 5 条最新 commit（真实 sha + 主题 + 作者 + 时间）
```

---

## 7. 复现 Checklist

- [ ] 服务器 ssh hxy@192.168.1.14 成功
- [ ] `git log --grep="#10081" -n 11` 能列出 11 条 commit
- [ ] `git pull origin main && npm install --no-audit --no-fund && npx prisma generate` 无错
- [ ] `npm run build` 成功，且路由表里有 `/projects/[projectId]/documents/[fileAssetId]`
- [ ] `systemctl --user restart project-manager.service project-manager-worker.service` 后两个都是 `active`
- [ ] `ss -ltn` 显示 3003 + 5000 都 listening
- [ ] `curl http://localhost:5000/health` 返回 `{"status":"ok"}`
- [ ] `npx vitest run shared/lib/chunk.test.ts shared/lib/document.test.ts shared/lib/search.test.ts` 全绿
- [ ] `npx tsx scripts/backfill-document-chunk-url.ts --dry-run` 看到 10 条 candidate → `/projects/...`
- [ ] `npx tsx scripts/backfill-document-chunk-url.ts --force` 成功
- [ ] chat 测 `ai-tool-optimization-recap.md` → AI 给出项目文档详情 + 链接是 `/projects/<id>/documents/<fileAssetId>`
- [ ] chat 测 `#10081单的最新提交记录` → AI 准确列出 5 条 commit
- [ ] 浏览器打开 `/projects/<id>/documents/<fileAssetId>` → 200，渲染 Markdown 正文，无乱码

---

## 8. 踩坑记录

> 按"现象 / 原因 / 解法"三段式整理，每个坑都来自这次真实开发与服务器验证过程。

### 坑 1：`updatedAt + delayMs` 让队列永久饿死新任务

**现象**：Worker 处理旧任务失败后，新上传的 FileAsset 任务在队列里等好几分钟不被处理。
**原因**：`handleJobError` 把 `updatedAt` 设成 `new Date(Date.now() + delayMs)`，但 `claimNextJob` 用 `createdAt ASC`，导致被推迟的任务永远在前。
**解法**：把 `updatedAt` 改回 `new Date()`，让 `orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }]` 决定公平性。

### 坑 2：`splitIntoChunks` 无限循环触发 OOM

**现象**：Worker 处理某些 docx 文本提取后内存耗尽，Node 进程被 systemd 重启。
**原因**：当尾部剩余 < overlap 时 `cursor += slice.length - overlap` 等于 0 甚至负数，循环永不退出。
**解法**：`cursor += Math.max(1, slice.length - overlap)`，加 `if (end === normalized.length) break` 终止条件，加参数校验。回归测试 `shared/lib/chunk.test.ts` 锁定"最后一段 < overlap"场景。

### 坑 3：纯文本 byte → 文本变成 "35,32,65,73..."

**现象**：上传 `ai-tool-optimization-recap.md` 后 Worker 状态 READY，但 AI 完全搜不到。
**原因**：`Uint8Array.prototype.toString("utf-8")` 不被支持，回退到 `Array.prototype.toString` 输出逗号分隔的数字。
**解法**：新增 `decodeTextBytes(bytes)` = `Buffer.from(bytes).toString("utf-8")`，文本/markdown 走这条路径。回归测试 `shared/lib/document.test.ts` 用中文 Markdown 锁定。

### 坑 4：RAG 类型映射错位 → DOCUMENT chunk 被静默过滤

**现象**：Worker 已经索引 9 条 ai-tool-optimization-recap.md 的 DOCUMENT chunk，DB 里也能查到，但 AI 参考来源显示为空。
**原因**：`SEARCH_DOCUMENT_SOURCE_TYPES.KNOWLEDGE_DOC` 是 Prisma 已废弃的别名，实际 enum 是 `DOCUMENT`，`toResultType` 拿到 `DOCUMENT` 返回 `null`。
**解法**：把常量改成 `DOCUMENT`，`toResultType` 改成 `if (sourceType === "DOCUMENT") return "doc"`。回归测试 `shared/lib/search.test.ts` 覆盖 4 种 sourceType。

### 坑 5：参考来源点开是乱码

**现象**：AI 答"项目文档"链接 `href="/api/upload/<fileAssetId>"`，浏览器拿到原始 Markdown 流显示乱码。
**原因**：`processFileAssetJob` 把 `SearchDocument.url` 写成文件下载 URL，浏览器把它当 attachment 渲染。
**解法**：新建 `/projects/[projectId]/documents/[fileAssetId]` 详情页，复用 `MarkdownContent` 渲染 `Document.extractedText`。Worker 写入 URL 时改为 `/projects/<projectId>/documents/<fileAssetId>`（projectId 不可解析回退 `/api/upload/...`）。配套 `scripts/backfill-document-chunk-url.ts` 一次性回填。

### 坑 6：AI 答"某工单最新提交记录" → "知识库中未找到"

**现象**：问 `#10081单的最新提交记录`，LLM 答"未找到"。
**原因**：BGE-M3 对纯数字 ID 区分度差，向量检索返回 #10068/#10066/#10075 等邻近 ID；`searchStructured` 拿到工单元数据后没附带 TicketCommit 列表。
**解法**：`queryTicket` 拿到工单后 `prisma.ticketCommit.findMany({ where: { ticketNo }, orderBy: { committedAt: "desc" }, take: 5 })` 反查 5 条 commit，写入 summary 和 sources（`type:"commit"`）。`queryCommit` 增加 `filters.ticketNo` 支持，作为"某工单提交记录"的精确入口。

### 坑 7：`prisma db push` 在生产上因无关表的 unique 冲突被卡住

**现象**：`npx prisma db push` 在 hxy@192.168.1.14 上因 `SearchDocument`、`UploadedFile` 的 unique 警告要求 `--accept-data-loss`，但这些表与本工单无关。
**原因**：Prisma db push 对已有数据 + unique 约束变更需要显式确认。
**解法**：放弃 `db push`，直接用 SQL DDL：`ALTER TYPE pm."IndexJobTargetType" ADD VALUE IF NOT EXISTS 'COMMIT';`、`DROP INDEX CONCURRENTLY pm."SearchDocument_documentId_key";`。schema 文件层面修改后人工同步。

### 坑 8：systemd 重启 loop（`EADDRINUSE` + 无 build）

**现象**：`project-manager.service` 进入 restart loop，`NRestarts` 持续上涨，日志反复 `EADDRINUSE` / "Could not find a production build"。
**原因**：(a) 残留的 `next-server` 进程占着 3003；(b) systemd 有时先 `npm run start` 再 `npm run build`，build 缺产物。
**解法**：手动 `systemctl stop` → `pkill -f next-server` → `systemctl reset-failed` → `npm run build` → `systemctl start`。之后必须保证 build 成功后再 restart。

### 坑 9：sudo 重启 service 找不到 unit

**现象**：服务器上 `hxy` 账号在 `sudo` 组但 `sudo systemctl restart project-manager.service` 报 `Unit ... not found`。
**原因**：unit 文件在 `~/.config/systemd/user/`（用户级），不是 `/etc/systemd/system/`（系统级）。`sudo` 默认走 system manager 看不到 user unit。
**解法**：用 `systemctl --user restart project-manager.service project-manager-worker.service`，不要 sudo。

---

## 附录：相关文档与脚本

| 路径 | 说明 |
|---|---|
| `docs/ARCHITECTURE.md` | 项目整体架构 |
| `docs/OPERATIONS.md` | 部署 / 重启 / 环境变量 |
| `prisma/schema.prisma` | `FileAsset`、`Document`、`SearchDocument`、`TicketCommit` 表定义 |
| `scripts/backfill-document-chunk-url.ts` | 一次性回填脚本 |
| `scripts/backfill-file-asset-projectid.ts` | 一次性回填 FileAsset → projectId |
| `scripts/verify-file-asset-projectid.ts` | 可重复验证脚本 |
| `scripts/cleanup-old-jobs.ts` | 30 天前 IndexJob 清理脚本（`--dry-run` / `--force`） |
| `docs/reviews/PR11-file-asset-projectid-{ai-mentor,code-reviewer}.md` | PR11 双审查报告 |

---

> 维护者：Cary222 <bluescary0@gmail.com>
> 关联 AI 助手：Cursor（`Co-authored-by: Cursor <cursoragent@cursor.com>`）
> 最近更新：2026-07-22（commit `843f989` 推送后）