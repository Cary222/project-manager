# Sirv 图床集成诊断与公开图床文档

> 适用：project-manager 仓库（Next.js + LangGraph + Agnes AI）
> 目标：让任何同事 / 未来的我拿到这份文档 + 仓库 commit 后，能**完整复现**"Sirv 图床集成"的端到端过程。

---

## 1. 目标 & 背景

### 1.1 旧版的问题 / 这次要解决什么

- **问题 1**：Agnes AI 不支持 base64 data URI 输入，只能接受公开 URL
- **问题 2**：本地图片无法直接传给 Agnes，需要先上传到公开图床
- **问题 3**：Sirv 免费账户已成功配置，但 Agnes 访问 Sirv URL 时报 `Connection reset by peer`

### 1.2 结论

- ✅ Sirv 图床上传功能已完成并测试通过
- ❌ Agnes 访问 Sirv URL 的问题待解决（网络/区域问题）
- 📝 新增 `docs/ai/image-host-integration.md` 公开图床集成文档

---

## 2. 改动清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `features/ai/lib/storage/public-image-uploader.ts` | 新增 | Sirv + Cloudflare R2 图床上传工具 |
| `features/ai/lib/storage/file-source.ts` | 修改 | BASE64/DATABASE 类型自动上传到公开图床 |
| `scripts/test-sirv-upload.ts` | 新增 | Sirv 上传测试脚本 |
| `docs/ai/image-host-integration.md` | 新增 | 公开图床集成完整文档 |
| `app/api/ai/conversations/[id]/messages/route.ts` | 修改 | 注入 DEBUG 日志用于排查 chat 模式图片问题 |
| `features/ai/tools/web-scrape.ts` | 新增 | Web scraping 工具（预留） |

---

## 3. 核心实现

### 3.1 Sirv 图床上传（`features/ai/lib/storage/public-image-uploader.ts`）

```startLine:28:features/ai/lib/storage/public-image-uploader.ts
export async function uploadToPublicImageHost(
  base64Data: string,
  options: UploadOptions
): Promise<UploadResult> {
  const { mimeType, preferProvider } = options;

  // 去除 data URI 前缀（如果有）
  const base64Clean = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');

  // 策略 1：优先使用 Sirv（如果配置了）
  if (preferProvider === 'sirv' || process.env.SIRV_CLIENT_ID) {
    try {
      return await uploadToSirv(base64Clean, mimeType);
    } catch (error) {
      console.warn('[uploadToPublicImageHost] Sirv upload failed, falling back to R2', error);
    }
  }
  // ...
}
```

**为什么这样写**：优先级 Sirv > R2，Sirv 免费额度足够，R2 作为降级方案。

### 3.2 Sirv 上传核心逻辑（`uploadToSirv` 函数）

```startLine:79:features/ai/lib/storage/public-image-uploader.ts
async function uploadToSirv(base64: string, mimeType: string): Promise<UploadResult> {
  // Step 1: 获取 Access Token
  const authResponse = await fetch('https://api.sirv.com/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  // Step 2: 上传图片到 /ai-chat/ 目录
  const filename = `ai-chat/${Date.now()}.${extension}`;
  const uploadResponse = await fetch(`https://api.sirv.com/v2/files/upload?filename=/${filename}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': mimeType },
    body: buffer,
  });

  // Step 3: 生成公开 URL
  const publicUrl = `https://${account}.sirv.com/${filename}`;
}
```

**为什么这样写**：Sirv API 需要先获取 token 再上传，图片存到 `ai-chat/` 目录便于管理。

### 3.3 FileAsset 解析为公开 URL（`features/ai/lib/storage/file-source.ts`）

```startLine:60:features/ai/lib/storage/file-source.ts
  // BASE64: 上传到公开图床（Agnes 等 Provider 不支持 data URI）
  if (fileAsset.storageType === "BASE64") {
    const base64Data = Buffer.from(fileAsset.bytes).toString('base64');
    const uploadResult = await uploadToPublicImageHost(base64Data, {
      mimeType: fileAsset.mimeType,
    });
    return { url: uploadResult.url, mimeType: fileAsset.mimeType };
  }
