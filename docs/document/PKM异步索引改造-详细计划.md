# PKM 笔记向量索引异步化 — 详细实现计划

> 适用：project-manager 仓库
> 状态：规划中
> 日期：2026-06-26
> 依赖决策：自建 `IndexJob` 表 + 独立 Worker 进程 + 指数退避重试

---

## 目录

1. [架构总览](#1-架构总览)
2. [Phase 0 — 数据库改造：IndexJob 表](#phase-0--数据库改造indexjob-表)
3. [Phase 1 — 改造笔记保存 API](#phase-1--改造笔记保存-api)
4. [Phase 2 — Worker 进程实现](#phase-2--worker-进程实现)
5. [Phase 3 — 幂等性与取消去重](#phase-3--幂等性与取消去重)
6. [Phase 4 — DELETE 清理 + CLI 工具](#phase-4--delete-清理--cli-工具)
7. [Phase 5 — 部署与运维](#phase-5--部署与运维)
8. [测试验证](#测试验证)
9. [文件变更清单](#文件变更清单)

---

## 1. 架构总览

### 1.1 改造前后对比

**改造前（同步链路）**：

```
POST /api/pkm/notes
    ↓
prisma.pkmNote.create
    ↓
syncPkmNoteSearchDocument()
    ├─ extractAttachmentTexts()  ← 同步阻塞，最坏 60s
    ├─ upsertSearchDocument()    ← 同步写入 content + embedding
    └─ 返回 NextResponse        ← 最坏情况等 60s+
```

**改造后（同步写 content + 异步生成 embedding）**：

```
POST /api/pkm/notes
    ↓
prisma.pkmNote.create
    ↓
syncPkmNoteSearchDocument()
    ├─ upsertSearchDocument(skipEmbedding=true)  ← 同步写 content，< 100ms
    └─ enqueueIndexJob(noteId)                  ← 入队，< 10ms
    ↓
返回 NextResponse  ← < 200ms
    ↓
Worker 进程（独立）
    ├─ fetchIndexJob()  ← 从 IndexJob 表拿 pending job
    ├─ extractAttachmentTexts()  ← 解析附件，可重试
    ├─ upsertSearchDocument()    ← 更新 chunk（带完整 content）
    ├─ fetchEmbeddingsBatch()    ← 生成向量
    └─ updateSearchDocumentEmbedding()
    └─ markJobDone()
```

### 1.2 数据流

```
┌─────────────────────────────────────────────────────────┐
│                    Worker 进程                           │
│                                                         │
│  IndexJob 表                                            │
│  ┌──────────────────────────────────────────────────┐   │
│  │ id | noteId | status | attempt | error | created │   │
│  └──────────────────────────────────────────────────┘   │
│       │                                                 │
│       ▼                                                 │
│  extractAttachmentTexts()  ←── 失败 → retry 指数退避     │
│       │                                                │
│       ▼                                                │
│  upsertSearchDocument(skipEmbedding=false)              │
│       │                                                │
│       ▼                                                │
│  fetchEmbeddingsBatch() → updateSearchDocumentEmbedding │
│       │                                                │
│       ▼                                                │
│  markJobDone()                                          │
└─────────────────────────────────────────────────────────┘
```

### 1.3 关键文件位置（现有代码引用）

| 文件 | 作用 | 改动 |
|---|---|---|
| `prisma/schema.prisma` | 定义 `SearchDocument` 和未来的 `IndexJob` | 新增 `IndexJob` model |
| `features/knowledge/lib/search.ts` | 索引写入核心逻辑 | 拆分 `syncPkmNoteSearchDocument`，新增 `enqueueIndexJob` |
| `app/api/pkm/notes/route.ts` | 笔记创建 API | 调用 `enqueueIndexJob` |
| `app/api/pkm/notes/[id]/route.ts` | 笔记更新/删除 API | 调用 `enqueueIndexJob` / 清理 job |
| `embedding/api.py` | 文档解析 + 向量生成 | 无需改动 |
| `scripts/document/search-admin.ts` | CLI 工具 | 新增 `worker` 子命令 / job 状态查看 |
| `worker/index.ts` | Worker 主程序 | **新建**，独立进程入口（与 `embedding/` 平级，常驻服务） |
| `worker/README.md` | Worker 部署说明 | **新建** |
| `package.json` | npm scripts | 新增 `worker` script |

---

## Phase 0 — 数据库改造：IndexJob 表

### 2.1 Prisma Model 设计

在 `prisma/schema.prisma` 中新增 `IndexJob` model，位于 `SearchDocument` 之后：

```prisma:prisma/schema.prisma
model IndexJob {
  id        String    @id @default(cuid())
  noteId    String    // FK → PkmNote.id
  status    IndexJobStatus @default(PENDING)
  attempt   Int       @default(0)          // 当前重试次数
  maxAttempts Int     @default(5)           // 最大重试次数
  error     String?                       // 最后一次错误信息
  errorSources Json?                      // 每个附件的 source（ok/timeout/error）
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  startedAt DateTime?

  note     PkmNote? @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([status, createdAt(sort: Asc)])    // worker 轮询用
  @@index([noteId, status])                  // 取消/去重查询用
  @@schema("pm")
}

enum IndexJobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

**为什么这样设计**：
- `status` 索引覆盖 `PENDING` + `createdAt ASC` → worker 轮询时 `WHERE status = 'PENDING' ORDER BY createdAt ASC LIMIT 1` 可以直接命中索引
- `noteId + status` 复合索引 → 取消操作 `DELETE WHERE noteId=? AND status='PENDING'` 高效
- `Cascade` on `noteId` → 笔记删除时自动清理 job（不需要在 DELETE API 里显式清理）
- `errorSources` 存每个附件的提取结果 → 方便排查是哪个附件失败了

### 2.2 Migration 操作

```bash
# 开发环境
npx prisma migrate dev --name add_index_job_table

# 生产环境
npx prisma migrate deploy
```

### 2.3 Prisma Client 重新生成

```bash
npx prisma generate
```

---

## Phase 1 — 改造笔记保存 API

### 3.1 新增 `enqueueIndexJob` 函数

在 `features/knowledge/lib/search.ts` 中新增函数（放在 `syncPkmNoteSearchDocument` 之后）：

```typescript:features/knowledge/lib/search.ts
export async function enqueueIndexJob(noteId: string): Promise<void> {
  // 1. 取消该 note 所有 pending 状态的旧 job（去重）
  await prisma.indexJob.deleteMany({
    where: {
      noteId,
      status: "PENDING",
    },
  });

  // 2. 入队新 job
  await prisma.indexJob.create({
    data: {
      noteId,
      status: "PENDING",
      attempt: 0,
    },
  });

  console.log(`[search:job] enqueued index job for note ${noteId}`);
}
```

### 3.2 改造 `syncPkmNoteSearchDocument`

将原函数拆分为两个路径：

**路径 A — Worker 用（完整逻辑，不入队）**：

```typescript:features/knowledge/lib/search.ts
/**
 * Worker 调用的完整同步索引逻辑。
 * 注意：这个函数不再入队，由调用方保证已处理入队逻辑。
 */
export async function syncPkmNoteSearchDocumentFull(noteId: string) {
  const note = await prisma.pkmNote.findUnique({...});
  if (!note) {
    await prisma.searchDocument.deleteMany({...});
    return null;
  }

  const attachments = normalizePkmAttachments(note.attachments);
  const attachmentTexts = await extractAttachmentTexts(attachments);

  // delete 旧 chunk
  await prisma.searchDocument.deleteMany({...});

  // build + upsert（skip embedding=false，完整写入）
  const chunks = await buildSearchablePkmNoteChunks({...note, attachments}, attachmentTexts);
  const savedChunks = await Promise.all(
    chunks.map((chunk, idx) => upsertSearchDocument(chunk, idx, false)), // skipEmbedding=false
  );

  // fetch + update embedding
  const embeddings = await fetchEmbeddingsBatch(savedChunks.map(c => c.content));
  await Promise.all(savedChunks.map(async (c, i) => {
    await updateSearchDocumentEmbedding(c.id, embeddings[i]);
  }));

  return savedChunks;
}
```

**路径 B — API 路由用（同步写 content + 入队，不生成向量）**：

```typescript:features/knowledge/lib/search.ts
/**
 * 笔记保存时调用的同步索引逻辑。
 * 只写 content，不生成 embedding（异步由 worker 完成）。
 */
export async function syncPkmNoteSearchDocument(noteId: string) {
  const note = await prisma.pkmNote.findUnique({...});
  if (!note) {
    await prisma.searchDocument.deleteMany({...});
    return null;
  }

  const attachments = normalizePkmAttachments(note.attachments);
  // 【关键改动】：这里不调 extractAttachmentTexts，
  // 直接用 note.content 和空的 attachmentTexts
  const attachmentTexts: Record<string, ExtractedTextResult> = {};

  // delete 旧 chunk
  await prisma.searchDocument.deleteMany({...});

  // build + upsert（skip embedding=true，只写 content）
  const chunks = await buildSearchablePkmNoteChunks({...note, attachments}, attachmentTexts);
  const savedChunks = await Promise.all(
    chunks.map((chunk, idx) => upsertSearchDocument(chunk, idx, true)), // skipEmbedding=true
  );

  // 【关键改动】：入队 job，而不是同步生成 embedding
  await enqueueIndexJob(noteId);

  return savedChunks;
}
```

**为什么这样做**：
- API 路由只写 `content`（来自 `note.content` 纯文本），不调 `extractAttachmentTexts` → 响应时间 < 200ms
- `attachmentTexts={}` → chunk 里只有笔记正文，没有附件内容 → keyword 搜索可用
- Worker 异步处理附件解析 + 向量生成 → 完整内容最终会覆盖只含正文的 chunk

### 3.3 新增 Worker 专用 extract 函数（带 source 收集）

Worker 需要知道每个附件的提取结果（用于 `errorSources` 字段），所以在 `features/knowledge/lib/search.ts` 新增：

```typescript:features/knowledge/lib/search.ts
export async function extractAttachmentTextsWithSources(
  attachments: PkmAttachment[],
): Promise<{
  results: Record<string, ExtractedTextResult>;
  failedCount: number;
  timeoutCount: number;
}> {
  const results: Record<string, ExtractedTextResult> = {};
  let failedCount = 0;
  let timeoutCount = 0;

  const texts = await extractAttachmentTexts(attachments);
  for (const [key, result] of Object.entries(texts)) {
    results[key] = result;
    if (result.source !== "ok") {
      failedCount++;
      if (result.source === "timeout") timeoutCount++;
    }
  }

  return { results, failedCount, timeoutCount };
}
```

### 3.4 改造 `app/api/pkm/notes/route.ts`（POST）

改动 `POST` handler（第 52-112 行），只需把 `await syncPkmNoteSearchDocument(note.id)` 保留不变（因为 `syncPkmNoteSearchDocument` 内部已改为"同步写 content + 入队"）。**无需改动 API 路由本身**，只需确保 `syncPkmNoteSearchDocument` 内部已包含 `enqueueIndexJob` 调用。

### 3.5 改造 `app/api/pkm/notes/[id]/route.ts`（PATCH）

第 91 行的 `await syncPkmNoteSearchDocument(updated.id)` **无需改动**（同上，内部已包含入队）。

DELETE handler（第 100-124 行）**需要新增**：在 `prisma.pkmNote.delete` 之前，确认 IndexJob 已被 cascade 清理（因为 schema 里配置了 `Cascade`）。如果 Cascade 生效，DELETE 路由无需修改。如果 Cascade 未生效（Prisma 版本问题），在 DELETE 前加一行：

```typescript:app/api/pkm/notes/[id]/route.ts
// DELETE handler 中，prisma.pkmNote.delete 之前
await prisma.indexJob.deleteMany({ where: { noteId: id } }); // 兜底清理
await prisma.pkmNote.delete({ where: { id } });
```

---

## Phase 2 — Worker 进程实现

### 4.1 Worker 主程序入口

新建 `worker/index.ts`：

```typescript:worker/index.ts
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { prisma } from "@/shared/db/client";
import { syncPkmNoteSearchDocumentFull } from "@/shared/lib/search";

const POLL_INTERVAL_MS = 2_000;   // 无 job 时轮询间隔
const BATCH_SIZE = 1;              // 每次只拿 1 个 job（附件解析 CPU 重，避免并发）
const LOG_PREFIX = "[worker]";

async function main() {
  console.log(`${LOG_PREFIX} started, polling IndexJob table...`);

  while (true) {
    try {
      await processNextJob();
    } catch (error) {
      console.error(`${LOG_PREFIX} unexpected error in loop:`, error);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function processNextJob(): Promise<void> {
  // 1. 原子抢 job（只拿 PENDING 的，按创建时间 FIFO）
  const job = await prisma.$transaction(async (tx) => {
    const found = await tx.indexJob.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    if (!found) return null;

    // 2. 标记为 PROCESSING（防止其他 worker 抢）
    await tx.indexJob.update({
      where: { id: found.id },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    return found;
  });

  if (!job) {
    await sleep(POLL_INTERVAL_MS);
    return;
  }

  console.log(`${LOG_PREFIX} processing job ${job.id} for note ${job.noteId} (attempt ${job.attempt + 1}/${job.maxAttempts})`);

  try {
    // 3. 执行完整索引（extract + embed + write）
    const chunks = await syncPkmNoteSearchDocumentFull(job.noteId);

    // 4. 标记成功
    await prisma.indexJob.update({
      where: { id: job.id },
      data: { status: "COMPLETED" },
    });

    console.log(`${LOG_PREFIX} job ${job.id} completed, ${chunks?.length ?? 0} chunks indexed`);
  } catch (error) {
    await handleJobError(job, error);
  }
}

async function handleJobError(job: { id: string; noteId: string; attempt: number; maxAttempts: number }, error: unknown) {
  const msg = error instanceof Error ? error.message : String(error);
  const nextAttempt = job.attempt + 1;

  if (nextAttempt >= job.maxAttempts) {
    // 超过最大重试次数，标记失败
    await prisma.indexJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        error: msg,
        attempt: nextAttempt,
      },
    });
    console.error(`${LOG_PREFIX} job ${job.id} FAILED after ${job.maxAttempts} attempts: ${msg}`);
    return;
  }

  // 计算指数退避延迟
  const delayMs = getExponentialBackoffMs(nextAttempt);
  console.warn(`${LOG_PREFIX} job ${job.id} failed (attempt ${nextAttempt}/${job.maxAttempts}): ${msg}. Retrying in ${delayMs}ms...`);

  // 标记为 PENDING，等待下次轮询（用 updatedAt 做 FIFO 排序）
  await prisma.indexJob.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      attempt: nextAttempt,
      error: msg,
      startedAt: null, // 重置 startedAt，这样在 FIFO 排序中会靠后
    },
  });

  await sleep(delayMs);
}

function getExponentialBackoffMs(attempt: number): number {
  const baseDelays = [1_000, 5_000, 30_000, 120_000, 600_000]; // 1s, 5s, 30s, 2min, 10min
  return baseDelays[Math.min(attempt - 1, baseDelays.length - 1)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().finally(() => prisma.$disconnect());
```

**关键设计点**：
- `$transaction` 原子抢 job：防止多 worker 并发抢同一个 job
- `status: "PENDING"` 的 job 重新入队时不 create 新记录，而是 update 旧记录 + 调整 `updatedAt` → 保持 FIFO 顺序
- `BATCH_SIZE = 1`：附件解析是 CPU 重操作，避免并发 worker 互相争抢 embedding 服务
- 独立 while 循环：进程常驻，不断轮询

### 4.2 `package.json` 新增 script

```json:package.json
"worker": "tsx worker/index.ts",
"worker:prod": "NODE_ENV=production tsx worker/index.ts"
```

### 4.3 Worker 进程管理（systemd）

创建 `scripts/deploy/worker.service`：

```ini:scripts/deploy/worker.service
[Unit]
Description=project-manager Index Worker
After=network.target

[Service]
Type=simple
User=hxy
WorkingDirectory=/home/hxy/work/personal/project-manager
ExecStart=/home/hxy/.nvm/versions/node/v22.12.0/bin/node /home/hxy/work/personal/project-manager/node_modules/.bin/tsx /home/hxy/work/personal/project-manager/worker/index.ts
Restart=always
RestartSec=5

Environment=NODE_ENV=production
EnvironmentFile=/home/hxy/work/personal/project-manager/.env.production

[Install]
WantedBy=multi-user.target
```

部署命令：

```bash
# 复制 service 文件
scp scripts/deploy/worker.service hxy@192.168.1.14:/etc/systemd/system/
# 重载 systemd
ssh hxy@192.168.1.14 "sudo systemctl daemon-reload"
# 启用并启动
ssh hxy@192.168.1.14 "sudo systemctl enable --now project-manager-worker"
# 查看日志
ssh hxy@192.168.1.14 "journalctl -u project-manager-worker -f"
```

---

## Phase 3 — 幂等性与取消去重

### 5.1 幂等性保证

**场景 1：同一笔记快速连续保存（手动保存 + 自动保存）**

```
t=0:   用户点击保存 → enqueueIndexJob(noteId=A, jobId=1, status=PENDING)
t=100ms: 自动保存触发 → enqueueIndexJob(noteId=A, jobId=2, status=PENDING)
                           └─ deleteMany WHERE noteId=A AND status=PENDING
                           └─ create jobId=2 (jobId=1 被删掉)
t=200ms: Worker 抢到 jobId=2，开始处理
t=50s:  Worker 完成，jobId=2 标记 COMPLETED
```

`enqueueIndexJob` 内部先 `deleteMany(PENDING)` 再 `create` → 只有一个 job 在跑，不会重复索引。

**场景 2：Worker 正在处理时，新的保存触发入队**

```
t=0:   Worker 抢到 jobId=1, status=PROCESSING
t=10s: 用户保存 → enqueueIndexJob(noteId=A)
                    └─ deleteMany WHERE noteId=A AND status=PENDING
                    └─ (jobId=1 是 PROCESSING，不受影响)
                    └─ create jobId=2 (PENDING)
t=50s: jobId=1 完成，标记 COMPLETED
t=51s: Worker 轮询 → 拿到 jobId=2，重新索引（覆盖 jobId=1 的结果）
```

**场景 3：Worker 崩溃（job 卡在 PROCESSING）**

```
t=0:   Worker 抢到 jobId=1, status=PROCESSING, startedAt=t0
t=10s: Worker 进程被 kill（SIGTERM）
jobId=1 永远卡在 PROCESSING → 需要定时器清理
```

**解决方案**：Worker 启动时或每次轮询时，检查 `PROCESSING` 状态的 job 是否超时：

```typescript:worker/index.ts
// 在 main() 循环开头加
async function recoverStaleJobs(): Promise<void> {
  const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟超时
  const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

  const stale = await prisma.indexJob.updateMany({
    where: {
      status: "PROCESSING",
      startedAt: { lt: staleCutoff },
    },
    data: {
      status: "PENDING",
      attempt: { increment: 1 }, // 重试次数 +1
      startedAt: null,
    },
  });

  if (stale.count > 0) {
    console.warn(`[worker] recovered ${stale.count} stale PROCESSING jobs`);
  }
}
```

### 5.2 错误源追踪（`errorSources`）

Worker 在处理附件时，需要把每个附件的 `source` 收集起来存入 `IndexJob.errorSources`：

```typescript:worker/index.ts
// 在 processNextJob() 的 try 块中
const note = await prisma.pkmNote.findUnique({ where: { id: job.noteId } });
const attachments = normalizePkmAttachments(note.attachments);
const { results: attachmentTexts, failedCount, timeoutCount } = await extractAttachmentTextsWithSources(attachments);

// ... 执行索引 ...

// 完成后更新 errorSources（方便排查）
await prisma.indexJob.update({
  where: { id: job.id },
  data: {
    status: "COMPLETED",
    errorSources: attachmentTexts as any,
  },
});
```

---

## Phase 4 — DELETE 清理 + CLI 工具

### 6.1 DELETE 笔记时的 IndexJob 清理

`prisma/schema.prisma` 中 `IndexJob.noteId` 配置了 `Cascade` 删除，Prisma 会在删除 `PkmNote` 时自动删除对应的 `IndexJob`。**如果 Prisma 版本不支持跨表 Cascade**（某些 Prisma 版本），在 `app/api/pkm/notes/[id]/route.ts` 的 DELETE handler 中手动清理：

```typescript:app/api/pkm/notes/[id]/route.ts
export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireSession();
  const { id } = params;

  const note = await prisma.pkmNote.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!note) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (note.userId !== session.user.id) return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  // 清理 pending job（避免孤儿 job）
  await prisma.indexJob.deleteMany({ where: { noteId: id } });

  // 清理 SearchDocument（已有的逻辑，但之前没调）
  await prisma.searchDocument.deleteMany({
    where: {
      sourceType: buildSearchDocumentSourceType(SEARCH_DOCUMENT_SOURCE_TYPES.PKM_NOTE),
      sourceId: id,
    },
  });

  await prisma.pkmNote.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

### 6.2 CLI 工具新增 job 子命令

在 `scripts/document/search-admin.ts` 的 main 函数中新增：

```bash
# 查看队列状态
npm run search:job -- status

# 查看某个笔记的 job 状态
npm run search:job -- inspect <noteId>

# 手动重试失败的 job
npm run search:job -- retry <jobId>

# 手动重试某笔记的所有 job
npm run search:job -- retry-note <noteId>

# 清理所有 PENDING 状态的 job（慎用）
npm run search:job -- clear-pending

# 清理 COMPLETED 状态的 job（清理历史）
npm run search:job -- purge-completed --older-than-days 7
```

新增文件 `scripts/document/job-admin.ts`：

```typescript:scripts/document/job-admin.ts
// 实现 subcommands: status / inspect / retry / retry-note / clear-pending / purge-completed
```

---

## Phase 5 — 部署与运维

### 7.1 部署顺序（重要！）

**必须按此顺序部署，否则会丢 job：**

```
1. 数据库 Migration（Phase 0）
   └─ npx prisma migrate deploy
   └─ npx prisma generate

2. 部署 Next.js（Phase 1）— 含改造后的 syncPkmNoteSearchDocument
   └─ API 路由开始入队 IndexJob（但此时 Worker 未跑，结果还是同步写 content）
   └─ npm run build && pm2 restart pm

3. 启动 Worker（Phase 2）
   └─ systemctl start project-manager-worker
   └─ tail -f /var/log/worker.log 观察日志
```

**为什么顺序重要**：如果先启动 Worker 但 DB 还没 Migration，Worker 会报错。如果先部署 Next.js 但 Worker 未启动，`enqueueIndexJob` 写入的 job 会堆积在 `PENDING` 状态，直到 Worker 启动后一次性处理。

### 7.2 滚动更新策略

Worker 支持滚动更新：

```bash
# 1. 更新代码
git pull && npm install && npm run build

# 2. 重启 Worker（systemd 会自动重启）
sudo systemctl restart project-manager-worker

# 3. 观察日志确认新 worker 接管
journalctl -u project-manager-worker -f
```

`$transaction` 原子抢 job 保证任何时刻只有一个 Worker 处理同一个 job。

### 7.3 监控要点

```bash
# 查看 job 队列健康状态
npm run search:job -- status

# 期望输出示例
# PENDING:   3 jobs
# PROCESSING: 1 job
# COMPLETED:  152 jobs
# FAILED:     2 jobs (需要人工处理)
```

### 7.4 回滚方案

**如果发现严重问题需要回滚**：

```bash
# 1. 停止 Worker
sudo systemctl stop project-manager-worker

# 2. 回滚 Next.js 到上一个版本
git revert HEAD && pm2 restart pm

# 3. (可选) 清理 pending jobs
npm run search:job -- clear-pending

# 4. 对之前的笔记手动 reindex
npm run search:reindex <noteId>
```

---

## 测试验证

### 8.1 单元测试

```bash
# 测试 enqueueIndexJob 的去重逻辑
npm test -- shared/lib/search.test.ts

# 测试 Worker 的指数退避计算
npm test -- worker/index.test.ts

# 测试幂等性（同一 note 两次 enqueue）
npm test -- shared/lib/search.test.ts -- --test-name-pattern="enqueueIndexJob dedup"
```

### 8.2 集成测试流程

```
步骤 1: 准备测试笔记
  └─ POST /api/pkm/notes（带大 PDF 附件）

步骤 2: 验证 API 响应时间
  └─ curl -w "time: %{time_total}s\n" -X POST ...
  └─ 期望: < 500ms（不含附件解析时间）

步骤 3: 验证 IndexJob 入队
  └─ npm run search:job -- inspect <noteId>
  └─ 期望: status=PENDING 或 PROCESSING

步骤 4: 等待 Worker 处理（观察日志）
  └─ journalctl -u project-manager-worker -f
  └─ 期望: "job xxx completed, N chunks indexed"

步骤 5: 验证向量已写入
  └─ npm run search:embed -- 补充缺失向量的文档
  └─ psql 查询: SELECT title, (embedding IS NOT NULL) FROM pm."SearchDocument" WHERE sourceId='<noteId>'

步骤 6: 验证搜索可用
  └─ curl "http://localhost:3003/api/search?q=BLE" ...
  └─ 期望: 测试笔记出现在结果中
```

### 8.3 超时重试验证

```
步骤 1: 找一个大 PDF（> 2MB）或临时把 EXTRACT_TEXT_TIMEOUT_MS 改成 1ms
步骤 2: 创建笔记，观察 Worker 日志
步骤 3: 确认重试行为：
  └─ attempt 1 failed: timeout (1s 后重试)
  └─ attempt 2 failed: timeout (5s 后重试)
  └─ attempt 3 failed: timeout (30s 后重试)
  └─ attempt 4 failed: timeout (2min 后重试)
  └─ attempt 5 failed: timeout (10min 后重试)
  └─ attempt 6: status=FAILED
步骤 4: 确认 FAILED job 不会继续重试
步骤 5: 确认 CLI 可手动 retry: npm run search:job -- retry <jobId>
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `prisma/schema.prisma` | 修改 | 新增 `IndexJob` model 和 `IndexJobStatus` enum |
| `features/knowledge/lib/search.ts` | 修改 | 改造 `syncPkmNoteSearchDocument`；新增 `enqueueIndexJob`；新增 `syncPkmNoteSearchDocumentFull`；新增 `extractAttachmentTextsWithSources` |
| `app/api/pkm/notes/[id]/route.ts` | 修改 | DELETE handler 新增 `deleteMany` 清理 SearchDocument 和 IndexJob |
| `worker/index.ts` | **新建** | Worker 主程序，独立进程（与 `embedding/` 平级） |
| `scripts/document/job-admin.ts` | **新建** | job 管理 CLI（status/inspect/retry/purge） |
| `scripts/deploy/worker.service` | **新建** | systemd service 文件 |
| `package.json` | 修改 | 新增 `worker` / `worker:prod` script |
| `docs/vector-search/PKM异步索引改造-进度追踪.md` | **新建** | 进度追踪文档（本文档依赖） |
| `docs/vector-search/PKM异步索引改造-详细计划.md` | **新建** | 本计划文档 |

---

## 附录：与现有代码的兼容处理

### A.1 现有的 `backfillSearchDocuments` 和 `reindex` 命令

CLI 的 `search:backfill` 和 `search:reindex` 命令**无需改动**（它们直接调 `syncPkmNoteSearchDocument`），但需要考虑：

- `syncPkmNoteSearchDocument` 改造后，backfill/reindex 也会走"同步写 content + 入队"的逻辑
- **这会导致 backfill/reindex 也变成异步**——这不是预期行为，backfill/reindex 应该**同步完成**

**解决方案**：给 `syncPkmNoteSearchDocument` 加参数，控制是否走异步路径：

```typescript:features/knowledge/lib/search.ts
export async function syncPkmNoteSearchDocument(
  noteId: string,
  options: { async?: boolean } = {},  // 新参数
) {
  // ... 准备 chunks ...

  if (options.async) {
    // API 路由调这个：同步写 content + 入队
    await Promise.all(chunks.map(... upsert skipEmbedding=true));
    await enqueueIndexJob(noteId);
  } else {
    // CLI backfill/reindex 调这个：同步完成全部
    await Promise.all(chunks.map(... upsert skipEmbedding=false));
    const embeddings = await fetchEmbeddingsBatch(...);
    // update embeddings...
  }
}
```

CLI 命令调用时传 `{ async: false }`（默认），API 路由调用时传 `{ async: true }`。

### A.2 现有的 embedding 超时处理

`syncPkmNoteSearchDocumentFull`（Worker 用）中的 `fetchEmbeddingsBatch` 仍可能超时（embedding 服务本身不可用）。这种情况下：

- chunk content 已入库（`upsertSearchDocument(skipEmbedding=false)` 会在 embedding 失败时 throw）
- **解决方案**：`upsertSearchDocument` 改造后的行为是 throw 异常 → Worker 的 try/catch 会捕获，重新入队 retry
- 幂等性：`@@unique([sourceType, sourceId, chunkIndex])` 保证不会产生重复 chunk

### A.3 embedding 服务独立部署

`embedding/api.py` 是独立进程（`uvicorn embedding.api:app --port 5000`），和 Worker / Next.js 完全解耦。Worker 挂掉不影响 embedding 服务；embedding 服务挂掉时 Worker 会 retry。

### A.4 数据库连接池

Prisma 默认连接池大小较小。Worker 独立进程有自己的连接池：

```bash
# .env.production 中 Worker 专用的连接池配置（如果需要）
# DATABASE_URL="postgresql://...&connection_limit=5&pool_timeout=10"
```

默认 Prisma 的 `connection_limit` 是 `num_cpus * 2 + 1`，Worker 单进程通常够用。如果部署多个 Worker 实例，需要确保 `connection_limit` 不要超过 PostgreSQL 的 `max_connections`。
