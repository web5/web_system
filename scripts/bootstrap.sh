#!/usr/bin/env bash
# ============================================================
# bootstrap.sh — 从零把本机/目标机拉到「可登录、可服务」状态
#
# 定位：把原本散落的 建库 → 迁移 → 构建 → 启动 → seed → 验证 编排成一个入口，
#       并补上它们没覆盖的「首次」场景（首次纳管、首次建库、首次 seed）。
#
# 在**目标机本地**执行：
#   本机:  ./scripts/bootstrap.sh --env local
#   prod:  ssh <prod> 'cd /data/web_system && ./scripts/bootstrap.sh --env prod'
#   （不引入额外 SSH 层，从而复用 apply-migrations.sh 与 pipeline/restart-backend.sh）
#
# 用法:
#   --env <local|dev|prod>   必填
#   --dry-run                只打印将执行的步骤（零副作用）
#   --skip-build             跳过构建
#   --no-start               只做数据层（建库+迁移+构建），不动进程
#   --with-front             额外构建前端产物与 CDN
#   --admin-password <pwd>   seed/重置 admin 密码（缺省则跳过）
#   --env-file <path>        配置来源（默认 $ROOT/.env.production，回退 $ROOT/.env）
#   --yes                    跳过交互确认
#
# 真相源（刻意不重复定义，避免清单漂移）：
#   服务清单 = scripts/modules.json（type=backend）
#   端口     = ecosystem.config.cjs（apps[].cwd ↔ apps[].env.PORT）
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ENV_NAME=""
DRY_RUN=0
DO_BUILD=1
DO_START=1
DO_FRONT=0
ADMIN_PASSWORD=""
ENV_FILE=""
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --env)            ENV_NAME="${2:-}"; shift 2 ;;
    --dry-run)        DRY_RUN=1; shift ;;
    --skip-build)     DO_BUILD=0; shift ;;
    --no-start)       DO_START=0; shift ;;
    --with-front)     DO_FRONT=1; shift ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --env-file)       ENV_FILE="${2:-}"; shift 2 ;;
    --yes)            ASSUME_YES=1; shift ;;
    -h|--help)        sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "未知参数: $1（--help 查看用法）" >&2; exit 2 ;;
  esac
done

case "$ENV_NAME" in
  local|dev|prod) ;;
  *) echo "用法: $0 --env <local|dev|prod> [--dry-run] [--skip-build] [--no-start] [--with-front] [--admin-password <pwd>]" >&2; exit 2 ;;
esac

[ -n "$ENV_FILE" ] || ENV_FILE="$ROOT/.env.production"
[ -f "$ENV_FILE" ] || ENV_FILE="$ROOT/.env"

g(){ printf "\033[32m%s\033[0m\n" "$1"; }
y(){ printf "\033[33m%s\033[0m\n" "$1"; }
r(){ printf "\033[31m%s\033[0m\n" "$1" >&2; }
step(){ echo; g "== $1 =="; }
run(){ if [ "$DRY_RUN" = "1" ]; then echo "    [dry-run] $*"; else eval "$@"; fi; }

FAILED_STEP=""
on_err(){ r "✗ 失败步骤: ${FAILED_STEP:-未知}"; r "  排查：pm2 logs <服务名>｜tail -50 /tmp/*.log"; exit 1; }
trap on_err ERR

# 共享包按依赖顺序（agent-core 是 ai-service 的依赖，历史漏项）
PACKAGES=(shared types mcp-core agent-core)

# ---------- 服务清单（modules.json） + 端口（ecosystem.config.cjs） ----------
SERVICES=()
while IFS= read -r d; do [ -n "$d" ] && SERVICES+=("$d"); done < <(
  node -e "for (const m of require('$ROOT/scripts/modules.json')) if (m.type === 'backend') console.log(m.dir);"
)
[ "${#SERVICES[@]}" -gt 0 ] || { r "无法从 scripts/modules.json 解析后端服务清单"; exit 1; }

