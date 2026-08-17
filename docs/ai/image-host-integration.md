# 公开图床集成文档

## 概述

为了支持 Agnes AI 等不支持 base64 data URI 的多模态 LLM，集成了公开图床自动上传功能。

## 技术架构

```
用户上传图片（本地文件）
  ↓
存储到 AiFileAsset（storageType=BASE64 或 DATABASE）
  ↓
resolveProviderImageSource 检测到 BASE64/DATABASE
  ↓
自动上传到公开图床（ImgBB 或 Cloudflare R2）
  ↓
返回公开 URL 给 Agnes
```

## 支持的图床

### 1. ImgBB（默认，无需配置）

- **优点**：免费、无需注册、即开即用
- **缺点**：图片永久保留、隐私风险、限流（匿名 5000 张/月）
- **适用场景**：快速测试、临时使用

**环境变量**（可选）：
```bash
IMGBB_API_KEY=your_api_key  # 不填则使用匿名模式
```

### 2. Cloudflare R2（推荐生产方案）

- **优点**：完全控制、自动过期（7天）、免费额度大（10GB + 1000万次读取）
- **缺点**：需要配置 Cloudflare 账户
- **适用场景**：生产环境、注重隐私

**环境变量**（必填）：
```bash
CLOUDFLARE_R2_ACCOUNT_ID=your_account_id
CLOUDFLARE_R2_ACCESS_KEY_ID=your_access_key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_secret_key
CLOUDFLARE_R2_BUCKET_NAME=ai-temp-images
CLOUDFLARE_R2_PUBLIC_DOMAIN=your-domain.com  # 可选，自定义域名
```

## 配置步骤

### 方案 1：ImgBB（快速测试）

1. 不需要任何配置，直接使用匿名模式
2. （可选）去 https://api.imgbb.com/ 申请 API Key，提高限流额度
3. 将 API Key 写入 `.env.local`：
   ```bash
   IMGBB_API_KEY=your_key_here
   ```

### 方案 2：Cloudflare R2（生产推荐）

#### 步骤 1：创建 R2 存储桶

1. 登录 Cloudflare：https://dash.cloudflare.com/
2. 进入 **R2** → **Create bucket**
3. 名称填 `ai-temp-images`
4. 地区选择 **自动**

#### 步骤 2：生成 API 凭证

1. 进入 **R2** → **Manage R2 API Tokens**
2. 点击 **Create API token**
3. 权限选择 **Object Read & Write**
4. 记录以下信息：
   - Account ID
   - Access Key ID
   - Secret Access Key

#### 步骤 3：配置环境变量

将以下内容添加到 `.env.local`：

```bash
CLOUDFLARE_R2_ACCOUNT_ID=你的账户ID
CLOUDFLARE_R2_ACCESS_KEY_ID=你的访问密钥ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY=你的密钥
CLOUDFLARE_R2_BUCKET_NAME=ai-temp-images
```

#### 步骤 4：配置公开访问（可选）

R2 默认私有，需要开启公开访问：

1. 进入存储桶 → **Settings** → **Public access**
2. 点击 **Allow Access**
3. 记录公开域名（如 `https://pub-xxxxx.r2.dev`）
4. 添加到 `.env.local`：
   ```bash
   CLOUDFLARE_R2_PUBLIC_DOMAIN=pub-xxxxx.r2.dev
   ```

#### 步骤 5：设置自动过期（推荐）

为了避免图片永久保留：

1. 进入存储桶 → **Settings** → **Lifecycle rules**
2. 点击 **Create rule**
3. 配置：
   - **Prefix**: `ai-chat/`（仅影响 AI 对话图片）
   - **Action**: Delete objects
   - **After**: 7 days
4. 保存

## 降级策略

系统会按以下优先级尝试上传：

1. **Cloudflare R2**（如果配置了环境变量）
2. **ImgBB**（R2 失败时降级）
3. **抛出错误**（所有图床都失败）

## 安全约束

### ⚠️ 重要提醒

