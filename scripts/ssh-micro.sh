#!/bin/bash
# ==========================================
# SSH 登录后端服务器
# 用法: ./ssh-micro.sh [command]
# ==========================================

set -e

# 加载 .env（与脚本同目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/.env" ]; then
    source "${SCRIPT_DIR}/.env"
fi

HOST="${MICRO_HOST:-}"
if [ -z "$HOST" ]; then
    echo "[ERROR] 未配置 MICRO_HOST（在 scripts/.env 或环境变量中设置 user@host）" >&2
    exit 1
fi
PASSWORD="${MICRO_PASSWORD:-}"

CMD="${1:-}"

expect -c "
set timeout 60
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 ${HOST} ${CMD}
expect {
    \"password:\" { send \"${PASSWORD}\r\" }
    \"Password:\" { send \"${PASSWORD}\r\" }
    timeout { puts \"TIMEOUT\"; exit 1 }
    eof { }
}
expect {
    \"password:\" { send \"${PASSWORD}\r\"; exp_continue }
    \"Password:\" { send \"${PASSWORD}\r\"; exp_continue }
    eof { }
}
catch wait result
exit [lindex \$result 3]
"
