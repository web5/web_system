#!/bin/bash
# ===========================================================
# 微前端平台端到端本地验证启动脚本
#
# 流程:
#   1. 构建 externals（vue/router/pinia/antd/axios/dayjs → public/static/externals/）
#   2. 构建基座 shell（→ public/shell/）
#   3. 构建微前端模块 portal/admin（→ public/static/modules/<key>/<version>/）
#   4. seed DB（deploy_modules + deploy_deployments dev 指针）
#   5. 启动 gateway:6000（前台运行，Ctrl+C 退出）
#
# 前置: MySQL 本机 127.0.0.1:3306，root/KedouLocal@2026，库 web_system_deploy 已存在
#
# 用法: bash scripts/dev-e2e-start.sh
# 验证: 浏览器访问 http://localhost:6000/ → 基座加载 → 进 /portal → loader 挂载 portal 模块
# ===========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

COMMIT=$(git rev-parse --short HEAD)
log "git commit = $COMMIT"

# ---------- 1. externals ----------
log "===== 1. 构建公共依赖 externals ====="
node scripts/build-externals.mjs

# ---------- 2. 基座 shell ----------
log "===== 2. 构建基座 shell ====="
cd apps/shell
npx vite build || err "shell 构建失败"
log "同步 shell 产物到 gateway public/shell/"
rm -rf "$SCRIPT_DIR/servers/gateway/public/shell"
cp -r dist "$SCRIPT_DIR/servers/gateway/public/shell"
cd "$SCRIPT_DIR"

# ---------- 3. 微前端模块 ----------
log "===== 3. 构建微前端模块 (portal / admin) ====="
for MOD in portal admin; do
  log "构建 $MOD..."
  node scripts/build-module.mjs "$MOD" --branch master >/dev/null 2>&1 || err "$MOD 构建失败"
  # 复制到 gateway public/static/modules/<key>/<version>/
  DEST="$SCRIPT_DIR/servers/gateway/public/static/modules/$MOD/$COMMIT"
  mkdir -p "$DEST"
  rm -rf "$DEST"/*
  cp -r "apps/$MOD/dist"/* "$DEST/"
  log "  $MOD → public/static/modules/$MOD/$COMMIT/"
done

# ---------- 4. seed DB ----------
log "===== 4. seed DB（deploy_modules + deploy_deployments）====="

# 4.1 先确保 deploy-console 已编译（synchronize=true 会自动建表）
if [ ! -f "servers/deploy-console/dist/main.js" ]; then
  log "编译 deploy-console..."
  (cd servers/deploy-console && npx tsc -p tsconfig.json) 2>&1 | tail -3
fi

# 4.2 后台启动 deploy-console 让 TypeORM synchronize 建表，输出到日志文件，5s 后用 lsof 杀进程
log "后台启动 deploy-console 建表（5s）..."
LOG_FILE="/tmp/deploy-console-init.log"
nohup node servers/deploy-console/dist/main.js > "$LOG_FILE" 2>&1 &
DC_PID=$!
sleep 5
# lsof 杀 6200 端口（子 shell 退出后 PID 失效；端口最准）
if lsof -ti :6200 >/dev/null 2>&1; then
  lsof -ti :6200 | xargs kill -9 2>/dev/null || true
  wait $DC_PID 2>/dev/null || true
  log "deploy-console 建表完成，已停止（6200 端口释放）"
else
  warn "deploy-console 6200 端口已不在（可能启动失败或极快退出）"
fi
[ -f "$LOG_FILE" ] && tail -3 "$LOG_FILE"

# 4.3 跑 seed
node scripts/seed-dev-deployment.mjs

# ---------- 5. 启动 gateway ----------
log "===== 5. 启动 gateway:6000 ====="
log "前置检查：确认 6000 端口未被占用"
if lsof -ti :6000 >/dev/null 2>&1; then
  warn "6000 端口被占用，旧进程 PID=$(lsof -ti :6000)。是否 kill？(y/N)"
  read -r ANS
  if [ "$ANS" = "y" ]; then lsof -ti :6000 | xargs kill -9 2>/dev/null || true; else err "请先释放 6000 端口"; fi
fi

log "启动 gateway（前台运行，Ctrl+C 退出）..."
log "验证步骤："
log "  0. 先 reload nginx 让 8090 生效：sudo /Users/geekwen/local/nginx/sbin/nginx -s reload"
log "  1. 浏览器访问 https://local.kedouai.com:8090/   → 应见基座布局 + 登录页"
log "     （nginx 8090 配了 SSL，避开 Chrome 屏蔽 6000 端口；自签证书点「继续前往」）"
log "  2. 登录后点「门户」菜单                       → loader 加载 /static/modules/portal/$COMMIT/index.js"
log "  3. F12 控制台 window.__MODULES_MANIFEST__     → 应见 portal/admin 三个模块清单"
log "  4. F12 控制台 window.__LOADER__.debug()       → mounted 应含 ['portal']"
log ""
log "[提示] Chrome 默认屏蔽 6000 端口。gateway 跑 6000，由 nginx 8090(SSL) 反代访问。"
log "       若不想用 nginx，可 PORT=8080 bash scripts/dev-e2e-start.sh 直接访问 8080。"
cd "$SCRIPT_DIR/servers/gateway"
DEPLOY_ENV_ID=dev node dist/main.js
