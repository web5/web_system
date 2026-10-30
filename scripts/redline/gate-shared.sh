#!/usr/bin/env bash
# ============================================================
# gate-shared.sh — 门禁共享判定库（豁免机制 + 规格书识别）
#
# 设计：卡 2.6（规格书识别放宽）+ 卡 2.7（豁免理由质量门）+ 卡 2.8（豁免按门分类）
# 为什么单独成文件：这三条规则同时影响 scan-rules.sh 与 check-commit-msg.sh。
#   两份实现各写一遍 → 口径必然漂移 → 出现「本地认、CI 不认」的新摩擦源，
#   那正是 2.8 要消灭的问题。单一实现 = 单一口径。
#
# 被 source 后提供：
#   §1 豁免机制
#     exempt_split <reason_text>      解析豁免理由文本
#         → EXEMPT_LEGACY   0/1  是否旧格式（一票否决）
#         → EXEMPT_GATES    逗号分隔门号（旧格式为空 = 全门）
#         → EXEMPT_REASON   理由原文（去掉门号前缀）
#     exempt_parse <body>            从 commit message 里找出豁免 trailer 并解析
#         → EXEMPT_PRESENT  0/1  是否存在豁免声明
#     exempt_covers <gate>           门号是否在豁免范围内（0=覆盖）
#     exempt_quality <reason> <ui_n> [tot_n]
#         理由质量门（卡 2.7）→ 0=合格；1=不合格（EXEMPT_QUALITY_MSG 说明原因）
#     exempt_allows <body> <gate> <ui_n> [tot_n]
#         组合判定：覆盖该门 **且** 理由合格 → 0=该门被豁免
#     exempt_commits_in_range <range>
#         列出 range 内带豁免 trailer 的 commit（每行 "sha\x1f理由"）
#     exempt_commit_counts <sha>     输出 "ui文件数 总文件数"（供质量门批量判定）
#     exempt_path_exists <sha> <path> [base]
#         trailer 指向的路径是否真实存在
#     exempt_is_ui_file <path>       UI 源码判定（质量门需要 UI 改动文件数）
#   §2 规格书识别
#     is_spec_doc <path>             放宽后的「规格书」判定（卡 2.6）
# ============================================================

# ============================================================
# §1 豁免机制
# ============================================================

# ---- 卡 2.7 阈值（可用环境变量调，便于观察期收紧/放宽）----
# 理由最短字符数（UTF-8 字符，不是字节）
EXEMPT_MIN_REASON_LEN="${EXEMPT_MIN_REASON_LEN:-10}"
# 批量标注阈值：UI 源码改动文件数 ≥ 此值时，理由须含文件数与统一根因
EXEMPT_BATCH_MIN_FILES="${EXEMPT_BATCH_MIN_FILES:-5}"

# ---- 无信息量取值（大小写不敏感；比较前去掉首尾空白）----
EXEMPT_EMPTY_VALUES="yes no true false ok n/a none tbd wip skip 是 否 无 不需要 不用"

# ---- 统一根因关键词（批量豁免时理由必须体现「同一个原因」）----
EXEMPT_ROOTCAUSE_KEYWORDS="同一 统一 批量 共性 同样 同一个 同批 共同 根因"

# ---- 解析结果容器（先初始化，避免 set -u 下未定义报错）----
EXEMPT_PRESENT=0
EXEMPT_LEGACY=0
EXEMPT_GATES=""
EXEMPT_REASON=""
EXEMPT_QUALITY_MSG=""

# ---- UTF-8 字符数 ----
# LC_ALL=C 下 tr 按字节处理；删掉 UTF-8 续接字节（0x80-0xBF）后剩余字节数 = 字符数。
# 不依赖 locale —— macOS 默认 locale 与 CI 容器 locale 不同，依赖 locale 会得到不同答案。
exempt_char_len() {
  LC_ALL=C printf '%s' "$1" \
    | LC_ALL=C tr -d '\200-\277' \
    | LC_ALL=C wc -c \
    | tr -d ' '
}

