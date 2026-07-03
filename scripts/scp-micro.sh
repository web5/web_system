#!/bin/bash
# ==========================================
# SCP 上传文件到后端服务器
# 用法: ./scp-micro.sh <本地路径> <远程路径>
# 示例: ./scp-micro.sh ./dist /data/web_system/servers/gateway/
# ==========================================

set -e

# 加载 .env（与脚本同目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/.env" ]; then
    source "${SCRIPT_DIR}/.env"
fi

HOST="${MICRO_HOST:-root@106.52.176.246}"
PASSWORD="${MICRO_PASSWORD:-}"

LOCAL_PATH="${1:-}"
REMOTE_PATH="${2:-}"

if [ -z "$LOCAL_PATH" ] || [ -z "$REMOTE_PATH" ]; then
    echo "用法: $0 <本地路径> <远程路径>"
    exit 1
fi

expect -c "
set timeout 120
spawn scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -r ${LOCAL_PATH} ${HOST}:${REMOTE_PATH}
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
