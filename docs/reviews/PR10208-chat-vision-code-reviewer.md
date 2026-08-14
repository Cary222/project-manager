<!-- reviewer: code-reviewer (硬层) -->
# PR10208 Chat 模式识图 — 硬层技术审查

## 审查结论
**CHANGES_REQUIRED** — 3 个 Critical 阻塞主流程；其余 Warning 在合入前应一并修复

### tsc 检查

`npx tsc --noEmit` 在 PR 触及路径上 0 错误。出现的 TS 错误均为历史遗留：
- `e2e/module-edit.spec.ts:264/294` — Playwright `test()` 参数用法（与 PR 无关）
- `features/admin/admin.test.ts` — `@/lib/db` 路径不存在（迁移前历史）
- `features/ai/core/context/__tests__/prisma-check.test.ts` — `../shared/db/client` 路径不存在（历史）

均不属于本次 PR 范围。

测试：`npx vitest run features/ai/core/context/__tests__/multimodal-builder.test.ts` → **9 个测试全部通过**。

---

## Critical（必须修复才能合并）

### 1. 首次发消息+图片静默丢图 — `app/api/ai/conversations/route.ts:9-12, 40`
`createSchema` 只声明 `title` 和 `firstMessage`，**没有 `inputImageIds`**。但 `features/ai/ui/AiChatPanel.tsx:1030-1042` 在 `conversationId` 为空时 POST 到 `/api/ai/conversations` 并把 `inputImageIds` 塞进 body。

```
user opens chat → uploads 3 images → types "what is this?" → click send
→ POST /api/ai/conversations { firstMessage, inputImageIds }
→ zod.parse strips inputImageIds (not in schema)
→ conversation created WITHOUT images
→ next request is "/api/ai/conversations/{id}/messages" but...
```

- **Impact**: 这个分支实际可能不被命中（`AiChatPage.tsx` 的 "new chat" 按钮先建空对话），但只要用户**在未建对话前**直接发图片消息，图片就丢了。属于真实用户路径。
- **Suggestion**: `createSchema` 加 `inputImageIds: z.array(z.string()).optional()`；或在 `app/api/ai/conversations/[id]/messages/route.ts` 的逻辑分支判断 `!conversationId` 时直接拒绝无 conversation 的图片消息（强约束路径）。

### 2. Legacy 路径（非 LangGraph）发消息不挂 INPUT 附件 — `app/api/ai/conversations/[id]/messages/route.ts:338-345`
这条路径在 `process.env.USE_LANGGRAPH !== "true"` 时生效。逻辑是：

```js
const [userProfile, appendUserMsg] = await Promise.all([
  getOrCreateProfile(session.user.id),
  appendMessage(conversationId, "user", message),  // ← 只 appendMessage，没传 attachments
]);
```

`inputImageIds` 没有进入这里。`appendMessage` 接口本身也不支持 attachments。

- **Impact**: 如果有人 `unset USE_LANGGRAPH` 或者新环境忘了设，Chat 模式识图**整体静默失效**（消息写了、附件没挂、LLM 看到的是纯文本）。一旦遗忘配置就难定位。
- **Suggestion**: legacy 路径也要执行 `validateInputImageOwnership` + `prisma.$transaction` 写 attachments。即使现在 USE_LANGGRAPH=true 是默认，把 legacy 路径做完整是 cheap defense。

### 3. `resolveCurrentInputImages` N+1 串行查询 — `features/ai/core/context/resolve-current-input-images.ts:24-33`
```js
for (const img of images) {
  const source = await resolveProviderImageSource(img.id);  // N 次 findUnique
  urls.push(source.url);
}
```
- **Impact**: 串行 await。用户传 5 张图 = 5 次顺序 `findUnique`。`resolveHistoryInputImages` 用 `Promise.all` 解决了同一问题，但当前轮次助手的实现明显退化。
- **Suggestion**: 改用 `Promise.all(uniqueFileAssetIds.map(id => resolveProviderImageSource(id)))` + 按原顺序聚合。`resolveProviderImageSource` 内部是 I/O 调用（必走 DB），并行至少把 5×latency 压到 1×latency。

