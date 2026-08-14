<!-- merged by Main from PR10208-chat-vision-code-reviewer.md + PR10208-chat-vision-ai-mentor.md -->

# PR10208 Chat 模式识图 — 综合审查报告

> **Merged by**: Main (Stage 2 — code-reviewer + ai-learning-mentor)
> **审查日期**: 2026-08-14
> **审查维度**: 硬层（typescript / DB / 后端正确性）+ 软层（架构 / 学习价值 / 演进）
> **合并痕迹**: 见下方"两份原始报告"链接

---

## 合并结论

| 维度 | 评级 | 关键判断 |
|---|---|---|
| **硬层** | **CHANGES_REQUIRED** | 3 Critical 阻塞主流程，8 Warning 应一并修复 |
| **软层** | **APPROVED** | 架构边界清晰、事务原子性到位、N+1 优化做了、生成端不破坏 image_url |
| **综合** | **CHANGES_REQUIRED** | 硬层 Critical 全部修复 + 软层 4 条建议的可执行项；其余为未来演进 |

---

## Critical（必须修复才能合并）

### C1. 首次发消息+图片静默丢图
**来源**: code-reviewer §1
**位置**: `app/api/ai/conversations/route.ts:9-12, 40`
**问题**: `createSchema` 只声明 `title` 和 `firstMessage`，没接 `inputImageIds`。但 `AiChatPanel.tsx:1030-1042` 在无 conversationId 时把 `inputImageIds` 塞进 body 发到这里——zod 静默丢图。
**修复**: `createSchema` 加 `inputImageIds: z.array(z.string()).max(2).optional()`+ ownerId 校验 + 事务写入 attachment。

### C2. Legacy 路径（USE_LANGGRAPH=false）不支持图片
**来源**: code-reviewer §2
**位置**: `app/api/ai/conversations/[id]/messages/route.ts:338-345`
**问题**: legacy 路径只 `appendMessage`，没传 attachments。环境配错就整体静默失效。
**修复**: legacy 路径也要执行 `validateInputImageOwnership` + `prisma.$transaction` 写 attachments。

### C3. `resolveCurrentInputImages` N+1 串行查询
**来源**: code-reviewer §3
**位置**: `features/ai/core/context/resolve-current-input-images.ts:24-33`
**问题**: 串行 `await`。5 张图 = 5 次顺序 `findUnique`。对比 history helper 已用 `Promise.all` 明显退化。
**修复**: 改 `Promise.all` 并行，并按原顺序聚合。

---

## Warnings（应当修复）

### W1. 历史图片 base64 累积，token 预算不感知
**来源**: code-reviewer §4
**位置**: `features/ai/core/context/messages-builder.ts:91-95` + `history-window.ts:35-66`
**问题**: `truncateHistoryByToken` 用 `countMessageTokens` 算 cost，图片 token 完全不入账。每张图 OpenAI 计 ~700 token，5 轮对话 × 5 张图 = 3.5K 图片 token + 2.5MB base64 payload。
**修复**: 在 history window 里加图片 cost 估算（每张 ~700 token），超过预算时优先淘汰带图旧轮次。

### W2. validateInputImageOwnership + resolveProviderImageSource 重复查 DB
**来源**: code-reviewer §5
**问题**: ownerId 校验和 resolve 同一行查 2 次。
**修复**: 合并为单次 `resolveCurrentInputImages` 内部做 ownerId 过滤。

### W3. `as any` + `as unknown as BaseMessage` 类型绕过
**来源**: code-reviewer §6
**位置**: `messages-builder.ts:117`
**修复**: 补注释，解释 LangChain AIMessage 构造器不直接暴露 `response_metadata`，必须断言。

### W4. 文档/实现不一致
**来源**: code-reviewer §7
**位置**: `resolve-current-input-images.ts:11-13`
**问题**: 注释说"502"，实际降级为纯文本。
**修复**: 改注释对齐实际行为。

