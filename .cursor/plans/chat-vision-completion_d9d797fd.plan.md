---
name: chat-vision-completion
overview: "Chat / Image / Video 三模统一多模态输入：用户上传图片 → AiFileAsset(ownerId) → AiMessageAttachment(INPUT) → resolveProviderImageSource → HumanMessage([text, image_url]) → Agnes。同时为 AiFileAsset 补全 ownerId ownership 基础安全修复。"
todos:
  - id: step0-schema-ownerid
    content: "Step 0: AiFileAsset 加 ownerId（nullable migration），统一三模引用校验"
    status: pending
  - id: step1-upload-helper
    content: "Step 1: 抽取 uploadImageToFileAsset helper，替换 handleImageUpload 走 /api/ai/file-assets JSON 通道（ownerId = session.user.id）"
    status: pending
  - id: step2-attachments-write
    content: "Step 2: messages API 入参加 inputImageIds，写入 AiMessageAttachment(direction=INPUT)（事务包裹，ownerId 归属校验）"
    status: pending
  - id: step3-messages-builder-multimodal
    content: "Step 3: messages-builder 支持纯数据的多模态 content（不查 DB），multimodal-builder 负责纯数据转换"
    status: pending
  - id: step4-route-ts-multimodal
    content: "Step 4: route.ts 按严格时序：校验→建消息→建附件→resolve→buildMessages（generate-response 只追加 text context，不重建图片）"
    status: pending
  - id: step5-history-multimodal
    content: "Step 5: 历史多轮 user message 同样按 batch attachments 重建成多模态 HumanMessage"
    status: pending
  - id: step6-image-video-refactor
    content: "Step 6: Image / Video 模式统一走 uploadImageToFileAsset（去重）"
    status: pending
  - id: step7-quality-gate
    content: "Step 7: 类型检查 / lint / 手工 smoke 三模均能识图"
    status: pending
isProject: false
---

# Plan: Chat 模式识图补全（三模统一多模态）

## 工单

- `#10208`

## Root Cause

Chat 消息链 `AiChatInput.handleImageUpload → /api/upload → knowledge` 走知识库上传通道，图片只在前端气泡渲染，**没有写 `AiMessageAttachment(direction=INPUT)`**，也没有 data URL / 多模态字段注入到 LangGraph `state.messages`。`buildMessages` 只把字符串 `content` 丢给 `HumanMessage` → chat 模型看不见图。

## 目标

> 三模统一走同一条多模态数据通路：Chat / Image / Video 共用 AiFileAsset (BASE64) → AiMessageAttachment(INPUT) → route.ts resolve → messages-builder → state.messages → generate-response（只追加 text context）→ Agnes

## 核心架构原则

1. **route.ts 做完所有 DB 查询 + resolve，state.messages 进入 LangGraph 时已是最终多模态消息**
2. **messages-builder 保持 pure function**（无 DB / 无 async）
3. **generate-response 只追加 search context 到最后一个 HumanMessage 的 text part，不重建、不丢失 image_url**
4. **history 多轮图片必须进 context**（第 2 轮对话模型仍能看到第 1 轮的图）
5. **1500 token 估算限制删除**：复用现有 10MB 硬限制 + 5MB 软限制

---

## 重要：先读现有代码再做

实现前必须确认：

- `prisma/schema.prisma` 中 `AiFileAsset` 是否有 `ownerId` 字段（Step 0 新增）
- `AiMessageAttachment` 模型结构（`messageId`, `fileAssetId`, `type`, `direction`）
- `app/api/ai/conversations/[id]/messages/route.ts` 中 `appendMessage` 的事务边界
- `features/ai/lib/file-source.ts` 的 `resolveProviderImageSource` 是否支持 BASE64 storageType

---

## 实现步骤

### Step 0. AiFileAsset 加 ownerId（ownership 基础安全修复）

**⚠️ 这不是"Chat 识图功能的一部分"，而是顺手补全 AiFileAsset 数据模型缺失的 ownership 维度，适用于 Chat / Image / Video 三模统一引用校验。**

**0.1** Prisma schema：

```prisma
model AiFileAsset {
  id          String            @id @default(cuid())
  ownerId    String?           // nullable：历史记录可为空，新记录写入时强制赋值
  storageType AiFileStorageType @default(DATABASE)
  storageKey  String?
  checksum    String?
  size        Int?
  mimeType    String?
  bytes       Bytes?
  createdAt   DateTime          @default(now())

  attachments AiMessageAttachment[]
  outputs     JobOutput[]

  @@index([storageKey])
  @@index([checksum])
  @@map("AiFileAsset")
  @@schema("pm")
}
```