---

## Warnings（应当修复）

### 4. historyImageUrls 用 base64 填充累积，token 预算不感知 — `features/ai/core/context/messages-builder.ts:91-95` + `history-window.ts:35-66`
`truncateHistoryByToken` 仅用 `countMessageTokens`（gpt-tokenizer 文本）算 cost。**图片 token 完全不入账**。每张图 DB 落 500KB-1MB bytes，重新读出 → data URI 注入 history → LLM 实际收到的 payload 是 500KB×N（base64 也不是图片，看成 token 的话 OpenAI 计 ~700 token/张）。

- **Impact**: 5 轮对话 + 5 张图 = 额外 3.5K 图片 token + 2.5MB 数据穿透。LLM 上下文吃紧、延迟飙升、可能直接 400。
- **Suggestion**: 在 `truncateHistoryByToken` 窗口里加 picture-cost 估算（每张图固定 ~700 token），超过预算时**优先淘汰带图的旧轮次**（保留文本）。或者历史图片只保留最近 1-2 张。

### 5. validateInputImageOwnership + resolveProviderImageSource 重复查 DB（同 row 2 次）
- `validateInputImageOwnership` select: `id/storageType/mimeType/ownerId` (1 次 findMany)
- `resolveProviderImageSource` inside loop: `findUnique` 每张图 1 次
- OwnerId 校验完成后，**没把查到的 storageType/mimeType/bytes 复用**，又查一次。
- **Suggestion**: 把 `validateInputImageOwnership` 改成只 select `id + ownerId`，剩下的让 `resolveCurrentInputImages` 从 ID 一次性或并行解析。或者新增 `resolveImagesByIds(ids, userId)` 把 ownerId + 解析合并。

### 6. `as any` + `as unknown as BaseMessage` 类型绕过 — `features/ai/core/context/messages-builder.ts:117`
```js
result.push(new AIMessage({ content: msg.content, response_metadata: hydrated ?? undefined } as any) as unknown as BaseMessage);
```
- **Impact**: 绕过 LangChain 1.x 类型。注释只说 "Metadata goes into response_metadata, NOT additional_kwargs"，没解释为什么需要 `as any`。
- **Suggestion**: 补一行注释解释 LangChain AIMessage 构造器不直接暴露 `response_metadata`，必须断言。或者改成先建实例再 `instance.additional_kwargs = {}` / `instance.response_metadata = hydrated`。

### 7. 文档/实现不一致 — `features/ai/core/context/resolve-current-input-images.ts:11-13`
```js
* 错误策略：
* - 任一图片解析失败 → 抛错（route.ts 上层捕获，返回 502）
* - 不静默跳过失败图片，避免 LLM 收到"只有 text 没有图"的退化版本
```
但 `route.ts:646-650` 实际是 `catch` 后记 `currentImageResolveError` 并**降级为纯文本**（line 687-692 警告日志）。两个行为相反。

- **Impact**: 文档误导；`failures` 路径走不到是因为上方根本没把 fail 抛上来。
- **Suggestion**: 二选一：
  - (a) 改 route 不降级 → 真的"502"；或
  - (b) 改 resolve 函数注释 + 提取 `failures` 字段，让 route 拿 `failures.length` 决定是否降级。

### 8. 乐观 UI 不显示用户图片 — `features/ai/ui/AiChatPanel.tsx:975-978`
```js
setMessages((prev) => [
  ...prev,
  { id: tempUserId, role: "user", content: message },
]);
```
Chat 模式发消息时，乐观插入的 user message 不带 `userImages`。Image/Video 模式（line 809-814）**带** `userImages`。两者不一致。

- **Impact**: Chat 模式用户上传图片后，发送后图片从输入框消失，气泡只显示文字（要刷新页面才从 attachments 重建）。**视觉跳变，对用户来说"图去哪了"**。
- **Suggestion**: 跟 Image 模式一样在 Chat 模式下也 set `userImages: chatInputFileIds.map(...)`。

