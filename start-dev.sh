#!/bin/bash

# Web System 开发环境启动脚本

echo "=========================================="
echo "启动 Web System 开发环境"
echo "=========================================="

# 停止现有服务
echo "停止现有服务..."
lsof -ti:3000 -ti:3001 -ti:3002 -ti:5173 -ti:5174 -ti:4173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# 启动后端服务（后台运行）
echo ""
echo "启动后端服务..."
echo "----------------------------------------"

# 启动 auth-service
echo "[1/3] 启动 auth-service (端口 3001)..."
cd "$(dirname "$0")/servers/auth-service" && rushx dev &
AUTH_PID=$!

# 等待服务启动
sleep 2

# 启动 user-service
echo "[2/3] 启动 user-service (端口 3002)..."
cd "$(dirname "$0")/servers/user-service" && rushx dev &
USER_PID=$!

# 等待服务启动
sleep 2

# 启动 gateway
echo "[3/3] 启动 gateway (端口 3000)..."
cd "$(dirname "$0")/servers/gateway" && rushx dev &
GATEWAY_PID=$!

# 等待服务启动
sleep 3

# 启动前端（前台运行）
echo ""
echo "启动前端应用..."
echo "----------------------------------------"

# 启动 portal
echo "[4/6] 启动 portal (端口 5173)..."
cd "$(dirname "$0")/apps/portal" && rushx dev &
PORTAL_PID=$!

# 启动 admin-web
echo "[5/6] 启动 admin-web (端口 5174)..."
cd "$(dirname "$0")/apps/admin-web" && rushx dev &
ADMIN_PID=$!

# 启动 docs 静态服务器
echo "[6/6] 启动 docs (端口 4173)..."
cd "$(dirname "$0")" && npx serve docs -p 4173 --no-clipboard &
DOCS_PID=$!

echo ""
echo "=========================================="
echo "所有服务已启动!"
echo "=========================================="
echo "  教育门户:   http://localhost:5173"
echo "  管理后台:   http://localhost:5174"
echo "  项目文档:   http://localhost:4173"
echo "  API 网关:   http://localhost:3000"
echo "  认证服务:   http://localhost:3001"
echo "  用户服务:   http://localhost:3002"
echo "=========================================="
echo ""
echo "按 Ctrl+C 停止所有服务"
echo ""

# 等待中断信号
wait
