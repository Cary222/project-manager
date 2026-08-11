---
name: AI 生图模式集成方案（v9 终版）
overview: |
  Agent Execution Runtime 架构。BackgroundJob 纯净化（无业务字段，仅 correlationId/traceId/parentJobId 追踪），
  JobOutput 承接多输出幂等（替代 AiMessageAttachment.jobId unique），lease recovery 修复 PROCESSING 卡死 bug，
  heartbeat 绑定 handler 生命周期 + 硬超时，SSE 事件命名 message.delta（非 JSON Patch 语义）。
  FileAsset storageKey（存储位置）与 checksum（内容指纹）职责分离。
isProject: false
---

## 核心调整（v8 → v9）

| # | 问题 | v8 | v9 |
|---|------|----|----|
| 1 | 链路追踪不够 | 仅 `correlationId` | 增加 `traceId` + `parentJobId`（支持 Agent 多步骤子任务树）|
| 2 | 多图幂等边界 | `AiMessageAttachment.jobId` + `@@unique([jobId, sequence])` | 新增 `JobOutput` 中间表，`FileAsset.create` 与 `Attachment.create` 之间加一层可恢复状态机 |
| 3 | storageKey 语义混淆 | `storageKey = hash(bytes)` | 拆分：`storageKey`=存储位置，`checksum`=内容指纹（用于去重，不用于定位）|
| 4 | lease recovery 有 bug | 只恢复 `status='PENDING'` | 恢复条件加 `OR (status='PROCESSING' AND leaseExpiresAt < now())` |
| 5 | heartbeat 无限续命 | `setInterval` 常驻 | 绑定 handler 生命周期（`try/finally` 停止）+ `Promise.race` 硬超时 kill |
| 6 | SSE 命名误导 | `message.patch`（非真 JSON Patch）| 重命名为 `message.delta`，语义为增量事件流，不承诺 RFC6902 |

---

## 架构设计

### 核心原则（累积自 v6-v9）

1. **BackgroundJob 纯净**：不含业务外键（userId/messageId/conversationId），业务关联全部进 `payload`；仅保留 `correlationId`/`traceId`/`parentJobId` 三个追踪字段
2. **JobOutput 承接结果**：Job 的执行结果不直接写业务表，先落 `JobOutput`（可恢复的中间状态），再由业务表引用
3. **Lease 而非 lock**：`leaseExpiresAt` 替代 `lockedAt`，recovery 覆盖 PENDING 和租约过期的 PROCESSING
4. **Heartbeat 绑定生命周期**：心跳跟 handler 执行绑定，超时会被 `Promise.race` 真正 kill，不会无限续命
5. **SSE 只暴露 message.delta**：前端不感知 job / JobOutput 模型，只感知消息增量
6. **存储位置与内容指纹分离**：`storageKey` 定位文件，`checksum` 做去重，两者不复用同一字段

### 追踪层级（traceId / parentJobId / correlationId）

```
traceId (一次用户请求的根)
  │
  ├─ correlationId = messageId（关联到具体 AiChatMessage）
  │
  └─ parentJobId（Agent 场景：子任务链）
        │
        ├─ Job A: rag.search        (parentJobId = null, traceId = T1)
        ├─ Job B: tool.call         (parentJobId = A.id, traceId = T1)
        └─ Job C: image.generate    (parentJobId = A.id, traceId = T1)
```

现在（生图场景）只用 `correlationId = messageId`，`traceId`/`parentJobId` 先建字段占位，Agent 阶段直接复用不用改 schema。

### Job → JobOutput → 业务表 数据流

```
BackgroundJob (IMAGE_GENERATE, payload: { messageId, prompt })
        │
        ▼
JobOutput.create({ jobId, sequence: 0, status: PENDING })   ← 先占位，crash 可恢复
        │
        ▼
generateImages() → bytes
        │
        ▼
FileAsset.create({ storageKey, checksum, ... })
        │
        ▼
JobOutput.update({ fileAssetId, status: COMPLETED })
        │
        ▼
AiMessageAttachment.create({ messageId, fileAssetId, jobOutputId })
        │
        ▼
message.delta { executionStatus: COMPLETED, attachments: [...] }
```

