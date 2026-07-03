#!/bin/bash
# ==========================================
# Web System 部署脚本
# 用法: ./deploy.sh
# ==========================================

set -e

# 加载 .env
if [ -f "$(dirname "$0")/scripts/.env" ]; then
    source "$(dirname "$0")/scripts/.env"
fi

SERVER_HOST="${DEPLOY_HOST:-ubuntu@106.52.176.246}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/ubuntu/web_system}"

echo "🚀 开始部署 Web System 到 ${SERVER_HOST}:${DEPLOY_DIR}..."

# 1. 构建项目
echo "📦 构建项目..."
cd "$(dirname "$0")"
pnpm install
pnpm build

# 2. 传输文件到服务器
echo "📤 传输文件到服务器..."
scp -r ./apps/portal/dist ${SERVER_HOST}:${DEPLOY_DIR}/portal
scp -r ./apps/admin-web/dist ${SERVER_HOST}:${DEPLOY_DIR}/admin-web
scp -r ./servers ${SERVER_HOST}:${DEPLOY_DIR}/
scp -r ./packages ${SERVER_HOST}:${DEPLOY_DIR}/
scp docker-compose.yml ${SERVER_HOST}:${DEPLOY_DIR}/
scp nginx-server.conf ${SERVER_HOST}:${DEPLOY_DIR}/

# 3. 在服务器上执行部署
echo "🔧 在服务器上执行部署..."
ssh ${SERVER_HOST} << 'EOF'
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

  # 应用 Nginx gzip 配置
  sudo cp /home/ubuntu/web_system/nginx-server.conf /etc/nginx/sites-enabled/kedouai-web.conf
  sudo nginx -t && sudo systemctl reload nginx
EOF

echo "✅ 部署完成!"
echo "📱 访问地址:"
echo "   - 管理后台：http://106.52.176.246:3001"
echo "   - 教育门户：http://106.52.176.246:3003"