**0.2** Migration + 历史数据审计：

```sql
-- nullable 列迁移（历史数据可为空）
ALTER TABLE "pm"."AiFileAsset" ADD COLUMN "ownerId" TEXT;
```

> **历史数据回填评估（执行 migration 前必须做）**：运行以下查询评估现有 AiFileAsset 是否有可关联的 userId：
> ```sql
> SELECT af.id, af."storageType", af.createdAt, ac."userId"
> FROM "pm"."AiFileAsset" af
> LEFT JOIN "pm"."AiMessageAttachment" ama ON ama."fileAssetId" = af.id
> LEFT JOIN "pm"."AiChatMessage" acm ON acm.id = ama."messageId"
> LEFT JOIN "pm"."AiConversation" ac ON ac.id = acm."conversationId"
> WHERE af."ownerId" IS NULL
> LIMIT 10;
> ```
> - 若所有历史 INPUT 附件都能通过 `AiMessageAttachment → AiChatMessage → AiConversation` 反查到 userId，执行回填：
>   ```sql
>   UPDATE "pm"."AiFileAsset" SET "ownerId" = (
>     SELECT ac."userId" FROM "pm"."AiMessageAttachment" ama
>     JOIN "pm"."AiChatMessage" acm ON acm.id = ama."messageId"
>     JOIN "pm"."AiConversation" ac ON ac.id = acm."conversationId"
>     WHERE ama."fileAssetId" = "pm"."AiFileAsset".id
>     AND ama.direction = 'INPUT'
>     LIMIT 1
>   ) WHERE "ownerId" IS NULL;
>   ```
> - 若存在无法回填的记录（OUTPUT 资产、无关联的残留记录），保留 `ownerId = NULL`，后续由各创建方补写。

**0.3** `app/api/ai/file-assets/route.ts` 写入时强制带 `ownerId`：

```ts
// POST 时，session.user.id 必填
const fileAsset = await prisma.aiFileAsset.create({
  data: {
    storageType: "BASE64",
    storageKey: dataUri,
    mimeType: file.type,
    size: compressed.size,
    ownerId: session.user.id,  // 新增强制写入
  },
});
```

**0.4** 统一归属校验函数（后续 Step 2 用）：

```ts
// 任何引用 AiFileAsset 的 API 统一用此校验
async function validateFileAssetOwnership(
  inputIds: string[],
  userId: string
): Promise<{ valid: boolean; missingIds: string[] }> {
  const assets = await prisma.aiFileAsset.findMany({
    where: { id: { in: inputIds }, ownerId: userId },
    select: { id: true },
  });
  const validIds = new Set(assets.map((a) => a.id));
  const missingIds = inputIds.filter((id) => !validIds.has(id));
  return { valid: missingIds.length === 0, missingIds };
}
```

> **语义**：`ownerId` = 资产归属用户，适用于 INPUT（用户上传）和 OUTPUT（AI 生成）两种资产。避免未来出现 `uploadedById` / `createdById` 等同名异义字段。

### Step 0.5. 架构验证（执行实现前必须做）

**实现前必须确认的两个关键点：**

**A. `resolveProviderImageSource()` 对 BASE64 类型不产生额外 N 次 I/O**

确认 `resolveProviderImageSource(fileAssetId)` 对 `storageType=BASE64` 的 AiFileAsset：
- 直接从 DB 读 `storageKey`（data URI），不查对象存储
- 不生成临时签名 URL
- 不做额外网络请求

若会引发 N 次外部 I/O，改为直接 Prisma batch 查询 `storageKey`，实现 `Map<fileAssetId, dataUri>`，resolve 变 O(1) 内存查表。

**B. `generateText()` 接收的 `messages` 中 image_url 仍为结构化 content part**

验证 `generateText({ messages })` 的类型签名：
- 确认它接受 `HumanMessage` 实例（LangChain Core 接受 `{ type, image_url }` 等结构）
- 确认传入的 `messages` 数组中，image_url part 不是 stringified JSON
- 可通过在 `enrichLastHumanMessage` 后加一次类型断言验证

> 若 LangChain 不直接接受 `HumanMessage` 构造的 `{ type: "image_url", image_url: { url } }` 结构，需在 `generateText` 之前用 `toLangChainMessages()` 转换一次。

### Step 1. Chat 图片上传改走 `/api/ai/file-assets`（复用 I2I/I2V 基础设施）