**为什么需要 JobOutput 这一层**：v8 的问题是 `FileAsset.create` 成功后如果进程 crash，`Attachment.create` 没执行，第二次重试会重新生成图片，产生孤儿 FileAsset。`JobOutput` 提前占位 `sequence`，任何一步 crash 后重试都能查到 `JobOutput` 记录判断该 sequence 是否已完成，不会重复生成。

---

## Prisma Schema

```prisma
// ── BackgroundJob（纯净 + 追踪三元组）───────────────────────────
model BackgroundJob {
  id             String              @id @default(cuid())
  type           BackgroundJobType
  status         BackgroundJobStatus @default(PENDING)

  payload        Json                // 业务关联全部在此：{ messageId, userId, prompt, modelRef }
  result         Json?               // 执行元数据：{ provider, model, duration }
  errorMessage   String?

  // ── 追踪三元组（Agent 阶段直接复用，现在只用 correlationId）──
  correlationId  String?             // 关联单个业务对象，如 messageId
  traceId        String?             // 一次用户请求的根 trace
  parentJobId    String?             // 子任务指向父任务

  priority       Int                 @default(10)
  attempt        Int                 @default(0)
  nextRetryAt    DateTime?

  // ── Lease（替代 lockedAt/lockedBy）───────────────────────────
  lockedBy       String?
  leaseExpiresAt DateTime?

  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@index([status, priority, updatedAt])
  @@index([correlationId])
  @@index([traceId])
  @@index([parentJobId])
  @@schema("pm")
}

// ── JobOutput（可恢复的执行结果中间态）──────────────────────────
enum JobOutputStatus {
  PENDING
  GENERATING
  COMPLETED
  FAILED
}

model JobOutput {
  id          String          @id @default(cuid())
  jobId       String
  sequence    Int             // 0,1,2,3... 支持多图/多文件输出
  status      JobOutputStatus @default(PENDING)
  fileAssetId String?
  errorMessage String?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  fileAsset FileAsset? @relation(fields: [fileAssetId], references: [id], onDelete: SetNull)

  @@unique([jobId, sequence])  // 幂等核心：同一 job 的同一 sequence 只产生一条记录
  @@index([jobId])
  @@schema("pm")
}

// ── AiMessageAttachment（引用 JobOutput，不再直接绑 jobId）─────
model AiMessageAttachment {
  id          String           @id @default(cuid())
  messageId   String
  fileAssetId String
  jobOutputId String?          @unique  // 一个 JobOutput 只产生一个 attachment
  type        AiAttachmentType
  createdAt   DateTime         @default(now())

  message   AiChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)
  fileAsset FileAsset     @relation(fields: [fileAssetId], references: [id], onDelete: Cascade)

  @@index([messageId])
  @@index([fileAssetId])
  @@map("AiMessageAttachment")
  @@schema("pm")
}

// ── FileAsset（storageKey 定位 / checksum 去重，职责分离）───────
model FileAsset {
  id          String          @id @default(cuid())
  storageType FileStorageType @default(DATABASE)
  storageKey  String?         // 存储位置：S3 key / 路径，例如 uploads/2026/08/xxx.png
  checksum    String?         // 内容指纹：sha256(bytes)，仅用于去重查询，不用于定位
  size        Int?
  mimeType    String?
  bytes       Bytes?          // 仅开发环境 / 小文件，production 应为空

  outputs     JobOutput[]
  attachments AiMessageAttachment[]

  @@index([storageKey])
  @@index([checksum])          // 去重查询走这个索引，不走 storageKey
  @@schema("pm")
}

enum FileStorageType {
  DATABASE
  OBJECT_STORAGE
}

enum AiAttachmentType {
  IMAGE
  FILE
}

// ── AiMessage executionStatus（v7 不变）─────────────────────────
enum AiMessageExecutionStatus {
  COMPLETED
  QUEUED
  PROCESSING
  FAILED
  CANCELLED
}

model AiChatMessage {
  id              String                    @id @default(cuid())
  conversationId  String
  role            String
  content         String
  executionStatus AiMessageExecutionStatus @default(COMPLETED)
  errorMessage    String?
  sources         Json?
  metadata        Json?
  attachments     AiMessageAttachment[]
  createdAt       DateTime                  @default(now())
  updatedAt       DateTime                  @updatedAt
  conversation    AiConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@schema("pm")
}
```