# ---- UI 源码判定 ----
# 与 scan-rules.sh 的 is_ui_file / check-commit-msg.sh 的 is_ui 语义一致。
# ⚠️ 不能写 `packages/ui/*`：会把 package.json / tsconfig / jest.config.js
# 也算成 UI 源码 → 改个 lint 脚本就要求设计评审（2026-10-22 实测误报）。
exempt_is_ui_file() {
  case "$1" in
    *.wxml|*.wxss|*.vue) return 0 ;;
    apps/*/pages/*) return 0 ;;
    apps/*/components/*) return 0 ;;
    apps/*/src/*.vue) return 0 ;;
    packages/ui/src/*) return 0 ;;
    app.json|apps/*/app.json) return 0 ;;
  esac
  return 1
}

# ---- 统计 stdin 里 UI 源码文件数 ----
exempt_ui_count() {
  local f n=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if exempt_is_ui_file "$f"; then n=$((n + 1)); fi
  done
  printf '%s' "$n"
}

# ---- 统计某 commit 的 UI 源码改动文件数与总改动文件数 ----
# 输出 "ui_n tot_n"。质量门（卡 2.7 ②）需要 UI 源码改动文件数来判定是否属批量豁免。
exempt_commit_counts() {
  local sha="$1" names ui tot
  names="$(git show --name-only --format= "$sha" 2>/dev/null)"
  ui="$(printf '%s\n' "$names" | exempt_ui_count)"
  tot="$(printf '%s\n' "$names" | grep -c . 2>/dev/null || true)"
  printf '%s %s' "${ui:-0}" "${tot:-0}"
}

# ---- 解析豁免理由文本（不含 "Micro-exempt:" 前缀）----
# 格式（卡 2.8）：
#   新格式  R11: 纯视觉微调       → 只豁免 R11
#           R11,R17: 纯视觉微改   → 豁免 R11 与 R17
#   旧格式  纯视觉微调            → 一票否决（豁免全部 8 门）
#
#   门号识别规则：**门号后必须紧跟冒号**，否则按旧格式解析。
#   原因：存量豁免里有正文以门号开头的（db526889 的理由正文以 "R9b " 开头），
#   若按「首个 token 是门号」来判，会把存量的一票否决误判成分类豁免 —— 行为突变。
#   冒号是唯一无歧义的分隔符。
exempt_split() {
  local rest="$1" gates reason

  EXEMPT_PRESENT=1
  EXEMPT_LEGACY=0
  EXEMPT_GATES=""
  EXEMPT_REASON=""
  EXEMPT_QUALITY_MSG=""

  # 去掉理由前的空白（trailer 冒号后惯例有一个空格）
  while :; do
    case "$rest" in
      [[:space:]]*) rest="${rest#[[:space:]]}" ;;
      *) break ;;
    esac
  done

  # 分类格式判定：门号列表（逗号分隔）后必须紧跟冒号
  # 门号形态 R[0-9]+[a-z]?（覆盖 R9b / R10 / R11 …）
  if printf '%s' "$rest" | grep -qE '^R[0-9]+[a-z]?(,[[:space:]]*R[0-9]+[a-z]?)*:'; then
    gates="$(printf '%s' "$rest" | sed -E 's/^(R[0-9]+[a-z]?(,[[:space:]]*R[0-9]+[a-z]?)*):.*/\1/' | tr -d '[:space:]')"
    reason="$(printf '%s' "$rest" | sed -E 's/^R[0-9]+[a-z]?(,[[:space:]]*R[0-9]+[a-z]?)*:[[:space:]]*//')"
    EXEMPT_GATES="$gates"
    EXEMPT_REASON="$reason"
    EXEMPT_LEGACY=0
  else
    # 旧格式：一票否决（向后兼容，避免存量 commit 行为突变）
    EXEMPT_GATES=""
    EXEMPT_REASON="$rest"
    EXEMPT_LEGACY=1
  fi
  return 0
}

# ---- 从 commit message 里找出豁免 trailer 并解析 ----
# 行首锚定 + 大小写敏感 —— 与 scan-rules.sh 原判定 `grep -qE '^Micro-exempt:'` 一致
exempt_parse() {
  local body="$1" line

  EXEMPT_PRESENT=0
  EXEMPT_LEGACY=0
  EXEMPT_GATES=""
  EXEMPT_REASON=""
  EXEMPT_QUALITY_MSG=""

  line="$(printf '%s\n' "$body" | grep -E '^Micro-exempt:' | head -n 1)"
  [ -n "$line" ] || return 1

  EXEMPT_PRESENT=1
  exempt_split "${line#Micro-exempt:}"
  return 0
}

