#!/usr/bin/env bash
# ============================================================
# provision-master-key.sh — 把主密钥投递到本机（0600 + 备份 + 指纹）
#
# 设计：specs/config-master-key-distribution/design.md §5.1 / §5.6
#       （Q11：由 super_admin 在目标机执行；**密钥值永不作为命令行参数**，避免进 shell 历史）
#
# 用法：
#   scripts/provision-master-key.sh --gen                        # 生成新钥（新域 / 本地演练）
#   scripts/provision-master-key.sh --from <user>@<host>:<path>  # 从同域既有机器 scp 取钥
#   scripts/provision-master-key.sh --from-stdin                 # 粘贴（read -s）
#   --file <path>   写入位置（默认 $CONFIG_MASTER_KEY_FILE 或 /etc/web-system/config-master.key）
#   --keep <n>      备份保留份数（默认 2）
#   --dry-run       只打印计划，不落盘
#
# 约定：
#   · 属主 = 当前执行用户，**必须等于 pm2 启动用户**（否则 console 读不到密钥文件）；
#   · 目录 0700、文件 0600；覆盖前备份 <file>.bak-<ts>；
#   · 结束打印**指纹**（与同域其他机器比对用），不打印密钥值。
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="${CONFIG_MASTER_KEY_FILE:-/etc/web-system/config-master.key}"
KEEP=2
DRY_RUN=0
SRC_KIND=""
SRC_FROM=""

while [ $# -gt 0 ]; do
  case "$1" in
    --gen)        SRC_KIND="gen"; shift ;;
    --from-stdin) SRC_KIND="stdin"; shift ;;
    --from)       SRC_KIND="scp"; SRC_FROM="${2:-}"; [ -n "$SRC_FROM" ] || { echo "--from 缺少 <user>@<host>:<path>" >&2; exit 2; }; shift 2 ;;
    --file)       KEY_FILE="${2:-}"; [ -n "$KEY_FILE" ] || { echo "--file 缺少路径" >&2; exit 2; }; shift 2 ;;
    --keep)       KEEP="${2:-2}"; shift 2 ;;
    --dry-run)    DRY_RUN=1; shift ;;
    *) echo "未知参数: $1（支持 --gen / --from / --from-stdin / --file / --keep / --dry-run）" >&2; exit 2 ;;
  esac
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
step() { echo -e "${GREEN}[provision]${NC} $1"; }
warn() { echo -e "${YELLOW}[provision][WARN]${NC} $1"; }
err()  { echo -e "${RED}[provision][ERROR]${NC} $1" >&2; exit 1; }

[ -n "$SRC_KIND" ] || err "必须指定密钥来源之一：--gen / --from <host:path> / --from-stdin"

KEY_DIR="$(dirname "$KEY_FILE")"
case "$KEY_FILE" in
  "$ROOT"/*) warn "目标路径在仓库工作区内（${KEY_FILE}）：确认它被 .gitignore 覆盖，绝不要提交" ;;
esac

if [ "$SRC_KIND" = "scp" ]; then
  command -v scp >/dev/null 2>&1 || err "未找到 scp（--from 需要 OpenSSH 客户端）"
elif [ "$SRC_KIND" = "gen" ]; then
  command -v openssl >/dev/null 2>&1 || err "未找到 openssl（--gen 需要它生成随机密钥）"
fi

step "目标密钥文件 : ${KEY_FILE}"
step "来源         : $SRC_KIND${SRC_FROM:+（$SRC_FROM）}"
step "权限         : 目录 0700 / 文件 0600，属主 $(id -un)"
[ "$DRY_RUN" = "1" ] && step "模式         : DRY-RUN（不落盘）"

# ---------- 1. 目录（必须先建好：临时文件写在同目录才能原子 mv） ----------
umask 077
if [ "$DRY_RUN" != "1" ]; then
  [ -d "$KEY_DIR" ] || { step "创建目录 ${KEY_DIR}（0700）..."; mkdir -p "$KEY_DIR" || err "创建目录失败"; }
  chmod 700 "$KEY_DIR"
fi

# ---------- 2. 取到值（写临时文件，不进参数/历史） ----------
TMP="${KEY_FILE}.tmp.$$"
cleanup() { rm -f "$TMP" "${TMP}.norm"; }
trap cleanup EXIT

if [ "$DRY_RUN" != "1" ]; then
  case "$SRC_KIND" in
    gen)
      step "生成随机密钥（openssl rand -base64 32）..."
      openssl rand -base64 32 > "$TMP" || err "openssl 生成失败"
      ;;
    scp)
      step "从 ${SRC_FROM} 取钥（scp 直传，不经过终端/历史）..."
      scp -q "$SRC_FROM" "$TMP" || err "scp 取钥失败（检查免密登录与远端路径）"
      ;;
    stdin)
      step "请粘贴主密钥后回车（输入不回显、不进 shell 历史）..."
      if ! read -rs KEY; then err "读取输入失败"; fi
      echo
      printf '%s' "$KEY" > "$TMP"
      unset KEY
      ;;
  esac

  # 归一化：去掉换行/CR（三种形态的解析都能容忍首尾空白，但保证单行更稳）
  tr -d '\r\n' < "$TMP" > "${TMP}.norm" || err "归一化失败"
  mv "${TMP}.norm" "$TMP"
  [ -s "$TMP" ] || err "密钥内容为空，中止（未改动现有文件）"
fi

# ---------- 3. 落盘（备份 → 覆盖 → 收权限） ----------
if [ "$DRY_RUN" != "1" ]; then
  if [ -f "$KEY_FILE" ]; then
    BAK="${KEY_FILE}.bak-$(date +%Y%m%d%H%M%S)"
    step "备份现有密钥 → $(basename "$BAK")"
    cp -p "$KEY_FILE" "$BAK" || err "备份失败"
    # 只保留最近 $KEEP 份
    ls -1t "${KEY_FILE}".bak-* 2>/dev/null | tail -n +"$((KEEP + 1))" | while IFS= read -r old; do
      rm -f "$old" || true
    done
  fi

  mv "$TMP" "$KEY_FILE" || err "写入失败"
  chmod 600 "$KEY_FILE" || err "chmod 600 失败"
fi

# ---------- 4. 指纹（不打印密钥值） ----------
if [ "$DRY_RUN" = "1" ]; then
  step "DRY-RUN 结束：未改动任何文件"
  exit 0
fi

if [ -f "$ROOT/scripts/verify-config-master-key.mjs" ]; then
  step "密钥指纹（用于与同域其他机器比对）："
  node "$ROOT/scripts/verify-config-master-key.mjs" --key-file "$KEY_FILE" --fingerprint-only || warn "指纹打印失败（不阻断）"
else
  warn "未找到 scripts/verify-config-master-key.mjs，跳过指纹打印"
fi

step "下一步："
echo "  1) 与同域既有机器比对指纹（必须一致，不一致说明拿错了钥）"
echo "  2) 重启 console：./scripts/publish-deploy-console.sh --skip-build"
echo "  3) 确认启动日志出现 [ConfigSelfCheck] 主密钥就绪 … 抽样可解=1/1"
echo "  4) 确认 .env 里的 CONFIG_MASTER_KEY 行已注释/删除（注入的文件路径优先，两者会校验一致）"
