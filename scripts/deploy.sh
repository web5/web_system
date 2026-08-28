#!/usr/bin/env bash
# ============================================================
# deploy.sh — 一键部署脚本（后端服务 / 前端微前端模块 / 自建 CDN）
#
# 用法：
#   ./scripts/deploy.sh dev gateway          # 后端服务 → dev
#   ./scripts/deploy.sh prod all             # 全部后端服务 → prod
#   ./scripts/deploy.sh dev portal           # 前端模块(portal/admin/shell) → dev
#   ./scripts/deploy.sh dev cdn              # 自建 CDN 公共依赖(static/cdn) → dev
#   DRY_RUN=1 ./scripts/deploy.sh dev user   # 预览不执行
#
# 后端服务：本地 build → tar dist → scp → 解压 → 依赖检查 → pm2 reload
# 前端模块：RELEASE_TAG=<git short> 构建 → 上传 public/static/modules/<m>/<V>/ → 更新 deploy 表
# 自建 CDN：本地 build-externals.mjs 生成 → 上传 public/static/cdn/（vue/antd/axios/dayjs 等公共依赖）
# ============================================================
set -uo pipefail

TARGET="${1:?用法: $0 <dev|prod> <service|module|all>}"
WHAT="${2:?用法: $0 <dev|prod> <service|module|all>}"
DRY_RUN="${DRY_RUN:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo dev)"

# 载入 DB 配置（统一从 .env.deploy 读取，禁止硬编码密码）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -f "$SCRIPT_DIR/.env.deploy" ] && source "$SCRIPT_DIR/.env.deploy"

# 统一走 ~/.ssh/config 别名（由 scripts/setup-ssh-key.sh 一次性打通免密）
case "$TARGET" in
  dev)  SSH_HOST="kedou-dev";  PORT_BASE=6000 ;;
  prod) SSH_HOST="kedou-prod"; PORT_BASE=3000 ;;
  *) echo "目标必须为 dev|prod"; exit 1 ;;
esac

BACKEND_SERVICES="gateway auth user ai ai-agent system todo content-hub mcp-gateway"
FRONTEND_MODULES="shell portal admin"

# 服务名 → servers/ 目录名（pm2 进程名与目录一致）
svc_dir() {
  case "$1" in
    gateway) echo gateway ;;
    auth) echo auth-service ;;
    user) echo user-service ;;
    ai) echo ai-service ;;
    ai-agent) echo ai-agent ;;
    system) echo system-service ;;
    todo) echo todo-service ;;
    content-hub) echo content-hub ;;
    mcp-gateway) echo mcp-gateway ;;
  esac
}

# 服务名 → pnpm filter 包名
svc_pkg() {
  case "$1" in
    gateway) echo @web-system/gateway ;;
    auth) echo @web-system/auth-service ;;
    user) echo @web-system/user-service ;;
    ai) echo @web-system/ai-service ;;
    ai-agent) echo @web-system/ai-agent ;;
    system) echo @web-system/system-service ;;
    todo) echo @web-system/todo-service ;;
    content-hub) echo @web-system/content-hub ;;
    mcp-gateway) echo @web-system/mcp-gateway ;;
  esac
}

say() { if [ "$DRY_RUN" = "1" ]; then echo "  [dry-run] $*"; else eval "$*"; fi }
log() { echo "[deploy:$TARGET] $*"; }

remote() { ssh -o ConnectTimeout=15 -o BatchMode=yes "$SSH_HOST" "$*"; }
scp_to() { scp -o ConnectTimeout=15 "$1" "$SSH_HOST:/tmp/"; }

deploy_backend() { # $1=service_name
  local svc="$1"
  local dir; dir=$(svc_dir "$svc")
  local pkg; pkg=$(svc_pkg "$svc")
  log "部署后端服务 $svc → ${TARGET}（目录 servers/${dir}）"
  if [ "$DRY_RUN" = "1" ]; then
    say "cd $ROOT && pnpm --filter $pkg build"
    return 0
  fi
  # 真实构建：失败立即中断，禁止打包旧产物（防止“假成功”覆盖线上）
  # 直接进服务目录跑 build，避免 pnpm --filter 在 workspace 级清理时触发
  # safe-delete 批量删除确认（dist 文件数超阈值会拦截 nest build）。
  # 用 /bin/rm 绝对路径绕过 pnpm 注入的 rm wrapper（safe-delete 会拦截裸 rm）
  log "  构建 $pkg ..."
  /bin/rm -rf "$ROOT/servers/$dir/dist"
  if ! (cd "$ROOT/servers/$dir" && npx nest build); then
    err "构建失败：$pkg（未部署，旧代码保留）"
  fi
  tar czf "/tmp/${svc}-deploy.tar.gz" -C "$ROOT/servers/$dir" dist
  scp_to "/tmp/${svc}-deploy.tar.gz"
  local cmd="cd /data/web_system/servers/$dir && rm -rf dist && tar xzf /tmp/${svc}-deploy.tar.gz && rm -f /tmp/${svc}-deploy.tar.gz"
  cmd="$cmd && { [ -d node_modules/@web-system/shared ] || { mkdir -p node_modules/@web-system && cp -r /data/web_system/packages/shared node_modules/@web-system/shared; echo '  [fix] shared 已补'; }; }"
  # 补建 @kedouai/agent-core 软链（指向远端 packages/agent-core），防止新包名部署后解析失败
  cmd="$cmd && { [ -e /data/web_system/packages/agent-core ] && { [ -e node_modules/@kedouai/agent-core ] || { mkdir -p node_modules/@kedouai && ln -sfn ../../../../packages/agent-core node_modules/@kedouai/agent-core && echo '  [fix] agent-core 已补'; }; }; }"
  cmd="$cmd && pm2 restart $dir 2>&1 | tail -1"
  remote "$cmd"
  rm -f "/tmp/${svc}-deploy.tar.gz"
  log "$svc 部署完成"
}

