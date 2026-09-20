#!/usr/bin/env bash
# ============================================================
# scan-rules.sh — 红线扫描核心库（R1~R8 集中实现）
#
# 设计（对应 docs/development/ai-native-sdlc-ci-deployment.md §2.1）：
#   R1~R4 = error 级（违规即非零退出）
#   R5/R8 = warning 级（默认仅提示，--strict 时升级为非零）
#   只扫「新增/变更行」，存量违规不背锅
#
# 用法:
#   scan-rules.sh cached                 # 扫描 git staged 变更（pre-commit 用）
#   scan-rules.sh diff <ref>             # 扫描某 git 变更范围（CI 用，如 origin/master...HEAD）
#   scan-rules.sh files <path...>        # 直接扫描给定文件/目录
#   scan-rules.sh tree [dir]             # 全仓扫描工作区（本地巡检用，较慢）
# 选项:
#   --strict    warning 级也返回非零
#   --no-color  禁用彩色输出
#
# 返回码: 0=通过  1=存在 error 级违规（或 --strict 下的 warning）
# 白名单/阈值调整：改下方 R* 判定函数，勿改调用方
# ============================================================
set -uo pipefail

# 定位仓库根（git 仓库内取 git root；否则按脚本位置推断）
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  TOP="$(git rev-parse --show-toplevel)"
else
  TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fi
cd "$TOP"

STRICT=0
COLOR=1
MODE=""
declare -a MODE_ARGS=()
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'

# ---- 违规收集 ----
declare -a ERRS=() WARNS=()
add_err()  { ERRS+=("$1|$2|$3|$4"); }
add_warn() { WARNS+=("$1|$2|$3|$4"); }
# add_err <规则> <说明> <定位> <内容>

# ---- 文件判定辅助 ----
is_code_file() { case "$1" in *.ts|*.tsx|*.vue|*.js|*.jsx|*.mjs|*.cjs) return 0;; *) return 1;; esac; }
is_ts_file()   { case "$1" in *.ts|*.tsx|*.vue) return 0;; *) return 1;; esac; }
is_test_path() { case "$1" in */test/*|*/tests/*|*/__tests__/*|*/spec/*|*.spec.*|*.test.*|*/fixtures/*|*/mocks/*|*/mock/*) return 0;; *) return 1;; esac; }
is_example()   { case "$1" in *.example.*|*.md) return 0;; *) return 1;; esac; }
is_comment_line() {
  local s="$1"
  case "$s" in
    '//'*|'/*'*|'*'*|'#'*|'<!--'*) return 0;;
    *) return 1;;
  esac
}

# ---- 行级规则（error 级）----
check_line_error() {
  local file="$1" line="$2" content="$3" s
  is_code_file "$file" || return 0
  s="$(printf '%s' "$content" | sed -E 's/^[[:space:]]*//')"

  # R1 调试残留（注释里提 console.log 属说明，跳过注释行）
  if ! is_comment_line "$s"; then
    if printf '%s' "$content" | grep -qE '\b(console\.(log|debug)\(|debugger\b)'; then
      add_err "R1" "调试残留(console.log/debug/debugger)" "${file}:${line}" "$content"
    fi
  fi
  # R3 占位残留（TODO/FIXME 常写在注释里，不跳过注释行）
  if printf '%s' "$content" | grep -qE '\b(TODO|FIXME)\b'; then
    add_err "R3" "占位残留(TODO/FIXME)" "${file}:${line}" "$content"
  fi
  # R4 TS 铁律：@ts-ignore / @ts-nocheck 本身是注释指令，不跳过
  if printf '%s' "$content" | grep -qE '@ts-(ignore|nocheck)'; then
    add_err "R4" "TS 铁律违反(@ts-ignore/nocheck)" "${file}:${line}" "$content"
  fi
  # R4 TS 铁律：裸 : any（.d.ts 与 test 夹具豁免；跳过注释行）
  if ! is_comment_line "$s" && is_ts_file "$file" && ! is_test_path "$file" && [[ "$file" != *.d.ts ]]; then
    if printf '%s' "$content" | grep -qE ':[[:space:]]*any([[:space:],);\]}]|$)'; then
      add_err "R4" "TS 铁律违反(: any)" "${file}:${line}" "$content"
    fi
  fi
}

