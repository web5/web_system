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
#   --max-commits <N>  diff 模式范围 commit 数上限（默认 300，0=不限；env SCAN_MAX_COMMITS 同效）
# 环境变量:
#   SCAN_PROFILE=1  逐门打印耗时到 stderr（`+Ns` 本段 / `累计 Ns` 总计，定位慢门用）
#
# 返回码: 0=通过  1=存在 error 级违规（或 --strict 下的 warning）  2=用法/范围错误
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

# 门禁共享判定库（豁免机制 2.7/2.8 + 规格书识别 2.6）
# 为什么 source 而不是各写一份：豁免判定横跨 scan-rules.sh 与 check-commit-msg.sh，
# 两份实现口径一旦漂移就会出现「本地认、CI 不认」—— 2.8 要消灭的正是这类摩擦。
#
# ⚠️ 路径按**脚本自身位置**解析，不能用 $TOP：
#   scan-rules.sh 会被用来扫别的仓库（本地自测、临时仓库、其它 worktree），
#   此时 $TOP 是被扫仓库的根，脚本却住在本仓库 —— 用 $TOP 会找不到库文件。
# shellcheck source=SC1091
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gate-shared.sh"

STRICT=0
COLOR=1
MODE=""
declare -a MODE_ARGS=()
# 扫描范围 commit 数上限（0 = 不限制）。见 diff 分支里的「范围过大」判定。
# 300 的依据：正常 PR 范围 <20、月度自查通常 <100；300 commit 实测约 3~4 分钟，
#   仍在一个人类愿意等的量级内；再往上就到了"没人会等"的区间，应该缩范围。
MAX_COMMITS="${SCAN_MAX_COMMITS:-300}"
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[1m'; N='\033[0m'

# ---- 违规收集 ----
declare -a ERRS=() WARNS=()
add_err()  { ERRS+=("$1|$2|$3|$4"); }
add_warn() { WARNS+=("$1|$2|$3|$4"); }
# add_err <规则> <说明> <定位> <内容>

# ---- 分阶段计时（SCAN_PROFILE=1 时打到 stderr，不影响 stdout 判定）----
# 动机：2026-10-22 实测一次 diff 扫描 10 分 29 秒，凭猜找不到瓶颈（怀疑行级 fork 风暴，
#   实测是 R12/R16 的全仓遍历）。留着比"再猜一次"便宜。
# 输出两列（2026-10-30 加）：`+N s` = 本段耗时（定位成本用），`累计 N s` = 从启动起算。
#   只有累计值时得做减法才知道哪段贵 —— 2026-10-30 实测 1517 commit 全历史时正是靠
#   相邻两行相减才发现 R11 单门吃掉 248s（占 commit 门 35%）。
_PROF_LAST=0
_prof() {
  [ "${SCAN_PROFILE:-0}" = "1" ] || return 0
  local _d=$((SECONDS - _PROF_LAST))
  _PROF_LAST=$SECONDS
  printf '[prof] %-28s +%4ss  累计 %ss\n' "$1" "$_d" "$SECONDS" >&2
}

# ---- 文件判定辅助 ----
_MAINTS_SEEN=""   # check_file 的 main.ts 判定去重标记（set -u 下必须先初始化）
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

# 去掉行首空白（等价于 sed -E 's/^[[:space:]]*//'，但零子进程）
# 为何不能用 "$(printf … | sed …)"：macOS 上每次 fork/exec 实测 ~80ms，
#   一次 diff 扫描上万行 → 十几分钟（2026-10-22 实测 10m29s）。
# 又为何不写成函数返回：$( ) 本身就是 subshell = 一次 fork。故结果写入全局 _S。
lstrip_to_s() {
  _S="$1"
  while [[ "$_S" == [[:blank:]]* ]]; do _S="${_S:1}"; done
}

# ---- 行级正则常量（集中定义，供 [[ =~ ]] 用；避免每次调用重复构造）----
# 用 `[[ $x =~ $VAR ]]` 而非字面量：正则含 ( ) | ; " ' 时字面量会被 shell 语法解析。
# `\s` 一律换 [[:space:]]：POSIX ERE 无 \s，bash 的 =~ 是 POSIX ERE。
RE_R1='(^|[^0-9A-Za-z_])(console\.(log|debug)\(|debugger([^0-9A-Za-z_]|$))'
RE_R3='(^|[^0-9A-Za-z_])(TODO|FIXME)([^0-9A-Za-z_]|$)'
RE_R3B='(^|[^0-9A-Za-z_])(TEMP|TBD|HACK|XXX)([^0-9A-Za-z_]|$)'
RE_R4TS='@ts-(ignore|nocheck)'
# 词界写法：`: any` 后接非标识符字符即命中（覆盖空格 / , ) ; } ] [ = $ 等全部形态）。
# 原写法 `[[:space:],);\]}]` 的 \] 在 POSIX 字符类里不是转义 → 整个类解析错，
# 只剩 `|$)` 分支有效，`const a: any = 1` / `any[]` / `x: any;` 全部漏报（存量 bug）。
RE_R4ANY=':[[:space:]]*any([^0-9A-Za-z_]|$)'
RE_R5A='enableCors\([[:space:]]*\)'
RE_R5B="origin[[:space:]]*:[[:space:]]*[\"']\\*[\"']"
RE_CRED="(password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token)[^=;]*=[[:space:]]*[\"'][^\"']{8,}"

# ---- 行级规则（error 级）----
check_line_error() {
  local file="$1" line="$2" content="$3" s
  is_code_file "$file" || return 0
  lstrip_to_s "$content"; s="$_S"

  # R1 调试残留（注释里提 console.log 属说明，跳过注释行）
  # 豁免：仓库根 scripts/ 一级目录的 CLI 工具（*.mjs / *.cjs）——
  #   debug-local / build-subset-externals / verify-cdn-subsets 这类脚本的
  #   stdout 输出是**产品行为**（进度/结论日志），不是调试残留（2026-09-29，CI 实测误报）。
  #   仅豁免一级目录，scripts/db 等子目录业务代码不豁免。
  #
  # 同性质扩展（2026-10-10，CI 实测误报）：apps/*/scripts/*.{js,mjs,cjs} 一级目录。
  #   apps/kedou-ai-minigram/scripts/{preview,upload}.js 是 miniprogram-ci CLI 工具，
  #   「预览成功 / 二维码路径 / 请用微信扫码」这类 console.log 是**给开发者看的产品输出**，
  #   与根 scripts 的 debug-local 完全同构；与根 scripts 一样只豁免一级目录，
  #   apps/*/src 下的业务代码不受影响。
  #
  # 同性质扩展（2026-10-21，CI 实测误报）：archive/migrations/*.{mjs,cjs} 一级目录。
  #   迁移脚本（p26~p37 等）是「给运维手动跑的 CLI 工具」，console.log 是**进度/结论日志**，
  #   与根 scripts 的 debug-local、apps/*/scripts 的 miniprogram-ci 完全同构（产品行为，非调试残留）。
  #   仅豁免 archive/migrations 一级目录；迁移脚本引用的业务代码不受影响。
  #
  # 同性质扩展（2026-10-22，CI 实测误报 · PR #379）：.codebuddy/[agent-kit/]skills/<skill>/scripts/*.{js,mjs,cjs}。
  #   skill 自带的**机检/脚手架脚本**（如 ux-prototype-designer 的 check-demo-panel.mjs）
  #   靠 stdout 交付结果：`::error file=…::…` 是 GitHub Actions 注解格式，通过提示是给人看的结论。
  #   删掉就没有任何输出 —— 同 scripts/*.mjs，属产品行为。只豁免 skill 的 scripts/ 一级，
  #   skill 目录里其余 .mjs（若有）与业务代码不受影响。
  if ! is_comment_line "$s" \
     && ! [[ "$file" == scripts/*.mjs || "$file" == scripts/*.cjs \
          || "$file" == apps/*/scripts/*.js || "$file" == apps/*/scripts/*.mjs \
          || "$file" == apps/*/scripts/*.cjs \
          || "$file" == archive/migrations/*.mjs || "$file" == archive/migrations/*.cjs \
          || "$file" == .codebuddy/skills/*/scripts/*.js || "$file" == .codebuddy/skills/*/scripts/*.mjs \
          || "$file" == .codebuddy/skills/*/scripts/*.cjs \
          || "$file" == .codebuddy/agent-kit/skills/*/scripts/*.js \
          || "$file" == .codebuddy/agent-kit/skills/*/scripts/*.mjs \
          || "$file" == .codebuddy/agent-kit/skills/*/scripts/*.cjs ]]; then
    if [[ "$content" =~ $RE_R1 ]]; then
      add_err "R1" "调试残留(console.log/debug/debugger)" "${file}:${line}" "$content"
    fi
  fi
  # R3 占位残留（TODO/FIXME 常写在注释里，不跳过注释行）
  if [[ "$content" =~ $RE_R3 ]]; then
    add_err "R3" "占位残留(TODO/FIXME)" "${file}:${line}" "$content"
  fi
  # R4 TS 铁律：@ts-ignore / @ts-nocheck 本身是注释指令，不跳过
  if [[ "$content" =~ $RE_R4TS ]]; then
    add_err "R4" "TS 铁律违反(@ts-ignore/nocheck)" "${file}:${line}" "$content"
  fi
  # R4 TS 铁律：裸 : any（.d.ts 与 test 夹具豁免；跳过注释行）
  if ! is_comment_line "$s" && is_ts_file "$file" && ! is_test_path "$file" && [[ "$file" != *.d.ts ]]; then
    if [[ "$content" =~ $RE_R4ANY ]]; then
      add_err "R4" "TS 铁律违反(: any)" "${file}:${line}" "$content"
    fi
  fi
}

# ---- 行级规则（warning 级）----
check_line_warn() {
  local file="$1" line="$2" content="$3" s
  is_code_file "$file" || return 0
  lstrip_to_s "$content"; s="$_S"

  # R3b 弱占位（注释里出现同样算占位，不跳过）
  if [[ "$content" =~ $RE_R3B ]]; then
    add_warn "R3" "弱占位(TEMP/TBD/HACK/XXX)" "${file}:${line}" "$content"
  fi
  # R5 CORS（server 源码目录才判定；跳过注释行）
  case "$file" in
    servers/*/src/*|servers/gateway/src/*)
      if ! is_comment_line "$s" \
          && { [[ "$content" =~ $RE_R5A ]] || [[ "$content" =~ $RE_R5B ]]; }; then
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
  # 按文件缓存：diff/tree 模式每行都会调本函数，不缓存就等于每个 main.ts
  # 的每一行都读 3 次文件（`grep -q` 各一次）→ Fork 风暴。
  case "$file" in
    servers/*/src/main.ts)
      case " $_MAINTS_SEEN " in *" $file "*) return 0;; esac
      _MAINTS_SEEN="$_MAINTS_SEEN $file"
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
  lstrip_to_s "$content"; s="$_S"
  is_comment_line "$s" && return 0  # 注释里的示例凭据不拦（如配置说明文档）
  # 形如 apiSecret: string = '...' 也命中：敏感词后允许类型注解等 token，再到 '='
  # 注：逐行扫描（read 已去行尾），字符类不含 \n（macOS BSD grep 的 \n 处理有坑）
  # 大小写不敏感：bash 的 =~ 受 nocasematch 控制（原 grep -i），用完还原
  local _hadnm=0
  shopt -q nocasematch || { _hadnm=1; shopt -s nocasematch; }
  if [[ "$content" =~ $RE_CRED ]]; then
    add_err "R2" "疑似硬编码凭据" "${file}:${line}" "$content"
  fi
  [ "$_hadnm" = 1 ] && shopt -u nocasematch
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
    # 卡 2.6：规格书识别放宽 —— 与 is_passport_file / check-commit-msg.sh 同一判定
    case "$path" in
      */prototype/*|docs/ui/prototypes/*|*/page-spec*.md) passport+=("$path") ;;
    esac
    is_spec_doc "$path" && passport+=("$path")
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
    # ⚠️ 不能写 `packages/ui/*`：会把 package.json / tsconfig / jest.config.js
    # 也算成 UI 源码 → R9b/R11 对「改个 lint 脚本」报设计评审缺失（2026-10-22 实测误报）。
    # 源码在 src/ 下（.vue 已被上面第一条覆盖，这里补 tokens.css / index.ts 等）。
    packages/ui/src/*) return 0 ;;
    app.json|apps/*/app.json) return 0 ;;
  esac
  return 1
}