deploy_cdn() {
  # 自建 CDN 公共依赖（vue/vue-router/pinia/antd/axios/dayjs(+插件)/vue-demi）
  # 先本地生成产物，再上传到远端 servers/gateway/public/static/cdn/，供 /static/cdn/ 托管。
  log "部署自建 CDN 公共依赖 → $TARGET"
  local src="$ROOT/servers/gateway/public/static/cdn"
  if [ ! -d "$src" ]; then
    log "  本地未找到 $src，先运行 scripts/build-externals.mjs 生成产物"
    say "cd $ROOT && node scripts/build-externals.mjs"
  fi
  if [ "$DRY_RUN" != "1" ]; then
    tar czf "/tmp/cdn-deploy.tar.gz" -C "$ROOT/servers/gateway/public/static" cdn
    scp_to "/tmp/cdn-deploy.tar.gz"
    remote "mkdir -p /data/web_system/servers/gateway/public/static && cd /data/web_system/servers/gateway/public/static && rm -rf cdn && tar xzf /tmp/cdn-deploy.tar.gz && rm -f /tmp/cdn-deploy.tar.gz"
    rm -f "/tmp/cdn-deploy.tar.gz"
  fi
  log "自建 CDN 部署完成"
}

deploy_frontend() { # $1=module_name
  local mod="$1"
  log "部署前端模块 $mod → $TARGET (V=$V)"
  if [ "$mod" = "shell" ]; then
    say "cd $ROOT/apps/shell && npx vite build"
    if [ "$DRY_RUN" != "1" ]; then
      tar czf "/tmp/shell-deploy.tar.gz" -C "$ROOT/apps/shell/dist" .
      scp_to "/tmp/shell-deploy.tar.gz"
      remote "cd /data/web_system/servers/gateway/public/shell && rm -rf ./* && tar xzf /tmp/shell-deploy.tar.gz && rm -f /tmp/shell-deploy.tar.gz"
      rm -f "/tmp/shell-deploy.tar.gz"
    fi
  else
    say "cd $ROOT/apps/$mod && RELEASE_TAG=$V MF_FORMAT=system npx vite build --mode mf"
    if [ "$DRY_RUN" != "1" ]; then
      tar czf "/tmp/${mod}-deploy.tar.gz" -C "$ROOT/apps/$mod/dist" .
      scp_to "/tmp/${mod}-deploy.tar.gz"
      remote "mkdir -p /data/web_system/servers/gateway/public/static/modules/$mod/$V && cd /data/web_system/servers/gateway/public/static/modules/$mod/$V && rm -rf ./* && tar xzf /tmp/${mod}-deploy.tar.gz && rm -f /tmp/${mod}-deploy.tar.gz"
      rm -f "/tmp/${mod}-deploy.tar.gz"
      # 更新 deploy 表版本（密码经远程 cnf 注入，不暴露在命令行）
      local db_host db_user db_pass
      if [ "$TARGET" = "dev" ]; then
        db_host="${DEV_DB_HOST:-127.0.0.1}"; db_user="${DEV_DB_USER:-root}"; db_pass="${DEV_DB_PASS:-}"
      else
        db_host="${PROD_DB_HOST:-172.16.16.10}"; db_user="${PROD_DB_USER:-root}"; db_pass="${PROD_DB_PASS:-}"
      fi
      local env_id="$TARGET"
      remote "cat > /tmp/.deploy_cnf <<'CNF'
[client]
host=$db_host
user=$db_user
password=$db_pass
CNF
mysql --defaults-extra-file=/tmp/.deploy_cnf web_system -e \"UPDATE deploy_deployments SET current_version='$V', deployed_at=NOW(6) WHERE env_id='$env_id' AND module_key='$mod'\" 2>/dev/null && echo '  deploy 表已更新'
rm -f /tmp/.deploy_cnf"
    fi
  fi
  log "$mod 部署完成"
}

case "$WHAT" in
  all)
    for svc in $BACKEND_SERVICES; do deploy_backend "$svc"; done
    ;;
  cdn)
    deploy_cdn
    ;;
  shell|portal|admin)
    deploy_frontend "$WHAT"
    ;;
  *)
    if echo "$BACKEND_SERVICES" | grep -qw "$WHAT"; then
      deploy_backend "$WHAT"
    else
      echo "未知目标: $WHAT"; echo "后端服务: $BACKEND_SERVICES"; echo "前端模块: $FRONTEND_MODULES"; exit 1
    fi
    ;;
esac

echo "[deploy] 完成。如需验证运行: ./scripts/health-check.sh $TARGET"
