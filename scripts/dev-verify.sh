#!/bin/bash
# ===========================================================
# Web System 本地开发验证脚本
# 一键验证：数据库 → 单元测试 → 集成测试 → 服务健康自检
#
# 用法:
#   ./scripts/dev-verify.sh            # 全部验证（DB + 单测 + 集成 + 健康）
#   ./scripts/dev-verify.sh --unit     # 仅单元测试
#   ./scripts/dev-verify.sh --integ    # 仅集成测试（需 MySQL 在跑）
#   ./scripts/dev-verify.sh --health   # 仅服务健康/登录自检（需后端在跑）
#
# 前置: 见 docs/development-guide.md
# ===========================================================
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok()   { echo -e "${G}  ✓${N} $1"; }
fail() { echo -e "${R}  ✗${N} $1"; }
warn() { echo -e "${Y}  !${N} $1"; }

MYSQL_BIN="$HOME/local/mysql-8.4.0-macos14-arm64/bin"
MYSQL="$MYSQL_BIN/mysql"
MYSQL_PASS="KedouLocal@2026"

PASS=0; FAIL=0
summary() { echo; echo -e "结果: ${G}${PASS} passed${N} / ${R}${FAIL} failed${N}"; }

DO_UNIT=true; DO_INTEG=true; DO_HEALTH=true
for arg in "$@"; do
  case "$arg" in
    --unit)   DO_UNIT=true;  DO_INTEG=false; DO_HEALTH=false ;;
    --integ)  DO_UNIT=false; DO_INTEG=true;  DO_HEALTH=false ;;
    --health) DO_UNIT=false; DO_INTEG=false; DO_HEALTH=true ;;
  esac
done

echo "=========================================="
echo " Web System 本地开发验证"
echo "=========================================="

# ---------- 1. 数据库 ----------
echo; echo "[1/4] 数据库检查"
if mysqladmin_cmd="$MYSQL_BIN/mysqladmin"; [ -x "$mysqladmin_cmd" ]; then :; fi
if "$MYSQL" -h127.0.0.1 -uroot -p"$MYSQL_PASS" -e "SELECT 1" >/dev/null 2>&1; then
  ok "MySQL (127.0.0.1:3306) 连接正常"
else
  fail "MySQL 未就绪，先执行 ./scripts/local-db.sh"; exit 1
fi
if redis-cli ping >/dev/null 2>&1 || "$HOME/local/redis-stable/src/redis-cli" ping >/dev/null 2>&1; then
  ok "Redis (6379) 正常"
else
  warn "Redis 未就绪（部分功能依赖），执行 ./scripts/local-db.sh 拉起"
fi

# ---------- 2. 单元测试 ----------
if $DO_UNIT; then
  echo; echo "[2/4] 单元测试（deploy-console jest）"
  if (cd "$ROOT/servers/deploy-console" && npx jest 2>&1 | tail -5); then
    ok "单元测试通过"
  else
    fail "单元测试未通过"; FAIL=$((FAIL+1))
  fi
fi

# ---------- 3. 集成测试 ----------
if $DO_INTEG; then
  echo; echo "[3/4] 集成测试（真实 DB）"
  for t in _test-p0 _test-p1; do
    if [ -f "$ROOT/scripts/$t.mjs" ]; then
      echo "  运行 $t.mjs ..."
      if node "$ROOT/scripts/$t.mjs" 2>&1 | tail -6; then
        ok "$t 通过"
      else
        fail "$t 未通过"; FAIL=$((FAIL+1))
      fi
    else
      warn "缺少 $t.mjs"
    fi
  done
fi

# ---------- 4. 服务健康自检 ----------
if $DO_HEALTH; then
  echo; echo "[4/4] 服务健康自检"
  # 登录自检（gateway 6000，admin/admin123）
  if curl -s -m 3 -X POST http://127.0.0.1:6000/api/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"username":"admin","password":"admin123"}' 2>/dev/null | grep -q accessToken; then
    ok "网关登录 OK（6000，admin/admin123）"
  else
    warn "网关登录未通过；可能未启动或密码不同。启动: ./scripts/local-up.sh"
  fi
  # deploy-console 登录自检（6200，admin/deploy2026）
  if curl -s -m 3 -X POST http://127.0.0.1:6200/api/auth/login \
      -H 'Content-Type: application/json' \
      -d '{"username":"admin","password":"deploy2026"}' 2>/dev/null | grep -q '"token"'; then
    ok "deploy-console 登录 OK（6200，admin/deploy2026）"
  else
    warn "deploy-console 未就绪（6200）；启动: pm2 restart web-deploy-console"
  fi
  # 各后端服务端口探测
  for port in 6101 6002 6003 6004 6005 6006 6007 6008; do
    if lsof -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then
      ok "端口 $port 监听中"
    else
      warn "端口 $port 未监听"
    fi
  done
fi

summary
