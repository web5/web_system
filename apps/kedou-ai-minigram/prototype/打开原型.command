#!/bin/bash
cd "$(dirname "$0")" || exit 1
PORT=8722

echo "科豆 AI 小程序原型（kedou-ai-minigram）"
echo "----------------------------------------"

if command -v python3 >/dev/null 2>&1; then
  if ! lsof -ti tcp:$PORT >/dev/null 2>&1; then
    nohup python3 -m http.server $PORT --bind 127.0.0.1 >/tmp/kd-proto.log 2>&1 &
    sleep 1.2
  fi
  if lsof -ti tcp:$PORT >/dev/null 2>&1; then
    echo "本地服务：http://localhost:$PORT"
    open "http://localhost:$PORT/index.html"
    echo "已用默认浏览器打开"
    exit 0
  fi
fi

echo "回退：直接打开文件"
open "index.html"
