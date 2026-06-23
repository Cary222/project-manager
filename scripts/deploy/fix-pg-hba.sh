#!/bin/bash
# 修复 pg_hba.conf 并启用远程访问

# 备份原有配置
sudo cp /etc/postgresql/14/main/pg_hba.conf /etc/postgresql/14/main/pg_hba.conf.bak

# 创建正确的配置（保留原有规则 + 添加远程访问）
sudo tee /etc/postgresql/14/main/pg_hba.conf > /dev/null << 'EOF'
# PostgreSQL Client Authentication Configuration File
local   all             postgres                                peer
local   all             all                                     peer
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
local   replication     all                                     peer
host    replication     all             127.0.0.1/32            scram-sha-256
host    replication     all             ::1/128                 scram-sha-256
host    community       community       192.168.1.0/24          scram-sha-256
host    all             all             0.0.0.0/0                scram-sha-256
host    all             all             ::0/0                   scram-sha-256
EOF

echo "pg_hba.conf 已修复"
echo ""
echo "重启 PostgreSQL..."
sudo pg_ctlcluster 14 main restart

echo ""
echo "检查状态..."
sudo pg_ctlcluster 14 main status
