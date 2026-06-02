#!/bin/bash
# 自动部署脚本：git pull → 构建 → 切换服务

set -e

WORK="/home/hxy/work/personal/project-manager"
LOG="/tmp/pm-deploy.log"
PORT=3003
DEPLOY_LOCK="/tmp/pm-deploy.lock"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG"
}

kill_port() {
    local port="$1"
    local pids
    pids=$(ss -ltnp "sport = :$port" 2>/dev/null | awk -F'pid=' '/users:\(\("next-server|next-server|node/ {gsub(/,.*/,"",$2); print $2}' | sort -u || true)
    if [ -n "$pids" ]; then
        log "停止占用 ${port} 端口的进程: ${pids}"
        kill $pids 2>/dev/null || true
    fi
}

wait_for_port_free() {
    local port="$1"
    local timeout="${2:-20}"
    local elapsed=0

    while ss -ltn "sport = :$port" | tail -n +2 | grep -q ":$port"; do
        if [ "$elapsed" -ge "$timeout" ]; then
            log "等待端口 ${port} 释放超时"
            return 1
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
}

if ! ( set -o noclobber; : > "$DEPLOY_LOCK" ) 2>/dev/null; then
    log "检测到另一个部署正在执行，跳过本次任务"
    exit 0
fi
trap 'rm -f "$DEPLOY_LOCK"' EXIT

log "=== 开始部署检查 ==="
cd "$WORK"

log "获取远程更新..."
git fetch origin

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "代码已是最新"
    log "无需重启，保持当前服务运行"
    log "=== 部署完成 ==="
    exit 0
fi

log "发现更新: $LOCAL → $REMOTE"
log "拉取最新代码..."
git pull origin main

log "开始安装依赖与生成 Prisma Client..."
if ! npm install >> "$LOG" 2>&1; then
    log "依赖安装失败！旧服务保持不变。查看日志: tail -60 $LOG"
    exit 1
fi
if ! npx prisma generate >> "$LOG" 2>&1; then
    log "Prisma Client 生成失败！旧服务保持不变。查看日志: tail -60 $LOG"
    exit 1
fi
log "开始构建..."
if ! npm run build >> "$LOG" 2>&1; then
    log "构建失败！旧服务保持不变。查看日志: tail -60 $LOG"
    exit 1
fi

log "检查并停止当前服务..."
kill_port "$PORT"
wait_for_port_free "$PORT" 20 || {
    log "端口 ${PORT} 未能及时释放，取消本次启动"
    exit 1
}

log "启动服务..."
nohup npm run start >> "$LOG" 2>&1 &

elapsed=0
while ! ss -ltn | tail -n +2 | grep -q ":$PORT"; do
    if [ "$elapsed" -ge 20 ]; then
        log "服务启动超时！最近日志："
        tail -60 "$LOG" | tee -a "$LOG"
        exit 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
done

log "服务启动成功 (port ${PORT})"
log "=== 部署完成 ==="
