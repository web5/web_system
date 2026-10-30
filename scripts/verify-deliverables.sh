#!/usr/bin/env bash
# ============================================================
# verify-deliverables.sh — 交付物完整性检查（四件套）
#
# 依据：~/AiWorkspace/20-私域资产/研发方案与发布规范-v2.md §2.10「交付物清单」
#   四件套（缺一不可）：
#     ① 方案文档        任务目录下匹配 *方案*.md / *设计*.md / *分析*.md 至少 1 份
#     ② 需求单/任务卡   匹配 *需求单*.md / *派单*.md 至少 1 份
#     ③ 测试用例文档    匹配 *测试用例*.md / *测试*.md 至少 1 份
#                       —— 无代码改动时豁免（需任务目录有「无代码改动」说明）
#     ④ 交互清单        匹配 *page-spec*.md / *交互清单*.md 至少 1 份
#                       —— 无 UI 改动时豁免
#
# 用法:
#   bash scripts/verify-deliverables.sh <任务目录> [<commit-sha>]
#
#   <任务目录>   交付物所在目录（如 ~/AiWorkspace/30-任务产物/2026-10-29-xxx/）
#   <commit-sha> 可选。给了则额外校验该 commit message 里的
#                Test: / Spec: trailer 指向的文件真实存在（判据与卡 2.2 同口径）
#
# 退出码: 0 = 齐备；1 = 有缺项
#
# 为什么单独成脚本而不是塞进 scan-rules.sh：
#   scan-rules.sh 扫的是**仓库里的 commit**，交付物却大多落在**仓库外**的任务目录
#   （~/AiWorkspace/30-任务产物/…），两者不在同一个文件系统边界上，
#   硬合并会让 scan-rules 依赖仓库外的路径 —— CI 上必然失配。
# ============================================================
set -uo pipefail

TASK_DIR="${1:-}"
COMMIT_SHA="${2:-}"

usage() {
  cat >&2 <<'USAGE'
用法: bash scripts/verify-deliverables.sh <任务目录> [<commit-sha>]
  <任务目录>    交付物所在目录
  [<commit-sha>] 可选；给了则校验该 commit 的 Test:/Spec: trailer 指向的文件是否存在
USAGE
  exit 2
}

# ---- 自检模式（CI 用）：造一个临时任务目录，验证本脚本能正确判缺 ----
# 为什么需要：CI 上没有真实任务目录，若不验证脚本本身可用，
#   「脚本写错了但从没人跑」会一直藏着。故 CI 固定跑一次自检。
if [ "${1:-}" = "--self-check" ]; then
  self_check() {
    local d; d="$(mktemp -d "${TMPDIR:-/tmp}/deliv-self.XXXXXX")"
    trap 'rm -rf "$d"' RETURN
    mkdir -p "$d"
    echo "方案-x" > "$d/方案-x.md"
    echo "需求单-x" > "$d/需求单-x.md"
    echo "测试用例-x" > "$d/测试用例-x.md"
    echo "spec-x" > "$d/page-spec-x.md"
    if ! bash "$0" "$d" >/dev/null 2>&1; then
      echo "自检失败：四件套齐备时应 exit 0" >&2
      return 1
    fi
    rm -f "$d/测试用例-x.md"
    if bash "$0" "$d" >/dev/null 2>&1; then
      echo "自检失败：缺测试用例文档时应 exit 1" >&2
      return 1
    fi
    echo "自检通过：齐备→exit 0，缺件→exit 1"
    return 0
  }
  self_check
  exit $?
fi

[ -n "$TASK_DIR" ] || usage
[ -d "$TASK_DIR" ] || { echo "错误：任务目录不存在：$TASK_DIR" >&2; exit 2; }

TASK_DIR="$(cd "$TASK_DIR" && pwd)"

MISSING=0
OK_COUNT=0