**1.1** 新增 `features/ai/lib/upload-to-file-asset.ts`

```ts
/**
 * 三模（Chat / Image / Video）共用：将 File 对象上传到 AiFileAsset 表。
 * - compressImage() 压缩（JPEG, max 1024px, 5MB 软限制）
 * - POST /api/ai/file-assets JSON { storageType:"BASE64", storageKey:dataUri }
 */
export async function uploadImageToFileAsset(file: File): Promise<{
  id: string;
  url: string;  // data URI，用于前端预览
  name: string;
}> {
  // 复用 compressImage()
  // POST /api/ai/file-assets
  // 返回 { id, url: dataUri, name }
}
```

**1.2** 重写 `features/ai/ui/AiChatInput.tsx` 的 `handleImageUpload`（line 184）

- 删除 `uploadImage` import，改用 `uploadImageToFileAsset`
- 首版最多 2 张图（与 API 限制一致）
- 保留 `image/*` mime 校验、压缩错误 toast

### Step 2. messages API 入参加 `inputImageIds`，事务写入 `AiMessageAttachment`

**⚠️ 时序要求（必须按此顺序执行）：**

```
1. 校验 inputImageIds（数量、格式）
2. prisma.$transaction([
     prisma.aiChatMessage.create({...}),
     ...inputImageIds.map(id => prisma.aiMessageAttachment.create(...))
   ])
3. resolveCurrentInputImages(messageId)  ← 用 transaction 返回的 message.id
4. buildMessages()
5. LangGraph state
```

**禁止**先 resolve 再写 attachment（会出现"消息已创建但 attachments 列表为空"的 race）。

**2.1** 扩展 `app/api/ai/conversations/[id]/messages/route.ts` 的 `messageSchema`：

```ts
inputImageIds: z.array(z.string()).max(2).optional()
```

**2.2** `inputImageIds` 归属校验（在 transaction 外执行）：

```ts
// ⚠️ 必须在 transaction 前执行，防止白白创建消息后校验失败
const { valid, missingIds } = await validateFileAssetOwnership(
  inputImageIds ?? [],
  session.user.id
);
if (!valid) {
  return NextResponse.json(
    { error: "Invalid or unauthorized image ids", detail: missingIds },
    { status: 400 }
  );
}
```

**2.3** 事务写入 message + attachments（先建 message，再建 attachments）：

```ts
// 必须分开两个操作在同一 transaction 内执行，确保原子性
const msg = await prisma.$transaction(async (tx) => {
  const created = await tx.aiChatMessage.create({ data: { ... } });
  if (inputImageIds?.length) {
    await tx.aiMessageAttachment.createMany({
      data: inputImageIds.map((fileAssetId) => ({
        messageId: created.id,
        fileAssetId,
        type: "IMAGE",
        direction: "INPUT",
      })),
    });
  }
  return created;
});
// msg.id 在 resolveCurrentInputImages 中使用
```

### Step 3. `messages-builder` 支持纯数据多模态 content

**3.1** 新增 `features/ai/core/context/multimodal-builder.ts`

```ts
// 纯函数，不查 DB，只做数据转换
export function buildMultimodalContent(
  text: string,
  imageUrls?: string[]
): HumanMessage["content"] {
  if (!imageUrls?.length) return text;
  return [
    { type: "text" as const, text },
    ...imageUrls.map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];
}
```

**3.2** `messages-builder.ts` 新增重载：

```ts
export function buildMessages(opts: {
  history: Array<{ id: string; role: string; content: string }>;
  currentInput: { text: string; imageUrls?: string[] };
  historyImageUrls?: Map<string, string[]>; // messageId → imageUrls
  pendingLastAssistantMessage?: string;
  historyTokenLimit?: number;
  systemAndRagTokenLimit?: number;
}): BaseMessage[] {
  // 历史消息：查 Map 有图则重建多模态 HumanMessage
  for (const msg of history) {
    if (msg.role === "user") {
      const urls = historyImageUrls?.get(msg.id);
      result.push(new HumanMessage(buildMultimodalContent(msg.content, urls)));
    } else {
      result.push(new AIMessage(msg.content));
    }
  }
  // 当前消息
  result.push(new HumanMessage(buildMultimodalContent(currentInput.text, currentInput.imageUrls)));
  return result;
}
```

### Step 4. route.ts 按严格时序执行，generate-response 只追加 text context

**4.1** 新增 `features/ai/core/context/resolve-current-input-images.ts`

