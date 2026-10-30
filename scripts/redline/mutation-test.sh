#!/usr/bin/env bash
# ============================================================
# mutation-test.sh — 变异测试：故意改坏实现，确认对应检查会红
#
# 用法：bash scripts/redline/mutation-test.sh
#
# 为什么必须有这个：判据「由我写不算数，必须被变异证伪」。
#   每个变异 = 把实现的某个关键判定改坏（去掉唯一性校验、把上限写错、
#   注释掉条件…），然后确认**对应的检查会报出来**。
#   若变异后检查仍然绿 → 说明该检查根本没生效（形同虚设），必须修。
#
# 手法：把脚本改坏 → 跑测试 → 期望「测试失败」→ 还原。
#   若变异后测试仍全绿 → 报 FAIL（该判据形同虚设）。
# ============================================================
set -uo pipefail

TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$TOP" || exit 1

PASS=0
FAIL=0
FAILED_CASES=""

ok()  { PASS=$((PASS+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED_CASES="${FAILED_CASES}\n    - $1"; printf '  \033[0;31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
mh()  { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# 备份要改的文件
BACKUP="$(mktemp -d "${TMPDIR:-/tmp}/mut.XXXXXX")"
trap 'rm -rf "$BACKUP"; restore_all' EXIT

MUTATED_FILES=()
restore_all() {
  for f in "${MUTATED_FILES[@]}"; do
    [ -f "$BACKUP/$(basename "$f")" ] && cp "$BACKUP/$(basename "$f")" "$f"
  done
}
snapshot() { for f in "$@"; do cp "$f" "$BACKUP/$(basename "$f")"; MUTATED_FILES+=("$f"); done; }

# 变异一个文件（python 精确替换），跑测试，期望测试失败
# 用法: mutate_expect_fail "<名称>" <文件> "<旧串>" "<新串>" "<期望失败的正则>"
mutate_expect_fail() {
  local name="$1" file="$2" old="$3" new="$4" pat="$5" out rc
  snapshot "$file"
  python3 - "$file" "$old" "$new" <<'PYEOF'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding='utf-8').read()
if s.count(old) != 1:
    sys.exit('anchor count=%d (期望 1)' % s.count(old))
io.open(p, 'w', encoding='utf-8').write(s.replace(old, new))
PYEOF
  if [ $? -ne 0 ]; then
    bad "${name}" "变异失败：锚点未唯一命中"
    restore_all
    return
  fi
  out="$(bash scripts/redline/test-gate-hardening.sh 2>&1)"
  rc=$?
  restore_all
  if [ "$rc" -eq 0 ]; then
    bad "${name}" "变异后测试仍全绿 → 该判据形同虚设"
  elif printf '%s' "$out" | grep -qE "$pat"; then
    ok "${name}（变异后测试如预期失败：$(printf '%s' "$out" | grep -oE "$pat" | head -1)）"
  else
    bad "${name}" "变异后测试失败了，但失败原因不是目标判据（期望匹配 ${pat}）"
  fi
}

SCAN="scripts/redline/scan-rules.sh"
LIB="scripts/redline/gate-shared.sh"
MSG="scripts/redline/check-commit-msg.sh"

# ============================================================
mh "卡 2.1 · R17 触发面"
# ============================================================
# 变异 1：把 A*|M* 退回只认 A*（= 撤回触发面放宽）
mutate_expect_fail "R17 触发面：退回只认新增（A*）" "$SCAN" \
  '        A*|M*)
          # 卡 2.1 ②③：递归 glob + 扩展名放宽' \
  '        A*)
          # 卡 2.1 ②③：递归 glob + 扩展名放宽' \
  'R17'

# 变异 2：去掉 .tsx 扩展名（撤回扩展名放宽）
mutate_expect_fail "R17 触发面：去掉 .tsx" "$SCAN" \
  '*.ts|*.tsx|*.mjs|*.jsx|*.vue)' \
  '*.ts|*.mjs|*.jsx|*.vue)' \
  'R17'

# 变异 3：不再排除测试文件自身
mutate_expect_fail "R17 触发面：不再排除测试文件" "$SCAN" \
  '*.spec.*|*.test.*) ;;
                    *) hit=1 ;;' \
  '*) hit=1 ;;' \
  'R17'

# ============================================================
mh "卡 2.2 · R17 判据真实性"
# ============================================================
# 变异 4：Test: 路径存在性校验去掉（永远放行）
mutate_expect_fail "R17 判据：去掉路径存在性校验" "$SCAN" \
  '  if ! exempt_path_exists "$c" "$tval" "$TOP"; then' \
  '  if false; then' \
  'R17'

# 变异 5：Test: pass 也不再放行（应放行却报 → 判据过严）
mutate_expect_fail "R17 判据：Test: pass 不再放行" "$SCAN" \
  '  [ "$tval" = "pass" ] && return 0' \
  '  [ "$tval" = "passX" ] && return 0' \
  'R17'

# ============================================================
mh "卡 2.8 · 豁免按门分类"
# ============================================================
# 变异 6：旧格式恢复一票否决到「只放行被问到的这一门」（即分类逻辑反了）
mutate_expect_fail "豁免分类：旧格式不再一票否决" "$LIB" \
  '  [ "$EXEMPT_LEGACY" = "1" ] && return 0' \
  '  [ "$EXEMPT_LEGACY" = "1" ] && [ "$gate" = "$EXEMPT_GATES" ] && return 0' \
  '豁免'

# 变异 7：门号匹配永远为真（分类形同虚设 → 任何门都被豁免）
mutate_expect_fail "豁免分类：门号匹配恒真" "$LIB" \
  '    [ "$g" = "$gate" ] && return 0' \
  '    return 0' \
  '豁免'

# ============================================================
mh "卡 2.7 · 豁免理由质量门"
# ============================================================
# 变异 8：理由长度下限失效
mutate_expect_fail "理由质量：去掉长度下限" "$LIB" \
  '  if [ "$len" -lt "$EXEMPT_MIN_REASON_LEN" ]; then' \
  '  if false; then' \
  'R20'

# 变异 9：无信息量取值白名单失效
mutate_expect_fail "理由质量：去掉无信息量取值判定" "$LIB" \
  '      EXEMPT_QUALITY_MSG="豁免理由无信息量（取值「${trimmed}」）"' \
  '      EXEMPT_QUALITY_MSG="豁免理由无信息量（取值「${trimmed}」）"; return 0' \
  'R20'

# 变异 10：批量标注的文件数要求失效
mutate_expect_fail "理由质量：去掉批量文件数要求" "$LIB" \
  '    if ! printf '"'"'%s'"'"' "$reason" | grep -qE "(^|[^0-9])${ui_n}([^0-9]|$)"; then' \
  '    if false; then' \
  'R20'

# 变异 11：统一根因要求失效
mutate_expect_fail "理由质量：去掉统一根因要求" "$LIB" \
  '    if ! printf '"'"'%s'"'"' "$reason" | grep -qE "($(printf '"'"'%s'"'"' "$EXEMPT_ROOTCAUSE_KEYWORDS" | tr '"'"' '"'"' '"'"'|'"'"'))"; then' \
  '    if false; then' \
  'R20'

# ============================================================
mh "卡 2.9 · 空提交检测"
# ============================================================
# 变异 12：空提交检测条件恒假
mutate_expect_fail "空提交检测：条件恒假" "$SCAN" \
  '    [ "${nfiles:-0}" = "0" ] || continue' \
  '    [ "${nfiles:-0}" = "__never__" ] || continue' \
  'R19'

# 变异 13：空提交也被豁免放行（本门不该接受豁免）
mutate_expect_fail "空提交检测：被豁免放行" "$SCAN" \
  '  check_r19_empty_commit "$range";  _prof "R19 空提交检测"' \
  '  : ;  _prof "R19 空提交检测"' \
  'R19'

# ============================================================
mh "卡 2.6 · 规格书识别"
# ============================================================
# 变异 14：is_spec_doc 恒假（规格书识别放宽失效）
mutate_expect_fail "规格书识别：is_spec_doc 恒假" "$LIB" \
  'is_spec_doc() {
  local p="$1" base dir seg' \
  'is_spec_doc() {
  local p="$1" base dir seg
  return 1' \
  '规格书'

# ============================================================
mh "卡 2.3 / 2.4 · 交付物脚本与 CI"
# ============================================================
# 变异 15：交付物脚本不再判缺（永远通过）
mutate_expect_fail "交付物脚本：缺件也判齐备" "scripts/verify-deliverables.sh" \
  '  bad "① 方案文档缺失（需 *方案*.md / *设计*.md / *分析*.md 至少 1 份）"' \
  '  ok "① 方案文档缺失（需 *方案*.md / *设计*.md / *分析*.md 至少 1 份）"' \
  '交付物'

# 变异 16：交付物脚本自检恒通过
mutate_expect_fail "交付物脚本：自检恒通过" "scripts/verify-deliverables.sh" \
  '    if bash "$0" "$d" >/dev/null 2>&1; then
      echo "自检失败：缺测试用例文档时应 exit 1" >&2
      return 1
    fi' \
  '    if false; then
      echo "自检失败：缺测试用例文档时应 exit 1" >&2
      return 1
    fi' \
  '自检'

printf '\n\033[1m== 汇总 ==\033[0m\n'
printf '变异被正确捕获 %s / 变异未被捕获 %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '失败用例：%s\n' "$FAILED_CASES"
  exit 1
fi
exit 0
