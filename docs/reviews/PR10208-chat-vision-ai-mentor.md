<!-- reviewer: ai-learning-mentor (软层) -->
# PR10208 Chat 模式识图 — 软层架构审查

> 审查日期：2026-08-14
> 审查范围：`#10208` 三模统一多模态输入（Chat 识图 + AiFileAsset.ownerId 基础安全修复）
> 审查身份：ai-learning-mentor（软层架构 + 学习价值）
> 审查对象：13 个核心文件（schema / route / core/context / lib / ui / tests）

---

## 审查结论

**APPROVED**（带 4 条建议，不阻塞合并）

整体这是一次**架构边界划得很干净**的多模态扩展。用户提的 6 条关键设计决策全部落地，没有出现"职责重叠"或"过度抽象"的迹象。三模（Chat / Image / Video）真正共享了 AiFileAsset + AiMessageAttachment + resolveProviderImageSource 一条基础设施，而不是各搞一份。事务边界、历史多轮图片、generate-response 不破坏 image_url 这三个高风险点都守住了。

唯一的隐忧是**附件抽象的边界还是"图像特化"**——加 audio / PDF 时需要触动的代码面比预期略大。下面会展开讲。

---

## 架构亮点

### 1. 职责分层非常清晰（route / context / node 三层边界）

```
route.ts（handleLangGraphRequest）
  ├── 校验 + 事务写入 message + attachments   ← 唯一接触 DB 的入口
  ├── resolveCurrentInputImages / resolveHistoryInputImages ← DB → URL 转换
  └── buildMessages(...)                       ← 纯函数，不查 DB

messages-builder.ts
  ├── 不查 DB，不异步
  └── 只做"数据 → LangChain BaseMessage[]"转换

generate-response.ts（multimodal-aware buildMessages）
  ├── 不重建 image_url 结构
  ├── 只对最后一个 HumanMessage 的 text part 做非破坏性 append
  └── image_url → image 转换只发生在这里（AI SDK UserContent 格式要求）
```

**类比**：就像「餐厅后厨」——`route.ts` 是「备菜间」（负责从仓库拉货、洗切、装盘），`messages-builder` 是「配菜单」（只列食材清单，不碰食材），`generate-response` 是「厨师」（拿到装好盘的食材，只在「调味」这一步动手，绝不重新切菜）。这种分层让 Bug 定位非常容易——多模态出问题，先看备菜间（resolve），再看配菜单（builder），最后看厨师（generate-response）。

### 2. `buildMessages` 重载设计是优雅的兼容方案

`messages-builder.ts` 同时接受 `currentMessage: string` 和 `currentInput: CurrentInput`（L84-88）：

```ts
const effectiveCurrentText = currentInput?.text ?? currentMessage ?? "";
```

这一行让旧的 `buildMessages({ history, currentMessage })` 调用方（Chat 模式以外的代码）**零修改**继续工作，新调用方用 `currentInput` 拿多模态能力。两个入口汇合到 `effectiveCurrentText`，退化和增强走同一条路径。**这是教科书式的「向后兼容的重载」**——新增能力不破坏旧调用方。

### 3. N+1 优化做得早、做得到位

`resolve-history-input-images.ts`（L34-62）一次性 `findMany` 查所有历史 attachment + 按 `fileAssetId` 去重 + `Promise.all` 并行 resolve provider source，再按 `messageId` 聚合。**这是典型的"把 N+1 折叠成 1 次 query + N 次并行 I/O"的工程取舍**——没有过度优化（比如自己写 LRU cache），也没有偷懒（直接循环 await）。

### 4. 事务原子性做得果断

`route.ts`（L748-776）的 4 步事务：

```
create message → createMany attachments → update conversation
```

三者绑定在一个 `prisma.$transaction` 里，**不会出现"消息有了但附件丢了"的中间态**。这是 Chat 识图能稳定运行的基础——否则下一轮重连后 LLM 会看到"消息但没图"的不一致状态。

### 5. generate-response 的「不破坏 image_url」三条纪律（L388-391 + L432-441）

代码注释里写得很清楚：

```ts
// 禁止 JSON.stringify：多模态 array 必须原样透传给 generateText
// 禁止重建 HumanMessage：不能 new HumanMessage(enriched) 重新构造
// 禁止重新 push 当前消息：state.messages 已经包含当前 HumanMessage
```

