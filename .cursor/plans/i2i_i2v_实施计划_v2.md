# I2I / I2V 实施计划（修正版）

## 最终架构

```
                    AiChat
                       │
                 Task Router
                       │
              chat / image / video
                       │
            ┌──────────┴──────────┐
            │                     │
         image                  video
            │                     │
      input image?          input image?
            │                     │
        ┌───┴───┐             ┌───┴───┐
        ▼       ▼             ▼       ▼
       T2I     I2I           T2V     I2V
        │       │             │       │
        └───┬───┘             └───┬───┘
            │                     │
            ▼                     ▼
       Image Handler         Video Handler
            │                     │
            └─────────┬───────────┘
                      ▼
             resolve FileAsset
                      │
                      ▼
             Provider Source
                      │
                ┌─────┴─────┐
                ▼           ▼
             Image       Video Provider
             Provider        │
                │            ▼
                ▼        REMOTE_URL
             FileAsset       │
                │            │
                └──────┬─────┘
                       ▼
              AiMessageAttachment
                       │
                       ▼
                 AiChatMessage
```

---

## 五项关键修正

### 修正 1: Task Router 只负责 category，generationMode 在请求处计算

**Task Router** (`features/ai/routing/task-router.ts`) — 只负责意图分类：
```typescript
interface ResolvedTask {
  category: "chat" | "image" | "video";
  toolMode?: "chat" | "search" | "web";
}
// 不包含 generationMode
```

**Generation Normalizer** (`features/ai/routing/generation-mode.ts`，新建) — 在生成请求处计算：
```typescript
function resolveGenerationMode(
  category: "chat" | "image" | "video",
  inputFileIds: string[],
) {
  if (category === "image") {
    return inputFileIds.length > 0 ? "IMAGE_TO_IMAGE" : "TEXT_TO_IMAGE";
  }
  if (category === "video") {
    return inputFileIds.length > 0 ? "IMAGE_TO_VIDEO" : "TEXT_TO_VIDEO";
  }
  return undefined;
}
```

**设计原则**：Task Router 负责"用户想干什么"（chat/image/video），generationMode 由"任务类型 + 输入图片"在请求处决定。

### 修正 2: 类型分层（API/Job 与 Provider 分离）

**API/Job 层** — `GenerationRequest`：
```typescript
interface GenerationRequest {
  prompt: string;
  modelRef?: string;
  inputFileIds?: string[];
}
```

**Provider 层** — 现有接口不修改：
- Image: `GenerateImageParams` + `imageUrls?: string[]`
- Video: `VideoGenerationInput.imageUrl?: string`

`generationMode` 由上层决定，不传进 Provider。Provider 只关心"有没有图片 URL"。

### 修正 3: file-source.ts 明确 DATABASE 行为（⚠️ 关键约束）

```typescript
// features/ai/lib/file-source.ts

interface ProviderFileSource {
  url: string;       // Provider 真正可访问的资源
  mimeType: string;
}

/**
 * 根据 storageType 解析 FileAsset 为 Provider 可用的源
 *
 * ⚠️ 关键约束：返回的 URL 必须能让外部 Provider（Agnes 等）访问
 */
export async function resolveProviderImageSource(
  fileAssetId: string
): Promise<ProviderFileSource> {
  // REMOTE_URL: 直接使用 storageKey（已经是外部可访问 URL）
  // OBJECT_STORAGE: 生成 signed URL（待实现）
  // DATABASE: 明确失败，不要返回 localhost URL！
}
```

**⚠️ 关键约束**：
```
Browser → localhost:3003 ✅
Agnes/Provider → localhost:3003 ❌
```

**不要返回 `http://localhost:3003/...` 给外部模型！**

DATABASE 存储当前无法支持 I2I/I2V，应明确报错。后续解决方案：
- 临时上传到 Provider
- 或上传到对象存储生成 signed URL

### 修正 4: AiMessageAttachment 增加 direction 区分