### 9. `inputImageIds` 数量无上限
- `messageSchema` 只 `z.array(z.string()).optional()`，没说 max。
- 前端 `imageInputRef` 是 `multiple` 一次可选多张。
- 50 张图 = 50 次 findUnique + 50 个并发 data URI 拼装（base64 放大 ~33%）。
- **Suggestion**: `z.array(z.string()).max(10)`；前端 `multiple` 也加 limit。

### 10. `resolveHistoryInputImages` 单条失败仅静默丢掉——日志一句 "failures" 计数
`features/ai/core/context/resolve-history-input-images.ts:50-62`：单个图片解析失败 push 到 `failures`，但 LLM 实际收到的历史 message 是**没图片的退化版本**。日志只输出计数 `history image resolution failures: N`，没看是哪条对话/哪个 fileAssetId。

- **Impact**: 历史图片 resolve 失败率高（DB migration 之后存量 asset ownerId=NULL）时，Chat 模式"看起来能跑"但 LLM 看不到图，问题不可见。
- **Suggestion**: 失败时输出 `failed messageId=xxx assetId=yyy reason=zzz` 至少 3 条样本，方便排查。

### 11. 第二次 `messages` 构造后没有 hash 去重 patch
- `messages-builder.ts:104-119` 走 `seen` set 看 history 内重发 message；`currentInput` 永远是新追加。
- **Impact**: 如果客户端重发相同 message（罕见但 streamed 网络场景），不会重复。当前实现 OK，但 `historyImageUrls` map 里如果同一个 messageId 出现多次，最后的 `arr.push(url)` 后 image 数组会重复。
- **Suggestion**: 聚合时 `attachSeen.has(messageId+fileAssetId)` 去重，或在 `getConversation` 服务端组装时已经按 ID 聚。

---

## Suggestions（建议改进）

### 12. 孤儿 AiFileAsset 清理
- 用户上传图片后没发送（关 tab / 切对话），rows 还在 DB。
- 每条 BASE64 行 500KB-1MB bytes，长时间累积。
- **Suggestion**: 后台 job：扫描 ownerId 设了但 `attachments` 数组为空的 AiFileAsset，超过 24h 删除。

### 13. AiFileAsset ownerId 旧行未回填
- `prisma/schema.prisma:1014` `ownerId String?` 注释说"历史数据允许为 NULL"。
- 但 schema migration 没附 `UPDATE pm."AiFileAsset" SET "ownerId" = ... WHERE ...` 脚本。
- **Impact**: 现有 BASE64 行（来自 Image/Video 模式）`ownerId=NULL`，新代码 `validateInputImageOwnership` 会**拒绝**这些历史 asset（`owned.length !== inputImageIds.length` → 403）。
- **Suggestion**: 在 PR 提交前补一笔 SQL patch（按 `createdAt` 早于今天 + `storageType='BASE64'` + `ownerId IS NULL` 的所有行，尝试从 `attachments.0.message.userId` 反推 ownerId）。如果无法反推，**保留 NULL 但允许 ownerId=NULL 的 asset 进入 Chat**（policy 变更需要明示）。

### 14. 集成测试覆盖空缺
- 9 个测试全在纯函数（`multimodal-builder.ts` + `messages-builder.ts`）。
- **没有**测试：
  - `validateInputImageOwnership` 跨用户拒绝
  - `prisma.$transaction` 在 attach create 失败时回滚
  - `resolveCurrentInputImages` 单点失败行为
  - `app/api/ai/file-assets` BASE64/REMOTE_URL/DATABASE 三种 storageType 写入 ownerId
- **Suggestion**: 至少补 3 个集成测试（vitest + pg-test 或 prisma test client）：
  - "user A 上传，user B 引用 → 403"
  - "attachments 写挂失败 → message 也不写入"
  - "BASE64 mode 写到 bytes 字段，size/mimeType 正确"