# ---- 门号是否被豁免覆盖 ----
# 用法：exempt_covers R11
exempt_covers() {
  local gate="$1" g
  [ "$EXEMPT_PRESENT" = "1" ] || return 1
  # 旧格式 = 全门豁免（向后兼容）。注意这里**不能**再比 $gate：
  # 旧格式下 EXEMPT_GATES 恒为空串，任何 "$gate" = "" 都是假 → 豁免全线失效，
  # 存量 8 门（含 error 级 R11）被追溯翻红。2026-10-30 实测：改前基线 11 error。
  [ "$EXEMPT_LEGACY" = "1" ] && return 0
  # 新格式：只豁免列出的门
  local IFS=','
  for g in $EXEMPT_GATES; do
    [ "$g" = "$gate" ] && return 0
  done
  return 1
}

# ---- 理由质量门的生效日期（卡 2.7 追溯边界）----
# 🔴 为什么需要：质量门最初的实现是「理由不达标 → 豁免不生效」，这会把**存量 commit
#   追溯翻红**。2026-10-30 实测：master~20 上 6796d16b（2026-10-23，11 个 UI 文件、
#   理由未标范围）因此从 warning 直接变 error —— 门禁只能约束新提交，不能改判历史。
#   故设生效日期：该时刻**之后**的 commit 才强制质量门；之前的只报 R20 提醒，豁免仍生效。
#
# 取值 = 2026-11-01 00:00:00 +0800（本改造合入后第一个自然日）
# 可用环境变量覆盖（测试用：设 0 表示对全部 commit 强制；设未来值可验证「存量不追溯」）
EXEMPT_QUALITY_STRICT_FROM="${EXEMPT_QUALITY_STRICT_FROM:-1793462400}"

# 用法：exempt_quality_is_strict <commit>  → 0 = 该 commit 受质量门强制
exempt_quality_is_strict() {
  local ts
  ts="$(git log -1 --format=%ct "$1" 2>/dev/null)" || return 1
  [ "${ts:-0}" -ge "$EXEMPT_QUALITY_STRICT_FROM" ]
}

# ---- 理由质量门（卡 2.7）----
# 用法：exempt_quality <reason> <ui_file_count> [total_file_count]
#   ui_file_count    = 该 commit 的 UI 源码改动文件数
#   total_file_count = 该 commit 的总改动文件数（缺省取 ui_file_count）
# 返回：0 = 合格；1 = 不合格（EXEMPT_QUALITY_MSG 说明原因）
exempt_quality() {
  local reason="$1" ui_n="${2:-0}" tot_n="${3:-$2}"
  local len low trimmed v

  EXEMPT_QUALITY_MSG=""

  # ① 理由质量：长度下限 + 无信息量取值
  len="$(exempt_char_len "$reason")"
  if [ "$len" -lt "$EXEMPT_MIN_REASON_LEN" ]; then
    EXEMPT_QUALITY_MSG="豁免理由过短（${len} 字 < ${EXEMPT_MIN_REASON_LEN} 字）"
    return 1
  fi
  low="$(printf '%s' "$reason" | tr 'A-Z' 'a-z')"
  trimmed="$low"
  while :; do
    case "$trimmed" in
      [[:space:]]*) trimmed="${trimmed#[[:space:]]}" ;;
      *) break ;;
    esac
  done
  while :; do
    case "$trimmed" in
      *[[:space:]]) trimmed="${trimmed%[[:space:]]}" ;;
      *) break ;;
    esac
  done
  for v in $EXEMPT_EMPTY_VALUES; do
    if [ "$trimmed" = "$v" ]; then
      EXEMPT_QUALITY_MSG="豁免理由无信息量（取值「${trimmed}」）"
      return 1
    fi
  done

  # ② 批量标注：UI 源码改动 ≥ 阈值时，理由须含文件数与统一根因
  if [ "$ui_n" -ge "$EXEMPT_BATCH_MIN_FILES" ]; then
    # 文件数：理由里出现 UI 文件数或总文件数（独立数字，不能是别的数的一部分）
    if ! printf '%s' "$reason" | grep -qE "(^|[^0-9])${ui_n}([^0-9]|$)"; then
      if [ "$tot_n" != "$ui_n" ] && printf '%s' "$reason" | grep -qE "(^|[^0-9])${tot_n}([^0-9]|$)"; then
        :
      else
        EXEMPT_QUALITY_MSG="批量豁免（UI 改动 ${ui_n} 个文件）未在理由中标注文件数"
        return 1
      fi
    fi
    if ! printf '%s' "$reason" | grep -qE "($(printf '%s' "$EXEMPT_ROOTCAUSE_KEYWORDS" | tr ' ' '|'))"; then
      EXEMPT_QUALITY_MSG="批量豁免（UI 改动 ${ui_n} 个文件）未在理由中说明统一根因"
      return 1
    fi
  fi
  return 0
}