### W5. 乐观 UI 不显示用户图片
**来源**: code-reviewer §8
**位置**: `AiChatPanel.tsx:975-978`
**问题**: Chat 模式 userImages 缺失，发送后图片从输入框消失。
**修复**: set `userImages: chatInputFileIds.map(...)`。

### W6. `inputImageIds` 数量无上限（schema/UI）
**来源**: code-reviewer §9 + ai-mentor 债务 3
**修复**: zod 加 `.max(2)`；前端 `multiple` 也加 limit。

### W7. `resolveHistoryInputImages` 失败日志不够
**来源**: code-reviewer §10
**修复**: 失败时输出 `messageId=xxx assetId=yyy reason=zzz` 至少 3 条样本。

### W8. `validateInputImageOwnership` 失败被吞
**来源**: code-reviewer §必带的烟火师
**修复**: 加 `console.warn('[route] inputImageIds 校验失败但已降级', { userId, missingIds })`。

---

## 软层 4 条建议（合并后作为可执行项）

### S1. 附件抽象"图像特化"（不阻塞）
**来源**: ai-mentor 债务 1
**判断**: 未来加 audio/PDF 时需要 4 处 rename（`validateInputImageOwnership` → `validateInputAttachmentOwnership`、`historyImageUrls` → `historyAttachmentUrls` 等）。**记录到 ADR**，不在本次 PR 处理。

### S2. ownerId 回填脚本
**来源**: ai-mentor 债务 2 + code-reviewer §13
**判断**: 历史 24 条 NULL 保留（短期不影响，新代码校验走 ownerId === userId）。**把已执行的 SQL API 化**——创建一个 `scripts/backfill-ai-file-asset-owner.ts`，包含正向回填 + dry-run 模式 + 重跑幂等。

### S3. API 层 hard limit
**来源**: ai-mentor 债务 3 + code-reviewer §9
**已并入 W6**

### S4. 集成测试覆盖
**来源**: ai-mentor 债务 4 + code-reviewer §14
**判断**: 9 个纯函数测试已覆盖数据形状。**补 3 个集成测试**：
- ownerId 校验失败 → 403
- 事务回滚（附件失败 → 消息不写）
- 失败消息聚合含正确 messageId

---

## Suggestions（建议改进，不阻塞）

### SG1. 孤儿 AiFileAsset 清理
**来源**: code-reviewer §12
**判断**: 后台 job 24h 清理未关联 attachment 的 ownerId asset。本期不实现，记 PR follow-up。

### SG2. ownerId 旧行 NULL 政策
**来源**: code-reviewer §13
**判断**: 保留 NULL（已由 `validateInputImageOwnership` 用 `ownerId === userId` 而非 `NOT NULL` 表达）。本次 PR 不改。

### SG3. `image.handler.ts` + `video.handler.ts` 显式 `direction: "OUTPUT"`
**来源**: code-reviewer §15
**修复**: 显式写，让审计更明确。

### SG4. `video-providers/storage.ts` ownerId 语义注释
**来源**: code-reviewer §16
**修复**: 注释 ownerId 当前等价 userId，未来切租户/共享时换。

### SG5. `image_uploads` 幂等去重
**来源**: code-reviewer §11
**判断**: historyImageUrls 按 messageId+fileAssetId 去重。本期 handler 不做，靠 DB 唯一约束。

---

## 正面反馈（保留到代码注释 / onboarding 文档）

来自两份审查：

