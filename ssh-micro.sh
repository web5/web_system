#!/bin/bash
# ==========================================
# SSH 登录后端服务器
# 用法: ./ssh-micro.sh [command]
# ==========================================

set -e

# 加载 .env
if [ -f "$(dirname "$0")/.env" ]; then
    source "$(dirname "$0")/.env"
fi

HOST="${MICRO_HOST:-root@106.52.176.246}"
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
