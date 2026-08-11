#!/bin/bash
# Web System 本地全栈一键启动（无 brew / 无 sudo，依赖 ~/local 下的 MySQL+Redis）
#
# 用法:
#   ./scripts/start-local.sh            # 启动整套（DB + 后端 + 前端）
#   ./scripts/start-local.sh --seed     # 额外初始化种子用户（admin / test）
#
# 前置:
#   - 已通过 scripts/local-db.sh 准备好 ~/local 下的 MySQL 与 Redis
#   - 根目录已 pnpm install（首次会自动跑）
#
# 说明:
#   本脚本只负责「启动」已有进程；如需重新初始化数据库，请手动处理 ~/local/mysql-data
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEED=false
for arg in "$@"; do
  [ "$arg" = "--seed" ] && SEED=true
done

# 颜色
green() { echo -e "\033[32m$1\033[0m"; }
yellow() { echo -e "\033[33m$1\033[0m"; }
red() { echo -e "\033[31m$1\033[0m"; }

echo "=========================================="
echo " Web System 本地环境一键启动"
echo "=========================================="

# ---------- 0. 依赖与共享包 ----------
if [ ! -d "$ROOT/node_modules" ] && [ ! -d "$ROOT/servers/auth-service/node_modules" ]; then
  yellow ">>> 未检测到 node_modules，先执行 pnpm install ..."
  (cd "$ROOT" && pnpm install)
fi

yellow ">>> 构建共享包 shared / types ..."
(cd "$ROOT/packages/shared" && pnpm build >/dev/null 2>&1 || true)
(cd "$ROOT/packages/types" && pnpm build >/dev/null 2>&1 || true)

# ---------- 1. 启动 MySQL + Redis ----------
yellow ">>> 启动本地 MySQL + Redis ..."
bash "$ROOT/scripts/local-db.sh"

# ---------- 2. 停掉旧进程 ----------
yellow ">>> 停止旧进程 ..."
lsof -ti:3000 -ti:3001 -ti:3002 -ti:3003 -ti:3004 -ti:3005 \
     -ti:5173 -ti:5174 -ti:4173 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# ---------- 3. 启动后端 ----------
# 注意: 不同服务脚本名不同（auth 用 dev, ai 用 start:dev），需分别处理
start_backend() {
  local svc="$1"
  local script="$2"
  echo "    $svc ($script) ..."
  (cd "$ROOT/servers/$svc" && nohup pnpm "$script" > "/tmp/${svc}.log" 2>&1 &)
  sleep 2
}

echo ""
yellow ">>> 启动后端服务 ..."
start_backend auth-service dev
start_backend user-service dev
start_backend ai-service start:dev
start_backend system-service dev
start_backend todo-service dev
# gateway 最后启动（依赖其他服务就绪）
start_backend gateway dev
sleep 3

# ---------- 4. 启动前端 ----------
echo ""
yellow ">>> 启动前端 ..."
echo "    portal (5173)..."
(cd "$ROOT/apps/portal" && nohup pnpm dev > /tmp/portal.log 2>&1 &)
echo "    admin-web (5174)..."
(cd "$ROOT/apps/admin-web" && nohup pnpm dev > /tmp/admin.log 2>&1 &)
echo "    docs (4173)..."
(cd "$ROOT" && nohup npx serve docs -p 4173 --no-clipboard > /tmp/docs.log 2>&1 &)
sleep 6

# ---------- 5. 可选: 种子用户 ----------
if [ "$SEED" = true ]; then
  echo ""
  yellow ">>> 初始化种子用户 (admin / test) ..."
  if [ -z "$ADMIN_INIT_PASSWORD" ]; then
    red "    [警告] 未设置 ADMIN_INIT_PASSWORD，将使用内置默认密码 admin123"
    export ADMIN_INIT_PASSWORD="admin123"
  fi
  (cd "$ROOT/servers/auth-service" && pnpm seed) || \
    red "    种子脚本执行失败，请检查 auth-service/.env 与数据库连接"
fi

# ---------- 6. 完成 ----------
echo ""
green "=========================================="
green " 启动完成!"
green "=========================================="
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
echo " 日志: /tmp/<服务名>.log"
echo " 重新初始化种子用户: ./scripts/start-local.sh --seed"
echo "=========================================="
