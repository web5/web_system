#!/bin/bash
cd "$(dirname "$0")" || exit 1
PORT=8722
# 服务根设为小程序目录上一级：prototype/*.html 与 docs/*.html 都能访问（总入口要嵌 docs 里的方案文档）
ROOT=".."

echo "科豆 AI 小程序原型（kedou-ai-minigram）"
echo "----------------------------------------"

if command -v python3 >/dev/null 2>&1; then
  if ! lsof -ti tcp:$PORT >/dev/null 2>&1; then
    nohup python3 -m http.server $PORT --bind 127.0.0.1 --directory "$ROOT" >/tmp/kd-proto.log 2>&1 &
    sleep 1.2
  fi
  if lsof -ti tcp:$PORT >/dev/null 2>&1; then
    echo "本地服务：http://localhost:$PORT"
    open "http://localhost:$PORT/prototype/hub.html"
    echo "已打开原型总入口（hub.html）"
    exit 0
  fi
fi

echo "回退：直接打开文件"
open "hub.html"