# 目录 → 端口（端口真相源：ecosystem.config.cjs 的 cwd/name + env.PORT）
port_of(){
  node -e "
const apps = require('$ROOT/ecosystem.config.cjs').apps || [];
for (const a of apps) {
  const dir = String(a.cwd || '').split('/servers/')[1];
  const port = a.env && a.env.PORT;
  if (dir && port && dir === process.argv[1]) { console.log(port); break; }
}
" "$1" 2>/dev/null | head -1
}

echo "=============================================="
echo " web_system bootstrap"
echo "   环境 : $ENV_NAME"
echo "   根目录: $ROOT"
echo "   配置 : $ENV_FILE"
echo "   模式 : dry-run=$DRY_RUN build=$DO_BUILD start=$DO_START front=$DO_FRONT"
echo "   服务 : ${#SERVICES[@]} 个"
echo "=============================================="

if [ "$ENV_NAME" = "prod" ] && [ "$ASSUME_YES" != "1" ] && [ "$DRY_RUN" != "1" ]; then
  y "⚠️  生产环境操作。确认继续？(yes/no)"
  read -r ans
  [ "$ans" = "yes" ] || { echo "已取消"; exit 0; }
fi

# ---------- 0. 工具链 ----------
step "0/7 工具链与依赖"
FAILED_STEP="工具链检查"
need(){ command -v "$1" >/dev/null 2>&1 || { r "缺少命令: $1"; exit 1; }; }
need node; need pm2
node -v; pm2 -v | head -1

if [ ! -d "$ROOT/servers/auth-service/node_modules" ]; then
  y ">>> 未检测到 node_modules，执行 pnpm install"
  run "(cd '$ROOT' && pnpm install)"
fi

# ---------- 1. 共享包 ----------
step "1/7 构建共享包: ${PACKAGES[*]}"
FAILED_STEP="构建共享包"
if [ "$DO_BUILD" = "1" ]; then
  for p in "${PACKAGES[@]}"; do
    echo "    packages/$p"
    run "(cd '$ROOT/packages/$p' && pnpm build)"
  done
else
  y ">>> --skip-build，跳过"
fi

# ---------- 2. 数据库 ----------
step "2/7 数据库（幂等建库）"
FAILED_STEP="建库"
if [ "$ENV_NAME" = "local" ]; then
  # local-db.sh 走 mysql 客户端（socket）。MySQL root 若已设密码，用 MYSQL_PWD 传入
  # （客户端自动识别，密码不进命令行/不回显）；来源：已导出的 MYSQL_PWD → .env 的 DB_PASSWORD。
  if [ -z "${MYSQL_PWD:-}" ] && [ -f "$ENV_FILE" ]; then
    MYSQL_PWD="$(grep -m1 '^DB_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r')"
    export MYSQL_PWD
    if [ -n "$MYSQL_PWD" ]; then echo "    使用 ${ENV_FILE} 的 DB_PASSWORD 连接（MYSQL_PWD）"; fi
  fi
  run "bash '$ROOT/scripts/local-db.sh'"