is_passport_file() {
  case "$1" in
    */prototype/*|docs/ui/prototypes/*|*/page-spec*.md|page-spec*.md) return 0 ;;
  esac
  # 卡 2.6：规格书识别放宽 —— 文件在 specs/ 或 docs/ui/page-specs/ 下，
  # 且文件名/目录名含 page-spec / prototype / 原型 语义即算规格书。
  # 解决 db526889 式「有原型但文件名不符约定 → 被迫用 Micro-exempt 豁免」。
  is_spec_doc "$1" && return 0
  return 1
}

# ---- 豁免判定（卡 2.7 理由质量门 + 卡 2.8 按门分类）----
# 所有豁免判定点统一走这里，避免 8 处各写一遍导致口径漂移。
#
# exempt_for_gate <commit> <body> <GATE>
#   → 0 = 该 commit 对该门被豁免（可跳过判定）；1 = 未豁免
#     旧格式 Micro-exempt: <理由>      → 一票否决（豁免全部 8 门，向后兼容）
#     新格式 Micro-exempt: R11: <理由>  → 只豁免 R11，其余门照常判定
# 理由质量不达标（卡 2.7）→ 豁免不生效（视同未豁免），并额外报一条 R20。
# 已就「理由质量不达标」报过警的 commit（避免同一 commit 被多个门各报一次）
_EXEMPT_REPORTED=""
# 已就「旧格式豁免」提示过的 commit（同样只提示一次）
_EXEMPT_LEGACY_HINTED=""
# 用旧格式（未按门分类）的豁免 commit 数 → 输出时汇总成一行提示
_EXEMPT_LEGACY_N=0
# NOTICES：非违规的提示信息（不计入 error/warning 计数）
declare -a NOTICES=()
add_notice() { NOTICES+=("$1|$2|$3|$4"); }
exempt_for_gate() {
  local c="$1" body="$2" gate="$3"
  local qmsg ui_n tot_n

  exempt_parse "$body" || return 1
  exempt_covers "$gate" || return 1
  # 卡 2.8：旧格式（未按门分类）仍一票否决（向后兼容），但提示改用新格式
  # 提示只汇总成一行（NOTICES 通道），不逐 commit 刷屏 —— 存量 40 commit 里有 20+ 条旧格式，
  # 逐条报会把基线刷爆，反而让人看不见真正的新增问题。
  if [ "$EXEMPT_LEGACY" = "1" ]; then
    case "$_EXEMPT_LEGACY_HINTED" in
      *"|$c|"*) ;;
      *)
        _EXEMPT_LEGACY_HINTED="${_EXEMPT_LEGACY_HINTED}|${c}|"
        _EXEMPT_LEGACY_N=$((_EXEMPT_LEGACY_N + 1))
        ;;
    esac
  fi
  # 需要理由质量判定 → 算该 commit 的改动计数（仅在有豁免时才付 git 调用成本）
  read -r ui_n tot_n <<<"$(commit_change_counts "$c")"
  if ! exempt_quality "$EXEMPT_REASON" "$ui_n" "$tot_n"; then
    qmsg="$EXEMPT_QUALITY_MSG"
    # 存量（生效日之前）**不追溯翻红**：只提醒，豁免照常生效。
    # 见 gate-shared.sh 的 EXEMPT_QUALITY_STRICT_FROM 注释（6796d16b 实证）。
    if ! exempt_quality_is_strict "$c"; then
      case "$_EXEMPT_LEGACY_HINTED" in
        *"|legacy-q|$c|"*) ;;
        *)
          _EXEMPT_LEGACY_HINTED="${_EXEMPT_LEGACY_HINTED}|legacy-q|${c}|"
          add_warn "R20" "豁免理由待改进（存量·未追溯，豁免仍生效）" "$(git log -1 --format=%s "$c" 2>/dev/null)" "${qmsg}；新提交起该理由将导致豁免失效，请按 §3.7 补可审计理由"
          ;;
      esac
      return 0
    fi
    # 理由质量不达标 → 豁免不生效，但要把原因讲清楚（否则执行者不知道为什么被拦）
    # 同一 commit 只报一次（多个门都会问到同一个 commit）
    case "$_EXEMPT_REPORTED" in
      *"|$c|"*) ;;
      *)
        _EXEMPT_REPORTED="${_EXEMPT_REPORTED}|${c}|"
        add_warn "R20" "豁免理由不达标（豁免未生效）" "$(git log -1 --format=%s "$c" 2>/dev/null)" "${qmsg}；请补充可审计的理由后重写 trailer"
        ;;
    esac
    return 1
  fi
  return 0
}

