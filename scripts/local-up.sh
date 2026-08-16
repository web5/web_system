#!/usr/bin/env bash
# Web System 本地改造版一键启动（pm2 + 构建产物 dist，网关 6000 / 各服务 6001-6008）
#
# 用法:
#   ./scripts/local-up.sh              # 构建共享包+全部后端 → pm2 启动/重启 → 健康检查
#   ./scripts/local-up.sh --no-build   # 跳过构建，仅 pm2 启动/重启（改 .env 后用这个最快）
#   ./scripts/local-up.sh --front      # 额外启动前端 portal(5173)/admin(5174)（vite dev）
#   ./scripts/local-up.sh --seed       # 重置 admin 登录密码为 admin123（bcrypt 写入 users 表）
#
# 前置:
#   - 本地 MySQL(3306,库 web_system) 与 Redis(6379) 已在跑（可用 ./scripts/local-db.sh 拉起）
#   - 根目录已 pnpm install（脚本会检测，缺则自动跑一次）
#
# 说明:
#   - 后端经 pm2 跑 servers/*/dist/main.js（进程清单见 ecosystem.config.cjs，10 个 web-* 服务）。
#   - dev 库 synchronize:true，服务启动时自动对齐表结构（snake_case + created_at/updated_at/deleted_at）。
#   - 登录端点: POST http://127.0.0.1:6000/api/auth/login   (admin / admin123)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DO_BUILD=true; DO_FRONT=false; DO_SEED=false
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=false ;;
    --front)    DO_FRONT=true ;;
    --seed)     DO_SEED=true ;;
    *) echo "未知参数: $arg"; exit 2 ;;
  esac
done

g(){ printf "\033[32m%s\033[0m\n" "$1"; }
y(){ printf "\033[33m%s\033[0m\n" "$1"; }
r(){ printf "\033[31m%s\033[0m\n" "$1"; }

# 构建顺序：先共享包（被服务依赖），再后端服务
PACKAGES=(shared types mcp-core)
SERVICES=(gateway auth-service user-service ai-service system-service todo-service mcp-gateway finnews upload-service deploy-console)

# ---------- 0. 依赖 ----------
if [ ! -d "$ROOT/servers/auth-service/node_modules" ]; then
  y ">>> 未检测到 node_modules，先 pnpm install ..."
  (cd "$ROOT" && pnpm install)
fi

# ---------- 1. 构建 ----------
if $DO_BUILD; then
  y ">>> 构建共享包: ${PACKAGES[*]}"
  for p in "${PACKAGES[@]}"; do
    echo "    packages/$p"
    (cd "$ROOT/packages/$p" && pnpm build)
  done
  y ">>> 构建后端服务: ${#SERVICES[@]} 个"
  for s in "${SERVICES[@]}"; do
    echo "    servers/$s"
    (cd "$ROOT/servers/$s" && pnpm build)
    if [ ! -f "$ROOT/servers/$s/dist/main.js" ]; then
      r "    $s 构建失败（未生成 dist/main.js）"; exit 1
    fi
  done
fi

# ---------- 2. pm2 启动/重启（幂等，拾取最新 dist） ----------
y ">>> pm2 启动/重启 web-* 服务 ..."
(cd "$ROOT" && pm2 startOrRestart ecosystem.config.cjs)

# ---------- 3. 可选：重置 admin 密码 ----------
if $DO_SEED; then
  y ">>> 重置 admin 密码为 admin123 ..."
  node "$ROOT/scripts/seed-admin.mjs" || r "    seed 失败（请确认 MySQL 连接）"
fi

# ---------- 4. 可选：前端 ----------
if $DO_FRONT; then
  y ">>> 启动前端 portal(5173) / admin(5174) ..."
  (cd "$ROOT/apps/portal"    && nohup pnpm dev > /tmp/portal.log    2>&1 &)
  (cd "$ROOT/apps/admin" && nohup pnpm dev > /tmp/admin.log 2>&1 &)
fi

# ---------- 5. 健康检查 ----------
y ">>> 等待服务就绪 ..."
sleep 6
pm2 status | grep -E "web-|errored" || true
echo
y ">>> 登录自检  POST http://127.0.0.1:6000/api/auth/login ..."
if curl -s -X POST http://127.0.0.1:6000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}' | grep -q accessToken; then
  g "    登录 OK（返回 accessToken）"
else
  r "    登录自检未返回 accessToken；可执行 ./scripts/local-up.sh --seed 重置 admin 密码"
fi

echo
g "完成。网关 http://localhost:6000  | portal http://localhost:5173  | admin http://localhost:5174/admin/"