# ---- 组合判定：覆盖该门 且 理由合格 ----
# 用法：exempt_allows <body> <gate> <ui_file_count> [total_file_count]
# 返回：0 = 该门被豁免（可跳过判定）；1 = 未被豁免（该门照常判定）
exempt_allows() {
  local body="$1" gate="$2" ui_n="${3:-0}" tot_n="${4:-$3}"
  exempt_parse "$body" || return 1
  exempt_covers "$gate" || return 1
  exempt_quality "$EXEMPT_REASON" "$ui_n" "$tot_n" || return 1
  return 0
}

# ---- 列出 range 内带豁免 trailer 的 commit ----
# 输出每行 "sha\x1f理由原文"（理由已去掉 "Micro-exempt:" 前缀与前导空白）。
# 只做一次 git log（单次调用），不逐 commit fork —— scan-rules 已在 commit 级别做过
# 一次 git show，再逐 commit fork 会成倍放大耗时（2026-10-22 实测一次 diff 扫描 10 分 29 秒）。
exempt_commits_in_range() {
  git log --format="%H%x1f%B%x1e" "$1" 2>/dev/null | awk '
    BEGIN { RS = "\036"; FS = "\037" }
    {
      if (NF < 2) next
      sha = $1; body = $2
      n = split(body, lines, "\n")
      for (i = 1; i <= n; i++) {
        if (lines[i] ~ /^Micro-exempt:/) {
          r = lines[i]
          sub(/^Micro-exempt:[ \t]*/, "", r)
          print sha "\037" r
          break
        }
      }
    }'
}

# ---- trailer 指向的路径是否真实存在 ----
# 用法：exempt_path_exists <sha> <path> [base]
#   ① 先看该 commit 的树里有没有这个路径（仓库内路径的标准口径）
#   ② 再看文件系统（绝对路径，或相对 base）—— 测试用例文档按规范落在**任务目录**
#      （仓库外），只看 commit 树会造成必然误报。
exempt_path_exists() {
  local c="$1" p="$2" base="${3:-}" t
  [ -n "$p" ] || return 1
  case "$p" in
    /*)
      [ -f "$p" ] && return 0
      return 1
      ;;
  esac
  if [ -n "$c" ] && [ "$(git cat-file -t "$c:$p" 2>/dev/null)" = "blob" ]; then
    return 0
  fi
  [ -n "$base" ] && [ -f "$base/$p" ] && return 0
  [ -f "$p" ] && return 0
  return 1
}

# ============================================================
# §2 规格书识别（卡 2.6）
# ============================================================
# 现状问题：规格书识别写死「文件名匹配 page-spec*.md」，于是
#   `specs/pipeline-form-preview/prototype.html`（有原型、文件名不符约定）
#   被判为「没有原型」→ 被逼用 Micro-exempt 豁免（实证 db526889）。
#   这是门禁自己绊自己：执行者做了正确的事（同行改了原型），却被规则惩罚。
#
# 放宽后的判定：文件位于 `docs/ui/page-specs/` 或 `specs/` 目录下，
#   且**文件名或目录名**含 page-spec / prototype / 原型 语义。
#
# ⚠️ 注意：本判定只用于「这个 commit 是否改了原型/规格」，
#   不用于「原型与 UI 源码不得同 commit」（check-commit-msg.sh 的混合提交检查）
#   —— 那是另一条规则，不在卡 2.6 范围内，不在 2.6 范围内放宽会引入新的拒绝。
is_spec_doc() {
  local p="$1" base dir seg
  case "$p" in
    docs/ui/page-specs/*|specs/*) ;;
    *) return 1 ;;
  esac
  base="${p##*/}"
  dir="${p%/*}"
  case "$base" in *page-spec*|*prototype*|*原型*) return 0 ;; esac
  local IFS='/'
  for seg in $dir; do
    case "$seg" in *page-spec*|*prototype*|*原型*) return 0 ;; esac
  done
  return 1
}