# ---- 统计某 commit 的 UI 源码改动文件数 / 总改动文件数 ----
# 质量门（卡 2.7 ②）需要「UI 源码改动 ≥ 5 个文件」这个量级。
# 只在 commit 命中豁免时才需要算 —— 绝大多数 commit 无豁免，不额外付 git 调用成本。
# 结果缓存在 _CC_SHA/_CC_UI/_CC_TOT：同一 commit 可能被多个门问到（如 R13 与 R14 共用一次判定）。
_CC_SHA=""; _CC_UI=0; _CC_TOT=0
commit_change_counts() {
  local c="$1" names
  if [ "$_CC_SHA" = "$c" ]; then
    printf '%s %s' "$_CC_UI" "$_CC_TOT"
    return 0
  fi
  names="$(git show --name-only --format= "$c" 2>/dev/null)"
  _CC_SHA="$c"
  _CC_UI="$(printf '%s\n' "$names" | exempt_ui_count)"
  # awk 计数（理由同 check_r19_empty_commit：grep -c 的 0 匹配会与 `|| echo 0` 拼成 "0\n0"）
  _CC_TOT="$(printf '%s\n' "$names" | awk 'NF{c++} END{print c+0}')"
  printf '%s %s' "$_CC_UI" "$_CC_TOT"
}