### 15. `image.handler.ts` 没改 `direction` 字段 — `worker/background/handlers/image.handler.ts:167-174`
```js
await prisma.aiMessageAttachment.create({
  data: {
    messageId,
    fileAssetId: asset.id,
    jobOutputId: output.id,
    type: "IMAGE",
    // ← 没有 direction 字段
  },
});
```
schema 默认 `direction = OUTPUT`，所以这里实际是 OUTPUT（正确）。但显式写 `direction: "OUTPUT"` 会让审计更清楚。

- **Suggestion**: 加 `direction: "OUTPUT"` 明确意图。`video.handler.ts:181-188` 同理。

### 16. `video-providers/storage.ts` 接收 `ownerId` 但调用方硬传 `userId` — `worker/background/handlers/video.handler.ts:169-174`
- `saveVideoAsset({ ownerId: userId, ... })` — ownerId 暂时只是 userId，没有更细的权限概念。
- 顶层设计没问题，但调用点应文档化"handler = user = owner" 的等式。
- **Suggestion**: 注释掉 `ownerId` 字段语义：当前等价于 userId；未来切租户/共享时会换。

---

## 正面反馈

- ✅ **OwnerId 校验** 写得正确：先 `findMany` + 服务端 filter，再返回错误信息含 `missingIds`（不暴露其他用户的 assetId 信息）。`UNAUTHORIZED_INPUT_IMAGE` 这种 error code prefix 也是好实践。
- ✅ **事务原子性**（Critical 2 警告的不算）：`prisma.$transaction(async (tx) => { msg.create; attach.createMany; conv.update })` 全部走 tx 客户端，事务回滚时三层数据一致。
- ✅ **历史图片 batch resolve**（`resolveHistoryInputImages`）：单条 `findMany` + `Promise.all` + 内存聚合，避开了 N+1 模式。Good。
- ✅ **Provider cache 友好**：失败 fallback to 纯文本（虽然文档不一致），`failures` 数组仍返回供上游感知。
- ✅ **Schema 兼容性**：`ownerId String?` 允许历史 NULL 行不破坏现有数据；`@@index([ownerId])` 让查询计划走 B-tree。
- ✅ **POST /api/ai/file-assets 不写 storageKey**（line 26-27 注释解释 B-tree 8191 字节限制）—— 是个不显眼但重要的工程权衡。
- ✅ **`forceSearch` 传给 LangGraph 路径**：`messageSchema` 严格类型 + `process.env.USE_LANGGRAPH` 开关控制两路径都识别同一 payload。
- ✅ **9 个 vitest 测试覆盖纯函数** 关键边界：no-image fallback、multimodal history、id-dedupe、不存在的 historyImageUrls entry。

---

## 跨审查转交

- **soft-mentor**: ① 第 4 项（图片 token 预算）属于"成本边界"决策——图片是否值得保留 1 轮 vs 多轮？是否要降级？软层 mentor 怎么取舍。② 第 13 项（历史 ownerId=NULL 政策）也是软层决策：拒绝 vs 允许 vs 异步回填。转交 `ai-learning-mentor`。

## 必带的烟火师（不阻塞修复）

- `validateInputImageOwnership` 在 `currentImageResolveError` 路径下被吞，没有返回 4xx。前端拿到的是 200 + 静默丢图。建议加 `console.warn('[route] inputImageIds 校验失败但已降级', { userId, missingIds })` 输出在 SSE 开始前，方便日志定位。
- `app/api/ai/file-assets/route.ts:125-131` REMOTE_URL 模式的"白名单"逻辑：非 `agnes-ai.com` 域名仅 `console.warn`，**真正接受了任意 https URL**。如果未来想严格，逻辑要改成 `if (!isAllowed) return 400`。

---

## 必须保留的跨层不变量

- `validateInputImageOwnership` 必须**只在 GET 路径的单一入口**（messages route），不要让 `appendMessage` 之类的 helper 内部隐式跳检。
- `prisma.$transaction` 写 user message + attachments + conversation.update 是 **不可拆** 的；后续扩展（保存 search context、citation 等）必须加入同一 tx。
- `resolveProviderImageSource` 仍是**唯一**外部 Provider 资源入口；后续多种 storageType 接入都走这里。
