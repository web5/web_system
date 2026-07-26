#!/bin/bash
# ===========================================================
# Web System - Dev 环境一键部署脚本
# 服务器配置见 scripts/.env.dev
# TODO: 与 deploy.sh / deploy-prod.sh 代码重复率高，后续应统一为 deploy.sh + 环境变量
#
# 用法:
#   ./scripts/deploy-dev.sh              # 部署全部
#   ./scripts/deploy-dev.sh auth         # 只部署 auth-service
#   ./scripts/deploy-dev.sh portal       # 只部署 portal 前端
#   ./scripts/deploy-dev.sh gateway      # 只部署 gateway
# ===========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/scripts/.env.dev"
COMPONENT="${1:-all}"

if [ ! -f "$ENV_FILE" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m 未找到配置文件 $ENV_FILE"
  exit 1
fi
source "$ENV_FILE"

# SSH 命令（dev 用密钥直连，不受外部 SSHPASS 影响）
unset SSHPASS
SSH_CMD="ssh -o ConnectTimeout=5 -o BatchMode=yes"
SCP_CMD="scp"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} [dev] $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} [dev] $1"; }
err()   { echo -e "${RED}[ERROR]${NC} [dev] $1"; exit 1; }

check_ssh() {
  log "检查 SSH 连接..."
  $SSH_CMD "$SERVER" "echo ok" 2>/dev/null || err "SSH 连接失败: $SERVER"
  log "SSH 连接正常"
}

deploy_portal() {
  log "===== 部署 Portal 前端 ====="
  cd "$SCRIPT_DIR/apps/portal"
  log "构建 portal..."
  npx vite build 2>&1 || err "Portal 构建失败"
  log "同步到远程服务器..."
  tar czf - dist | $SSH_CMD "$SERVER" "cd $REMOTE_DIR/servers/gateway && rm -rf public/* && tar xzf - && mv dist/* public/ && rm -rf dist"
  log "Portal 同步完成"
  deploy_gateway_restart
}

deploy_auth() {
  log "===== 部署 auth-service ====="
  cd "$SCRIPT_DIR/servers/auth-service"
  log "构建 auth-service..."
  npx nest build 2>&1 || err "auth-service 构建失败"
  log "同步 dist + 源码到远程..."
  tar czf - dist src package.json | $SSH_CMD "$SERVER" "cd $REMOTE_DIR && tar xzf -"
  log "重启 auth-service..."
  $SSH_CMD "$SERVER" "cd $REMOTE_DIR && pm2 restart auth-service 2>/dev/null || pm2 start servers/auth-service/dist/main.js --name auth-service"
  log "auth-service 重启完成"
}

deploy_gateway() {
  log "===== 部署 Gateway ====="
  cd "$SCRIPT_DIR/servers/gateway"
  log "构建 gateway..."
  npx nest build 2>&1 || err "gateway 构建失败"
  log "同步 dist 到远程..."
  tar czf - dist | $SSH_CMD "$SERVER" "cd $REMOTE_DIR && tar xzf -"
  deploy_gateway_restart
}

deploy_gateway_restart() {
  log "重启 gateway..."
  $SSH_CMD "$SERVER" "cd $REMOTE_DIR && pm2 restart gateway 2>/dev/null || pm2 start servers/gateway/dist/main.js --name gateway"
  log "gateway 重启完成"
}

deploy_config() {
  log "===== 同步配置文件 ====="
  $SCP_CMD "$SCRIPT_DIR/ecosystem.config.js" "$SERVER:$REMOTE_DIR/ecosystem.config.js"
  log "ecosystem.config.js 已同步"
}

deploy_all() {
  log "===== 全量部署 (dev) ====="
  deploy_portal
  deploy_auth
  deploy_gateway
  deploy_config
  $SSH_CMD "$SERVER" "pm2 save"
  log "===== 全部部署完成 ====="
}

health_check() {
  log "===== 健康检查 ====="
  sleep 5
  for svc in "Gateway:3000" "Auth:3001"; do
    name="${svc%%:*}"
    port="${svc##*:}"
    code=$($SSH_CMD "$SERVER" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/" 2>/dev/null || echo "000")
    if [ "$code" = "000" ]; then warn "$name (:$port) → 无法连接"; else log "$name (:$port) → $code"; fi
  done
  log "公网验证:"
  for url in "$PUBLIC_URL/" "$PUBLIC_URL/login"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    log "  $url → $code"
  done
}

echo ""
echo "=========================================="
echo "  Web System Dev 部署脚本"
echo "  服务器: $SERVER"
echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""

check_ssh

case "$COMPONENT" in
  all)    deploy_all; health_check ;;
  portal) deploy_portal; health_check ;;
  auth)   deploy_auth; health_check ;;
  gateway) deploy_gateway; health_check ;;
  config) deploy_config ;;
  *)
    echo "用法: $0 [all|portal|auth|gateway|config]"
    exit 1
    ;;
esac

echo ""
echo "=========================================="
echo "  🎉 部署完成！"
echo "  访问地址: $PUBLIC_URL"
echo "=========================================="
