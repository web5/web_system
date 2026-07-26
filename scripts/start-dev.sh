#!/bin/bash
# Web System 全栈开发环境一键启动（后端 pnpm dev + 前端 pnpm dev）
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=========================================="
echo "启动 Web System 开发环境"
echo "=========================================="

# 停止现有服务
echo ">>> 停止现有服务..."
lsof -ti:3000 -ti:3001 -ti:3002 -ti:3003 -ti:3004 -ti:3005 \
     -ti:5173 -ti:5174 -ti:4173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# ====== 后端 ======
echo ""
echo ">>> 启动后端服务..."

for svc in auth-service user-service ai-service system-service todo-service; do
  echo "    $svc ..."
  cd "$ROOT/servers/$svc" && nohup pnpm dev > "/tmp/${svc}.log" 2>&1 &
  sleep 2
done

# gateway 最后启动（依赖其他服务就绪）
echo "    gateway ..."
cd "$ROOT/servers/gateway" && nohup pnpm dev > /tmp/gateway.log 2>&1 &
sleep 3

# ====== 前端 ======
echo ""
echo ">>> 启动前端..."

echo "    portal (5173)..."
cd "$ROOT/apps/portal" && nohup pnpm dev > /tmp/portal.log 2>&1 &

echo "    admin-web (5174)..."
cd "$ROOT/apps/admin-web" && nohup pnpm dev > /tmp/admin.log 2>&1 &

echo "    docs (4173)..."
cd "$ROOT" && nohup npx serve docs -p 4173 --no-clipboard > /tmp/docs.log 2>&1 &

sleep 6

echo ""
echo "=========================================="
echo "所有服务已启动!"
echo "=========================================="
echo "  Portal:    http://localhost:5173"
echo "  Admin:     http://localhost:5174/admin/"
echo "  Docs:      http://localhost:4173"
echo "  Gateway:   http://localhost:3000"
echo "  Auth:      http://localhost:3001"
echo "  User:      http://localhost:3002"
echo "  AI:        http://localhost:3003"
echo "  System:    http://localhost:3004"
echo "  Todo:      http://localhost:3005"
echo "=========================================="