---

## Stage 1：Schema

1. 新建 `JobOutput` model（`@@unique([jobId, sequence])`，幂等核心）
2. `BackgroundJob` 加 `traceId` / `parentJobId`（`correlationId` 已在 v8 存在），`lockedAt` → `leaseExpiresAt`
3. `AiMessageAttachment.jobId` → `jobOutputId`（引用 JobOutput 而非直接绑 job）
4. `FileAsset` 加 `checksum` 独立索引，`storageKey` 语义收窄为「定位」

---

## Stage 2：Worker Lease + Heartbeat（修复 v8 两个 bug）

### `worker/jobs/background-job.ts` — claim + lease recovery（修复 bug）

```ts
const LEASE_DURATION_MS = 5 * 60_000; // 5分钟租约

export async function claimNextBackgroundJob(workerId: string): Promise<BackgroundJob | null> {
  // 修复点：recovery 条件必须覆盖 PENDING 和租约过期的 PROCESSING
  // v8 bug: 只查 status='PENDING'，PROCESSING 卡死永远不会被捡回
  const [job] = await prisma.$queryRaw<BackgroundJob[]>`
    UPDATE "BackgroundJob"
    SET status = 'PROCESSING', "lockedBy" = ${workerId}, "leaseExpiresAt" = NOW() + INTERVAL '5 minutes'
    WHERE id = (
      SELECT id FROM "BackgroundJob"
      WHERE
        (status = 'PENDING' AND (nextRetryAt IS NULL OR nextRetryAt <= NOW()))
        OR (status = 'PROCESSING' AND "leaseExpiresAt" < NOW())  -- ← 修复：捡回租约过期的任务
      ORDER BY priority DESC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `;
  return job ?? null;
}

export async function renewLease(jobId: string, workerId: string): Promise<boolean> {
  const result = await prisma.backgroundJob.updateMany({
    where: { id: jobId, lockedBy: workerId }, // 只有持有者能续约
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS) },
  });
  return result.count > 0;
}
```

### `worker/runtime/heartbeat.ts`（新建：绑定生命周期 + 硬超时）

```ts
export function startHeartbeat(jobId: string, workerId: string) {
  const timer = setInterval(() => {
    renewLease(jobId, workerId).catch((err) => console.error(`[heartbeat] renew failed`, err));
  }, 30_000);

  return {
    stop: () => clearInterval(timer), // handler 结束（成功/失败/超时）必须调用
  };
}

export async function runWithTimeout<T>(
  jobId: string,
  workerId: string,
  handler: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const heartbeat = startHeartbeat(jobId, workerId);
  try {
    // 硬超时：handler 死循环也会被真正 kill，不是心跳无限续命
    return await Promise.race([
      handler(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Job ${jobId} timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  } finally {
    heartbeat.stop(); // 无论成功/失败/超时，心跳必须停
  }
}
```

### `worker/config/job-policy.ts`（v8 已有，补充 timeoutMs）

```ts
export const JOB_POLICY: Record<BackgroundJobType, { maxAttempts: number; timeoutMs: number }> = {
  IMAGE_GENERATE: { maxAttempts: 3, timeoutMs: 120_000 },
  DOCUMENT_INDEX: { maxAttempts: 5, timeoutMs: 600_000 },
  TEXT_SUMMARY: { maxAttempts: 5, timeoutMs: 60_000 },
};
```

### `worker/runtime/worker-loop.ts`（调用 runWithTimeout）

```ts
async function processNextJob(): Promise<boolean> {
  const job = await claimNextBackgroundJob(WORKER_ID);
  if (!job) return false;

  const policy = JOB_POLICY[job.type];
  try {
    await runWithTimeout(job.id, WORKER_ID, () => dispatch(job, WORKER_ID), policy.timeoutMs);
  } catch (err) {
    await handleJobFailure(job, err, policy.maxAttempts); // 按 maxAttempts 决定 retry / FAILED
  }
  return true;
}
```

---

## Stage 3：JobOutput 幂等 handler

### `worker/handlers/image.handler.ts`

```ts
export async function handleImageGenerate(job: BackgroundJob, workerId: string): Promise<void> {
  const { messageId, prompt, modelRef } = job.payload as ImagePayload;
  const startTime = Date.now();

  await prisma.aiChatMessage.update({
    where: { id: messageId },
    data: { executionStatus: "PROCESSING" },
  });
  emitJobEvent(job, "job.started");

  // ── 幂等检查：sequence=0 是否已完成 ─────────────────────────
  const existing = await prisma.jobOutput.findUnique({
    where: { jobId_sequence: { jobId: job.id, sequence: 0 } },
  });
  if (existing?.status === "COMPLETED") {
    await finalizeJob(job, messageId);
    return;
  }

  // ── 占位（crash 后重试能查到，不会重新生成）─────────────────
  const output = existing ?? await prisma.jobOutput.create({
    data: { jobId: job.id, sequence: 0, status: "GENERATING" },
  });

  const result = await generateImages({ prompt, modelRef });
  const asset = await createFileAsset(result.images[0]);

  await prisma.jobOutput.update({
    where: { id: output.id },
    data: { status: "COMPLETED", fileAssetId: asset.id },
  });

  await prisma.aiMessageAttachment.create({
    data: { messageId, fileAssetId: asset.id, jobOutputId: output.id, type: "IMAGE" },
  });

  await finalizeJob(job, messageId, { provider: "openrouter", model: modelRef, duration: Date.now() - startTime });
}

async function finalizeJob(job: BackgroundJob, messageId: string, result?: Record<string, unknown>) {
  await prisma.aiChatMessage.update({ where: { id: messageId }, data: { executionStatus: "COMPLETED" } });
  await updateJobStatus(job.id, "COMPLETED", { result });
  emitJobEvent(job, "job.completed");
}
```

多图场景（未来）：循环 `sequence: 0..N-1`，每个 sequence 独立幂等检查，任意一张失败不影响已完成的其他张。

### FileAsset storageKey / checksum 分离

```ts
// features/ai/lib/file-storage.ts
export async function createFileAsset(params: { bytes: Buffer; mimeType: string }): Promise<FileAsset> {
  const checksum = sha256(params.bytes); // 内容指纹，仅用于去重查询
  const storageType = env.NODE_ENV === "production" ? "OBJECT_STORAGE" : "DATABASE";

  if (storageType === "OBJECT_STORAGE") {
    const storageKey = `uploads/${dateSlug()}/${cuid()}.${extOf(params.mimeType)}`; // 存储位置，独立生成
    await uploadToObjectStorage(storageKey, params.bytes);
    return prisma.fileAsset.create({
      data: { storageType, storageKey, checksum, mimeType: params.mimeType, size: params.bytes.length },
    });
  }

  return prisma.fileAsset.create({
    data: {
      storageType,
      storageKey: `db:${checksum}`, // 开发环境仍用可读 key，但不复用 checksum 语义
      checksum,
      bytes: params.bytes,
      mimeType: params.mimeType,
      size: params.bytes.length,
    },
  });
}
```

---

## Stage 4：SSE 事件命名（message.delta）

`features/ai/lib/domain-events.ts`：

```ts
// v8 → v9：message.patch → message.delta（不承诺 RFC6902 语义，只是增量流）
export function emitJobEvent(job: BackgroundJob, event: "job.started" | "job.completed" | "job.failed") {
  const { messageId } = job.payload as { messageId?: string };
  if (!messageId) return;

  const deltaMap: Record<typeof event, Record<string, unknown>> = {
    "job.started": { executionStatus: "PROCESSING" },
    "job.completed": { executionStatus: "COMPLETED" },
    "job.failed": { executionStatus: "FAILED" },
  };

  emitSSE(messageId, {
    type: "message.delta",
    id: messageId,
    delta: deltaMap[event],
  });
}
```

未来 Agent 场景直接扩展 `delta` 内容，不改协议：

```json
{ "type": "message.delta", "id": "msg_x", "delta": { "progress": { "phase": "thinking", "tool": "search" } } }
```

前端仍然只监听 `message.delta`，不感知 job / JobOutput。

---

## Stage 5：API（不变）

```
POST /api/ai/generate/image
Body: { conversationId, prompt, modelName }
```

```ts
// 1. requireSession()
// 2. create message (executionStatus: QUEUED)
// 3. enqueueBackgroundJob({ type: IMAGE_GENERATE, priority: 50, correlationId: messageId, payload: { messageId, userId, prompt, modelRef } })
// 4. return { messageId }
```

---

## Stage 6：模型能力 + 前端 UI（不变，沿用 v7/v8）

- `inferCapabilities` append 不覆盖
- `model-selector.tsx` 按 capability 包含分组（非排他）
- `AiChatPanel.tsx` 监听 `message.delta`（重命名自 `message.updated`）
- `AiMessageBubble.tsx` 渲染 attachments

---

## 改动文件清单

| 文件 | 动作 |
|------|------|
| `prisma/schema.prisma` | 修改：`JobOutput` 新建 + `BackgroundJob` 加 traceId/parentJobId/leaseExpiresAt + `AiMessageAttachment.jobOutputId` + `FileAsset.checksum` 独立 |
| `worker/jobs/background-job.ts` | 修改：`claimNextBackgroundJob` 修复 lease recovery bug，加 `renewLease` |
| `worker/runtime/heartbeat.ts` | 新建：`startHeartbeat` + `runWithTimeout` |
| `worker/runtime/worker-loop.ts` | 修改：调用 `runWithTimeout` 替代直接 `dispatch` |
| `worker/config/job-policy.ts` | 修改：加 `timeoutMs` |
| `worker/handlers/image.handler.ts` | 修改：JobOutput 幂等占位模式 |
| `features/ai/lib/file-storage.ts` | 修改：`storageKey` 定位 / `checksum` 去重分离 |
| `features/ai/lib/domain-events.ts` | 修改：`message.patch` → `message.delta` |
| `app/api/ai/generate/image/route.ts` | 修改：enqueue 加 `correlationId: messageId` |
| `features/ai/ui/AiChatPanel.tsx` | 修改：监听事件改为 `message.delta` |

## 质量门

- [ ] `npx prisma migrate dev` 生成迁移文件
- [ ] `npm run build` 编译通过
- [ ] Lease recovery 测试：模拟 worker 在 PROCESSING 中途 kill，5 分钟后另一 worker 能捡回该 job
- [ ] Heartbeat 测试：handler 抛异常/超时后，`heartbeat.stop()` 被调用，不再续约
- [ ] 幂等测试：`JobOutput` 占位后 crash，重试不重新生成图片，直接复用已有 `fileAssetId`
- [ ] FileAsset 去重测试：相同 checksum 不同 storageKey 可共存，删除逻辑不会误删共享内容
- [ ] SSE 事件类型全部为 `message.delta`，无 `job.*` 或 `message.patch` 残留
