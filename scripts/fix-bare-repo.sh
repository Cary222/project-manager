#!/bin/bash
# 修复裸仓库配置，将 HEAD 从 master 改为 main

set -e

BARE="/home/hxy/work/personal/project-manager.git"
WORK="/home/hxy/work/personal/project-manager"

echo "=== 修复裸仓库配置 ==="

# 1. 修改裸仓库 HEAD
echo "1. 修改裸仓库 HEAD 指向 main..."
sudo git -C "$BARE" symbolic-ref HEAD refs/heads/main

# 2. 强制推送到裸仓库（因为裸仓库是空的）
echo "2. 强制推送到裸仓库..."
cd "$WORK"
git push -f origin main

# 3. 验证
echo "3. 验证裸仓库..."
echo "裸仓库 HEAD: $(sudo git -C "$BARE" rev-parse --symbolic-full-name HEAD)"
echo "裸仓库 main 最新提交: $(sudo git -C "$BARE" log --oneline -1 main 2>/dev/null || echo '无')"
echo "工作仓库 origin/main: $(git log --oneline -1 origin/main)"

echo ""
echo "=== 修复完成 ==="
echo "现在可以测试自动部署了。"
