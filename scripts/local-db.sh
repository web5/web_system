#!/bin/bash
# 本地 MySQL + Redis 启动脚本（无 brew / 无 sudo，二进制装到 ~/local）
set -e
LOCAL="$HOME/local"

MYSQL_HOME="$LOCAL/mysql-8.4.0-macos14-arm64"
REDIS_BIN="$LOCAL/redis-stable/src/redis-server"
REDIS_CLI="$LOCAL/redis-stable/src/redis-cli"

MYSQL_DATA="$LOCAL/mysql-data"
MYSQL_SOCK="$MYSQL_DATA/mysql.sock"
MYSQL_LOG="$LOCAL/mysql.log"

echo "===== 启动 Redis ====="
if [ ! -x "$REDIS_BIN" ]; then
  echo "Redis 未编译，先编译..."
  cd "$LOCAL/redis-stable" && make -j"$(sysctl -n hw.ncpu)" >/tmp/redis_make.log 2>&1
fi
if ! "$REDIS_CLI" ping >/dev/null 2>&1; then
  nohup "$REDIS_BIN" --daemonize yes --port 6379 >/tmp/redis.log 2>&1
  sleep 1
  "$REDIS_CLI" ping && echo "Redis OK" || { echo "Redis 启动失败"; tail -20 /tmp/redis.log; exit 1; }
else
  echo "Redis 已在运行"
fi

echo "===== 启动 MySQL ====="
if [ ! -d "$MYSQL_HOME" ]; then
  echo "MySQL 未解压，先解压..."
  tar -xzf "$LOCAL/mysql.tar.gz" -C "$LOCAL"
fi
export PATH="$MYSQL_HOME/bin:$PATH"

if [ ! -d "$MYSQL_DATA" ]; then
  echo "初始化 MySQL 数据目录..."
  "$MYSQL_HOME/bin/mysqld" --initialize-insecure --user="$USER" --basedir="$MYSQL_HOME" --datadir="$MYSQL_DATA" >/tmp/mysql_init.log 2>&1
fi

if ! "$MYSQL_HOME/bin/mysqladmin" --socket="$MYSQL_SOCK" ping >/dev/null 2>&1; then
  nohup "$MYSQL_HOME/bin/mysqld" --user="$USER" --basedir="$MYSQL_HOME" --datadir="$MYSQL_DATA" \
    --socket="$MYSQL_SOCK" --port=3306 --bind-address=127.0.0.1 \
    --log-error="$MYSQL_LOG" >/tmp/mysql.log 2>&1 &
  # 等待就绪
  for i in $(seq 1 30); do
    if "$MYSQL_HOME/bin/mysqladmin" --socket="$MYSQL_SOCK" ping >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

"$MYSQL_HOME/bin/mysqladmin" --socket="$MYSQL_SOCK" ping || { echo "MySQL 启动失败"; tail -30 "$MYSQL_LOG"; exit 1; }
echo "MySQL OK"

echo "===== 创建数据库 web_system ====="
"$MYSQL_HOME/bin/mysql" --socket="$MYSQL_SOCK" -uroot <<'SQL'
CREATE DATABASE IF NOT EXISTS web_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL
echo "数据库 web_system 就绪"
echo "===== 完成 ====="