**Prisma schema 修改**：
```prisma
model AiMessageAttachment {
  // ... 现有字段
  direction AiAttachmentDirection @default(OUTPUT)

  @@schema("pm")
}

enum AiAttachmentDirection {
  INPUT   // 用户输入的参考图片
  OUTPUT  // AI 生成的图片/视频
}
```

**语义**：
```text
用户消息
└── INPUT
    └── original.png

AI 消息
└── OUTPUT
    └── generated.png / generated.mp4
```

**重要性**：历史消息渲染必须能区分"用户参考图"和"AI 生成结果"。

### 修正 5: inputModalities 缺失 ≠ 支持

```typescript
const supportsImageInput = model.inputModalities?.includes("image") === true;
// 缺失字段 ≠ 支持 image
// 宁可下拉框为空，不要误判
```

---

## 最终开发顺序

```
Phase 0
类型 + FileSource + INPUT/OUTPUT
        ↓
Phase 1
Image/Video API 校验
        ↓
Phase 2
Image/Video Worker 接输入图
        ↓
Phase 3
Image Provider 支持 imageUrls
        ↓
Phase 4
Task Router 感知 hasImages
        ↓
Phase 5
ModelSelector 增加 inputModalities
        ↓
Phase 6
AiChatPanel 接通完整链路
        ↓
测试
```

---

## 完整文件清单

| 阶段 | 文件 | 操作 |
|------|------|------|
| 0 | `features/ai/lib/file-source.ts` | 新建 |
| 0 | `features/ai/routing/generation-mode.ts` | 新建 |
| 0 | `prisma/schema.prisma` | 修改 |
| 1 | `app/api/ai/generate/image/route.ts` | 修改 |
| 1 | `app/api/ai/generate/video/route.ts` | 修改 |
| 2 | `worker/background/handlers/image.handler.ts` | 修改 |
| 2 | `worker/background/handlers/video.handler.ts` | 修改 |
| 3 | `features/ai/llm/image-generator.ts` | 修改 |
| 4 | `features/ai/routing/task-router.ts` | 修改 |
| 5 | `features/ai/llm/providers/types.ts` | 修改 |
| 5 | `features/ai/llm/providers/registry.ts` | 修改 |
| 5 | `features/ai/llm/model-selector.tsx` | 修改 |
| 6 | `features/ai/ui/AiChatPanel.tsx` | 修改 |

---

## 质量门

### 功能测试

| 测试项 | 预期结果 |
|--------|----------|
| T2I 不带 inputFileIds | 成功 |
| I2I 带一个图片 | 成功 |
| I2I 不带图片 | API 400 |
| T2V 不带 inputFileIds | 成功（现有功能不回归） |
| I2V 带一个图片 | 成功 |
| I2V 不带图片 | API 400 |
| 输入类型错误（PDF/TXT） | API 400 |

### 安全校验

| 测试项 | 预期结果 |
|--------|----------|
| inputFileId 不属于用户 | 403/404 |
| 第一版超过 1 张输入图 | API 400 |

### 模型过滤

| 测试项 | 预期结果 |
|--------|----------|
| capability=image 但 inputModalities 无 image | 不出现在 I2I 模型列表 |
| 有输入图时 | 只显示 inputModalities 包含 image 的模型 |

### 数据正确性

| 测试项 | 预期结果 |
|--------|----------|
| 输入附件 direction=INPUT | 正确 |
| 输出附件 direction=OUTPUT | 正确 |
| 输入图片不重复创建 FileAsset | 正确复用已有资源 |

---

## 约束条件

- **不新建 Worker 任务类型**：复用 IMAGE_GENERATE / VIDEO_GENERATE
- **不新建 Tab**：保持 Auto / Chat / Image / Video
- **DATABASE 明确不支持 Provider 访问**：不要伪造 URL
- **inputModalities 缺失 ≠ 支持**：宁可下拉框为空