# ---- 行级规则（warning 级）----
check_line_warn() {
  local file="$1" line="$2" content="$3" s
  is_code_file "$file" || return 0
  s="$(printf '%s' "$content" | sed -E 's/^[[:space:]]*//')"

  # R3b 弱占位（注释里出现同样算占位，不跳过）
  if printf '%s' "$content" | grep -qE '\b(TEMP|TBD|HACK|XXX)\b'; then
    add_warn "R3" "弱占位(TEMP/TBD/HACK/XXX)" "${file}:${line}" "$content"
  fi
  # R5 CORS（server 源码目录才判定；跳过注释行）
  case "$file" in
    servers/*/src/*|servers/gateway/src/*)
      if ! is_comment_line "$s" \
          && { printf '%s' "$content" | grep -qE 'enableCors\(\s*\)' \
          || printf '%s' "$content" | grep -qE "origin\s*:\s*['\"]\*['\"]"; }; then
        add_warn "R5" "CORS 疑似硬编码" "${file}:${line}" "$content"
      fi ;;
  esac
}

# ---- 文件级规则 ----
check_file() {
  local file="$1"
  # R2a 敏感文件类型
  if [[ "$file" =~ (^|/)[^/]*\.(pem|key|crt|cert)$ ]]; then
    add_err "R2" "敏感文件入库" "$file" "证书/私钥文件不应提交"
  fi
  if [[ "$file" =~ (^|/)\.env($|\.) ]] && ! [[ "$file" == *.example* ]]; then
    add_err "R2" "敏感文件入库" "$file" ".env* 不应提交（.gitignore 已兜底）"
  fi
  # R5+R8 main.ts
  case "$file" in
    servers/*/src/main.ts)
      if grep -qE 'enableCors\(\s*\)' "$file"; then
        add_warn "R5" "CORS 无参启用" "$file" "应读取 config CORS_ORIGINS"
      fi
      if grep -q 'enableCors' "$file" && ! grep -q 'useGlobalFilters' "$file"; then
        add_warn "R8" "main.ts 缺全局异常过滤器" "$file" "enableCors 存在但未注册 useGlobalFilters"
      fi
      ;;
  esac
}

# ---- R2b 硬编码凭据 ----
check_cred_line() {
  local file="$1" line="$2" content="$3" s
  is_example "$file" && return 0
  is_test_path "$file" && return 0
  s="$(printf '%s' "$content" | sed -E 's/^[[:space:]]*//')"
  is_comment_line "$s" && return 0  # 注释里的示例凭据不拦（如配置说明文档）
  # 形如 apiSecret: string = '...' 也命中：敏感词后允许类型注解等 token，再到 '='
  # 注：逐行扫描（read 已去行尾），字符类不含 \n（macOS BSD grep 的 \n 处理有坑）
  if printf '%s' "$content" | grep -qiE '(password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token)[^=;]*=[[:space:]]*["'"'"'][^"'"'"']{8,}'; then
    add_err "R2" "疑似硬编码凭据" "${file}:${line}" "$content"
  fi
}

# ---- 单行检查封装（文件+行号+内容）----
check_one_line() {
  local file="$1" line="$2" content="$3"
  check_file "$file"
  check_line_error "$file" "$line" "$content"
  check_line_warn "$file" "$line" "$content"
  check_cred_line "$file" "$line" "$content"
}

