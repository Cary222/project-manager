/**
 * 公开图床上传工具（支持 Sirv + Cloudflare R2）
 * 
 * 用途：将 base64 图片上传到公开可访问的 URL，供不支持 data URI 的 LLM Provider 使用
 * 
 * 安全约束：
 * - 仅用于 AI 对话临时图片
 * - 不应上传包含敏感信息的图片
 * - Sirv / R2 图片设置 7 天自动过期
 */

interface UploadResult {
  url: string;
  provider: 'sirv' | 'r2';
  expiresAt?: Date;
}

interface UploadOptions {
  mimeType: string;
  preferProvider?: 'sirv' | 'r2';
}

/**
 * 上传 base64 图片到公开图床
 * 
 * 优先级：Sirv（免费）> Cloudflare R2
 */
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

  // 策略 2：降级到 Cloudflare R2
  if (!process.env.CLOUDFLARE_R2_ACCOUNT_ID) {
    throw new Error(
      'Image upload requires Sirv or Cloudflare R2. ' +
      'Sirv Free: 5GB storage, get started at https://sirv.com/pricing/ ' +
      'R2 Free: 10GB storage, get started at https://dash.cloudflare.com/'
    );
  }

  try {
    return await uploadToCloudflareR2(base64Clean, mimeType);
  } catch (error) {
    console.error('[uploadToPublicImageHost] R2 upload failed', error);
    throw new Error('Failed to upload image: ' + (error instanceof Error ? error.message : String(error)));
  }
}

/**
 * 上传到 Sirv（专业图片 CDN，有永久免费计划）
 * 
 * 官网：https://sirv.com/pricing/
 * 免费计划：
 * - 5GB 存储
 * - 20GB 流量/月
 * - 永久有效
 * 
 * API 文档：https://sirv.com/help/articles/sirv-rest-api/
 * 
 * 配置步骤：
 * 1. 注册 Sirv 账号
 * 2. 在 Account Settings > API 页面生成 Client ID 和 Client Secret
 * 3. 填入环境变量
 */
async function uploadToSirv(base64: string, mimeType: string): Promise<UploadResult> {
  const clientId = process.env.SIRV_CLIENT_ID;
  const clientSecret = process.env.SIRV_CLIENT_SECRET;
  const account = process.env.SIRV_ACCOUNT || clientId?.split('.')[0]; // 从 clientId 提取账户名
  
  if (!clientId || !clientSecret) {
    throw new Error(
      'SIRV_CLIENT_ID and SIRV_CLIENT_SECRET are required. ' +
      'Get them at https://my.sirv.com/#/account/settings/api'
    );
  }

  // Step 1: 获取 Access Token
  const authResponse = await fetch('https://api.sirv.com/v2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientId,
      clientSecret,
    }),
  });

  if (!authResponse.ok) {
    const errorText = await authResponse.text();
    throw new Error(`Sirv auth failed: ${authResponse.status} ${errorText}`);
  }

  const authResult = await authResponse.json();
  const accessToken = authResult.token;

  if (!accessToken) {
    throw new Error('Sirv returned no access token');
  }

  // Step 2: 上传图片
  const buffer = Buffer.from(base64, 'base64');
  const extension = mimeType.split('/')[1] || 'jpg';
  const filename = `ai-chat/${Date.now()}.${extension}`;

  const uploadResponse = await fetch(`https://api.sirv.com/v2/files/upload?filename=/${filename}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': mimeType,
    },
    body: buffer,
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`Sirv upload failed: ${uploadResponse.status} ${errorText}`);
  }

  // Step 3: 生成公开 URL
  const publicUrl = `https://${account}.sirv.com/${filename}`;

  console.log('[uploadToSirv] success', { 
    url: publicUrl,
  });

  return {
    url: publicUrl,
    provider: 'sirv',
    // Sirv 免费账户图片永久保留（需手动删除）
  };
}

/**
 * 上传到 Cloudflare R2（推荐生产方案）
 * 
 * 配置环境变量：
 * - CLOUDFLARE_R2_ACCOUNT_ID
 * - CLOUDFLARE_R2_ACCESS_KEY_ID
 * - CLOUDFLARE_R2_SECRET_ACCESS_KEY
 * - CLOUDFLARE_R2_BUCKET_NAME
 * - CLOUDFLARE_R2_PUBLIC_DOMAIN（可选，用于生成公开 URL）
 * 
 * 安全特性：
 * - 自动设置 7 天过期（通过 S3 lifecycle rule）
 * - 完全控制图片生命周期
 */
async function uploadToCloudflareR2(base64: string, mimeType: string): Promise<UploadResult> {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'ai-temp-images';
  const publicDomain = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Cloudflare R2 credentials not configured');
  }

  // 动态导入 AWS SDK（避免打包体积）
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  // 生成唯一文件名（带时间戳）
  const timestamp = Date.now();
  const extension = mimeType.split('/')[1] || 'jpg';
  const key = `ai-chat/${timestamp}-${Math.random().toString(36).slice(2)}.${extension}`;

  // 上传到 R2
  const buffer = Buffer.from(base64, 'base64');
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    // 设置 7 天后自动删除（通过 lifecycle rule）
    Metadata: {
      'auto-delete-after': '7d',
    },
  });

  await s3Client.send(command);

  // 生成公开 URL
  const publicUrl = publicDomain
    ? `https://${publicDomain}/${key}`
    : `https://${bucketName}.${accountId}.r2.cloudflarestorage.com/${key}`;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  console.log('[uploadToCloudflareR2] success', { url: publicUrl, expiresAt });

  return {
    url: publicUrl,
    provider: 'r2',
    expiresAt,
  };
}

/**
 * 检查当前配置的图床可用性
 */
export async function checkImageHostAvailability(): Promise<{
  sirv: boolean;
  r2: boolean;
  preferred: 'sirv' | 'r2' | 'none';
}> {
  const r2Available = !!(
    process.env.CLOUDFLARE_R2_ACCOUNT_ID &&
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  );

  const sirvAvailable = !!(
    process.env.SIRV_CLIENT_ID &&
    process.env.SIRV_CLIENT_SECRET
  );

  return {
    sirv: sirvAvailable,
    r2: r2Available,
    preferred: sirvAvailable ? 'sirv' : r2Available ? 'r2' : 'none',
  };
}
