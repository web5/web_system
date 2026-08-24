#!/usr/bin/env bash
# ============================================================
# deploy.sh — 一键部署脚本（后端服务 / 前端微前端模块）
#
# 用法：
#   ./scripts/deploy.sh dev gateway          # 后端服务 → dev
#   ./scripts/deploy.sh prod all             # 全部后端服务 → prod
#   ./scripts/deploy.sh dev portal           # 前端模块(portal/admin/shell) → dev
#   DRY_RUN=1 ./scripts/deploy.sh dev user   # 预览不执行
#
# 后端服务：本地 build → tar dist → scp → 解压 → 依赖检查 → pm2 reload
# 前端模块：RELEASE_TAG=<git short> 构建 → 上传 public/static/modules/<m>/<V>/ → 更新 deploy 表
# ============================================================
set -uo pipefail

TARGET="${1:?用法: $0 <dev|prod> <service|module|all>}"
WHAT="${2:?用法: $0 <dev|prod> <service|module|all>}"
DRY_RUN="${DRY_RUN:-0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo dev)"

case "$TARGET" in
  dev)  SSH_HOST="ubuntu@175.27.189.123"; PORT_BASE=6000 ;;
  prod) SSH_HOST="root@106.52.176.246";     PORT_BASE=3000 ;;
  *) echo "目标必须为 dev|prod"; exit 1 ;;
esac

BACKEND_SERVICES="gateway auth user ai system todo content-hub mcp-gateway"
FRONTEND_MODULES="shell portal admin"

# 服务名 → servers/ 目录名（pm2 进程名与目录一致）
svc_dir() {
  case "$1" in
    gateway) echo gateway ;;
    auth) echo auth-service ;;
    user) echo user-service ;;
    ai) echo ai-service ;;
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
  say "cd $ROOT && pnpm --filter $pkg build"
  if [ "$DRY_RUN" != "1" ]; then
    tar czf "/tmp/${svc}-deploy.tar.gz" -C "$ROOT/servers/$dir" dist
    scp_to "/tmp/${svc}-deploy.tar.gz"
    local cmd="cd /data/web_system/servers/$dir && rm -rf dist && tar xzf /tmp/${svc}-deploy.tar.gz && rm -f /tmp/${svc}-deploy.tar.gz"
    cmd="$cmd && { [ -d node_modules/@web-system/shared ] || { mkdir -p node_modules/@web-system && cp -r /data/web_system/packages/shared node_modules/@web-system/shared; echo '  [fix] shared 已补'; }; }"
    cmd="$cmd && pm2 restart $svc 2>&1 | tail -1"
    remote "$cmd"
    rm -f "/tmp/${svc}-deploy.tar.gz"
  fi
  log "$svc 部署完成"
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
      # 更新 deploy 表版本（需要目标库）
      if [ "$TARGET" = "dev" ]; then
        remote "mysql -h127.0.0.1 -uroot -pweb_system_root_2026 web_system -e \"UPDATE deploy_deployments SET current_version='$V', deployed_at=NOW(6) WHERE env_id='dev' AND module_key='$mod'\" 2>/dev/null && echo '  deploy 表已更新'"
      else
        remote "mysql -h172.16.16.10 -uroot -p'gn%!CTvZNP0e4%Lc' web_system -e \"UPDATE deploy_deployments SET current_version='$V', deployed_at=NOW(6) WHERE env_id='prod' AND module_key='$mod'\" 2>/dev/null && echo '  deploy 表已更新'"
      fi
    fi
  fi
  log "$mod 部署完成"
}

case "$WHAT" in
  all)
    for svc in $BACKEND_SERVICES; do deploy_backend "$svc"; done
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
