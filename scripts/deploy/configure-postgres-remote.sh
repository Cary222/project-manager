#!/bin/bash
# PostgreSQL 远程访问配置脚本
# 用于配置 PostgreSQL 允许远程连接

PG_HBA="/etc/postgresql/14/main/pg_hba.conf"
PG_CONF="/etc/postgresql/14/main/postgresql.conf"

echo "=== PostgreSQL 远程访问配置 ==="

# 1. 检查并修改 pg_hba.conf
echo ""
echo "1. 检查 pg_hba.conf 远程访问规则..."

# 备份
sudo cp "$PG_HBA" "${PG_HBA}.bak.$(date +%Y%m%d%H%M%S)"

# 检查是否已有 IPv4 远程访问规则
if ! grep -q "^host\s*all\s*all\s*0\.0\.0\.0/0" "$PG_HBA"; then
    echo "添加远程访问规则到 pg_hba.conf..."
    # 添加允许所有 IPv4 远程连接的规则（scram-sha-256 认证）
    echo "# 允许远程 IPv4 连接" | sudo tee -a "$PG_HBA"
    echo "host    all     all     0.0.0.0/0               scram-sha-256" | sudo tee -a "$PG_HBA"
    echo "host    all     all     ::0/0                   scram-sha-256" | sudo tee -a "$PG_HBA"
else
    echo "远程访问规则已存在，跳过"
fi

# 2. 确保 postgresql.conf 监听所有地址
echo ""
echo "2. 检查 postgresql.conf 监听配置..."
if grep -q "^listen_addresses\s*=" "$PG_CONF"; then
    CURRENT=$(grep "^listen_addresses\s*=" "$PG_CONF")
    echo "当前配置: $CURRENT"
    if ! echo "$CURRENT" | grep -q "'*'"; then
        echo "修改为 listen_addresses = '*'..."
        sudo sed -i "s/^listen_addresses\s*=.*/listen_addresses = '*'/" "$PG_CONF"
    fi
else
    echo "添加 listen_addresses = '*'..."
    echo "listen_addresses = '*'" | sudo tee -a "$PG_CONF"
fi

# 3. 重启 PostgreSQL
echo ""
echo "3. 重启 PostgreSQL..."
sudo pg_ctlcluster 14 main restart

echo ""
echo "=== 配置完成 ==="
echo ""
echo "现在可以从其他机器连接:"
echo "  psql -h <服务器IP> -p 5432 -U postgres -d community"
echo ""
echo "项目连接字符串示例:"
echo "  postgresql://community:community@<服务器IP>:5432/community?schema=pm"
