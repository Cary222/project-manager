import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://community:community@192.168.1.14:5432/community?options=-c%20search_path%3Dpm,public' } },
});

async function main() {
  // 查找所有 UserApiKey
  const keys = await db.userApiKey.findMany({});
  console.log('=== 所有 UserApiKey ===');
  keys.forEach(k => {
    console.log(`id=${k.id}, provider=${k.provider}, name=${k.name}, ownerType=${k.ownerType}`);
  });
  
  // 查找 anthropic 相关
  const anthropicKeys = await db.userApiKey.findMany({
    where: {
      OR: [
        { provider: { contains: 'anthropic', mode: 'insensitive' } },
        { name: { contains: 'anthropic', mode: 'insensitive' } },
      ],
    },
  });
  console.log('\n=== Anthropic 相关 ===');
  anthropicKeys.forEach(k => {
    console.log(`id=${k.id}, provider=${k.provider}, name=${k.name}`);
  });
}

main()
  .then(() => db.$disconnect())
  .catch(e => { console.error(e); db.$disconnect(); });