```ts
export async function resolveCurrentInputImages(
  messageId: string,
  text: string
): Promise<{ text: string; imageUrls: string[] }> {
  const attachments = await prisma.aiMessageAttachment.findMany({
    where: { messageId, direction: "INPUT", type: "IMAGE" },
  });
  const sources = await Promise.all(
    attachments.map((a) => resolveProviderImageSource(a.fileAssetId))
  );
  return { text, imageUrls: sources.map((s) => s.url) };
}
```

**4.2** 新增 `features/ai/core/context/resolve-history-input-images.ts`

```ts
export async function resolveHistoryInputImages(
  history: Array<{ id: string; role: string }>
): Promise<Map<string, string[]>> {
  const userIds = history.filter((m) => m.role === "user").map((m) => m.id);
  if (!userIds.length) return new Map();

  const attachments = await prisma.aiMessageAttachment.findMany({
    where: { messageId: { in: userIds }, direction: "INPUT", type: "IMAGE" },
  });
  const sources = await Promise.all(
    attachments.map((a) => resolveProviderImageSource(a.fileAssetId))
  );
  const map = new Map<string, string[]>();
  for (let i = 0; i < attachments.length; i++) {
    const mid = attachments[i].messageId;
    if (!map.has(mid)) map.set(mid, []);
    map.get(mid)!.push(sources[i].url);
  }
  return map;
}
```

**4.3** `handleLangGraphRequest` 中调用（严格时序）：

```ts
// Step A: 归属校验（在 transaction 前）
// Step B: transaction 创建 message + attachments（见 Step 2.3）
// Step C: resolve 图片（在 transaction 完成后，用返回的 message.id）
const [historyImageUrls, resolvedCurrent] = await Promise.all([
  resolveHistoryInputImages(conversationHistory ?? []),
  resolveCurrentInputImages(msg.id, message),
]);

// Step D: buildMessages
const langgraphMessages = buildMessages({
  history: conversationHistory ?? [],
  currentInput: { text: message, imageUrls: resolvedCurrent.imageUrls },
  historyImageUrls,
  pendingLastAssistantMessage: pendingState?.lastAssistantMessage,
});

// Step E: LangGraph state
// ...
```

**4.4** `generate-response.ts` 只对最后一个 HumanMessage 的 content 做非破坏性 text append

**⚠️ 三个核心纪律：**

1. **禁止 JSON.stringify**：多模态 array 必须原样透传给 `generateText`，image_url 不能变成字符串。
2. **禁止重建 HumanMessage**：不能 `new HumanMessage(enriched)` 重新构造——只能 clone 后修改 text part。
3. **禁止重新 push 当前消息**：state.messages 已经包含当前 HumanMessage，generate-response 修改最后一条即可。

**关键原则**：`generate-response` 不负责理解图片，只负责保持已有 content parts 并修改 text part。

```ts
import type { BaseMessage } from "@langchain/core/messages";

// HumanMessage content 的两种形态
type HumanContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

// 对最后一个 HumanMessage 的 content 做非破坏性 text append，返回新数组
function enrichLastHumanMessage(
  messages: BaseMessage[],
  contextToAppend: string
): BaseMessage[] {
  // 从后往前找第一个 HumanMessage
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] instanceof HumanMessage) {
      lastHumanIdx = i;
      break;
    }
  }
  if (lastHumanIdx === -1) {
    throw new Error("No HumanMessage found in conversation history");
  }

  // 只 clone 到 lastHumanIdx 为止，之后的引用不变
  const before = messages.slice(0, lastHumanIdx);
  const target = messages[lastHumanIdx] as HumanMessage;
  const content = target.content as HumanContent;

  let enriched: HumanContent;
  if (typeof content === "string") {
    // 纯文本：直接追加
    enriched = content + "\n\n" + contextToAppend;
  } else {
    // multimodal array：找到 text part，增强它，image_url 原样保留（不对 part 做 new 操作）
    enriched = content.map((part) => {
      if (part.type === "text") {
        return { type: "text", text: part.text + "\n\n" + contextToAppend };
      }
      // image_url：原样透传，不做任何转换
      return part;
    });
  }

  // 浅 clone：只有 lastHumanIdx 位置的元素被替换
  return [...before, { ...target, content: enriched } as BaseMessage, ...messages.slice(lastHumanIdx + 1)];
}
```

**generate-response 入口**：

