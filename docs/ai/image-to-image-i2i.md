# AI 图生图（I2I）功能开发到测试复现手册

> 适用：project-manager 仓库（Next.js + Prisma + Worker）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"AI 图生图（I2I）"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- **现象**：用户在 AI 对话中上传参考图后，生成的图片完全没有参考参考图的构图、风格或内容
- **业务影响**：I2I（图生图）功能形同虚设，用户体验极差
- **根本原因**：Agnes API 的图片输入格式错误，图片放在了顶层 `image` 字段，而 API 要求放在 `extra_body.image` 中

### 1.2 结论

- 新版修复了 `image-generator.ts` 中 Agnes provider 的 I2I 请求格式
- 图片正确传递到 `extra_body.image` 数组中，支持 Base64 Data URI 和外部 URL

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/llm/image-generator.ts` | 修改 | Agnes 图片生成 I2I 格式修复 |
| `worker/background/handlers/image.handler.ts` | 修改 | 解析 inputFileIds 并传递给图片生成器 |
| `features/ai/lib/file-source.ts` | 新增 | FileAsset Storage Layer 抽象（支持 REMOTE_URL/BASE64/DATABASE） |
| `features/ai/routing/generation-mode.ts` | 新增 | T2I/I2I 模式路由逻辑 |
| `app/api/ai/file-assets/route.ts` | 新增 | 文件上传 API |
| `app/api/ai/generate/image/route.ts` | 修改 | 对接 worker job 队列 |
| `prisma/schema.prisma` | 修改 | 新增 AiFileAsset 表和 MESSAGE_ATTACHMENTS |
| `features/ai/ui/AiChatInput.tsx` | 修改 | AI 对话输入组件（支持图片上传） |
| `features/ai/ui/AiChatPanel.tsx` | 修改 | AI 对话面板（显示附件和生成结果） |

---

## 3. 核心实现

### 3.1 Agnes I2I 格式修复（`features/ai/llm/image-generator.ts`）

```201:229:features/ai/llm/image-generator.ts
async function generateWithAgnes(
  params: GenerateImageParams,
  apiKey: string,
  baseURL: string
): Promise<GenerateImageResult> {
  const { prompt, modelRef = "agnes-image-2.1-flash", n = 1, size = "1K", imageUrls } = params;

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    model: modelName,
    prompt,
    size,
    n,
  };

  // I2I 模式：传入输入图片 URL
  // Agnes API 要求图片放在 extra_body.image 中（文档：https://wiki.agnes-ai.com/en/docs/agnes-image-21-flash.md）
  if (imageUrls && imageUrls.length > 0) {
    requestBody.extra_body = {
      image: imageUrls,
      response_format: "url",
    };
    console.log(`[agnes-image] I2I mode: using input images ${JSON.stringify(imageUrls)}`);
  }
```

**为什么这样写**：根据 Agnes API 官方文档，图生图的输入图片必须放在 `extra_body.image` 数组中，而不是请求体顶层。错误格式导致 API 直接忽略参考图。

### 3.2 Worker 图片处理（`worker/background/handlers/image.handler.ts`）

```48:75:worker/background/handlers/image.handler.ts
  // I2I 模式：解析输入图片为 Provider 可访问的 URL
  let inputImageUrls: string[] = [];
  if (generationMode === "IMAGE_TO_IMAGE" && inputFileIds) {
    try {
      // 并行解析所有输入图片
      const sources = await Promise.all(
        inputFileIds.map((id) => resolveProviderImageSource(id))
      );
      inputImageUrls = sources.map((s) => s.url);
      console.log(`[IMAGE_GENERATE] I2I mode: ${inputImageUrls.length} input images resolved`);
    } catch (error) {
      // 文件解析失败（DATABASE storage 等）
      console.error(`[IMAGE_GENERATE] Failed to resolve input images:`, error);
      // ...
    }
  }
```

**为什么这样写**：Worker 运行在远程服务器，无法访问本地数据库的图片。需要通过 `resolveProviderImageSource` 将 FileAsset 转换为 Provider 可访问的 URL（REMOTE_URL 或 Base64 Data URI）。

### 3.3 File Source 抽象（`features/ai/lib/file-source.ts`）

```46:64:features/ai/lib/file-source.ts
  // REMOTE_URL: 直接使用 storageKey
  if (fileAsset.storageType === "REMOTE_URL") {
    if (!fileAsset.storageKey) {
      throw new Error(`FileAsset ${fileAssetId} is REMOTE_URL but has no storageKey`);
    }
    return {
      url: fileAsset.storageKey,
      mimeType: fileAsset.mimeType,
    };
  }

  // BASE64: 数据存于 bytes（无索引字段），从 bytes 重建 data URI 返回
  if (fileAsset.storageType === "BASE64") {
    return {
      url: toDataUri(fileAsset.mimeType, fileAsset.bytes),
      mimeType: fileAsset.mimeType,
    };
  }
