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

# ---- R9 UI 结构变更须同行原型/规格（文件级 · warning 级）----
# 触发：diff 内 ① apps/*/pages/** 新增文件；或 ② app.json 的 pages/tabBar 段变化
# 判据：同 diff 须同时出现通行证路径：apps/*/prototype/** / docs/ui/prototypes/** / specs/**/page-spec*.md
# 不命中 → 报 warning（--strict 升级为 error）。设计：specs/kit-sop-enforcement/design.md §3.5
check_r9() {
  local range="$1" st path ia=0
  local -a new_pages=() passport=()
  while IFS=$'\t' read -r st path; do
    [ -n "${path:-}" ] || continue
    case "$st" in
      A*) case "$path" in apps/*/pages/*) new_pages+=("$path") ;; esac ;;
    esac
    case "$path" in
      */prototype/*|docs/ui/prototypes/*|*/page-spec*.md) passport+=("$path") ;;
    esac
  done < <(git diff --name-status --no-renames "$range" -- 2>/dev/null)
  # app.json 信息架构（pages / tabBar 段）变化
  local ia_files
  ia_files="$(git diff --name-only --no-renames "$range" -- 'app.json' 'apps/*/app.json' 2>/dev/null)"
  if [ -n "$ia_files" ]; then
    if git diff -U0 --no-color "$range" -- 'app.json' 'apps/*/app.json' 2>/dev/null \
       | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' | grep -qE '"(pages|tabBar)"'; then
      ia=1
    fi
  fi
  [ ${#new_pages[@]} -eq 0 ] && [ "$ia" = "0" ] && return 0
  [ ${#passport[@]} -gt 0 ] && return 0
  local loc="app.json 信息架构(pages/tabBar)变化"
  [ ${#new_pages[@]} -gt 0 ] && loc="新增 UI 页面 ${#new_pages[@]} 个"
  add_warn "R9" "UI 结构变更未经原型/规格" "$loc" "须同 diff 含 apps/*/prototype/** 或 specs/**/page-spec*.md（见 specs/kit-sop-enforcement/design.md）"
}

is_ui_file() {
  case "$1" in
    *.wxml|*.wxss|*.vue) return 0 ;;
    apps/*/pages/*) return 0 ;;
    apps/*/components/*) return 0 ;;
    apps/*/src/*.vue) return 0 ;;
    packages/ui/*) return 0 ;;
    app.json|apps/*/app.json) return 0 ;;
  esac
  return 1
}

is_passport_file() {
  case "$1" in
    */prototype/*|docs/ui/prototypes/*|*/page-spec*.md|page-spec*.md) return 0 ;;
  esac
  return 1
}

# ---- R9b 既有 UI 改动须同行原型/豁免（文件级 · warning 级）----
# 补 R9 的覆盖缺口：R9 只卡新增页面与信息架构，改既有交互/样式一行不报（§3.5.1）。
# 阈值：UI 文件改动累计行数 >= 5，或 diff 含结构标签（<view / <template / <block）。
# 豁免：同 range 内 commit message 带 `Micro-exempt: <理由>`。
R9B_LINE_THRESHOLD="${R9B_LINE_THRESHOLD:-5}"
check_r9b() {
  local range="$1" st path passport=0
  local -a ui_files=()
  while IFS=$'\t' read -r st path; do
    [ -n "${path:-}" ] || continue
    case "$st" in A*) continue ;; esac          # 新增页面由 R9 管
    if is_ui_file "$path"; then ui_files+=("$path"); fi
    if is_passport_file "$path"; then passport=1; fi
  done < <(git diff --name-status --no-renames "$range" -- 2>/dev/null)

  [ ${#ui_files[@]} -eq 0 ] && return 0
  [ "$passport" = "1" ] && return 0

  local lines=0 struct=0
  lines="$(git diff --numstat --no-renames "$range" -- "${ui_files[@]}" 2>/dev/null | awk '{a+=$1+$2} END{print a+0}')"
  if git diff -U0 --no-color "$range" -- "${ui_files[@]}" 2>/dev/null \
     | grep -E '^\+' | grep -qE '<(view|template|block)'; then
    struct=1
  fi
  [ "${lines:-0}" -lt "$R9B_LINE_THRESHOLD" ] && [ "$struct" = "0" ] && return 0

  if git log --format=%B "$range" 2>/dev/null | grep -qE '^Micro-exempt:'; then
    return 0
  fi
  add_warn "R9b" "既有 UI 改动无同行原型/豁免" "${#ui_files[@]} 个文件 / ${lines} 行" "须同行改原型/规格（apps/*/prototype/**、specs/**/page-spec*.md），或 commit 带 Micro-exempt: <理由>（§3.5.1）"
}

# ---- R10 UI commit 须带 Proto 凭证（commit 级 · warning 级）----
# 方案 B 的 CI 兜底：本地可被 --no-verify 绕过，故这里再验一次（§3.8）。
check_r10() {
  local range="$1"
  local -a commits=()
  while IFS= read -r c; do
    [ -n "$c" ] && commits+=("$c")
  done < <(git rev-list --reverse "$range" 2>/dev/null)
  [ ${#commits[@]} -eq 0 ] && return 0

  local c f sha isui
  for c in "${commits[@]}"; do
    isui=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if is_ui_file "$f"; then isui=1; break; fi
    done < <(git show --name-only --format= "$c" 2>/dev/null)
    [ "$isui" -eq 0 ] && continue

    body="$(git log -1 --format=%B "$c" 2>/dev/null)"
    # 「微调豁免」语义与 R9b 保持一致：纯视觉微调在 commit 层同样被认，避免两套口径制造摩擦
    if printf '%s' "$body" | grep -qE '^Micro-exempt:'; then
      continue
    fi

    sha="$(printf '%s' "$body" | grep -E '^Proto:[[:space:]]*[0-9a-fA-F]{7,40}' | head -n 1 | awk '{print $2}')"
    if [ -z "$sha" ]; then
      add_warn "R10" "UI commit 缺 Proto 凭证" "$(git log -1 --format=%s "$c")" "UI 源码 commit 的 message 须带 Proto: <已确认原型的 sha>（§3.8）"
      continue
    fi
    if ! git merge-base --is-ancestor "$sha" "$c^" 2>/dev/null; then
      add_warn "R10" "UI commit 的 Proto 指向非祖先" "$sha" "Proto 必须指向已落库的原型/规格 commit（§3.8）"
    fi
  done
}

# ---- R11 设计评审凭证（commit 级 · error 级）----
# 设计：specs/design-reviewer/design.md §3.7（2026-09-22 拍板：直接 error，不设 warning 观察期）
# 判据：① 含 UI 源码的 commit 须带 `Design: pass`；② 报告头部 `阻塞: N` 须为 0
# 作用域：仅对含 UI 源码 / 原型规格的 commit 生效，纯后端 PR 零摩擦
# 豁免：`Micro-exempt:` 与 R9b / R10 同口径（避免"记了豁免还报错"的新摩擦）
check_r11() {
  local range="$1"
  local -a commits=()
  while IFS= read -r c; do
    [ -n "$c" ] && commits+=("$c")
  done < <(git rev-list --reverse "$range" 2>/dev/null)
  [ ${#commits[@]} -eq 0 ] && return 0

  local c f body dval n isui
  for c in "${commits[@]}"; do
    isui=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if is_ui_file "$f"; then isui=1; break; fi
    done < <(git show --name-only --format= "$c" 2>/dev/null)

    body="$(git log -1 --format=%B "$c" 2>/dev/null)"
    dval="$(printf '%s' "$body" | grep -E '^Design:[[:space:]]*[^[:space:]]+' | head -n 1 | sed -E 's/^Design:[[:space:]]*//' | tr -d '\r')"

    if [ "$isui" -eq 0 ]; then
      # 原型/规格 commit：若带 Design: <报告路径>，校验报告存在且阻塞清零
      [ -z "$dval" ] && continue
      [ "$dval" = "pass" ] && continue
      if ! git cat-file -e "$c:$dval" 2>/dev/null; then
        add_err "R11" "Design 凭证指向的报告不存在" "$dval" "报告须落盘 docs/ui/reviews/*.md 并与原型/规格同 commit（§3.7）"
        continue
      fi
      n="$(git show "$c:$dval" 2>/dev/null | grep -E '^阻塞:[[:space:]]*[0-9]+' | head -n 1 | grep -oE '[0-9]+' | head -n 1)"
      if [ "${n:-0}" -gt 0 ]; then
        add_err "R11" "设计评审阻塞项未清零" "${dval}（阻塞: ${n}）" "报告头部 阻塞: N 且 N>0 不得进入实现（§3.7）"
      fi
      continue
    fi

    if printf '%s' "$body" | grep -qE '^Micro-exempt:'; then
      continue
    fi
    if [ -z "$dval" ]; then
      add_err "R11" "UI commit 缺设计评审凭证" "$(git log -1 --format=%s "$c")" "UI 源码 commit 的 message 须带 Design: pass（D3 已过）；纯视觉微调走 Micro-exempt: <理由>（§3.7）"
      continue
    fi
    if [ "$dval" != "pass" ]; then
      add_err "R11" "UI commit 的 Design 凭证非 pass" "$dval" "UI commit 须写 Design: pass；报告路径应挂在原型/规格 commit 上（§3.7）"
    fi
  done
}

# ---- R11b 原型锚点漂移（diff 级 · 受 DESIGN_ANCHOR_MODE 控制）----
# off（默认，存量回填前）→ 跳过；warn → 提示；strict → error
# 存量回填分批推进：docs/ui/anchor-backlog.md（§3.7.1；Q4 批次序、Q5 单批先 warn 再 strict）
# 「未回填 ≠ 已漂移」：原型侧无 data-dr 时扫描器输出 SKIP，此处不判违规
#   off     全部跳过（默认，存量回填前）
#   warn    全部提示
#   strict  全部 error
#   scoped  DESIGN_ANCHOR_SCOPE 内的 app → error，其余 → warn（按批次推进用，Q5）
DESIGN_ANCHOR_MODE="${DESIGN_ANCHOR_MODE:-off}"
DESIGN_ANCHOR_SCOPE="${DESIGN_ANCHOR_SCOPE:-}"
check_r11b() {
  local range="$1"
  [ "$DESIGN_ANCHOR_MODE" = "off" ] && return 0
  local py="$TOP/scripts/redline/scan-design-drift.py"
  [ -f "$py" ] || return 0
  local out lvl rule loc msg sev app
  out="$(python3 "$py" anchors "$range" 2>/dev/null)"
  [ -n "$out" ] || return 0
  while IFS=$'\t' read -r lvl rule loc msg; do
    [ -n "${lvl:-}" ] || continue
    case "$lvl" in
      MISSING|EXTRA)
        sev=warn
        if [ "$DESIGN_ANCHOR_MODE" = "strict" ]; then
          sev=err
        elif [ "$DESIGN_ANCHOR_MODE" = "scoped" ] && [ -n "$DESIGN_ANCHOR_SCOPE" ]; then
          app="${loc%% *}"   # loc 形如 "<app> · <key>"
          case ",${DESIGN_ANCHOR_SCOPE}," in
            *",${app},"*) sev=err ;;
          esac
        fi
        if [ "$sev" = "err" ]; then
          add_err "$rule" "原型锚点漂移（${lvl}）" "$loc" "$msg"
        else
          add_warn "$rule" "原型锚点漂移（${lvl}）" "$loc" "$msg"
        fi ;;
    esac
  done <<EOF
$out
EOF
}

# ---- 通用骨架：两处应同源的路径比对（可复用）----
# 用法：check_sync_pair <规则号> <说明> <源> <目标> <排除项...>
# 语义：以源为准 —— ① 目标有此文件但内容不同 → 漂移；② 目标缺失 → 未同步。
#       排除项按「相对路径包含匹配」跳过（项目专属 / 下游定制，永不覆盖）。
# 级别：warning（--strict 下 error），并**打印建议修复命令**——报警自带处方，无需额外 apply 脚本。
# 同源守门家族：R9/R9b/R10（原型同行）、R11（设计评审凭证）、R12（kit 同源）共用本套机制。
check_sync_pair() {
  local rule="$1" desc="$2" src="$3" dst="$4"; shift 4
  local -a excl=("$@")
  [ -d "$src" ] || return 0
  local rel f x skip
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    rel="${f#$src/}"
    skip=0
    for x in ${excl[@]+"${excl[@]}"}; do
      case "$rel" in *"$x"*) skip=1; break ;; esac
    done
    [ "$skip" -eq 1 ] && continue
    if [ ! -e "$dst/$rel" ]; then
      add_warn "$rule" "${desc}（目标缺失，未同步）" "$rel" "建议：mkdir -p \"$(dirname "$dst/$rel")\" && cp \"$src/$rel\" \"$dst/$rel\""
    elif [ -f "$dst/$rel" ] && ! cmp -s "$f" "$dst/$rel"; then
      add_warn "$rule" "${desc}（内容漂移）" "$rel" "建议：cp \"$src/$rel\" \"$dst/$rel\""
    fi
  done < <(find "$src" -type f -print 2>/dev/null)
  return 0
}

# ---- R12 kit 能力源 ↔ 运行源 同源守门 ----
# 背景：上游 ai-agent-kit 经 sync-to-target 只写 .codebuddy/agent-kit/（能力源），
#       而 IDE 加载的是 .codebuddy/skills/（运行源），中间缺 apply → 漂移（#117/#118 即此坑）。
# 保护清单：项目专属技能（只在运行源）与下游定制文件（同步时永不覆盖）跳过比对。
check_r12() {
  check_sync_pair "R12" "kit 能力源与运行源漂移" \
    ".codebuddy/agent-kit/skills" ".codebuddy/skills" \
    "be-developer" "fe-developer" "design-reviewer" \
    "rd-digital-agent/references/project-context.md"
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
  check_r9 "$range"   # R9：文件级 UI 结构门禁（warning 级，先于行扫描）
  check_r9b "$range"  # R9b：既有 UI 改动门禁（补 R9 覆盖缺口）
  check_r10 "$range"  # R10：UI commit 的 Proto 凭证（方案 B CI 兜底）
  check_r11 "$range"  # R11：设计评审凭证（error 级 · specs/design-reviewer/design.md §3.7）
  check_r11b "$range" # R11b：原型锚点漂移（受 DESIGN_ANCHOR_MODE 控制，默认 off）
  check_r12           # R12：kit 能力源 ↔ 运行源 同源守门（不依赖 range）
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
  # bash 3.2（macOS 自带）在 set -u 下展开空数组会报 unbound variable；
  # 只改非代码文件时 diff_text 为空 → pending 为空 → 原本会阻断正常提交。
  local rec file content
  for rec in ${pending[@]+"${pending[@]}"}; do
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