这三条不是想出来的，是踩过坑才知道的（见 `docs/debug/`）。**保留已经形成的肌肉记忆**，对维护者极友好。

### 6. 三模统一：infra 共享、surface 各异

`features/ai/lib/upload-image-to-file-asset.ts`（L44-73）真正做到了「Chat / Image / Video」共用一个 helper：
- Image 模式（I2I）走 `handleReferenceImageUpload`（L221-279）→ 同一 helper
- Video 模式（I2V）走同一通道
- Chat 模式（识图）走 `handleImageUpload`（L191-214）→ 同一 helper

helper 内部封装了 compress + POST + ownerId 三件套。**减少了一处复制粘贴 = 减少一处漂移**。

---

## 架构债务（合并后会累积的隐忧）

### ⚠️ 债务 1：附件抽象还是"图像特化"，加 audio/PDF 时仍要改 4 处

虽然 `AiAttachmentType` 枚举里已经有 `IMAGE | VIDEO | FILE`，但实现层到处都是 `image` 字面量：

| 文件 | 行号 | "image" 字面量 |
|------|------|--------------|
| `multimodal-builder.ts` | L17-19 | `MultimodalImagePart` 硬编码 `image_url` |
| `messages-builder.ts` | L110 | `historyImageUrls` 参数名 |
| `route.ts` | L165-184 | `validateInputImageOwnership` 函数名 + 错误码 `UNAUTHORIZED_INPUT_IMAGE` / `NON_IMAGE_INPUT` |
| `route.ts` | L641-650 | `currentInputImageUrls` 变量名 |
| `AiChatInput.tsx` | L191-214 | `handleImageUpload` 函数名 |

**未来加 audio 的工作量估算**：
1. schema 加 `type: "AUDIO"` 分支 → 0.5 天
2. `resolveProviderImageSource` 改名为 `resolveProviderFileSource` + 音频分支 → 0.5 天
3. `multimodal-builder` 改名为 `multimodal-content-builder` + audio part → 0.5 天
4. **4 处命名重构**（`validateInputImageOwnership` → `validateInputAttachmentOwnership` 之类）→ 1 天

> **建议**：**这次先不动**，但记一个 ADR（架构决策记录）：「未来 attachment 抽象需要先做一次 rename + 重构」。可以在新 `docs/ai/PR10208-multimodal-future.md` 留一段。

### ⚠️ 债务 2：ownerId 回填策略在 plan 里写了，但代码里没看到自动回填脚本

plan 里 Step 0.2（L98-125）详细写了历史数据回填 SQL（通过 `AiMessageAttachment → AiChatMessage → AiConversation` 反查 userId），但**当前 PR 没有附带回填脚本**（如 `scripts/backfill-file-asset-owner.ts`）。

> **风险**：历史 24 条 NULL ownerId 记录（plan 估算）会保留为 NULL。短期内没问题（`validateInputImageOwnership` 在代码层校验，不依赖 ownerId 非空），但**未来如果加"非 owner 无法引用"的硬性规则，要回头补**。
>
> **建议**：要么在 PR 描述里写明"回填脚本作为 follow-up"，要么补一个 `npm run db:backfill-ai-file-asset-owner` 脚本（即使是 dry-run 模式也好）。

### ⚠️ 债务 3：单 image_url 限制（首版 ≤2 张）在三处分散

| 位置 | 限制 |
|------|------|
| `route.ts` L157 | `z.array(z.string()).optional()`（**没有 max 限制**） |
| `upload-image-to-file-asset.ts` | 没有数量校验（按次调用） |
| `AiChatInput.tsx` | 也没有硬性 ≤2 限制（用户可以无限点 +） |

**plan 提到"UI + API 统一最多 2 张"（L503）**，但实际只在 UI 层做了软约束（每次 `handleImageUpload` 都允许），没在 zod schema 里加 `.max(2)`。**这是一个很容易被遗忘的"软约束"**——前端绕过就能多传。

> **建议**：在 `messageSchema.inputImageIds` 上加 `.max(2).optional()`，让 API 层是 hard limit。

### ⚠️ 债务 4：测试只覆盖「数据形状」，没覆盖「路由编排」

`multimodal-builder.test.ts` 9 个测试 100% 覆盖了纯函数（`buildMultimodalContent` / `extractTextAndImageUrls` / `buildMessages` 的多模态分支）。**但**：

