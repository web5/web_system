#!/bin/bash

# Web System 部署脚本
# 目标服务器：106.52.176.246

set -e

SERVER_HOST="106.52.176.246"
SERVER_USER="ubuntu"
DEPLOY_DIR="/home/ubuntu/web_system"

echo "🚀 开始部署 Web System..."

# 1. 构建项目
echo "📦 构建项目..."
cd "$(dirname "$0")"
pnpm install
pnpm build

# 2. 传输文件到服务器
echo "📤 传输文件到服务器..."
scp -r ./apps/portal/dist ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_DIR}/portal
scp -r ./apps/admin-web/dist ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_DIR}/admin-web
scp -r ./servers ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_DIR}/servers
scp -r ./packages ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_DIR}/packages
scp docker-compose.yml ${SERVER_USER}@${SERVER_HOST}:${DEPLOY_DIR}/

# 3. 在服务器上执行部署
echo "🔧 在服务器上执行部署..."
ssh ${SERVER_USER}@${SERVER_HOST} << 'EOF'
  cd /home/ubuntu/web_system
  
  # 安装依赖
  pnpm install --prod
  
  # 启动服务
  docker-compose up -d
  
  # 启动后端服务
  pm2 restart all || true
  pm2 start servers/gateway/dist/main.js --name gateway
  pm2 start servers/auth-service/dist/main.js --name auth-service
  pm2 start servers/user-service/dist/main.js --name user-service
EOF

echo "✅ 部署完成!"
echo "📱 访问地址:"
echo "   - 管理后台：http://106.52.176.246:3001"
echo "   - 教育门户：http://106.52.176.246:3003"
