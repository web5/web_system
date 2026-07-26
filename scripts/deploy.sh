#!/bin/bash
# ===========================================================
# Web System - 一键部署脚本
# 本地执行，自动构建 + 同步 + 重启远程服务
#
# 用法:
#   ./scripts/deploy.sh                    # 部署 dev 全部
#   ./scripts/deploy.sh prod               # 部署 prod 全部
#   ./scripts/deploy.sh dev portal         # 只部署 portal 前端到 dev
#   ./scripts/deploy.sh prod admin         # 只部署 admin-web 到 prod
#   ./scripts/deploy.sh dev system         # 只部署 system-service 到 dev
#   ./scripts/deploy.sh dev seed           # 只执行变变素材种子初始化
# ===========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_ENV="${1:-dev}"
COMPONENT="${2:-all}"

# 加载环境配置
ENV_FILE="$SCRIPT_DIR/scripts/.env.deploy"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m 未找到配置文件 $ENV_FILE"
  echo "请复制 .env.deploy.example 为 .env.deploy 并填入服务器信息"
  exit 1
fi
source "$ENV_FILE"

# 根据环境选择服务器
case "$DEPLOY_ENV" in
  dev)
    SERVER="$DEV_SERVER"
    REMOTE_DIR="$DEV_REMOTE_DIR"
    PUBLIC_URL="$DEV_PUBLIC_URL"
    ;;
  prod)
    SERVER="$PROD_SERVER"
    REMOTE_DIR="$PROD_REMOTE_DIR"
    PUBLIC_URL="$PROD_PUBLIC_URL"
    ;;
  *)
    echo "未知环境: $DEPLOY_ENV (支持: dev, prod)"
    exit 1
    ;;
esac

if [ -z "$SERVER" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m $DEPLOY_ENV 环境的 SERVER 未配置，请检查 .env.deploy"
  exit 1
fi

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} [$DEPLOY_ENV] $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} [$DEPLOY_ENV] $1"; }
err()   { echo -e "${RED}[ERROR]${NC} [$DEPLOY_ENV] $1"; exit 1; }

# 测试 SSH 连接
check_ssh() {
  log "检查 SSH 连接 ($SERVER)..."
  ssh -o ConnectTimeout=5 -o BatchMode=yes "$SERVER" "echo ok" 2>/dev/null || err "SSH 连接失败: $SERVER"
  log "SSH 连接正常"
}

# ===========================================================
# 构建 & 同步 Portal 前端
# ===========================================================
deploy_portal() {
  log "===== 部署 Portal 前端 ====="

  cd "$SCRIPT_DIR/apps/portal"

  log "构建 portal..."
  npx vite build 2>&1 || err "Portal 构建失败"
  log "Portal 构建完成"

  log "同步到远程服务器（保留已有 admin/ 等目录）..."
  # 先清理旧 portal 文件，但不删 admin/ 等子目录
  ssh "$SERVER" "cd $REMOTE_DIR/servers/gateway/public && find . -maxdepth 1 -not -name '.' -not -name 'admin' -exec rm -rf {} + 2>/dev/null; true"
  tar czf - dist | ssh "$SERVER" "cd $REMOTE_DIR/servers/gateway && tar xzf - && cp -r dist/* public/ && rm -rf dist"
  log "Portal 同步完成"

  deploy_gateway_restart
}

# ===========================================================
# 构建 & 同步 Admin 管理后台前端
# ===========================================================
deploy_admin() {
  log "===== 部署 Admin 管理后台 ====="

  cd "$SCRIPT_DIR/apps/admin-web"

  log "构建 admin-web..."
  npx vite build 2>&1 || err "admin-web 构建失败"
  log "admin-web 构建完成"

  log "同步到远程服务器（public/admin/）..."
  ssh "$SERVER" "mkdir -p $REMOTE_DIR/servers/gateway/public/admin"
  tar czf - dist | ssh "$SERVER" "cd $REMOTE_DIR/servers/gateway/public/admin && rm -rf ./* && tar xzf - --strip-components=1"
  log "Admin 同步完成"

  deploy_gateway_restart
}

# ===========================================================
# 构建 & 同步 auth-service
# ===========================================================
deploy_auth() {
  log "===== 部署 auth-service ====="

  cd "$SCRIPT_DIR/servers/auth-service"

  log "构建 auth-service..."
  npx nest build 2>&1 || err "auth-service 构建失败"
  log "auth-service 构建完成"

  log "同步 dist + 源码到远程..."
  tar czf - dist src package.json | ssh "$SERVER" "cd $REMOTE_DIR && tar xzf -"
  log "auth-service 同步完成"

  log "重启 auth-service..."
  ssh "$SERVER" "cd $REMOTE_DIR && pm2 restart auth-service 2>/dev/null || pm2 start servers/auth-service/dist/main.js --name auth-service"
  log "auth-service 重启完成"
}

