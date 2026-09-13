#!/bin/bash
# ===========================================================
# ⚠️ DEPRECATED（2026-09-13）—— 请勿用于新部署
#
# 本脚本已过时且与现状不符：
#   - 写死 3000/3001 端口（现状为 6000 系列，见 ecosystem.config.js）
#   - 只覆盖 portal / auth / gateway，漏掉 system/user/ai/todo/upload/mcp-gateway/
#     content-hub/knowledge-service/ai-agent/deploy-console
#   - 用 `pm2 restart --update-env`，会把执行会话的变量固化进 pm2_env（污染源）
#
# 替代方案：
#   后端 + 数据：  ssh <prod> 'cd /data/web_system && ./scripts/bootstrap.sh --env prod'
#   单服务重启：   scripts/pipeline/restart-backend.sh（干净环境重建 + 依赖校验）
#   发布后验证：   scripts/pipeline/verify-backend.sh
#   设计方案：     docs/development/prod-release-plan.md
#
# 服务器配置见 scripts/.env.prod
# ===========================================================
#
# 用法:
#   ./scripts/deploy-prod.sh              # 部署全部
#   ./scripts/deploy-prod.sh auth         # 只部署 auth-service
#   ./scripts/deploy-prod.sh portal       # 只部署 portal 前端
#   ./scripts/deploy-prod.sh gateway      # 只部署 gateway
# ===========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/scripts/.env.prod"
COMPONENT="${1:-all}"

if [ ! -f "$ENV_FILE" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m 未找到配置文件 $ENV_FILE"
  exit 1
fi
source "$ENV_FILE"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} [prod] $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} [prod] $1"; }
err()   { echo -e "${RED}[ERROR]${NC} [prod] $1"; exit 1; }

# SSH 命令（支持密码或密钥）
SSH_CMD="ssh -o ConnectTimeout=5 -o BatchMode=yes"
SCP_CMD="scp"
if [ -n "$SERVER_PASSWORD" ]; then
  export SSHPASS="$SERVER_PASSWORD"
  SSH_CMD="sshpass -e ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no"
  SCP_CMD="sshpass -e scp -o StrictHostKeyChecking=no"
fi

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
  log "===== 全量部署 (prod) ====="
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
echo "  Web System 生产环境部署脚本"
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