else
  # dev/prod：在本机直连（凭据来自目标机 .env，绝不写进命令行回显）
  if [ ! -f "$ENV_FILE" ]; then
    r "缺少配置文件 $ENV_FILE（DB 凭据来源）"; exit 1
  fi
  db_get(){ grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r'; }
  DB_HOST="$(db_get DB_HOST)"; DB_PORT="$(db_get DB_PORT)"; DB_USER="$(db_get DB_USERNAME)"; DB_PASS="$(db_get DB_PASSWORD)"
  DB_HOST="${DB_HOST:-127.0.0.1}"; DB_PORT="${DB_PORT:-3306}"; DB_USER="${DB_USER:-root}"
  echo "    目标: ${DB_USER}@${DB_HOST}:${DB_PORT}"
  SQL="CREATE DATABASE IF NOT EXISTS web_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS web_system_deploy CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS web_system_knowledge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  if [ "$DRY_RUN" = "1" ]; then
    echo "    [dry-run] mysql -h$DB_HOST -P$DB_PORT -u$DB_USER -e '<建三库> '"
  else
    MYSQL_PWD="$DB_PASS" mysql -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" -e "$SQL" \
      || { r "建库失败（检查 DB_* 与网络）"; exit 1; }
    echo "    已确保: web_system / web_system_deploy / web_system_knowledge"
  fi
fi

# ---------- 3. 迁移 ----------
step "3/7 数据库迁移（apply-migrations.sh local = 应用到这台机的库）"
FAILED_STEP="数据库迁移"
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi   # 让 DB_* 进入环境供迁移脚本使用
# 迁移脚本的 local 分支同样走 mysql 客户端：root 有密码时补 MYSQL_PWD（与建库步骤保持一致）
if [ -z "${MYSQL_PWD:-}" ] && [ -n "${DB_PASSWORD:-}" ]; then
  MYSQL_PWD="$DB_PASSWORD"; export MYSQL_PWD
fi
run "bash '$ROOT/scripts/apply-migrations.sh' local"

# ---------- 4. 后端构建 ----------
step "4/7 构建后端服务（${#SERVICES[@]} 个）"
FAILED_STEP="构建后端"
if [ "$DO_BUILD" = "1" ]; then
  for s in "${SERVICES[@]}"; do
    echo "    servers/$s"
    run "(cd '$ROOT/servers/$s' && ( [ -f nest-cli.json ] && npx nest build || npx tsc -p tsconfig.json ))"
    if [ "$DRY_RUN" != "1" ] && [ ! -f "$ROOT/servers/$s/dist/main.js" ]; then
      r "    $s 构建失败（未生成 dist/main.js）"; exit 1
    fi
  done
else
  y ">>> --skip-build，跳过"
fi

# ---------- 5. 启动（干净环境 + 依赖校验） ----------
step "5/7 启动服务（pipeline/restart-backend.sh，PM2_ALLOW_NEW=1 支持首次纳管）"
FAILED_STEP="启动服务"
if [ "$DO_START" = "1" ]; then
  for s in "${SERVICES[@]}"; do
    p="$(port_of "$s")"
    echo "    $s (PORT=${p:-未解析})"
    run "RELEASE_DIR='$ROOT' MODULE_KEY='$s' MODULE_DIR='$s' MODULE_TYPE=backend PORT='${p:-}' PM2_ALLOW_NEW=1 DRY_RUN=$DRY_RUN bash '$ROOT/scripts/pipeline/restart-backend.sh'"
  done
else
  y ">>> --no-start，跳过（进程未变更）"
fi

# ---------- 6. 初始数据 ----------
step "6/7 初始数据（admin 账号）"
FAILED_STEP="seed admin"
if [ -n "$ADMIN_PASSWORD" ]; then
  ADMIN_INIT_PASSWORD="$ADMIN_PASSWORD" run "node '$ROOT/scripts/seed-admin.mjs'"
else
  y ">>> 未提供 --admin-password，跳过 seed。"
  y "    需要时执行: node scripts/seed-admin.mjs   （默认 admin123）或 --admin-password <pwd>"
fi

# ---------- 7. 验证 ----------
step "7/7 验证"
FAILED_STEP="验证"
if [ "$DO_START" = "1" ] && [ "$DRY_RUN" != "1" ]; then
  sleep 5
  for s in "${SERVICES[@]}"; do
    p="$(port_of "$s")"
    RELEASE_DIR="$ROOT" MODULE_KEY="$s" MODULE_DIR="$s" MODULE_TYPE=backend PORT="${p:-}" \
      bash "$ROOT/scripts/pipeline/verify-backend.sh" || { r "验证失败: $s"; exit 1; }
  done
  echo
  y ">>> 登录自检"
  if curl -s --max-time 8 -X POST http://127.0.0.1:6000/api/auth/login \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"admin\",\"password\":\"${ADMIN_PASSWORD:-admin123}\"}" | grep -q accessToken; then
    g "    登录 OK（返回 accessToken）"
  else
    y "    登录未返回 accessToken：若密码非 admin123，请用 --admin-password 重跑"
  fi
else
  y ">>> 跳过（--no-start 或 --dry-run）"
fi

echo
g "bootstrap 完成（${ENV_NAME}）。网关 http://127.0.0.1:6000"