# 契约与数据变更面（R13）——这类故障编译能过、测试能过、线上才炸
# 收窄原则：**宁窄勿宽**。实测把 packages/agent-core/*（整个 SDK）纳入后，其内部实现改动
#   （如 type-only 导入修正）也被判为契约变更 → 摩擦过大 → 门禁会被关掉（kit-sop-enforcement §3.7）。
#   待「契约登记文件」落盘（SSE 事件 / MCP 工具 / 权限码的单一真相源）后，再把协议文件明确纳入。
R13_LINE_THRESHOLD="${R13_LINE_THRESHOLD:-5}"
is_contract_file() {
  case "$1" in
    archive/migrations/*) return 0 ;;               # 数据/结构迁移（含跨库误写风险，已归档至仓库根 archive/）
    packages/types/*) return 0 ;;                   # 共享常量：权限码 / 事件类型 / 枚举
    packages/agent-core/src/interfaces/*) return 0 ;;  # 协议契约（StreamEventType / RunInput）
    servers/mcp-gateway/src/*/tools/*) return 0 ;;  # MCP 工具注册
    servers/*/src/*/*.controller.ts) return 0 ;;    # 对外接口（另受 R13_LINE_THRESHOLD 约束）
    servers/*/src/*/*.controller.js) return 0 ;;
  esac
  return 1
}

# 发布与环境面（R14）——测试通过不等于能上线
is_release_file() {
  case "$1" in
    ecosystem.config.cjs|ecosystem.config.js) return 0 ;;   # 服务与端口真相源
    servers/*/.env|servers/*/.env.*) return 0 ;;            # 服务配置源
    scripts/.env.deploy|scripts/.env.deploy.*) return 0 ;;
    scripts/pipeline/*) return 0 ;;
    scripts/publish-*.sh|scripts/deploy-*.sh|scripts/bootstrap.sh) return 0 ;;
    servers/deploy-console/src/pipeline/*) return 0 ;;      # 流水线 restart/verify 真身
    .github/workflows/*) return 0 ;;                        # 门禁自身
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
    # ⚠️ 顺序不能反（2026-10-11 实测误报）：passport 判定必须**先于**新增文件的 continue。
    #   原型/规格绝大多数是**新建**文件（A 状态，如 apps/<app>/prototype/voice-input-spec.md），
    #   原来把它和「新增页面」一起 continue 掉 → 「先提原型、再提 UI 源码」这条正规走法
    #   反而被判「无同行原型」，逼人回头去用 Micro-exempt 后门。
    if is_passport_file "$path"; then passport=1; fi
    case "$st" in A*) continue ;; esac          # 新增页面由 R9 管
    if is_ui_file "$path"; then ui_files+=("$path"); fi
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

  # 豁免（卡 2.8 按门分类）：R9b 只认「豁免范围含 R9b」的声明。
  # 旧格式 Micro-exempt: <理由> 仍是一票否决（豁免全部 8 门，向后兼容）。
  while IFS= read -r _rec; do
    [ -n "$_rec" ] || continue
    _sha="${_rec%%$'\x1f'*}"
    _rsn="${_rec#*$'\x1f'}"
    exempt_split "$_rsn"
    exempt_covers "R9b" || continue
    read -r _ui _tot <<<"$(commit_change_counts "$_sha")"
    if exempt_quality "$EXEMPT_REASON" "$_ui" "$_tot"; then
      return 0
    fi
    # 存量（生效日之前）不追溯翻红 —— 与 exempt_for_gate 同口径
    if ! exempt_quality_is_strict "$_sha"; then
      add_warn "R20" "豁免理由待改进（存量·未追溯，豁免仍生效）" "$(git log -1 --format=%s "$_sha" 2>/dev/null)" "${EXEMPT_QUALITY_MSG}；新提交起该理由将导致豁免失效"
      return 0
    fi
    add_warn "R20" "豁免理由不达标（豁免未生效）" "$(git log -1 --format=%s "$_sha" 2>/dev/null)" "${EXEMPT_QUALITY_MSG}；请补充可审计的理由后重写 trailer"
  done < <(exempt_commits_in_range "$range")
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
    # 卡 2.8：豁免按门分类 —— 只有豁免范围含 R10 才放行 R10。
    if exempt_for_gate "$c" "$body" "R10"; then
      continue
    fi

    sha="$(printf '%s' "$body" | grep -E '^Proto:[[:space:]]*' | head -n 1 | grep -oE '[0-9a-fA-F]{7,40}' | head -n 1)"
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

    if exempt_for_gate "$c" "$body" "R11"; then
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
      add_warn "$rule" "${desc}（目标缺失，未同步）" "$rel" "建议：bash scripts/redline/apply-agent-kit.sh（第二跳一键镜像；单项亦可 cp \"$src/$rel\" \"$dst/$rel\"）"
    elif [ -f "$dst/$rel" ] && ! cmp -s "$f" "$dst/$rel"; then
      add_warn "$rule" "${desc}（内容漂移）" "$rel" "建议：bash scripts/redline/apply-agent-kit.sh（第二跳一键镜像；单项亦可 cp \"$src/$rel\" \"$dst/$rel\"）"
    fi
  done < <(find "$src" -type f -print 2>/dev/null)
  return 0
}

# ---- 评审凭证校验（供 R13 / R14 复用）----
# 用法：_trailer_check_one <规则号> <trailer 名> <说明> <commit> <message>
# 语义：命中改动面的 commit 须带 `<Trailer>: pass`（或报告路径）；
#       指向报告时校验报告存在且头部 `阻塞: N` 为 0。
# 豁免：`Micro-exempt:` 与 R9b / R10 / R11 同口径（避免"记了豁免还报错"的新摩擦）
# 级别：warning（--strict 下 error）。Q3 已拍板（2026-09-24）保持 warning；
#   如需转 error，把本函数内两处 add_warn 改 add_err，并配套存量 commit 过渡策略。
_trailer_check_one() {
  local rule="$1" trailer="$2" desc="$3" c="$4" body="$5"
  local tval n
  tval="$(printf '%s' "$body" | grep -E "^${trailer}:[[:space:]]*[^[:space:]]+" | head -n 1 | sed -E "s/^${trailer}:[[:space:]]*//" | tr -d '\r')"
  if [ -z "$tval" ]; then
    add_warn "$rule" "${desc} commit 缺评审凭证" "$(git log -1 --format=%s "$c")" "message 须带 ${trailer}: pass（或报告路径）；纯微调走 Micro-exempt: <理由>（specs/rd-process-model §3.7）"
    return 0
  fi
  [ "$tval" = "pass" ] && return 0

  if ! git cat-file -e "$c:$tval" 2>/dev/null; then
    add_warn "$rule" "${trailer} 凭证指向的报告不存在" "$tval" "报告须随该 commit 落盘"
    return 0
  fi
  n="$(git show "$c:$tval" 2>/dev/null | grep -E '^阻塞:[[:space:]]*[0-9]+' | head -n 1 | grep -oE '[0-9]+' | head -n 1)"
  if [ "${n:-0}" -gt 0 ]; then
    add_warn "$rule" "${desc}评审阻塞项未清零" "${tval}（阻塞: ${n}）" "报告头部 阻塞: N 且 N>0 不得放行"
  fi
  return 0
}

