#!/bin/bash
# 自动部署脚本：git pull → 构建 → 切换服务 + 重试失败任务

set -e

WORK="/home/hxy/work/personal/project-manager"
LOG="/tmp/pm-deploy.log"
DEPLOY_LOCK="/tmp/pm-deploy.lock"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

if ! ( set -o noclobber; : > "$DEPLOY_LOCK" ) 2>/dev/null; then
    log "检测到另一个部署正在执行，跳过本次任务"
    exit 0
fi
trap 'rm -f "$DEPLOY_LOCK"' EXIT

log "=== 开始部署检查 ==="
cd "$WORK"

log "获取远程更新..."
git --git-dir="$WORK/.git" --work-tree="$WORK" fetch origin

LOCAL=$(git --git-dir="$WORK/.git" --work-tree="$WORK" rev-parse HEAD)
REMOTE=$(git --git-dir="$WORK/.git" --work-tree="$WORK" rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "代码已是最新"
    log "无需重启，保持当前服务运行"
    log "=== 部署完成 ==="
    exit 0
fi

log "发现更新: $LOCAL → $REMOTE"
log "拉取最新代码..."
git --git-dir="$WORK/.git" --work-tree="$WORK" pull --ff-only origin main

log "开始安装依赖与生成 Prisma Client..."
if ! npm install --no-audit --no-fund >> "$LOG" 2>&1; then
    log "依赖安装失败！旧服务保持不变。查看日志: tail -60 $LOG"
    exit 1
fi
# npm install 可能因本机 npm 版本差异改写 package-lock.json,复位保持部署树干净,避免下次 pull 被脏树挡住
git --git-dir="$WORK/.git" --work-tree="$WORK" checkout -- package-lock.json 2>/dev/null || true
if ! npx prisma generate >> "$LOG" 2>&1; then
    log "Prisma Client 生成失败！旧服务保持不变。查看日志: tail -60 $LOG"
    exit 1
fi
log "清理旧的 build 产物..."
rm -rf "$WORK/.next" 2>/dev/null || true
log "开始构建..."
if ! npm run build >> "$LOG" 2>&1; then
    log "构建失败！旧服务保持不变。查看日志: tail -60 $LOG"
    exit 1
fi

log "重启 project-manager 服务..."

systemctl --user restart project-manager.service
systemctl --user restart project-manager-worker.service
systemctl --user restart project-manager-background-worker.service
systemctl --user restart embedding-api.service

# 健康检查
sleep 5
for svc in project-manager project-manager-worker project-manager-background-worker embedding-api; do
    if ! systemctl --user is-active --quiet "${svc}.service"; then
        log "警告: ${svc} 未达到 active 状态"
    fi
done

# HTTP health check
if curl -fsS --retry 3 --retry-delay 1 http://127.0.0.1:3003 > /dev/null 2>&1; then
    log "Web health check 通过"
else
    log "警告: Web health check 未通过，请检查日志"
fi

if curl -fsS --retry 3 --retry-delay 1 http://127.0.0.1:5000/health > /dev/null 2>&1; then
    log "Embedding API health check 通过"
else
    log "警告: Embedding API health check 未通过"
fi

# 重试失败的 IndexJob（FILE_ASSET 类型）
log "重试失败的索引任务..."
retry_result=$(cd "$WORK" && npx tsx -e "
import { loadEnvConfig } from '@next/env';
import { prisma } from './shared/db/client';

loadEnvConfig(process.cwd());

async function main() {
  const result = await prisma.indexJob.updateMany({
    where: {
      targetType: 'FILE_ASSET',
      status: 'FAILED',
    },
    data: {
      status: 'PENDING',
      attempt: 0,
      error: null,
      updatedAt: new Date(),
    },
  });
  console.log(JSON.stringify({ count: result.count }));
}
main().catch(e => console.error(e.message)).finally(() => prisma.\$disconnect());
" 2>&1 || echo '{"count":0}')

retry_count=$(echo "$retry_result" | grep -o '"count":[0-9]*' | grep -o '[0-9]*' || echo "0")
log "已重置 ${retry_count} 个失败任务，Worker 将在下次轮询时处理"

log "=== 部署完成 ==="
