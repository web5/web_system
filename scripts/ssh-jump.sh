#!/bin/bash
# ==========================================
# SSH 跳板机登录（Jump Host）
# 用法: ./ssh-jump.sh [command]
# ==========================================

set -e

# 加载 .env（与脚本同目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/.env" ]; then
    source "${SCRIPT_DIR}/.env"
fi

JUMP_HOST="${JUMP_HOST:-root@42.194.200.69}"
MICRO_HOST="${MICRO_HOST:-root@172.16.16.2}"
MICRO_PASSWORD="${MICRO_PASSWORD:-}"

CMD="${1:-}"

expect -c "
set timeout 60
spawn ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -J ${JUMP_HOST} ${MICRO_HOST} ${CMD}
expect {
    \"password:\" { send \"${MICRO_PASSWORD}\r\" }
    \"Password:\" { send \"${MICRO_PASSWORD}\r\" }
    timeout { puts \"TIMEOUT\"; exit 1 }
    eof { }
}
expect {
    \"password:\" { send \"${MICRO_PASSWORD}\r\"; exp_continue }
    \"Password:\" { send \"${MICRO_PASSWORD}\r\"; exp_continue }
    eof { }
}
catch wait result
exit [lindex \$result 3]
"