# ---- R13 契约与数据变更评审凭证 · R14 发布与环境评审凭证（commit 级）----
# 设计：specs/rd-process-model/design.md §3.7
# R13 触发面：is_contract_file（迁移 / packages/types / MCP 工具 / 对外控制器）
#            控制器类另受 R13_LINE_THRESHOLD 行数约束（防一行微调也报）
# R14 触发面：is_release_file（ecosystem / 服务 .env / 流水线脚本 / CI workflow）
#            判据源 docs/development/release-review-checklist.md
# 性能：两个面共用一次遍历 —— 各自遍历会让 commit 级 git 调用翻倍（range 较大时明显卡顿）
check_r13_r14() {
  local range="$1"
  local -a commits=()
  # --no-merges：merge commit 不是真实改动，纳入只会制造噪音
  while IFS= read -r c; do
    [ -n "$c" ] && commits+=("$c")
  done < <(git rev-list --reverse --no-merges "$range" 2>/dev/null)
  [ ${#commits[@]} -eq 0 ] && return 0

  local c f body hit_c hit_r lines_c add del
  for c in "${commits[@]}"; do
    hit_c=0; hit_r=0; lines_c=0
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if is_contract_file "$f"; then hit_c=1; fi
      if is_release_file "$f"; then hit_r=1; fi
    done < <(git show --name-only --format= "$c" 2>/dev/null)
    [ "$hit_c" -eq 0 ] && [ "$hit_r" -eq 0 ] && continue

    # 契约面：未达行数阈值视为微调，不强制评审（与 R9b 同策略，防噪音）
    if [ "$hit_c" -eq 1 ]; then
      while IFS=$'\t' read -r add del f; do
        [ -n "$f" ] || continue
        is_contract_file "$f" || continue
        case "${add:-}" in *[!0-9]*) continue ;; esac   # 二进制文件 numstat 为 `-`
        case "${del:-}" in *[!0-9]*) continue ;; esac
        lines_c=$(( lines_c + add + del ))
      done < <(git show --numstat --format= "$c" 2>/dev/null)
      [ "$lines_c" -lt "$R13_LINE_THRESHOLD" ] && hit_c=0
    fi
    [ "$hit_c" -eq 0 ] && [ "$hit_r" -eq 0 ] && continue

    body="$(git log -1 --format=%B "$c" 2>/dev/null)"
    # 卡 2.8：豁免按门分类 —— R13 与 R14 各自独立判定（原来共用一次判定，
    # 一条豁免会顺带放行另一门）。旧格式仍是一票否决（豁免全部 8 门，向后兼容）。
    if [ "$hit_c" = "1" ]; then
      exempt_for_gate "$c" "$body" "R13" || _trailer_check_one "R13" "Contract" "契约与数据变更" "$c" "$body"
    fi
    if [ "$hit_r" = "1" ]; then
      exempt_for_gate "$c" "$body" "R14" || _trailer_check_one "R14" "Release" "发布与环境变更" "$c" "$body"
    fi
  done
}

# ---- R15 独立代码评审凭证（commit 级 · warning）----
# 设计：specs/rd-process-model/design.md §3.7 · 判据源 docs/development/code-review-checklist.md
# 触发面：**新增**对外接口（*.controller.ts / *.controller.js 为新增文件）——
#   新增接口是最需要第三方评审的形态（越权 / 入参校验 / 错误处理语义 / 敏感信息泄露）。
#   改动既有实现不触发（触发面宁可窄：本门主观性最强、成本最高）。
# 判据：commit 须带 `Code: pass` 或 `Code: <报告路径>`；报告头部 `阻塞: N` 须为 0
# 级别：warning（--strict 下 error），先观察误报再决定是否收紧
check_r15() {
  local range="$1"
  local -a commits=()
  while IFS= read -r c; do
    [ -n "$c" ] && commits+=("$c")
  done < <(git rev-list --reverse --no-merges "$range" 2>/dev/null)
  [ ${#commits[@]} -eq 0 ] && return 0

  local c st f body hit
  for c in "${commits[@]}"; do
    hit=0
    while IFS=$'\t' read -r st f; do
      [ -n "${f:-}" ] || continue
      case "$st" in
        A*)
          case "$f" in
            */*.controller.ts|*/*.controller.js) hit=1 ;;
          esac
          ;;
      esac
    done < <(git show --name-status --format= "$c" 2>/dev/null)
    [ "$hit" -eq 0 ] && continue

    body="$(git log -1 --format=%B "$c" 2>/dev/null)"
    # 卡 2.8：豁免按门分类 —— 只有豁免范围含 R15 才放行 R15
    exempt_for_gate "$c" "$body" "R15" || _trailer_check_one "R15" "Code" "新增对外接口" "$c" "$body"
  done
}

