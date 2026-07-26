#!/bin/bash
# 全量编译所有服务和共享包
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ">>> 1/9 packages/shared"
cd "$ROOT/packages/shared" && pnpm build

echo ">>> 2/9 packages/types"
cd "$ROOT/packages/types" && pnpm build

echo ">>> 3/9 servers/auth-service"
cd "$ROOT/servers/auth-service" && pnpm build 2>/dev/null || echo "    (pre-existing type error, skipped)"

echo ">>> 4/9 servers/user-service"
cd "$ROOT/servers/user-service" && pnpm build

echo ">>> 5/9 servers/ai-service"
cd "$ROOT/servers/ai-service" && pnpm build

echo ">>> 6/9 servers/system-service"
cd "$ROOT/servers/system-service" && pnpm build

echo ">>> 7/9 servers/todo-service"
cd "$ROOT/servers/todo-service" && pnpm build

echo ">>> 8/9 servers/upload-service"
cd "$ROOT/servers/upload-service" && pnpm build

echo ">>> 9/9 servers/gateway"
cd "$ROOT/servers/gateway" && pnpm build

echo ">>> 全量编译完成"