- ✅ **OwnerId 校验** 写得正确：先 `findMany` + 服务端 filter + 返回 `missingIds` 不暴露其他用户的 assetId
- ✅ **事务原子性**：`prisma.$transaction` 4 步（msg / attach.createMany / conv.update）绑定
- ✅ **历史图片 batch resolve**：单 `findMany` + `Promise.all` + 内存聚合
- ✅ **Provider cache 友好**：失败 fallback 纯文本 + `failures[]` 字段
- ✅ **Schema 兼容性**：`ownerId String?` 允许历史 NULL + `@@index([ownerId])`
- ✅ **POST /api/ai/file-assets 不写 storageKey**（注释解释 B-tree 8191 字节限制）
- ✅ **`buildMessages` 重载设计**（向后兼容 + 新能力）
- ✅ **三模统一**：infra 共享（AiFileAsset + INPUT Attachment + resolveProviderImageSource）
- ✅ **generate-response 三条纪律**（禁止 JSON.stringify / 禁止重建 / 禁止 push）

---

## 跨审查转交

- **soft-mentor → code-reviewer §4**：图片 token 预算策略（成本边界）— 已在 W1 落地，**采用 W1 方案（含图 cost 估算 + 优先淘汰带图旧轮次）**
- **soft-mentor → code-reviewer §13**：ownerId=NULL 政策 — 已在 SG2 落地，**保留 NULL 不变**

---

## Mentor 二次评估（修复必要性）

> **审查报告**：`docs/reviews/PR10208-chat-vision-ai-mentor-reround.md`
> **结论**：11 项里 10 项必修复，1 项可推迟，0 项过度设计。**无 gold-plating**。

### 优先级分层

**P0 — 必修（6 项）**：
1. C1 — `/api/ai/conversations` 接 `inputImageIds`
2. C2 — legacy 路径支持图片
3. C3 — `resolveCurrentInputImages` 改 `Promise.all`
4. W5 — 乐观 UI 显示用户图片
5. W8 — `validateInputImageOwnership` 失败 warn 日志
6. W4 — 注释对齐实际行为

**P1 — 应修（4 项）**：
7. W2 — 合并 validate + resolve 为单次 DB 查询
8. W6 — zod `.max(8)` 留余地（不用 2）
9. W1 — history window 加图片 token cost（每张 ~700 token，优先淘汰带图旧轮次）
10. W3 — `as any` 注释解释 LangChain AIMessage 构造器限制

**follow-up（1 项）**：
- W7 — history 失败日志样本（合并到 W1 一起改或单独推迟）

### 与硬层审查的关系

Mentor 二次评估**确认硬层审查无 gold-plating**，但给出执行优先级分层。建议 Main 一次性完成 P0 + P1（共 10 项），预计 1-1.5 小时。

---

## 修复任务清单（合并后 Main 执行）

| # | 项 | 工作量 | 阻塞？ |
|---|---|---|---|
| 1 | C1: `/api/ai/conversations` 接 inputImageIds | M | ✅ |
| 2 | C2: legacy 路径支持图片 | M | ✅ |
| 3 | C3: `resolveCurrentInputImages` 改并行 | S | ✅ |
| 4 | W1: history 图片 token cost 估算 | M | ✅ |
| 5 | W2: validate + resolve 合并 | S | ✅ |
| 6 | W3: `as any` 注释 | S | ✅ |
| 7 | W4: 文档/实现对齐 | S | ✅ |
| 8 | W5: 乐观 UI 显示用户图片 | S | ✅ |
| 9 | W6 + S3: schema max(2) + UI limit | S | ✅ |
| 10 | W7: history 失败日志样本 | S | ✅ |
| 11 | W8: 校验失败 warn 日志 | S | ✅ |
| 12 | S2: ownerId 回填脚本（幂等） | M | ✅ |
| 13 | S4: 3 个集成测试 | M | ✅ |
| 14 | SG3: 显式 direction=OUTPUT | S | ✅ |
| 15 | SG4: ownerId 语义注释 | S | ✅ |

---

## 两份原始报告

- `docs/reviews/PR10208-chat-vision-code-reviewer.md` — 硬层（code-reviewer）
- `docs/reviews/PR10208-chat-vision-ai-mentor.md` — 软层（ai-learning-mentor）
