# AI Mentor Review（软层）— I2V 图生视频功能

<!-- reviewer: ai-learning-mentor (软层) -->
<!-- date: 2026-08-13 -->
<!-- scope: PR12 - I2V (Image-to-Video) implementation -->

---

## 审查结论

| 维度 | 评价 |
|------|------|
| **整体评价** | ✅ **APPROVED** — 架构设计合理，复用模式健康，可进入 Stage3 |
| **设计决策** | 合理 — `inputFileIds` 比 `imageUrl` 更具扩展性 |
| **架构演进** | 健康 — I2I/I2V 共用 `generation-mode.ts` + `file-source.ts`，复用充分 |
| **学习价值** | 高 — API 层校验 + Worker 层解析的职责分离是可复用模式 |
| **可改进点** | 3 处中等优先级，1 个 Critical（见下方） |

---

## 1. 设计决策审查

### 1.1 为什么选 `inputFileIds` 而非 `imageUrl`

**结论：✅ 正确选择**

你选择通过 `inputFileIds`（文件 ID 数组）而非直接传 `imageUrl`（URL 字符串），这是正确的架构决策，原因如下：

**当前优势：**
- `inputFileIds` 是 DB 主键，有完整溯源能力（谁上传的、什么时间、什么格式）
- `imageUrl` 只是临时字符串，无法追溯来源
- 共用 `AiMessageAttachment` 表统一管理 INPUT/OUTPUT 附件，历史消息渲染自然接入

**对未来的扩展性：**

| 扩展场景 | `imageUrl` 的问题 | `inputFileIds` 的优势 |
|----------|------------------|---------------------|
| 多图输入（关键帧动画） | 需要改成 `imageUrls[]`，API 签名破坏性变更 | 只改 Schema 校验，`inputFileIds` 支持数组天然适配 |
| 关键帧时序控制 | 需要额外传 `{ urls, timestamps }` | `AiFileAsset` 可扩展 `metadata` 字段存时序 |
| 输入图鉴权 | URL 无法做用户级权限检查 | DB 查 `AiFileAsset.userId` 天然鉴权 |
| 输入图历史展示 | 需要额外建表 | 已有 `AiMessageAttachment` |

> **关键洞察**：你选的是一个"存储锚点"（文件 ID）而不是"存储值"（URL）。这是正确的抽象层级——就像工单路由用 `ticketId` 而非 `ticketUrl` 一样。

---

### 1.2 `generationMode` 的放置位置

**结论：✅ 符合计划设计的"职责分离"原则**

你把 `resolveGenerationMode()` 的调用放在两处，这是有意的设计：

```
API Route（video/route.ts）          Worker（video.handler.ts）
      │                                    │
      ├── 校验 + 早期拒绝（400）            ├── 解析图片 → Provider URL
      └── 传 inputFileIds 给 Job           └── 传 imageUrl 给 Provider
```

**为什么这样设计？**

- API 层做"快速失败"：不合法的请求（I2V 但没图片）立刻返回 400，不浪费 Worker 资源
- Worker 层做"资源解析"：`inputFileIds` → `resolveProviderImageSource()` → Provider 可访问的 URL
- 两层都用 `resolveGenerationMode()`，保持一致性

这其实是 **防腐层（Anti-Corruption Layer）** 模式的变体——API 层把用户的"我想上传图片"翻译成内部的 `inputFileIds`，Worker 再把它翻译成 Provider 的 `imageUrl`。

---

## 2. 架构演进审查

### 2.1 I2I/I2V 共用 `generation-mode.ts` + `file-source.ts`

**结论：✅ 复用充分，边界清晰**

```
generation-mode.ts           file-source.ts
      │                           │
      ├── Image: T2I / I2I        ├── REMOTE_URL → 直接返回 storageKey
      └── Video: T2V / I2V        ├── BASE64 → 重建 data URI
                                  └── DATABASE → 明确报错（不伪造 URL）
```

**复用价值：**
- 如果后续接入"音频生成"（T2A / I2A），只需要扩展 `GenerationMode` 类型，校验逻辑天然复用
- `file-source.ts` 的 storageType 分支可以继续扩展 OBJECT_STORAGE（未来签名 URL）

**一个潜在风险点：**

`video.handler.ts` 和 `image.handler.ts` 都调用 `resolveGenerationMode()`，但两者传入的 `inputFileIds` 类型略有不同：

| Handler | inputFileIds 来源 | 处理方式 |
|---------|------------------|---------|
| `image.handler.ts` | `inputFileIds: string[]` | `Promise.all()` 并行解析所有图 |
| `video.handler.ts` | `inputFileIds?: string[]` | 只取第一张 `[0]`，硬编码 1 图限制 |

这在当前 V1 是合理的（视频通常只用一个参考图），但如果要扩展多图，关键路径不同会导致维护负担。建议在 `generation-mode.ts` 补充注释说明这个设计决策。

---

### 2.2 Worker → Provider 的类型桥接

