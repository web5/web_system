#!/usr/bin/env bash
# ============================================================
# setup-ssh-key.sh — 一次性打通服务器 SSH 免密登录
#
# 作用：把本机已有的服务器密钥 ~/.ssh/id_ed25519_servers
#       分发到 dev / prod 服务器，并写入 ~/.ssh/config，
#       之后所有部署脚本（publish / deploy / ssh-*）都无需再输密码。
#
# 用法：
#   ./scripts/setup-ssh-key.sh           # 自动读取 scripts/.env.deploy
#   ./scripts/setup-ssh-key.sh "密码"     # 直接传入服务器密码（仅首次分发用）
#
# 说明：
#   - 第一次需要你输入一次服务器密码（用 ssh-copy-id 推公钥）。
#   - 推完后写入 ~/.ssh/config，之后全部走密钥，不再弹确认。
#   - 如果服务器已经能免密登录，脚本会自动跳过分发步骤。
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.deploy"
PASS="${1:-}"

# 加载服务器地址（找不到就用默认值）
if [ -f "$ENV_FILE" ]; then source "$ENV_FILE"; fi
DEV_HOST="${DEV_SERVER:-ubuntu@175.27.189.123}"
PROD_HOST="${PROD_SERVER:-root@106.52.176.246}"
JUMP_HOST="root@42.194.200.69"

KEY="$HOME/.ssh/id_ed25519_servers"
PUB="$KEY.pub"

[ -f "$PUB" ] || { echo "[ERROR] 未找到服务器公钥 $PUB，请先生成: ssh-keygen -t ed25519 -f $KEY"; exit 1; }

# 确保 ~/.ssh 权限正确（macOS 常见坑）
chmod 700 "$HOME/.ssh" 2>/dev/null || true
chmod 600 "$KEY" 2>/dev/null || true

# 配置 ~/.ssh/config（幂等：已存在则跳过）
ensure_config() {
  local host_alias="$1" userhost="$2" via="${3:-}"
  local cfg="$HOME/.ssh/config"
  touch "$cfg"; chmod 600 "$cfg"
  if grep -q "Host $host_alias$" "$cfg"; then
    echo "  [skip] ~/.ssh/config 已有 $host_alias"
    return
  fi
  {
    echo ""
    echo "Host $host_alias"
    echo "  HostName ${userhost#*@}"
    echo "  User ${userhost%@*}"
    echo "  IdentityFile $KEY"
    echo "  IdentitiesOnly yes"
    echo "  StrictHostKeyChecking accept-new"
    [ -n "$via" ] && echo "  ProxyJump $via"
  } >> "$cfg"
  echo "  [ok] 写入 $host_alias → $userhost"
}

echo "===== 配置 ~/.ssh/config ====="
ensure_config kedou-dev  "$DEV_HOST"
ensure_config kedou-prod "$PROD_HOST"
ensure_config kedou-jump "$JUMP_HOST"

# 测试是否已免密；否则用 ssh-copy-id 推公钥（只需这一次输密码）
push_key() {
  local alias="$1" host="$2"
  echo "===== 检查 $alias 免密登录 ====="
  if ssh -o BatchMode=yes -o ConnectTimeout=8 "$alias" "echo ok" >/dev/null 2>&1; then
    echo "  [skip] $alias 已免密"
    return
  fi
  echo "  需要推送公钥到 $host（首次需输入密码）"
  if [ -n "$PASS" ]; then
    ssh-copy-id -i "$PUB" -o StrictHostKeyChecking=accept-new "$host" <<< "$PASS" >/dev/null 2>&1 \
      && echo "  [ok] 公钥已推送" || echo "  [warn] 自动推送失败，请手动: ssh-copy-id -i $PUB $host"
  else
    ssh-copy-id -i "$PUB" -o StrictHostKeyChecking=accept-new "$host" \
      && echo "  [ok] 公钥已推送" || echo "  [warn] 推送失败，请手动执行: ssh-copy-id -i $PUB $host"
  fi
}

push_key kedou-dev  "$DEV_HOST"
push_key kedou-prod "$PROD_HOST"

echo ""
echo "===== 验证 ====="
ssh -o BatchMode=yes kedou-dev  "echo dev  OK: \$(hostname)" 2>/dev/null || echo "dev  仍需密码"
ssh -o BatchMode=yes kedou-prod "echo prod OK: \$(hostname)" 2>/dev/null || echo "prod 仍需密码"
echo "完成。之后部署请使用: ./scripts/publish.sh dev [目标]"