```

**为什么这样写**：BASE64 类型的图片自动上传到公开图床，返回公开 URL 供 Agnes 访问。

---

## 4. 环境与配置

| 变量 / 依赖 | 值 | 说明 |
|------------|----|------|
| `SIRV_CLIENT_ID` | `xxx` | Sirv API Client ID |
| `SIRV_CLIENT_SECRET` | `xxx` | Sirv API Client Secret |
| `SIRV_ACCOUNT` | `cary222` | Sirv 账户名（从 Client ID 提取） |
| `CLOUDFLARE_R2_*` | - | R2 配置（可选，降级方案） |
| 端口 | 3003 | Next.js 开发服务器 |

### Sirv 免费账户申请

1. 访问 https://sirv.com/pricing/
2. 注册免费账户（5GB 存储 + 20GB 流量/月）
3. Account Settings > API > 生成 Client ID 和 Client Secret

---

## 5. 启动 / 部署

```bash
# 1. 配置环境变量
# 编辑 .env.local，添加：
SIRV_CLIENT_ID=your_client_id
SIRV_CLIENT_SECRET=your_client_secret
SIRV_ACCOUNT=your_account_name

# 2. 安装依赖
cd /Users/vastgui/Desktop/project-manager
npm install

# 3. 启动开发服务器
npm run dev

# 4. 启动生产服务器（部署后）
npm run build && npm run start
```

---

## 6. 测试 & 验证

### 6.1 Sirv 上传测试脚本

```bash
cd /Users/vastgui/Desktop/project-manager
npx tsx scripts/test-sirv-upload.ts
```

**期望输出**：
```
🧪 测试 Sirv 图床上传...

🔍 检查配置：
   SIRV_CLIENT_ID: ✅ 已配置
   SIRV_CLIENT_SECRET: ✅ 已配置

📤 上传测试图片...
   Provider: sirv
   URL: https://cary222.sirv.com/ai-chat/1723862400000.png

🌐 测试访问...
   HTTP Status: 200 OK
   Content-Type: image/png

🎉 Sirv 图床配置成功！
```

### 6.2 端到端验证（图片理解）

```bash
# 在 AI 聊天框上传本地图片
# 期望：图片上传成功，Sirv 返回公开 URL
# 问题：Agnes 访问 Sirv URL 时可能报 Connection reset
```

---

## 7. 复现 Checklist

- [ ] 确认 `.env.local` 中 `SIRV_CLIENT_ID` 和 `SIRV_CLIENT_SECRET` 已配置
- [ ] 确认 Sirv 账户有上传权限
- [ ] 跑 `npx tsx scripts/test-sirv-upload.ts` 验证上传成功
- [ ] 验证上传后的 URL 可在浏览器访问
- [ ] 在 AI 聊天框上传本地图片测试
- [ ] 确认图片 URL 已正确传给 Agnes
- [ ] 观察 Agnes 是否成功识别图片内容

---

## 8. 踩坑记录

### 坑 1：Sirv 上传成功但 Agnes 访问失败

**现象**：
```
Connection aborted.', ConnectionResetError(104, 'Connection reset by peer')
```

**原因**：
- Sirv 免费 CDN 在某些区域可能不稳定
- Agnes 服务器可能在国内，访问 Sirv CDN（境外）被阻断

**解法**：
- 继续使用 Sirv（图片上传功能正常）
- 等待 Agnes 服务端修复，或考虑切换到国内图床

### 坑 2：Agnes 不支持 base64 data URI

**现象**：
```
image_url not accessible
```

**原因**：
- Agnes API 要求图片必须是公开可访问的 URL
- base64 data URI 无法被外部服务器访问

**解法**：
- 已实现 BASE64 → Sirv URL 自动转换
- 用户上传图片自动上传到 Sirv，返回公开 URL

### 坑 3：Sirv API 认证失败

**现象**：
```
Sirv auth failed: 401 Unauthorized
```

**原因**：
- Client ID 或 Client Secret 填写错误
- API 权限不足

**解法**：
- 检查 `.env.local` 中的 `SIRV_CLIENT_ID` 和 `SIRV_CLIENT_SECRET`
- 确认在 Sirv Account Settings > API 页面生成了正确的凭证

---

## 附录：当前状态总结

| 能力 | 状态 | 说明 |
|------|------|------|
| 图片上传到 Sirv | ✅ 完成 | 测试通过 |
| Sirv URL 生成 | ✅ 完成 | 格式 `https://cary222.sirv.com/ai-chat/{timestamp}.{ext}` |
| Agnes 读取 Sirv URL | ❌ 待解决 | Connection reset by peer |
| 公开图床文档 | ✅ 完成 | `docs/ai/image-host-integration.md` |