**结论：✅ 符合计划"类型分层"原则**

```
API/Job 层                          Provider 层
GenerationRequest { inputFileIds }  VideoGenerationInput { imageUrl }
     │                                    │
     └── resolveProviderImageSource() ────┘
```

这个桥接是单向的——Provider 不感知 `inputFileIds`，只接收最终可用的 URL。这保证了：
- Provider 接口稳定，不因前端需求变化而修改
- 测试时可以 mock `resolveProviderImageSource()` 独立验证 Provider 调用

---

## 3. 学习价值分析

### 3.1 这是一个可复用的工程模式

这次实现展示了 **API 层校验 + Worker 层执行** 的职责分离模式：

**API Route 的职责（校验层）：**
```
1. 鉴权（requireSession）
2. Schema 校验（Zod）
3. 业务规则校验（I2V 必须有图 / 最多 1 张）
4. 数据验证（文件归属 / MIME 类型）
5. 写 DB（创建消息）
6. 入队 BackgroundJob
```

**Worker 的职责（执行层）：**
```
1. 读 Job Payload
2. 解析输入资源（resolveProviderImageSource）
3. 调外部 Provider
4. 写 DB（结果 + 附件）
5. 发送 SSE 事件（emitMessageDelta）
```

**为什么这样分层？**
- API Route 在 Next.js Edge 环境中运行，超时限制严（通常是 30s）
- 视频生成可能需要 5 分钟，必须放到 Worker 独立执行
- 分层后，API Route 快速返回"任务已入队"，Worker 在后台慢慢处理

> **苏格拉底提问**：想象你以后要接入"音频生成"（T2A/I2A），这六步模式里哪几步需要改？哪几步可以复用？

---

### 3.2 `resolveProviderImageSource` 的边界处理值得学习

`file-source.ts` 对 DATABASE storage 的处理方式是一个很好的**防御性编程**例子：

```typescript
// 关键约束：
// Browser → localhost:3003 ✅
// Agnes/Provider → localhost:3003 ❌

if (fileAsset.storageType === "DATABASE") {
  throw new Error(
    `FileAsset ${fileAssetId} uses DATABASE storage, which is not accessible by external Providers.`
  );
}
```

这不是"功能缺失"——这是**明确系统边界**，让调用方知道 DATABASE 当前不支持 I2I/I2V，避免误用导致静默失败。

对比一个反面模式：如果这里返回 `null` 或伪造一个 `localhost` URL，错误会延迟到 Provider 返回"图片加载失败"，排查链路会拉长很多。

---

## 4. 可改进点（非阻塞）

### 4.1 Agnes V2 API 能力未充分挖掘（中等优先级）

`video-generator.ts` 里硬编码了：

```typescript
requestBody.num_frames = 121;
requestBody.frame_rate = 24;
```

Agnes Video V2.0 API 文档显示支持更多参数（如 `duration`、`aspect_ratio`），当前实现：
- 硬编码 121 帧 ≈ 5 秒视频
- 没有让用户选择视频时长
- 没有让用户选择画面比例（16:9 / 9:16 / 1:1）

**建议**：未来 V2 可以考虑在 UI 增加时长/比例选择器，通过 `inputFileIds` → `metadata` 传递给 Worker，再透传给 Provider。

---

### 4.2 I2V 进度反馈缺失（中等优先级）

当前 I2V 模式的 `emitMessageDelta` 调用位置：

- `video.handler.ts` 在 Worker 异常时调用了 `emitMessageDelta`（第 74 行）
- 但正常流程（解析图片成功 → 调用 Provider → 等待轮询）**没有**调用 `emitMessageDelta`

对比 `image.handler.ts`，它在正常流程里有进度回调：

```typescript
// image.handler.ts — 有进度
async (percent: number, detail: string) => {
  await prisma.aiChatMessage.update(...);
  emitMessageDelta(messageId, { progress: { step: "generating", percent, detail } });
}
```

这意味着 I2V 用户看不到"正在解析输入图片 → 正在提交到 Provider → 正在生成视频 (30%)"这类中间进度。

**建议**：在 `video.handler.ts` 的 I2V 分支添加进度反馈，让用户体验与 I2I 一致。

---

### 4.3 `AiMessageAttachment.direction` 的 UI 渲染待验证（低优先级）

计划里设计了 `INPUT`（用户参考图）和 `OUTPUT`（AI 生成结果）的区分，但 `AiMessageBubble.tsx` 里 `userImages` 的渲染逻辑需要确认是否正确接入：

```typescript
// AiChatPanel.tsx — userImages 来自 inputFileIds state
userImages: inputFileIds?.map((img) => ({ id: img.id, url: img.url, name: img.name })),
```

这是从前端 state 拿的，不是从 DB 的 `direction=INPUT` 附件读取。历史消息加载时（`loadMessages`），`userImages` 字段没有从 API 返回的数据里填充。

