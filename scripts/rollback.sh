#!/bin/bash
# ===========================================================
# Web System - 回滚脚本
# 将远程 $REMOTE_DIR 还原到指定发布快照（releases/<tag>/web_system.tar.gz）
# 并重启相关服务。
#
# 用法:
#   ./scripts/rollback.sh dev  <tag>
#   ./scripts/rollback.sh prod <tag>
#
# tag 来自运维系统"版本记录"列表（对应 deploy_versions.version_tag）
# ===========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOY_ENV="${1:-dev}"
TAG="${2}"

if [ -z "$TAG" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m 用法: $0 <env> <tag>"
  exit 1
fi

ENV_FILE="$SCRIPT_DIR/scripts/.env.deploy"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "\033[0;31m[ERROR]\033[0m 未找到配置文件 $ENV_FILE"
  echo "请复制 .env.deploy.example 为 .env.deploy 并填入服务器信息"
  exit 1
fi
source "$ENV_FILE"

case "$DEPLOY_ENV" in
  dev)
    SERVER="$DEV_SERVER"
    REMOTE_DIR="$DEV_REMOTE_DIR"
    ;;
  prod)
    SERVER="$PROD_SERVER"
    REMOTE_DIR="$PROD_REMOTE_DIR"
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

# 若由后端注入 DB 环境连接（DEPLOY_HOST 等），则覆盖，支持任意/自定义环境
if [ -n "$DEPLOY_HOST" ]; then
  SERVER="$DEPLOY_USER@$DEPLOY_HOST"
  REMOTE_DIR="$DEPLOY_REMOTE_DIR"
  log "使用 DB 环境连接覆盖: $DEPLOY_USER@$DEPLOY_HOST ($REMOTE_DIR)"
fi

SSH_OPTS=""
if [ -n "$DEPLOY_KEY" ] && [ "$DEPLOY_KEY" != "~/.ssh/id_ed25519_servers" ] && [ -f "$DEPLOY_KEY" ]; then
  SSH_OPTS="-i $DEPLOY_KEY"
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} [$DEPLOY_ENV] $1"; }
err() { echo -e "${RED}[ERROR]${NC} [$DEPLOY_ENV] $1"; exit 1; }

SNAP="$REMOTE_DIR/releases/$TAG/web_system.tar.gz"

log "检查 SSH 连接 ($SERVER)..."
ssh $SSH_OPTS -o ConnectTimeout=5 -o BatchMode=yes "$SERVER" "echo ok" 2>/dev/null || err "SSH 连接失败: $SERVER"

log "回滚 $DEPLOY_ENV 到版本: $TAG"
ssh $SSH_OPTS "$SERVER" "test -f $SNAP" || err "快照不存在: $SNAP"

log "还原快照..."
# 清空远程目录（保留 releases 与 node_modules 之外的全部内容），再解压快照
ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR && rm -rf ./servers ./apps ./ecosystem.config.js ./package.json 2>/dev/null; tar xzf $SNAP -C $REMOTE_DIR"
log "快照还原完成"

log "重启服务..."
ssh $SSH_OPTS "$SERVER" "cd $REMOTE_DIR && pm2 restart all 2>/dev/null || true"
log "服务重启完成"

log "===== 回滚完成: $DEPLOY_ENV @ $TAG ====="