```ts
export async function generateResponse(params: {
  state: { messages: BaseMessage[] };
  searchResults?: string[];
  toolResults?: Record<string, unknown>;
}) {
  const { state, searchResults, toolResults } = params;

  const contextParts: string[] = [];
  if (searchResults?.length) {
    contextParts.push("=== 检索结果 ===\n" + searchResults.join("\n\n"));
  }
  if (toolResults) {
    const toolLines = Object.entries(toolResults).map(
      ([name, result]) =>
        `[${name}]\n${typeof result === "string" ? result : JSON.stringify(result)}`
    );
    contextParts.push("=== 工具结果 ===\n" + toolLines.join("\n\n"));
  }

  let finalMessages = state.messages;
  if (contextParts.length > 0) {
    finalMessages = enrichLastHumanMessage(state.messages, contextParts.join("\n\n"));
  }

  // finalMessages 最后一项的 content 已是增强后的结构（含 image_url）
  await generateText({ messages: finalMessages });
}
```

> **generate-response 的职责边界**：只对最后一个 HumanMessage 的 content 做非破坏性 text append；不序列化多模态 content；不重新构造 HumanMessage；不追加新消息。

### Step 5. history 多轮图片进 context（第 2 轮仍能看见第 1 轮的图）

已在 Step 3-4 的 `resolveHistoryInputImages` + `historyImageUrls` 一次性 batch 查询中实现：

```text
第 1 轮：HumanMessage([text:"这是什么？", image_url: cat.jpg])
第 2 轮：HumanMessage("它是什么品种？")
  ↓
LangGraph state.messages = [猫图消息, AI回复, "它是什么品种？"]
  ↓
generateText → 模型看到完整上下文
```

### Step 6. Image / Video 模式统一走 `uploadImageToFileAsset`

- `app/api/ai/generate/image/route.ts`：已有 `INPUT` attachments 链路，不改动
- `worker/background/handlers/video.handler.ts`：`inputFileIds` 走 `resolveProviderImageSource`，已 OK
- `AiChatInput`：三模共用 `uploadImageToFileAsset` helper

### Step 7. 异常路径（P1）

- **上传失败** → toast + 不发消息
- **多图上限**：UI + API 统一最多 **2 张**
- **归属校验失败** → 400 错误，不创建消息
- **size 限制**：复用 10MB 硬限制 + 5MB 软限制

## 不在范围内（out of scope）

- PDF / audio / video attachment
- 非 Agnes 模型 capability detection
- 自动 caption / OCR
- 精确视觉 token 预算
- **RAG / SearchDocument / embedding**：该链路服务知识库检索，与 Chat 多模态输入是正交需求，本次不涉及

## 验证清单

1. **类型检查**：`npm run build` 通过
2. **lint**：`npm run lint` 通过
3. **手工 smoke**：
   - Chat 单图：发送 "这张图描绘了什么"，模型回答与图相关
   - Chat 多图：上传 2 张图，问 "两张图有什么区别"
   - 历史回看：发消息后刷新，再发第 2 轮引用第 1 轮图片
4. **回归**：生图 I2I 模式 + 视频 I2V 链路仍正常

## 文件清单

新增：
- `prisma/migrations/xxxx_add_ai_file_asset_owner/migration.sql`（ownerId nullable 列）
- `features/ai/lib/upload-to-file-asset.ts`
- `features/ai/core/context/multimodal-builder.ts`
- `features/ai/core/context/resolve-current-input-images.ts`
- `features/ai/core/context/resolve-history-input-images.ts`
- `features/ai/lib/validate-file-asset-ownership.ts`（统一归属校验）

修改：
- `prisma/schema.prisma`（AiFileAsset 加 ownerId）
- `app/api/ai/file-assets/route.ts`（POST 时强制写 ownerId）
- `features/ai/ui/AiChatInput.tsx`（改走 `/api/ai/file-assets`，2 图上限）
- `app/api/ai/conversations/[id]/messages/route.ts`（`inputImageIds` schema + 事务写入 + resolve + buildMessages）
- `features/ai/core/context/messages-builder.ts`（多模态支持，纯函数）
- `app/api/ai/conversations/route.ts`（首条消息支持 `inputImageIds`）

不修改：
- `generate-response.ts`（只追加 text context，不重建图片）
- `agent.ts`

## commit 策略（用户暂未要求提交）

- `#10208` feat(ai-chat): 三模统一多模态输入（Chat 识图 + AiFileAsset.ownerId 基础安全修复）
- body 末尾 Co-authored-by: Cursor <cursoragent@cursor.com>
- 默认推 origin，不推 github