# ---- diff 模式：数组缓冲规避子 shell，主 shell 逐行检查 ----
scan_diff_range() {
  local range="$1" diff_text dl add cur_file=""
  local -a pending=()
  diff_text="$(git diff --no-color --unified=0 "$range" -- '*.ts' '*.tsx' '*.vue' '*.js' '*.jsx' '*.mjs' '*.cjs' 2>/dev/null)"
  [ -n "$diff_text" ] || return 0
  while IFS= read -r dl; do
    case "$dl" in
      +++\ b/*) cur_file="${dl#+++ b/}"; continue ;;
      +++*) cur_file=""; continue ;;
      @@*) continue ;;
      +*)  # 新增行
        add="${dl#+}"
        [ -n "$cur_file" ] && [ -n "$add" ] && pending+=("$cur_file|$add")
        ;;
    esac
  done <<< "$diff_text"
  local rec file content
  for rec in "${pending[@]}"; do
    file="${rec%%|*}"; content="${rec#*|}"
    check_one_line "$file" "" "$content"
  done
}

# ---- cached 模式（pre-commit）----
scan_cached() {
  local f
  # R2a 文件名检查（新增/修改/重命名）
  while IFS= read -r f; do
    [ -n "$f" ] && check_file "$f"
  done < <(git diff --cached --name-only --diff-filter=ACM)
  # 行级规则（只扫新增行）
  scan_diff_range --cached
}

# ---- files / tree 模式 ----
scan_one_file() {
  local f="$1" line_no=0 content
  [ -f "$f" ] || { echo "跳过(不存在): $f" >&2; return 0; }
  check_file "$f"
  is_code_file "$f" || return 0
  while IFS= read -r content; do
    line_no=$((line_no + 1))
    check_line_error "$f" "$line_no" "$content"
    check_line_warn "$f" "$line_no" "$content"
    check_cred_line "$f" "$line_no" "$content"
  done < "$f"
}

scan_tree() {
  local dir="${1:-.}" f rel
  [ -d "$dir" ] || { echo "目录不存在: $dir" >&2; return 0; }
  while IFS= read -r -d '' f; do
    rel="${f#./}"
    case "$rel" in
      .git/*|node_modules/*|*/node_modules/*|*/dist/*|*/build/*|*/coverage/*|public/static/modules/*) continue ;;
    esac
    scan_one_file "$rel"
  done < <(find "$dir" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.vue' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) -print0 2>/dev/null)
}

# ---- 参数解析 ----
while [ $# -gt 0 ]; do
  case "$1" in
    --strict)   STRICT=1 ;;
    --no-color) COLOR=0 ;;
    -h|--help)  sed -n '1,28p' "$0"; exit 0 ;;
    --*)        echo "未知选项: $1" >&2; exit 2 ;;
    *)          if [ -z "$MODE" ]; then MODE="$1"; else MODE_ARGS+=("$1"); fi ;;
  esac
  shift
done

case "$MODE" in
  cached) scan_cached ;;
  diff)
    [ ${#MODE_ARGS[@]} -ge 1 ] || { echo "用法: scan-rules.sh diff <range>（如 origin/master...HEAD）" >&2; exit 2; }
    scan_diff_range "${MODE_ARGS[0]}"
    ;;
  files)
    [ ${#MODE_ARGS[@]} -ge 1 ] || { echo "用法: scan-rules.sh files <path...>" >&2; exit 2; }
    for f in "${MODE_ARGS[@]}"; do scan_one_file "$f"; done
    ;;
  tree) scan_tree "${MODE_ARGS[0]:-.}" ;;
  *) sed -n '1,28p' "$0" >&2; exit 2 ;;
esac

# ---- 输出与返回 ----
[ "$COLOR" = "1" ] || { G=''; Y=''; R=''; N=''; B=''; }
code=0
if [ ${#ERRS[@]} -gt 0 ]; then
  code=1
  echo -e "${B}══ 红线违规（error）══${N}"
  for v in "${ERRS[@]}"; do
    IFS='|' read -r rule desc loc content <<<"$v"
    echo -e "  ${R}[$rule]${N} ${B}${desc}${N}"
    echo -e "       ${B}${loc}${N}"
    [ -n "$content" ] && echo -e "       ${Y}${content}${N}"
  done
fi
if [ ${#WARNS[@]} -gt 0 ]; then
  if [ "$STRICT" = "1" ]; then code=1; fi
  echo -e "${B}══ 红线提示（warning）══${N}"
  for v in "${WARNS[@]}"; do
    IFS='|' read -r rule desc loc content <<<"$v"
    echo -e "  ${Y}[$rule]${N} ${desc}"
    echo -e "       ${B}${loc}${N}"
    [ -n "$content" ] && echo -e "       $content"
  done
fi

if [ "$code" = "0" ]; then
  echo -e "${G}✓ 红线扫描通过（${#ERRS[@]} error / ${#WARNS[@]} warning）${N}"
else
  echo -e "${R}✗ 红线扫描未通过（${#ERRS[@]} error / ${#WARNS[@]} warning）${N}"
fi
exit "$code"
