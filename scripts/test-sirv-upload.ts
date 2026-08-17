/**
 * 测试 Sirv 图床上传
 * 
 * 用法：
 *   npx tsx scripts/test-sirv-upload.ts
 */

// 加载 .env.local
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { uploadToPublicImageHost } from '../features/ai/lib/storage/public-image-uploader';

async function testSirvUpload() {
  console.log('🧪 测试 Sirv 图床上传...\n');

  // 检查环境变量
  console.log('🔍 检查配置：');
  console.log(`   SIRV_CLIENT_ID: ${process.env.SIRV_CLIENT_ID ? '✅ 已配置' : '❌ 未配置'}`);
  console.log(`   SIRV_CLIENT_SECRET: ${process.env.SIRV_CLIENT_SECRET ? '✅ 已配置' : '❌ 未配置'}`);
  console.log('');

  // 1x1 透明 PNG（最小测试图片）
  const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  try {
    console.log('📤 上传测试图片...');
    
    const result = await uploadToPublicImageHost(testImageBase64, {
      mimeType: 'image/png',
    });

    console.log('\n✅ 上传成功！');
    console.log('📊 结果：');
    console.log(`   Provider: ${result.provider}`);
    console.log(`   URL: ${result.url}`);
    if (result.expiresAt) {
      console.log(`   Expires: ${result.expiresAt.toISOString()}`);
    }

    console.log('\n🌐 测试访问...');
    const response = await fetch(result.url);
    console.log(`   HTTP Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);
    console.log(`   Content-Length: ${response.headers.get('content-length')} bytes`);

    if (response.ok) {
      console.log('\n🎉 Sirv 图床配置成功！');
    } else {
      console.error('\n❌ 图片上传成功，但无法访问');
    }

  } catch (error) {
    console.error('\n❌ 测试失败：');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\n💡 请检查：');
    console.error('   1. .env.local 中的 SIRV_CLIENT_ID 和 SIRV_CLIENT_SECRET 是否正确');
    console.error('   2. API Client 是否有上传权限');
    console.error('   3. 网络连接是否正常');
    process.exit(1);
  }
}

testSirvUpload();