# ===========================================================
# 构建 & 同步 system-service
# ===========================================================
deploy_system() {
  log "===== 部署 system-service ====="

  cd "$SCRIPT_DIR/servers/system-service"

  log "构建 system-service..."
  npx nest build 2>&1 || err "system-service 构建失败"
  log "system-service 构建完成"

  log "同步 dist + 源码到远程..."
  tar czf - dist src package.json | ssh "$SERVER" "cd $REMOTE_DIR && tar xzf -"
  log "system-service 同步完成"

  log "重启 system-service..."
  ssh "$SERVER" "cd $REMOTE_DIR && pm2 restart system-service 2>/dev/null || pm2 start servers/system-service/dist/main.js --name system-service"
  log "system-service 重启完成"
}

# ===========================================================
# 构建 & 同步 gateway
# ===========================================================
deploy_gateway() {
  log "===== 部署 Gateway ====="

  cd "$SCRIPT_DIR/servers/gateway"

  log "构建 gateway..."
  npx nest build 2>&1 || err "gateway 构建失败"
  log "gateway 构建完成"

  log "同步 dist 到远程..."
  tar czf - dist | ssh "$SERVER" "cd $REMOTE_DIR && tar xzf -"
  log "gateway 同步完成"

  deploy_gateway_restart
}

deploy_gateway_restart() {
  log "重启 gateway..."
  ssh "$SERVER" "cd $REMOTE_DIR && pm2 restart gateway 2>/dev/null || pm2 start servers/gateway/dist/main.js --name gateway"
  log "gateway 重启完成"
}

# ===========================================================
# 同步 ecosystem 配置
# ===========================================================
deploy_config() {
  log "===== 同步配置文件 ====="
  scp "$SCRIPT_DIR/ecosystem.config.js" "$SERVER:$REMOTE_DIR/ecosystem.config.js"
  log "ecosystem.config.js 已同步"
}

# ===========================================================
# 变变素材种子初始化（force 模式，覆盖为 SVG）
# ===========================================================
seed_bianbian() {
  log "===== 初始化变变素材库（替换为 SVG 图标） ====="

  # 通过 gateway 调用 seed API（force 模式：删除旧素材重建）
  local api_url="${PUBLIC_URL}/api/admin/bianbian/seed?force=1"
  log "调用 seed API: $api_url"

  local result
  result=$(curl -s -o /dev/null -w '%{http_code}' -X POST --max-time 10 "$api_url" 2>/dev/null || echo "000")
  if [ "$result" = "000" ]; then
    warn "API 调用失败（网络或端口），通过 SSH 直接调用..."
    ssh "$SERVER" "curl -s -X POST 'http://127.0.0.1:3004/admin/bianbian/seed?force=1'" || warn "seed 调用失败，请登录管理后台手动操作"
  else
    log "seed API 响应: $result"
    if [ "$result" = "200" ] || [ "$result" = "201" ]; then
      log "素材库初始化成功！"
    else
      warn "seed API 返回 $result，可能需要登录管理后台手动操作"
    fi
  fi
}

# ===========================================================
# 全量部署
# ===========================================================
deploy_all() {
  log "===== 全量部署 ($DEPLOY_ENV) ====="
  deploy_admin
  deploy_system
  deploy_portal
  deploy_gateway
  deploy_config

  # 保存 PM2 配置
  ssh "$SERVER" "pm2 save"
  log "PM2 配置已保存"

  log "===== 全部部署完成 ====="
}

# ===========================================================
# 健康检查
# ===========================================================
health_check() {
  log "===== 健康检查 ====="
  sleep 5

  services=(
    "Gateway:3000"
    "Auth:3001"
    "System:3004"
  )

  for svc in "${services[@]}"; do
    name="${svc%%:*}"
    port="${svc##*:}"
    code=$(ssh "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/" 2>/dev/null || echo "000")
    if [ "$code" = "000" ]; then
      warn "$name (:$port) → 无法连接"
    else
      log "$name (:$port) → $code"
    fi
  done

  # 公网验证
  log "公网验证:"
  for url in "$PUBLIC_URL/" "$PUBLIC_URL/login" "$PUBLIC_URL/admin/"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    log "  $url → $code"
  done
}

# ===========================================================
# 主流程
# ===========================================================
echo ""
echo "=========================================="
echo "  Web System 部署脚本"
echo "  环境: $DEPLOY_ENV"
echo "  服务器: $SERVER"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""

check_ssh

case "$COMPONENT" in
  all)
    deploy_all
    health_check
    ;;
  portal)
    deploy_portal
    health_check
    ;;
  admin)
    deploy_admin
    health_check
    ;;
  auth)
    deploy_auth
    health_check
    ;;
  system)
    deploy_system
    health_check
    ;;
  gateway)
    deploy_gateway
    health_check
    ;;
  config)
    deploy_config
    ;;
  seed)
    seed_bianbian
    ;;
  *)
    echo "用法: $0 [dev|prod] [all|portal|admin|auth|system|gateway|config|seed]"
    exit 1
    ;;
esac

echo ""
echo "=========================================="
echo "  🎉 部署完成！"
echo "  访问地址: $PUBLIC_URL"
echo "=========================================="