note() { printf '  \033[0;33m·\033[0m %s\n' "$1"; }
good() { OK_COUNT=$((OK_COUNT+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad()  { MISSING=$((MISSING+1)); printf '  \033[0;31m✗\033[0m %s\n' "$1"; }

# 在任务目录（递归）里找匹配任一 pattern 的文件
# 用法: find_any <pattern>... → 打印第一个匹配的文件路径（找不到则空输出）
find_any() {
  local pat f
  for pat in "$@"; do
    f="$(find "$TASK_DIR" -type f -name "$pat" 2>/dev/null | head -n 1)"
    if [ -n "$f" ]; then
      printf '%s' "$f"
      return 0
    fi
  done
  return 1
}

# 任务目录里是否有说明「无代码改动」/「无 UI 改动」的文档
# 判定口径：任一 .md 文件正文里出现该表述即算「已说明」
has_note() {
  local kw="$1" f
  f="$(find "$TASK_DIR" -type f -name '*.md' 2>/dev/null | head -n 40)"
  [ -n "$f" ] || return 1
  # 用 grep -l（只看是否命中，不看行号），一次调用扫全部候选
  printf '%s\n' "$f" | xargs grep -l -- "$kw" 2>/dev/null | head -n 1 | grep -q .
}

echo "交付物完整性检查"
echo "任务目录: $TASK_DIR"
[ -n "$COMMIT_SHA" ] && echo "commit:   $COMMIT_SHA"
echo "---------------------------------------------"

# ---------- ① 方案文档 ----------
if f="$(find_any '*方案*.md' '*设计*.md' '*分析*.md')"; then
  good "① 方案文档：${f#$TASK_DIR/}"
else
  bad "① 方案文档缺失（需 *方案*.md / *设计*.md / *分析*.md 至少 1 份）"
fi

# ---------- ② 需求单 ----------
if f="$(find_any '*需求单*.md' '*派单*.md')"; then
  good "② 需求单：${f#$TASK_DIR/}"
else
  bad "② 需求单缺失（需 *需求单*.md / *派单*.md 至少 1 份）"
fi

# ---------- ③ 测试用例文档 ----------
if f="$(find_any '*测试用例*.md' '*测试*.md')"; then
  good "③ 测试用例文档：${f#$TASK_DIR/}"
elif has_note '无代码改动'; then
  note "③ 测试用例文档豁免（任务目录已说明「无代码改动」）"
else
  bad "③ 测试用例文档缺失（需 *测试用例*.md / *测试*.md 至少 1 份；确无代码改动须在任务目录写明「无代码改动」）"
fi

# ---------- ④ 交互清单 ----------
if f="$(find_any '*page-spec*.md' '*交互清单*.md')"; then
  good "④ 交互清单：${f#$TASK_DIR/}"
elif has_note '无 UI 改动' || has_note '无UI改动' || has_note '无 UI 变更'; then
  note "④ 交互清单豁免（任务目录已说明「无 UI 改动」）"
else
  bad "④ 交互清单缺失（需 *page-spec*.md / *交互清单*.md 至少 1 份；确无 UI 改动须在任务目录写明「无 UI 改动」）"
fi

# ---------- 附加：commit trailer 指向的文件必须真实存在 ----------
if [ -n "$COMMIT_SHA" ]; then
  if ! git cat-file -e "${COMMIT_SHA}^{commit}" 2>/dev/null; then
    bad "附加校验：commit $COMMIT_SHA 不存在"
  else
    msg="$(git log -1 --format=%B "$COMMIT_SHA" 2>/dev/null)"
    trailer_missing=0
    for key in Test Spec; do
      # 取该 trailer 的值（第一个非空行）
      val="$(printf '%s\n' "$msg" | grep -E "^${key}:[[:space:]]*[^[:space:]]+" | head -n 1 | sed -E "s/^${key}:[[:space:]]*//" | tr -d '\r')"
      [ -n "$val" ] || continue          # 没写这个 trailer → 不在本检查范围
      [ "$val" = "pass" ] && continue     # pass 表示「无需该产物」，不校验路径
      # 路径可能相对仓库根，也可能相对任务目录 —— 两处都试
      found=""
      if git cat-file -e "${COMMIT_SHA}:${val}" 2>/dev/null; then
        found="仓库内 ${val}"
      elif [ -f "$TASK_DIR/$val" ]; then
        found="任务目录内 ${val}"
      elif [ -f "$val" ]; then
        found="文件系统 ${val}"
      fi
      if [ -n "$found" ]; then
        good "附加校验：${key}: ${found}"
      else
        bad "附加校验：${key}: 指向的文件不存在 —— ${val}"
        trailer_missing=1
      fi
    done
    [ "$trailer_missing" = "0" ] && note "附加校验：Test:/Spec: trailer 指向的文件均存在"
  fi
fi

echo "---------------------------------------------"
if [ "$MISSING" -gt 0 ]; then
  printf '\033[0;31m✗ 交付物不齐备（缺 %s 项）\033[0m\n' "$MISSING"
  exit 1
fi
printf '\033[0;32m✓ 交付物齐备\033[0m\n'
exit 0
