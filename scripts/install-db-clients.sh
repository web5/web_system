#!/bin/bash

# ==========================================
# 数据库客户端安装脚本
# 安装：PostgreSQL 客户端、MySQL 客户端、Redis 客户端
# ==========================================

set -e  # 遇到错误立即退出

echo "=========================================="
echo "开始安装数据库客户端工具"
echo "=========================================="
echo ""

# 1. 清理 Homebrew 缓存锁文件
echo "【1/4】清理 Homebrew 缓存锁文件..."
rm -f ~/Library/Caches/Homebrew/downloads/*.incomplete
echo "✅ 清理完成"
echo ""

# 2. 更新 Homebrew
echo "【2/4】更新 Homebrew..."
brew update
echo "✅ 更新完成"
echo ""

# 3. 安装 PostgreSQL 客户端（包含 psql）
echo "【3/4】安装 PostgreSQL 15 客户端..."
brew install postgresql@15
echo "✅ PostgreSQL 客户端安装完成"
echo ""

# 4. 安装 MySQL 客户端（不包含服务器）
echo "【4/4】安装 MySQL 客户端..."
brew install mysql-client
echo "✅ MySQL 客户端安装完成"
echo ""

# 5. 安装 Redis 客户端（包含 redis-cli）
echo "【5/5】安装 Redis 客户端..."
brew install redis
echo "✅ Redis 客户端安装完成"
echo ""

# 6. 配置环境变量
echo "=========================================="
echo "配置环境变量..."
echo "=========================================="
echo ""

# PostgreSQL 客户端路径
if [ -d "/opt/homebrew/opt/postgresql@15/bin" ]; then
    echo 'export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"' >> ~/.zshrc
    echo "✅ 已添加 PostgreSQL 到 PATH"
fi

# MySQL 客户端路径
if [ -d "/opt/homebrew/opt/mysql-client/bin" ]; then
    echo 'export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"' >> ~/.zshrc
    echo "✅ 已添加 MySQL 客户端到 PATH"
fi

echo ""
echo "=========================================="
echo "✅ 安装完成！"
echo "=========================================="
echo ""
echo "已安装的工具："
echo "  - psql (PostgreSQL 客户端)"
echo "  - mysql (MySQL 客户端)"
echo "  - redis-cli (Redis 客户端)"
echo ""
echo "请执行以下命令使环境变量生效："
echo "  source ~/.zshrc"
echo ""
echo "或者重启终端。"
echo ""