# ---- R17 测试用例凭证（commit 级 · warning）----
# 背景：2026-10-22「自媒体运营」模块（3a22972c）交付后**没有测试用例文档**，
#       验证只能靠用户在界面上即兴点 → dev/prod 各漏一半发布项（dev 缺 gateway 路由、
#       prod 缺前端产物与 seed），全部由用户走查才发现。
# 判据源：~/AiWorkspace/20-私域资产/研发方案与发布规范-v2.md §4（测试方案）
#          —— 通用规范 2026-10-23 起迁出仓库，真源在总控；本仓库只放项目实例文档
#
# 触发面（卡 2.1 放宽）：
#   ① 状态由「只认新增 A」放宽为「新增 A 或修改 M」
#      —— 改既有实现同样可能漏测，只卡新增会漏掉绝大多数改动（实测近 300 commit 只命中 6 次）。
#   ② 路径改为递归匹配（servers/*/src/**、apps/*/src/** 下任意层级）
#   ③ 扩展 .tsx / .mjs / .jsx（admin / portal 侧存在这些扩展）
#   ④ 仍排除测试文件自身（*.spec.* / *.test.*）—— 用例文档门不该拦写测试的人
# 判据（卡 2.2 真实性）：
#   `Test: pass`     → 允许（表示本 commit 无需测试用例，如纯文档）
#   `Test: <路径>`   → 该路径必须真实存在（否则判 FAIL —— 防止随手写个路径糊弄）
# 级别：warning（--strict 下 error），先观察误报再决定是否收紧
check_r17() {
  local range="$1"
  local -a commits=()
  while IFS= read -r c; do
    [ -n "$c" ] && commits+=("$c")
  done < <(git rev-list --reverse --no-merges "$range" 2>/dev/null)
  [ ${#commits[@]} -eq 0 ] && return 0

  local c st f body hit tval
  for c in "${commits[@]}"; do
    hit=0
    while IFS=$'\t' read -r st f; do
      [ -n "${f:-}" ] || continue
      # 卡 2.1 ①：新增 A 或修改 M 都触发
      case "$st" in
        A*|M*)
          # 卡 2.1 ②③：递归 glob + 扩展名放宽
          case "$f" in
            servers/*/src/*|apps/*/src/*)
              case "$f" in
                *.ts|*.tsx|*.mjs|*.jsx|*.vue)
                  # 卡 2.1 ④：排除测试文件自身
                  case "$f" in
                    *.spec.*|*.test.*) ;;
                    *) hit=1 ;;
                  esac
                  ;;
              esac
              ;;
          esac
          ;;
      esac
    done < <(git show --name-status --format= "$c" 2>/dev/null)
    [ "$hit" -eq 0 ] && continue

    body="$(git log -1 --format=%B "$c" 2>/dev/null)"
    # 卡 2.8：豁免按门分类 —— 只有豁免范围含 R17 才放行 R17
    exempt_for_gate "$c" "$body" "R17" || _r17_credential_check "$c" "$body"
  done
}

# ---- R17 凭证真实性检查（卡 2.2）----
# `Test: pass`   → 允许（表示本 commit 无需测试用例，如纯文档）
# `Test: <路径>` → 路径必须真实存在；不存在即判 FAIL
# 用 `_trailer_check_one` 复用「缺凭证」判定，但路径存在性按 R17 语义单独判
#   （用例文档常落在任务目录而非仓库内，故不能只查 git 对象树）。
_r17_credential_check() {
  local c="$1" body="$2" tval
  tval="$(printf '%s' "$body" | grep -E '^Test:[[:space:]]*[^[:space:]]+' | head -n 1 | sed -E 's/^Test:[[:space:]]*//' | tr -d '\r')"
  if [ -z "$tval" ]; then
    add_warn "R17" "测试用例 commit 缺评审凭证" "$(git log -1 --format=%s "$c")" "message 须带 Test: pass（无需测试用例）或 Test: <用例文档路径>（路径须真实存在）；纯微调走 Micro-exempt: <理由>（specs/rd-process-model §3.7）"
    return 0
  fi
  [ "$tval" = "pass" ] && return 0
  if ! exempt_path_exists "$c" "$tval" "$TOP"; then
    add_warn "R17" "Test 凭证指向的用例文档不存在" "$tval" "Test: <路径> 须指向真实存在的用例文档（仓库内或任务目录内）；确无用例需求写 Test: pass"
    return 0
  fi
  return 0
}

# ---- R18 研发方案与发布任务清单凭证（commit 级 · warning）----
# 背景：同 R17。发布清单缺失导致流水线「成功」但前端产物没投递、
#       初始化 seed 没跑（prod content_sources = 0 行）—— 功能上线即空壳。
#       平台侧 release_plan 只校验不变量，不校验「方案里有没有写发布清单」，故需本门。
# 判据源：~/AiWorkspace/20-私域资产/研发方案与发布规范-v2.md §5（发布任务清单）
#          —— 通用规范 2026-10-23 起迁出仓库，真源在总控；本仓库只放项目实例文档
# 触发面：**新增** service / controller / 前端 view（功能级改动，必然涉及发布）
# 判据：commit 须带 `Plan: pass`（本 commit 无需发布，如纯内部重构）或 `Plan: <研发方案路径>`
# 级别：warning（--strict 下 error）
check_r18() {
  local range="$1"
  local -a commits=()
  while IFS= read -r c; do
    [ -n "$c" ] && commits+=("$c")
  done < <(git rev-list --reverse --no-merges "$range" 2>/dev/null)
  [ ${#commits[@]} -eq 0 ] && return 0

  local c st f body hit
  for c in "${commits[@]}"; do
    hit=0
    while IFS=$'\t' read -r st f; do
      [ -n "${f:-}" ] || continue
      case "$st" in
        A*)
          case "$f" in
            */*.controller.ts|*/*.controller.js|*/*.service.ts|apps/*/src/views/*) hit=1 ;;
          esac
          ;;
      esac
    done < <(git show --name-status --format= "$c" 2>/dev/null)
    [ "$hit" -eq 0 ] && continue

    body="$(git log -1 --format=%B "$c" 2>/dev/null)"
    # 卡 2.8：豁免按门分类 —— 只有豁免范围含 R18 才放行 R18
    exempt_for_gate "$c" "$body" "R18" || _trailer_check_one "R18" "Plan" "研发方案与发布清单" "$c" "$body"
  done
}

# ---- R19 空提交检测（commit 级 · error 级）----
# 背景：空 commit 没有任何内容，却能占一个 commit 位置 —— 实质是「用空提交重跑 CI」
#       的后门。实证 558d8cb5「空 commit 仅触发 CI 重跑，无代码变更」曾用 Micro-exempt: 绕过，
#       绕过了该 commit 的全部门禁判定。
# 判据：commit 的树与其父提交完全相同（无任何文件改动）且非 merge commit → 判 FAIL。
#   ⚠️ merge commit 一律跳过：merge 相对第一父的 diff 可能为空，但那是合并语义不是空提交。
#   ⚠️ 不豁免：空提交不产生任何改动面，Micro-exempt 也救不了它（豁免只对有改动面的门有意义）。
#       故本门不接受 Micro-exempt 豁免 —— 否则等于留了同一个后门。
check_r19_empty_commit() {
  local range="$1"
  local c nfiles
  # --no-merges：merge commit 不是「空提交」，是合并
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    # --root：首个 commit（无父）也算有内容
    # 用 awk 计数：grep -c 在 0 匹配时「输出 0 且退出码 1」，
    #   配 `|| echo 0` 会拼成 "0\n0"，导致后续比较永远不等。
    nfiles="$(git diff-tree --no-commit-id --name-only -r --root "$c" 2>/dev/null | awk 'NF{c++} END{print c+0}')"
    [ "${nfiles:-0}" = "0" ] || continue
    add_err "R19" "空提交（无任何文件改动）" "$(git log -1 --format=%s "$c")" "空提交无意义；如需重跑 CI 请用 CI 重跑按钮，而不是提交空 commit（§2.9）"
  done < <(git rev-list --reverse --no-merges "$range" 2>/dev/null)
}

# ---- R12 kit 能力源 ↔ 运行源 同源守门 ----
# 背景：上游 ai-agent-kit 经 sync-to-target 只写 .codebuddy/agent-kit/（能力源），
#       而 IDE 加载的是 .codebuddy/skills/（运行源），中间缺 apply → 漂移（#117/#118 即此坑）。
# 保护清单：项目专属技能（只在运行源）与下游定制文件（同步时永不覆盖）跳过比对。
check_r12() {
  check_sync_pair "R12" "kit 能力源与运行源漂移" \
    ".codebuddy/agent-kit/skills" ".codebuddy/skills" \
    "be-developer" "fe-developer" "design-reviewer" "release-reviewer" "contract-reviewer" "code-reviewer" \
    "rd-digital-agent/references/project-context.md"
}

# ---- R16 SSE 事件契约一致性（消费方手写联合 ↔ agent-core 真相源）----
# 设计：specs/rd-process-model/design.md §3.7 · 判据源 docs/api/contracts.md C2
# 背景：'card' 曾由服务端推送、被 portal 与小程序各自手写联合类型，而共享类型未登记 →
#       消费方漏分支时没有任何检查能发现（2026-09-24）。手工对齐只解决当下，本规则解决复发。
# 不依赖 range：比对当前文件内容，改动任一相关文件即触发。
check_r16() {
  local py="$TOP/scripts/redline/check-sse-contract.py"
  [ -f "$py" ] || return 0
  local out lvl rule loc msg
  out="$(python3 "$py" 2>/dev/null)"
  [ -n "$out" ] || return 0
  while IFS=$'\t' read -r lvl rule loc msg; do
    [ -n "${lvl:-}" ] || continue
    case "$lvl" in
      MISSING|EXTRA|LOOSE)
        add_warn "${rule:-R16}" "$msg" "$loc" "契约真相源：packages/agent-core 的 StreamEventType（docs/api/contracts.md C2）" ;;
    esac
  done <<EOF
$out
EOF
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
  _prof "start(range=$range)"
  check_r9 "$range";   _prof "R9  文件级 UI 结构"
  check_r9b "$range";  _prof "R9b 既有 UI 改动"
  check_r10 "$range";  _prof "R10 UI commit Proto 凭证"
  check_r11 "$range";  _prof "R11 设计评审凭证"
  check_r11b "$range"; _prof "R11b 原型锚点漂移"
  check_r13_r14 "$range"; _prof "R13/R14 契约与发布凭证"
  check_r15 "$range";  _prof "R15 对外接口评审凭证"
  check_r17 "$range";  _prof "R17 测试用例凭证"
  check_r18 "$range";  _prof "R18 研发方案凭证"
  check_r19_empty_commit "$range";  _prof "R19 空提交检测"
  check_r12;           _prof "R12 kit 同源（全仓遍历）"
  check_r16;           _prof "R16 SSE 契约（调 python）"
  # 卡 2.8：旧格式豁免的汇总提示（NOTICES 通道，不计入 error/warning）
  if [ "$_EXEMPT_LEGACY_N" -gt 0 ]; then
    add_notice "R21" "有 ${_EXEMPT_LEGACY_N} 个 commit 用旧格式豁免（未按门分类）" "" "旧写法 Micro-exempt: <理由> 仍是一票否决（豁免全部 8 门，向后兼容）；建议改用 Micro-exempt: <R门号>: <理由>，只豁免指定门"
  fi
  diff_text="$(git diff --no-color --unified=0 "$range" -- '*.ts' '*.tsx' '*.vue' '*.js' '*.jsx' '*.mjs' '*.cjs' 2>/dev/null)"
  _prof "git diff 取新增行"
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
  _prof "行级扫描（${#pending[@]} 行）"
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
  # `|| [ -n "$content" ]`：文件末尾没有换行符时，read 返回非零但 content 有值，
  # 纯 `while read` 会把最后一行**整行跳过**（存量漏洞，2026-10-22 用无尾换行夹具实测）。
  while IFS= read -r content || [ -n "$content" ]; do
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
    --max-commits) MAX_COMMITS="${2:-}"; shift ;;
    -h|--help)  sed -n '1,24p' "$0"; exit 0 ;;
    --*)        echo "未知选项: $1" >&2; exit 2 ;;
    *)          if [ -z "$MODE" ]; then MODE="$1"; else MODE_ARGS+=("$1"); fi ;;
  esac
  shift
done

case "${MAX_COMMITS}" in
  ''|*[!0-9]*) echo "✗ --max-commits 需要非负整数（收到: '${MAX_COMMITS}'）；0 = 不限制" >&2; exit 2 ;;
esac

case "$MODE" in
  cached) scan_cached ;;
  diff)
    [ ${#MODE_ARGS[@]} -ge 1 ] || { echo "用法: scan-rules.sh diff <range>（如 origin/master...HEAD）" >&2; exit 2; }
    # 防「假通过」（2026-10-30 实测）：range 不可解析 / 为 0 个 commit 时，各 check_* 的
    #   `git rev-list ... 2>/dev/null` 静默失败 → 空循环，git diff 也是空 → 最终打印
    #   「✓ 红线扫描通过（0 error / 0 warning）」并 exit 0。
    #   门禁把「没有输入」当成「没有违规」，比 --no-verify 更危险：
    #   绕过是显式的、看得见的；假通过是静默的、被当成绿灯。
    #   实测触发场景：shallow clone 的 worktree 里 `origin/master~20` 解析不了（本地最常见的自查命令）。
    # 为什么只在 diff 分支校验：cached 模式 range 传的是 `--cached`，无 staged 变更属合法空集。
    _R="${MODE_ARGS[0]}"
    if ! git rev-parse --verify --quiet "${_R%%..*}" >/dev/null 2>&1; then
      {
        echo "✗ 扫描范围左侧 ref 不可解析: ${_R}"
        echo "  常见原因：① shallow clone 深度不足（worktree 未 fetch 到该 ref 的历史）② ref 拼写错误"
        echo "  处理：git fetch --unshallow 或 git fetch --depth=<N> origin '+refs/heads/*:refs/remotes/origin/*'"
        echo "        验证：git rev-parse --verify --quiet '${_R%%..*}'"
      } >&2
      exit 2
    fi
    _NC="$(git rev-list --count "$_R" 2>/dev/null || true)"
    case "${_NC:-}" in
      ''|*[!0-9]*) echo "✗ 无法枚举扫描范围（git rev-list 失败）: ${_R}" >&2; exit 2 ;;
      0)           echo "✗ 扫描范围为 0 个 commit，拒绝静默通过: ${_R}" >&2; exit 2 ;;
    esac
    # 范围上限（2026-10-30 实测驱动，不是拍脑袋定的阈值）：
    #   1517 commit 全历史实测 17m27s、峰值 RSS 186MB —— **不是 OOM**，是 8 道 commit 门
    #   各遍历一遍 + 每 commit 2~6 次 git 子进程（R11 单门 248s、R17 141s、R10 102s），
    #   叠加 19.3 万行的逐行检查（341s）。耗时规模到这个量级，调用方（CI job、终端、
    #   编辑器任务）会先超时把进程杀掉，报出 exit 137/139 —— 看起来像「门禁崩溃」，
    #   实际是「跑得慢到被杀」。加上限是为了把「静默等 17 分钟然后被杀」变成
    #   「立刻告诉你范围太大 + 怎么缩」。
    # 为什么不做静默截断：只扫前 N 个 commit 却照样打印「✓ 红线扫描通过」，就是另一种假通过，
    #   比 17 分钟更危险（本次 #8249 刚修完同类问题，不能又开一个后门）。
    if [ "${MAX_COMMITS}" != "0" ] && [ "${_NC}" -gt "${MAX_COMMITS}" ]; then
      {
        echo "✗ 扫描范围过大：${_NC} 个 commit（上限 ${MAX_COMMITS}）"
        echo "  实测成本（2026-10-30，1517 commit）：17m27s / 峰值 186MB —— 不是内存问题，"
        echo "  但会被 CI job、终端或编辑器的超时机制杀掉（exit 137/139），看起来像崩溃。"
        echo "  处理（任选其一）："
        echo "    1) 缩到本次改动（推荐，覆盖 95% 场景）："
        echo "         MB=\$(git merge-base origin/master HEAD)"
        echo "         bash scripts/redline/scan-rules.sh diff \"\$MB..HEAD\""
        echo "    2) 只这一次放行（全局默认不变）："
        echo "         bash scripts/redline/scan-rules.sh diff '${_R}' --max-commits 0"
        echo "    3) 确实要全量、又怕被超时杀掉 → 后台跑并看进度："
        echo "         SCAN_PROFILE=1 SCAN_MAX_COMMITS=0 bash scripts/redline/scan-rules.sh diff '${_R}' \\"
        echo "           > /tmp/scan.out 2> /tmp/scan.err &"
        echo "         tail -f /tmp/scan.err      # 每跑完一门打一行「+Ns 累计 Ns」"
      } >&2
      exit 2
    fi
    printf '扫描范围: %s（%s 个 commit）\n' "$_R" "$_NC" >&2
    scan_diff_range "$_R"
    ;;
  files)
    [ ${#MODE_ARGS[@]} -ge 1 ] || { echo "用法: scan-rules.sh files <path...>" >&2; exit 2; }
    for f in "${MODE_ARGS[@]}"; do scan_one_file "$f"; done
    ;;
  tree) scan_tree "${MODE_ARGS[0]:-.}" ;;
  *) sed -n '1,24p' "$0" >&2; exit 2 ;;
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

if [ ${#NOTICES[@]} -gt 0 ]; then
  echo -e "${B}══ 门禁提示（notice）══${N}"
  for v in "${NOTICES[@]}"; do
    IFS='|' read -r rule desc loc content <<<"$v"
    echo -e "  ${B}[${rule}]${N} ${desc}"
    [ -n "$loc" ] && echo -e "       ${B}${loc}${N}"
    [ -n "$content" ] && echo -e "       ${Y}${content}${N}"
  done
fi

if [ "$code" = "0" ]; then
  echo -e "${G}✓ 红线扫描通过（${#ERRS[@]} error / ${#WARNS[@]} warning）${N}"
else
  echo -e "${R}✗ 红线扫描未通过（${#ERRS[@]} error / ${#WARNS[@]} warning）${N}"
fi
exit "$code"
