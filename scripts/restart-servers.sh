#!/bin/bash
# 重启 gateway 和 ai-service（加载新编译配置）
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ">>> 停止旧进程..."
kill $(lsof -t -i :3000) $(lsof -t -i :3003) 2>/dev/null || true
sleep 2

echo ">>> 启动 gateway (3000)..."
cd "$ROOT/servers/gateway"
nohup node dist/main > /tmp/gateway.log 2>&1 &

echo ">>> 启动 ai-service (3003)..."
cd "$ROOT/servers/ai-service"
nohup node dist/main > /tmp/ai.log 2>&1 &

sleep 4

echo ">>> 验证..."
curl -s -o /dev/null -w "gateway: HTTP %{http_code}" http://localhost:3000/health 2>/dev/null && echo " OK" || echo " FAIL"
curl -s -o /dev/null -w "ai-service: HTTP %{http_code}" http://localhost:3003/ai/models 2>/dev/null && echo " OK" || echo " FAIL"

echo ">>> 完成"
