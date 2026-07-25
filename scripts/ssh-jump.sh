#!/bin/bash
# ===========================================================
# SSH 跳板机运维管理脚本
# 通过跳板机访问内网服务器
# 用于日常运维、查看日志、修改配置等操作
#
# 服务器配置见 .env.dev / .env.prod
#
# 用法:
#   ./scripts/ssh-jump.sh                      # 查看帮助
#   ./scripts/ssh-jump.sh list                 # 列出所有环境
#   ./scripts/ssh-jump.sh prod                 # 交互登录 prod 服务器
#   ./scripts/ssh-jump.sh dev                  # 交互登录 dev 服务器
#   ./scripts/ssh-jump.sh jump                 # 交互登录跳板机
#   ./scripts/ssh-jump.sh prod "pm2 list"      # 远程执行命令
#   ./scripts/ssh-jump.sh dev "tail -20 logs/auth-out.log"  # 查看日志
# ===========================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 从环境配置文件加载服务器信息
load_env_hosts() {
  local env_file="$SCRIPT_DIR/.env.prod"
  if [ -f "$env_file" ]; then
    source "$env_file"
    JUMP_HOST="${JUMP_HOST:-}"
    PROD_HOST="${SERVER:-}"
  fi
  local dev_file="$SCRIPT_DIR/.env.dev"
  if [ -f "$dev_file" ]; then
    source "$dev_file"
    DEV_HOST="${SERVER:-}"
  fi
}
load_env_hosts

# ===== 默认服务器配置（如 .env.* 中未定义） =====
JUMP_HOST="${JUMP_HOST:-root@42.194.200.69}"
DEV_HOST="${DEV_HOST:-ubuntu@175.27.189.123}"
PROD_HOST="${PROD_HOST:-root@106.52.176.246}"
# ===============================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

show_help() {
  echo "SSH 跳板机运维管理脚本"
  echo ""
  echo "架构: 本地 → 跳板机(${JUMP_HOST}) → 内网服务器"
  echo ""
  echo "用法:"
  echo "  $0 list                   列出所有环境"
  echo "  $0 prod                   交互登录生产服务器"
  echo "  $0 dev                    交互登录开发服务器"
  echo "  $0 jump                   交互登录跳板机"
  echo "  $0 prod '命令'            远程执行命令"
  echo "  $0 dev '命令'             远程执行命令"
  echo ""
  echo "常用运维命令:"
  echo "  pm2 list                  查看所有进程"
  echo "  pm2 logs <name> --lines 20  查看服务日志"
  echo "  tail -50 logs/auth-out.log   查看 auth 日志"
  echo "  df -h                     查看磁盘"
  echo "  free -h                   查看内存"
  echo "  systemctl status nginx    查看 Nginx 状态"
  echo ""
}

# 执行远程命令（通过跳板机）
exec_via_jump() {
  local target="$1"
  local cmd="$2"
  echo -e "${CYAN}[${target}]${NC} $cmd"
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
    -J "${JUMP_HOST}" "${target}" "$cmd"
}

# 交互式登录（通过跳板机）
login_via_jump() {
  local target="$1"
  local name="$2"
  echo -e "${GREEN}正在登录 ${name} (${target})...${NC}"
  echo -e "${YELLOW}路径: 本地 → 跳板机(${JUMP_HOST}) → ${name}${NC}"
  echo ""
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
    -J "${JUMP_HOST}" "${target}"
}

case "${1:-help}" in
  list)
    echo "可用环境:"
    echo "  jump  - 跳板机 ${JUMP_HOST}"
    echo "  dev   - 开发服务器 ${DEV_HOST}"
    echo "  prod  - 生产服务器 ${PROD_HOST}"
    echo ""
    echo "连接路径:"
    echo "  本地 → 跳板机 → dev"
    echo "  本地 → 跳板机 → prod"
    ;;
  jump)
    echo -e "${GREEN}正在登录跳板机...${NC}"
    ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "${JUMP_HOST}"
    ;;
  dev)
    shift
    if [ $# -gt 0 ]; then
      exec_via_jump "$DEV_HOST" "$*"
    else
      login_via_jump "$DEV_HOST" "开发服务器"
    fi
    ;;
  prod)
    shift
    if [ $# -gt 0 ]; then
      exec_via_jump "$PROD_HOST" "$*"
    else
      login_via_jump "$PROD_HOST" "生产服务器"
    fi
    ;;
  help|--help|-h|"")
    show_help
    ;;
  *)
    echo -e "${RED}未知环境: $1${NC}"
    show_help
    exit 1
    ;;
esac
