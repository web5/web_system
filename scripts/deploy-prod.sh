#!/bin/bash
# ==========================================
# Web System - 生产环境一键部署脚本
# 目标服务器: 106.52.176.246 (root)
# ==========================================
set -e

echo "========================================="
echo "  Web System 生产环境部署"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================="

PROJECT_DIR="/root/web_system"

cd "$PROJECT_DIR"

# Step 1: 确保 Docker 运行
echo ""
echo "[1/5] 检查 Docker 状态..."
if ! systemctl is-active docker &>/dev/null; then
    echo "  启动 Docker..."
    systemctl start docker
    systemctl enable docker
fi
echo "  Docker: $(docker --version)"

# Step 2: 确保 docker-compose 可用
echo ""
echo "[2/5] 检查 docker-compose..."
if ! command -v docker-compose &>/dev/null; then
    echo "  安装 docker-compose..."
    curl -fsSL https://get.daocloud.io/docker/compose/releases/download/v2.24.0/docker-compose-linux-x86_64 \
        -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi
echo "  docker-compose: $(docker-compose --version)"

# Step 3: 停止旧服务（如果有）
echo ""
echo "[3/5] 停止旧容器..."
docker-compose -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true
docker-compose -f docker-compose.yml down --remove-orphans 2>/dev/null || true

# Step 4: 构建镜像
echo ""
echo "[4/5] 构建 Docker 镜像（可能需要几分钟）..."
docker-compose -f docker-compose.prod.yml build --no-cache

# Step 5: 启动服务
echo ""
echo "[5/5] 启动所有服务..."
docker-compose -f docker-compose.prod.yml up -d

echo ""
echo "========================================="
echo "  等待服务启动..."
echo "========================================="
sleep 5

# 健康检查
echo ""
echo "检查服务状态:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "测试端口连通性:"
for port in 3000 3001 3002 3003 6379; do
    if nc -z localhost $port 2>/dev/null; then
        echo "  ✅ Port $port - OK"
    else
        echo "  ⚠️  Port $port - 等待中..."
    fi
done

echo ""
echo "========================================="
echo "  🚀 部署完成！"
echo "  Gateway:   http://106.52.176.246:3000"
echo "  Swagger:   http://106.52.176.246:3000/docs"
echo "  Auth:      http://106.52.176.246:3001 (内部)"
echo "  User:      http://106.52.176.246:3002 (内部)"
echo "  AI:        http://106.52.176.246:3003 (内部)"
echo ""
echo "  ⚠️  小程序 API 地址: https://kedouai.com/api"
echo "  ⚠️  请确保 kedouai.com Nginx 配置:"
echo "     location /api {"
echo "         proxy_pass http://106.52.176.246:3000;"
echo "         proxy_set_header Host \$host;"
echo "     }"
echo "========================================="
echo ""
echo "查看日志: docker-compose -f docker-compose.prod.yml logs -f"
echo "查看状态: docker-compose -f docker-compose.prod.yml ps"
