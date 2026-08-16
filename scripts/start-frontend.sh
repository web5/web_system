#!/bin/bash
# 启动所有前端（Vite dev server + Docs 静态服务）
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ">>> 停止旧前端进程..."
lsof -ti:5173 -ti:5174 -ti:4173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

echo ">>> 启动 portal (5173)..."
cd "$ROOT/apps/portal" && nohup pnpm dev > /tmp/portal.log 2>&1 &

echo ">>> 启动 admin (5174)..."
cd "$ROOT/apps/admin" && nohup pnpm dev > /tmp/admin.log 2>&1 &

echo ">>> 启动 docs (4173)..."
cd "$ROOT" && nohup npx serve docs -p 4173 --no-clipboard > /tmp/docs.log 2>&1 &

sleep 5
echo ">>> 验证..."
curl -s -o /dev/null -w "portal:    HTTP %{http_code}" http://localhost:5173 && echo " OK" || echo " FAIL"
curl -s -o /dev/null -w "admin:     HTTP %{http_code}" http://localhost:5174/admin/ && echo " OK" || echo " FAIL"
curl -s -o /dev/null -w "docs:      HTTP %{http_code}" http://localhost:4173 && echo " OK" || echo " FAIL"
echo ">>> 完成"