1. 没测 `validateInputImageOwnership` 的 ownerId 校验失败分支
2. 没测事务原子性（attachments 写失败时 message 是否回滚）
3. 没测 `resolveHistoryInputImages` 的 failures 聚合逻辑（L74-80 那段 messageId 反查）
4. 没测 E2E：上传图片 → 发消息 → 看到 LLM 识图回复

> **建议**：补一个端到端集成测试（用 Vitest mock prisma）：
> - 错误 ownerId → 抛 `UNAUTHORIZED_INPUT_IMAGE`
> - 包含非 image mime → 抛 `NON_IMAGE_INPUT`
> - 历史 attachments 部分解析失败 → `failures[]` 含正确 messageId

---

## 学习路径建议（这份代码展示了什么？新手应该怎么学？）

### 🎓 它是一份「多模态 LLM 应用的标准全链路」教材

新手按这条顺序读这套代码，**30 分钟内能看懂"前端上传图片 → LLM 看见图片"的完整链路**：

```
Step 1（5 分钟）features/ai/lib/upload-image-to-file-asset.ts
  └─ 学到：图片压缩 → JSON POST → 返回 AiFileAsset.id

Step 2（5 分钟）app/api/ai/file-assets/route.ts
  └─ 学到：ownerId = session.user.id（基础安全），BASE64 存 bytes 避免 B-tree 超限

Step 3（10 分钟）app/api/ai/conversations/[id]/messages/route.ts
  └─ 学到：路由层的严格时序：校验 → 事务 → resolve → buildMessages

Step 4（5 分钟）features/ai/core/context/multimodal-builder.ts
  └─ 学到：纯函数怎么把 (text, imageUrls) 变成 LangChain HumanMessage content

Step 5（5 分钟）features/ai/agents/conversation/nodes/generate-response.ts
  └─ 学到：multimodal content 怎么过 AI SDK（image_url → image 转换）
```

### 🧠 这套代码展示的 4 个核心认知

| 认知 | 在哪学 | 一句话 |
|------|--------|--------|
| **纯函数 vs 副作用的边界** | `messages-builder.ts` | 纯函数 = 容易测试、容易复用、不会"读到一半数据库被改了" |
| **事务原子性是分布式系统的呼吸** | `route.ts` L748-776 | message + attachments + conversation update 必须绑在一起，否则下一轮重连就脏数据 |
| **多模态 content 是"数组，不是字符串"** | `multimodal-builder.ts` + `generate-response.ts` | 一旦 `JSON.stringify`，image_url 就丢了；这是高发 bug 点 |
| **N+1 是隐性性能债** | `resolve-history-input-images.ts` | 一次 findMany + 内存聚合，比循环 await 快 10x 且代码差不多长 |

### ❓ 给学习者的 3 个苏格拉底式问题

> **Q1**：为什么 `route.ts` 要先把 `message + attachments` 写进事务，再去 `resolveCurrentInputImages`？
> 提示：试想如果顺序反过来——先 resolve 再写——会发生什么？

> **Q2**：`generate-response.ts` 注释里说"禁止重建 HumanMessage"，但它实际是 `{ ...target, content: enriched }` 浅克隆。这个浅克隆为什么不会破坏 image_url 的内部结构？
> 提示：JS 对象引用 vs 浅克隆分别复制了什么层？

> **Q3**：`multimodal-builder.ts` 的 `extractTextAndImageUrls` 反向函数有什么实际用途？代码里目前没看到调用方。
> 提示：未来要在 generate-response 里"读出图片 URL 单独处理"时会用到（虽然现在不调）。这个函数的存在意味着什么设计哲学？

---

## 未来演进建议（audio / PDF / 多模态工具调用）

### 🎯 加 audio / PDF attachment 的推荐路径

**不要现在做**，但建议预留扩展点：

1. **第一步：rename + generic 化**
   - `validateInputImageOwnership` → `validateInputAttachmentOwnership`
   - `resolveCurrentInputImages` → `resolveCurrentInputAttachments`
   - `historyImageUrls` → `historyAttachmentUrls`（Map<messageId, { image: string[]; audio: string[]; pdf: string[] }>）
   - 一次性 rename + 改类型，4 处 → 1 处后续改动