1. **隐私风险**：上传到公开图床的图片**任何人都能访问**
2. **不要上传敏感信息**：身份证、护照、银行卡、私密照片等
3. **数据主权**：ImgBB 服务器在境外，敏感业务请使用 R2

### 推荐做法

- **开发/测试**：使用 ImgBB（方便）
- **生产环境**：使用 Cloudflare R2 + 7天自动过期

## 测试方法

### 测试 1：文本中的图片 URL

在 AI 聊天框输入：

```
这张图片里有什么？ https://images.pexels.com/photos/39001604/pexels-photo-39001604.jpeg
```

系统会自动提取 URL 并发送给 Agnes。

### 测试 2：上传本地图片

1. 点击聊天框的**上传图片**按钮
2. 选择本地图片
3. 输入提示词：`描述这张图片`
4. 提交后，系统会自动：
   - 存储为 `BASE64` 类型
   - 调用 `resolveProviderImageSource`
   - 上传到 ImgBB/R2
   - 返回公开 URL 给 Agnes

### 验证日志

查看控制台输出：

```bash
[file-source] BASE64 uploaded to public host { fileAssetId: '...', provider: 'imgbb', url: 'https://...' }
```

或

```bash
[file-source] BASE64 uploaded to public host { fileAssetId: '...', provider: 'r2', url: 'https://...' }
```

## 代码位置

| 文件 | 说明 |
|------|------|
| `features/ai/lib/storage/public-image-uploader.ts` | 图床上传核心逻辑 |
| `features/ai/lib/storage/file-source.ts` | `resolveProviderImageSource` 集成点 |
| `features/ai/agents/conversation/nodes/generate-response.ts` | 文本 URL 自动提取逻辑 |

## 故障排查

### 问题 1：ImgBB 上传失败

**症状**：
```
[uploadToImgBB] ImgBB upload failed: 400 Bad Request
```

**原因**：
- 图片格式不支持（只支持 jpg/png/gif/webp）
- 图片大小超过 32MB
- 匿名限流（每月 5000 张）

**解决**：
- 检查图片格式和大小
- 配置 `IMGBB_API_KEY` 提高限流额度
- 切换到 Cloudflare R2

### 问题 2：R2 上传失败

**症状**：
```
Cloudflare R2 credentials not configured
```

**原因**：环境变量未配置

**解决**：检查 `.env.local` 中的以下变量：
```bash
CLOUDFLARE_R2_ACCOUNT_ID
CLOUDFLARE_R2_ACCESS_KEY_ID
CLOUDFLARE_R2_SECRET_ACCESS_KEY
```

### 问题 3：Agnes 返回 "image_url not accessible"

**原因**：
- 图床生成的 URL 不可访问
- R2 存储桶未开启公开访问

**解决**：
1. 手动访问生成的 URL，验证是否可访问
2. R2 存储桶开启 **Public access**
3. 配置 `CLOUDFLARE_R2_PUBLIC_DOMAIN`

## 性能优化

### 1. 缓存公开 URL（待实现）

为同一张图片缓存上传结果：

```typescript
// 伪代码
const cached = await redis.get(`image:${fileAssetId}`);
if (cached) return { url: cached, mimeType };
```

### 2. 批量上传（待实现）

对于多张图片，并行上传：

```typescript
await Promise.all(images.map(img => uploadToPublicImageHost(img)));
```

## 未来优化方向

1. **智能选择图床**：根据图片大小、地理位置、用户偏好自动选择
2. **上传进度反馈**：大图片上传时显示进度条
3. **图片压缩**：上传前自动压缩，减少流量和存储成本
4. **访问统计**：记录每张图片的访问次数，优化缓存策略
5. **自动清理**：定期清理超过 7 天的 ImgBB 链接（需要手动删除）

## 相关文档

- [Agnes AI 多模态支持](./PR10199-ai-model-config-recap.md)
- [FileAsset 存储架构](../document/PKM_CHUNKING_IMPL.md)