```

**为什么这样写**：Storage Layer 抽象让不同存储类型的 FileAsset 都能转换为 Provider 可访问的 URL。REMOTE_URL 直接返回，BASE64 重建 Data URI。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| Worker 目录 | `/home/hxy/work/personal/project-manager/` | 远程服务器 worker 路径 |
| Worker 端口 | 5000（主 API）、Worker 后台任务 | Worker 独立进程 |
| Agnes API | `https://apihub.agnes-ai.com/v1/images/generations` | 图片生成端点 |
| Agnes 模型 | `agnes-image-2.1-flash` | 默认模型 |
| API Key | USER/SYSTEM provider 配置 | 在 Web UI 设置中配置 |

---

## 5. 启动 / 部署

```bash
# ========== 本地开发 ==========
# 1. 安装依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 2. 启动 Next.js 开发服务器
npm run dev

# 3. 启动 Worker（另一个终端）
npm run worker

# ========== 远程部署 ==========
# 1. 同步代码到远程
rsync -avz --exclude='node_modules' --exclude='.next' \
  /Users/vastgui/Desktop/project-manager/ \
  hxy@192.168.1.14:/home/hxy/work/personal/project-manager/

# 2. 在远程服务器重启 Worker
ssh hxy@192.168.1.14
cd /home/hxy/work/personal/project-manager
pm2 restart worker-background  # 或 systemctl restart project-manager-worker
```

---

## 6. 测试 & 验证

### 6.1 I2I 功能测试

1. 打开 AI 对话页面 `http://localhost:3003/ai`
2. 上传一张参考图片
3. 输入提示词（如"将图片转为赛博朋克风格"）
4. 点击发送

**期望日志输出**（Worker 端）：
```
[IMAGE_GENERATE] job=xxx mode=IMAGE_TO_IMAGE model=agnes-image-2.1-flash
[IMAGE_GENERATE] I2I mode: 1 input images resolved
[IMAGE_GENERATE] inputImages: data:image/jpeg;base64,xxx...
[agnes-image] I2I mode: using input images ["data:image/jpeg;base64,xxx..."]
[agnes-image] 发起生图: endpoint=https://apihub.agnes-ai.com/v1/images/generations
```

**期望结果**：生成的图片应该明显参考了原图的构图、主体或风格。

### 6.2 T2I 功能回归测试

1. 不上传图片
2. 直接输入提示词
3. 点击发送

**期望**：正常生成图片，不受影响。

---

## 7. 复现 Checklist

- [ ] 本地启动 `npm run dev`
- [ ] 远程服务器代码同步完成
- [ ] 远程 Worker 已重启
- [ ] 打开 AI 对话页面
- [ ] 上传参考图片
- [ ] 输入 I2I 提示词
- [ ] 发送请求
- [ ] Worker 日志显示 `[agnes-image] I2I mode: using input images`
- [ ] 生成图片参考了原图风格/构图
- [ ] 图片正确显示在对话中

---

## 8. 踩坑记录

### 坑 1：Agnes API I2I 图片格式错误

**现象**：生成的图片完全没有参考原图，用户上传的参考图被完全忽略。

**原因**：代码中将图片放在请求体顶层的 `image` 字段，但 Agnes API 要求放在 `extra_body.image` 数组中。API 文档明确指出：
> 图生图需要在 `extra_body.image` 中提供输入图像 URL 或 Data URI Base64。

**解法**：修改 `generateWithAgnes` 函数：

```typescript
// 错误写法
requestBody.image = imageUrls[0];

// 正确写法
requestBody.extra_body = {
  image: imageUrls,
  response_format: "url",
};
```

### 坑 2：远程 Worker 无法访问本地图片

**现象**：DATABASE 存储的图片在 Worker 端无法访问，导致 I2I 功能在生产环境失效。

**原因**：Worker 运行在远程服务器 `192.168.1.14`，无法通过 `localhost:3003` 访问本地数据库中的图片。

**解法**：实现了 `resolveProviderImageSource` 抽象层，支持：
- `REMOTE_URL`：直接使用已上传的外部 URL
- `BASE64`：从 bytes 字段重建 Data URI（适用于 DashScope Wanx API）
- `DATABASE`：抛出明确错误，提示用户使用 REMOTE_URL

### 坑 3：远程代码未同步

**现象**：本地修复后，远程 Worker 仍然使用旧代码，I2I 功能仍然失效。

**原因**：开发者忘记将修改后的代码同步到远程服务器。

**解法**：使用 rsync 同步代码后，必须重启 Worker：
```bash
rsync -avz --exclude='node_modules' --exclude='.next' \
  /Users/vastgui/Desktop/project-manager/ \
  hxy@192.168.1.14:/home/hxy/work/personal/project-manager/

ssh hxy@192.168.1.14 "cd /home/hxy/work/personal/project-manager && pm2 restart worker-background"
```