**建议**：确认 `/api/ai/conversations/${convId}` 是否返回 INPUT 附件，或在 `AiChatMessage` API 层补上 `userImages` 字段。

---

## 5. Critical 问题

### ❗ 5.1 DATABASE storage 用户体验优化

**问题**：`file-source.ts` 对 DATABASE storage 直接抛出错误，导致 I2V 请求静默失败（用户只看到"视频生成失败"）。

**当前体验链路**：
```
用户上传图片 → DATABASE storage 保存
       ↓
用户发起 I2V → resolveProviderImageSource() → Error: DATABASE not accessible
       ↓
Worker 标记 FAILED → 前端显示"视频生成失败"
       ↓
用户困惑：为什么上传成功了却不能用？
```

**影响**：用户不知道是"图片格式不对"还是"存储方式不支持"，也没有引导到解决方案。

**缓解建议**：

1. **API 层预检查**（`video/route.ts` 第 41-70 行已有部分校验）—— 在现有基础上增加 storageType 检查：

```typescript
// 在验证 inputFileIds 存在后，增加：
const inputFiles = await prisma.aiFileAsset.findMany({
  where: { id: { in: inputFileIds } },
  select: { id: true, mimeType: true, storageType: true }, // ← 加 storageType
});

// 新增：DATABASE storage 不支持 I2V 的友好提示
const unsupportedFiles = inputFiles.filter(
  (f) => f.storageType === "DATABASE"
);
if (unsupportedFiles.length > 0) {
  return NextResponse.json(
    { error: "DATABASE 存储的图片暂不支持 I2V，请使用外部链接图片" },
    { status: 400 }
  );
}
```

2. **User Facing 错误信息优化**（`video.handler.ts` 第 66-76 行）—— 当前错误信息是技术性的：

```typescript
// 当前
content: "输入图片无法访问，请使用外部图片链接。"

// 建议更友好
content: "暂不支持从上传图片生成视频（DATABASE 存储限制）。请使用图片 URL 或切换到文字生成视频模式。";
```

**根本解法**（长期）：实现 OBJECT_STORAGE 的 signed URL 方案，让 DATABASE 存储的图片也能生成临时可访问 URL。

---

## 6. 与 Agnes Video V2.0 API 的对齐

| Agnes V2 API 能力 | 当前实现 | 状态 |
|-------------------|---------|------|
| `/videos` POST 创建任务 | ✅ 已接入 | 完整 |
| `image` 参数（I2V） | ✅ `requestBody.image = imageUrl` | 完整 |
| 轮询 `/agnesapi?video_id=` | ✅ `pollVideoTask()` | 完整 |
| `num_frames` / `frame_rate` | ✅ 硬编码 121/24 | 部分（不可配置） |
| `duration` 参数 | ❌ 未暴露 | 缺失 |
| `aspect_ratio` 参数 | ❌ 未暴露 | 缺失 |
| 错误码映射 | ⚠️ 只打印日志 | 可改进（但非 Critical） |

---

## 7. 架构演进路径建议

```
V1（当前）                    V2（建议）                    V3（长期）
   │                            │                              │
   ├── T2V / I2V 基础           ├── 多图输入（关键帧动画）         ├── 多段视频拼接
   ├── 硬编码帧数/帧率           ├── 时长/比例选择器               ├── 视频编辑（裁剪/字幕）
   └── DATABASE → Error         ├── OBJECT_STORAGE signed URL    └── 视频压缩/转码
```

**从 V1 到 V2 的最小改动**：
1. `generation-mode.ts` → `GenerationMode` 增加 `"IMAGE_TO_VIDEO_MULTI"`
2. `file-source.ts` → `resolveProviderImageSource` 返回数组
3. `video.handler.ts` → 循环解析多图
4. UI → 增加图片列表 + 时长/比例选择器

---

## 8. 总结

### 设计亮点

1. **`inputFileIds` 的选择**：正确抽象层级，为多图/关键帧等扩展留足空间
2. **API/Worker 分层**：职责分离清晰，API 快速失败，Worker 异步执行
3. **`file-source.ts` 的边界处理**：明确 DATABASE 不支持，不伪造 URL
4. **共用 `generation-mode.ts`**：Image/Video 复用校验逻辑，符合 DRY

### 需要关注

1. **Critical**：DATABASE storage I2V 的用户体验优化（API 层预检查 + 友好错误信息）
2. **中等**：I2V 进度反馈缺失（`emitMessageDelta`）
3. **中等**：Agnes V2 能力未充分暴露（时长/比例不可配置）
4. **低**：历史消息 `userImages` 渲染链路验证

### 评审结论

✅ **APPROVED — 可以合并**，Critical 问题建议在 V1.1 修复，不阻塞本次 PR。

---

> 🎭 当前身份：架构顾问（AI Mentor 软层审查）
> 📋 审查范围：设计决策 / 架构演进 / 学习价值 / 可改进点 / Agnes API 对齐
> ⏱️ 审查时间：2026-08-13