2. **第二步：multimodal part 联合类型扩展**
   ```ts
   export type MultimodalPart =
     | MultimodalTextPart
     | MultimodalImagePart
     | MultimodalAudioPart   // { type: "audio", input_audio: { data, format } }
     | MultimodalPdfPart;    // { type: "file", file: { filename, file_data } }
   ```
   - **复用** `MultimodalTextPart` / `MultimodalImagePart`
   - 加 audio / pdf 分支即可，不改现有调用方

3. **第三步：route.ts 拆出"附件类型路由器"**
   ```ts
   const attachmentResolver = {
     IMAGE: resolveProviderImageSource,
     AUDIO: resolveProviderAudioSource,
     PDF: resolveProviderPdfSource,
   };
   ```
   - 让 `validateInputAttachmentOwnership` 按 `type` 字段 dispatch
   - 现有 Chat 识图（type=IMAGE）走默认分支，零改动

### 🔮 多模态工具调用（让 LLM 主动用工具看图）

当前模型只能「看用户上传的图」。下一步可以让模型在 searchKnowledge 时**主动检索带图的工单 / 笔记**，把图当成"视觉证据"输出：

- 需要：`searchKnowledge` 返回 chunk 时附 `attachments[]`，路由到 `multimodal-builder` 生成 multimodal content
- 需要的 schema 改动：`SearchDocument.attachments: Json?`
- 复用度：100% 复用本次的 `multimodal-builder` + `generate-response` 转换逻辑

### 📊 性能/可观测性建议

1. **加 `image_count` 指标到 conversation runtime state**
   - `AiConversationRuntimeState.metrics: { multimodalRounds: number; totalImagesUploaded: number }`
   - 看到 LLM 是否真的用了图（vs 文本回复）

2. **`resolveProviderImageSource` 失败的 retry 策略**
   - 当前是失败就降级（`failures[]`）
   - 建议加 maxRetries=1，DB transient 错误重试一次

3. **`validateInputImageOwnership` 加 audit log**
   - 谁试图引用别人的图？写入 `ModerationLog`，方便排查 abuse

---

## 总结

✅ **APPROVED** — 架构边界清晰、事务原子性到位、N+1 优化做了、生成端不破坏 image_url
⚠️ **4 条非阻塞建议** — 附件抽象 rename / ownerId 回填脚本 / API 层 hard limit / E2E 测试覆盖
🎓 **学习价值高** — 是「前端 → DB → LLM」全链路标准教材，建议作为 onboarding 第一课

---

## 关联文件清单（按学习路径排序）

| 顺序 | 文件 | 行数 | 学习目标 |
|------|------|------|----------|
| 1 | `features/ai/lib/upload-image-to-file-asset.ts` | 76 | 前端上传 helper |
| 2 | `app/api/ai/file-assets/route.ts` | 186 | 服务端 BASE64 + ownerId |
| 3 | `app/api/ai/conversations/[id]/messages/route.ts` | 1291 | 路由层严格时序 |
| 4 | `features/ai/core/context/multimodal-builder.ts` | 65 | 纯函数数据转换 |
| 5 | `features/ai/core/context/resolve-current-input-images.ts` | 34 | 单图 resolve |
| 6 | `features/ai/core/context/resolve-history-input-images.ts` | 84 | 历史批量 resolve |
| 7 | `features/ai/core/context/messages-builder.ts` | 140 | 多模态 message 构造 |
| 8 | `features/ai/agents/conversation/nodes/generate-response.ts` | 513 | AI SDK 转换 + 不破坏 image_url |
| 9 | `features/ai/lib/file-source.ts` | 88 | Provider source 解析（BASE64 → data URI）|
| 10 | `features/ai/ui/AiChatInput.tsx` | 651 | 前端 UI（重点 L191-214 handleImageUpload）|
| 11 | `features/ai/ui/AiChatPanel.tsx` | 1708 | SSE 流处理 + inputImageIds 透传（L1026-1027）|
| 12 | `features/ai/core/context/__tests__/multimodal-builder.test.ts` | 152 | 单元测试（纯函数）|
| 13 | `prisma/schema.prisma` | 1032 | 数据模型（AiFileAsset.ownerId L1014 + AiMessageAttachment L991）|

---

## 审查产物落盘说明

- 本次审查产物：`docs/reviews/PR10208-chat-vision-ai-mentor.md`（本文件，软层）
- 待合并：`docs/reviews/PR10208-chat-vision-review.md`（Main 合并 code-reviewer + ai-mentor 后）
- 待补：`docs/reviews/PR10208-chat-vision-code-reviewer.md`（硬层审查）
