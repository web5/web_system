#!/usr/bin/env bash
# ============================================================
# test-gate-hardening.sh — 门禁硬化改造的验收测试（卡 2.1~2.9）
#
# 用法：bash scripts/redline/test-gate-hardening.sh
#
# 设计：造一个**临时 git 仓库**（隔离，不碰真实仓库），在里面构造各种 commit，
#       逐条断言 scan-rules.sh / check-commit-msg.sh 的判定是否符合预期。
#       每个用例都有「变异测试」注释 —— 故意改坏实现时该用例会红。
#
# 为什么用临时仓库：真实 master 上「造一个 Micro-exempt: R11 但缺 Plan:」的 commit
#   会污染主线；且门禁行为只取决于 commit 内容与 message，与仓库其余部分无关。
# ============================================================
set -uo pipefail

TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCAN="$TOP/scripts/redline/scan-rules.sh"
CHECK_MSG="$TOP/scripts/redline/check-commit-msg.sh"

PASS=0
FAIL=0
FAILED_CASES=""

ok()   { PASS=$((PASS+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); FAILED_CASES="${FAILED_CASES}\n    - $1"; printf '  \033[0;31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
sec_head() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gate-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---- 造仓库 ----
cd "$WORK" || exit 1
git init -q .
git config user.email t@t.io
git config user.name T
git config commit.gpgsign false
mkdir -p servers/api/src apps/admin/src/views specs/x docs/ui/page-specs
echo "x" > servers/api/src/app.ts
echo "x" > apps/admin/src/views/A.vue
git add -A && git commit -qm "init"

BASE="$(git rev-parse HEAD)"

# 造一个 commit：改动 servers/api/src/app.ts（新增 controller → 命中 R15/R18）
newcommit() { # $1=msg  $2..=文件路径（相对仓库根，内容自动写）
  local msg="$1"; shift
  local f
  for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "content-$RANDOM" > "$f"; done
  git add -A
  git commit -qm "$msg"
}

# 扫描单个 commit 的判定：输出该 commit 命中的规则
scan_one() { # $1=commit sha
  bash "$SCAN" diff "$1^..$1" --no-color 2>/dev/null | grep -oE '\[R[0-9]+b?\]' | tr -d '[]' | sort -u | tr '\n' ' '
}

expect_rules() { # $1=label $2=commit $3=期望规则(空格分隔) $4=不该有的规则(空格分隔)
  local label="$1" c="$2" want="$3" notwant="$4"
  local got w n bad_hit=""
  got="$(scan_one "$c")"
  for w in $want; do
    case " $got " in *" $w "*) ;; *) bad_hit="$bad_hit 缺:$w" ;; esac
  done
  for n in $notwant; do
    case " $got " in *" $n "*) bad_hit="$bad_hit 多:$n" ;; esac
  done
  if [ -z "$bad_hit" ]; then
    ok "${label}（命中: ${got:-无}）"
  else
    bad "${label}" "实际命中: ${got:-无}；问题:$bad_hit"
  fi
}

# ============================================================
sec_head "卡 2.1 · R17 触发面放宽"
# ============================================================
# 旧逻辑只认「新增 A」+ 一层路径 → 改动既有 .ts 不触发
newcommit "feat: 改既有 ts 文件" servers/api/src/app.ts
C_MOD="$(git rev-parse HEAD)"
expect_rules "修改既有 servers .ts 触发 R17" "$C_MOD" "R17" ""

# 深层目录也应触发（递归 glob）
newcommit "feat: 新增深层 ts" servers/api/src/deep/nested/mod.ts
C_DEEP="$(git rev-parse HEAD)"
expect_rules "深层路径触发 R17" "$C_DEEP" "R17" ""

# .tsx 也应触发
newcommit "feat: 新增 tsx" apps/admin/src/views/B.tsx
C_TSX="$(git rev-parse HEAD)"
expect_rules ".tsx 触发 R17" "$C_TSX" "R17" ""

# 测试文件自身不触发
newcommit "test: 新增 spec 文件" servers/api/src/app.spec.ts
C_SPEC="$(git rev-parse HEAD)"
expect_rules "*.spec.ts 不触发 R17" "$C_SPEC" "" "R17"

# ============================================================
sec_head "卡 2.2 · R17 判据真实性（Test: 须指向真实文件）"
# ============================================================
newcommit "feat: 带假路径 Test 凭证" servers/api/src/app2.ts
git commit --amend -qm "feat: 带假路径 Test 凭证
Test: docs/不存在的用例文档.md"
C_FAKE="$(git rev-parse HEAD)"
expect_rules "Test 指向不存在路径 → 报 R17" "$C_FAKE" "R17" ""

# Test: pass → 允许
newcommit "feat: Test pass" servers/api/src/app3.ts
git commit --amend -qm "feat: Test pass
Test: pass"
C_PASS="$(git rev-parse HEAD)"
expect_rules "Test: pass → 放行" "$C_PASS" "" "R17"

# Test: 指向真实存在且已落盘的文件 → 放行
newcommit "feat: Test 指向真实文档" servers/api/src/app4.ts
echo "用例文档" > docs/ui/page-specs/real.md
git add -A && git commit -qm "feat: Test 指向真实文档
Test: docs/ui/page-specs/real.md"
C_REAL="$(git rev-parse HEAD)"
expect_rules "Test 指向真实文件 → 放行" "$C_REAL" "" "R17"

# ============================================================
sec_head "卡 2.8 · 豁免按门分类"
# ============================================================
# 造一个改了 controller 的 commit（命中 R15/R18），带 Micro-exempt: R11 → R15/R18 应仍报
newcommit "feat: 新增 controller" servers/api/src/thing.controller.ts
git commit --amend -qm "feat: 新增 controller
Micro-exempt: R11: 纯视觉微调，不涉及契约与发布面"
C_SCOPED="$(git rev-parse HEAD)"
expect_rules "R11 分类豁免 → R15/R18 仍报" "$C_SCOPED" "R15 R18" "R11"

# 旧格式 → 仍全豁免
newcommit "feat: 新增 controller2" servers/api/src/thing2.controller.ts
git commit --amend -qm "feat: 新增 controller2
Micro-exempt: 纯视觉微调，本次改动不涉及任何门禁面"
C_LEGACY="$(git rev-parse HEAD)"
expect_rules "旧格式豁免 → 全部放行" "$C_LEGACY" "" "R11 R15 R18"

# 多门豁免 R15,R18 → R15/R18 放行
newcommit "feat: 新增 controller3" servers/api/src/thing3.controller.ts
git commit --amend -qm "feat: 新增 controller3
Micro-exempt: R15,R18: 批量新增对外接口，契约与发布面均已评审"
C_MULTI="$(git rev-parse HEAD)"
expect_rules "多门豁免 R15,R18 → 均放行" "$C_MULTI" "" "R15 R18"

# ============================================================
sec_head "卡 2.7 · 豁免理由质量门"
# ============================================================
# 质量门有生效日期（EXEMPT_QUALITY_STRICT_FROM，默认 2026-11-01）：
# 生效日之前的存量 commit 不追溯翻红，只报 R20 提醒。
# 本段用例造的是「现在」的 commit，故先把门槛设为 0（强制全部生效）来验证质量门逻辑本身；
# 段末再单独验证「存量不追溯」的行为。
export EXEMPT_QUALITY_STRICT_FROM=0
# 理由过短 → 豁免不生效
newcommit "feat: 新增 controller4" servers/api/src/thing4.controller.ts
git commit --amend -qm "feat: 新增 controller4
Micro-exempt: yes"
C_SHORT="$(git rev-parse HEAD)"
expect_rules "理由=yes → 豁免不生效（报 R15/R18）" "$C_SHORT" "R15 R18" ""

# 理由无信息量（yes）→ 同上
newcommit "feat: 新增 controller5" servers/api/src/thing5.controller.ts
git commit --amend -qm "feat: 新增 controller5
Micro-exempt: no"
C_NO="$(git rev-parse HEAD)"
expect_rules "理由=no → 豁免不生效" "$C_NO" "R15 R18" ""

# 批量改动（≥5 个 UI 文件）但理由没标文件数 → 不生效
for i in 1 2 3 4 5 6; do echo "v$i" > "apps/admin/src/views/P$i.vue"; done
newcommit "feat: 批量改 UI" apps/admin/src/views/P1.vue
git commit --amend -qm "feat: 批量改 UI
Micro-exempt: 纯缺陷修复，浮层视觉无设计变更"
C_BATCH="$(git rev-parse HEAD)"
# 该 commit 改了 UI 文件 → R11 会命中；豁免不生效 → R11 报出来
expect_rules "批量豁免未标文件数 → 豁免不生效" "$C_BATCH" "R11" ""

# 批量改动 + 理由含文件数与统一根因 → 生效
newcommit "feat: 批量改 UI2" apps/admin/src/views/P2.vue
git commit --amend -qm "feat: 批量改 UI2
Micro-exempt: 同一 CSS 作用域 bug 批量修复，7 个 UI 文件统一挂回模块容器"
C_BATCHOK="$(git rev-parse HEAD)"
expect_rules "批量豁免标了文件数与根因 → 生效" "$C_BATCHOK" "" "R11"

# 存量不追溯：门槛设在未来 → 同样的劣质理由不再让豁免失效（但仍报 R20 提醒）
# 实证：6796d16b（2026-10-23，11 个 UI 文件、理由未标范围）曾被追溯翻红为 R11 error
export EXEMPT_QUALITY_STRICT_FROM=4102444800   # 2100-01-01
newcommit "feat: 新增 controller9" servers/api/src/thing9.controller.ts
git commit --amend -qm "feat: 新增 controller9
Micro-exempt: yes"
C_LEGACYQ="$(git rev-parse HEAD)"
expect_rules "存量劣质理由 → 不追溯翻红（豁免仍生效，仅报 R20）" "$C_LEGACYQ" "R20" "R15 R18"
export EXEMPT_QUALITY_STRICT_FROM=0

# ============================================================
sec_head "卡 2.9 · 空提交检测"
# ============================================================
git commit -q --allow-empty -m "ci: 空提交重跑"
C_EMPTY="$(git rev-parse HEAD)"
got="$(scan_one "$C_EMPTY")"
case " $got " in
  *" R19 "*) ok "空提交 → 报 R19（命中: ${got:-无}）" ;;
  *) bad "空提交 → 报 R19" "实际命中: ${got:-无}" ;;
esac

# ============================================================
sec_head "卡 2.6 · 规格书识别放宽"
# ============================================================
# specs/x/prototype.html 应被认作规格书 → R11 的原型/规格面不该要求补 Design
newcommit "docs: 新增原型页" specs/x/prototype.html
C_PROTO="$(git rev-parse HEAD)"
got="$(scan_one "$C_PROTO")"
case " $got " in
  *" R11 "*) bad "specs/**/prototype.html 被认作规格书（R11 不应命中）" "实际命中: ${got:-无}" ;;
  *) ok "specs/**/prototype.html 被认作规格书（R11 未命中）" ;;
esac

# ============================================================
sec_head "卡 2.8 · check-commit-msg.sh 的豁免分类"
# ============================================================
# L2 本地门：UI commit 缺 Proto → 报错；带 Micro-exempt: R11 不应豁免 R10(Proto)
# ⚠️ check-commit-msg.sh 检的是**暂存区**（commit 还没建），所以这里改文件后 git add，
#    不能用 newcommit（那会先 commit 掉，暂存区就空了）。
echo "staged ui change" > apps/admin/src/views/Z.vue
git add apps/admin/src/views/Z.vue
MSGFILE="$WORK/msg.txt"
printf 'feat: UI 改动待提交\nMicro-exempt: R11: 纯视觉微调，仅设计评审豁免\n' > "$MSGFILE"
out="$(cd "$WORK" && bash "$CHECK_MSG" "$MSGFILE" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'Proto'; then
  ok "L2：R11 分类豁免不放行 Proto 检查"
else
  bad "L2：R11 分类豁免不放行 Proto 检查" "rc=$rc out=$(printf '%s' "$out" | head -3 | tr '\n' ' ')"
fi

# L2：R10 分类豁免 → 放行（Proto 被豁免，但 Design 仍须带 → 仍应拒）
printf 'feat: UI 改动待提交\nMicro-exempt: R10: 纯视觉微调，仅原型凭证豁免\n' > "$MSGFILE"
out="$(cd "$WORK" && bash "$CHECK_MSG" "$MSGFILE" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -q 'Design'; then
  ok "L2：R10 分类豁免放行 Proto，但仍要求 Design"
else
  bad "L2：R10 分类豁免放行 Proto，但仍要求 Design" "rc=$rc out=$(printf '%s' "$out" | head -3 | tr '\n' ' ')"
fi

# 旧格式 → L2 全部放行
printf 'feat: UI 改动待提交\nMicro-exempt: 纯视觉微调，本次改动不涉及任何门禁面\n' > "$MSGFILE"
out="$(cd "$WORK" && bash "$CHECK_MSG" "$MSGFILE" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then
  ok "L2：旧格式豁免全放行"
else
  bad "L2：旧格式豁免全放行" "rc=$rc out=$(printf '%s' "$out" | head -3 | tr '\n' ' ')"
fi

# ============================================================
sec_head "卡 2.3 · 交付物完整性脚本"
# ============================================================
DELIV="$TOP/scripts/verify-deliverables.sh"
if [ -x "$DELIV" ] || [ -f "$DELIV" ]; then
  ok "verify-deliverables.sh 存在"
else
  bad "verify-deliverables.sh 存在" "文件缺失"
fi

# ============================================================
sec_head "范围保护 · 上限拒绝 / 显式放行（#8250）"
# ============================================================
# 背景：1517 commit 全历史实测 17m27s、峰值 186MB —— 不是内存问题，但会被外部超时
#   杀掉（exit 137/139），看起来像崩溃。加保护的目的不是"跑得快"，是"别让人等 17 分钟
#   才被 kill"。⚠️ 判据里必须包含「不得静默截断」：只扫一部分却打印通过，是另一种假通过。
out="$(cd "$WORK" && bash "$SCAN" --no-color diff "$BASE..HEAD" --max-commits 1 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q '扫描范围过大'; then
  ok "上限：超限 exit 2 + 报「扫描范围过大」"
else
  bad "上限：超限 exit 2 + 报「扫描范围过大」" "rc=$rc out=$(printf '%s' "$out" | head -2 | tr '\n' ' ')"
fi

# 指引必须可执行：缩范围（merge-base）与单次放行（--max-commits 0）两条路都要给
if printf '%s' "$out" | grep -q 'merge-base' && printf '%s' "$out" | grep -q -- '--max-commits 0'; then
  ok "上限：指引含「缩范围」与「显式放行」两条可执行路径"
else
  bad "上限：指引含两条可执行路径" "out=$(printf '%s' "$out" | head -8 | tr '\n' ' ')"
fi

# --max-commits 0 = 不限制
out="$(cd "$WORK" && bash "$SCAN" --no-color diff "$BASE..HEAD" --max-commits 0 2>&1)"; rc=$?
if ! printf '%s' "$out" | grep -q '扫描范围过大'; then
  ok "上限：--max-commits 0 不拦截"
else
  bad "上限：--max-commits 0 不拦截" "rc=$rc"
fi

# 非法值必须报错，不能静默当成 0 —— 当 0 等于悄悄关掉保护（假通过的近亲）
out="$(cd "$WORK" && bash "$SCAN" --no-color diff "$BASE..HEAD" --max-commits abc 2>&1)"; rc=$?
if [ "$rc" -eq 2 ] && printf '%s' "$out" | grep -q '非负整数'; then
  ok "上限：非法值 exit 2（不当成 0 悄悄关保护）"
else
  bad "上限：非法值 exit 2" "rc=$rc out=$(printf '%s' "$out" | head -2 | tr '\n' ' ')"
fi

# 默认 300 不得误伤正常 PR 范围（CI 单 PR <20 commit）
out="$(cd "$WORK" && bash "$SCAN" --no-color diff "$BASE..HEAD" 2>&1)"; rc=$?
if ! printf '%s' "$out" | grep -q '扫描范围过大'; then
  ok "上限：默认 300 不误伤正常 PR 范围"
else
  bad "上限：默认 300 不误伤正常 PR 范围" "rc=$rc"
fi

# SCAN_PROFILE 要能定位「哪一门慢」——只有累计值时要人做减法，等于半个工具
out="$(cd "$WORK" && SCAN_PROFILE=1 bash "$SCAN" --no-color diff "$BASE..HEAD" 2>&1 >/dev/null)"
if printf '%s' "$out" | grep -qE '\+[[:space:]]*[0-9]+s.*累计'; then
  ok "profile：逐门输出「本段 +Ns / 累计 Ns」"
else
  bad "profile：逐门输出「本段 +Ns / 累计 Ns」" "out=$(printf '%s' "$out" | head -3 | tr '\n' ' ')"
fi

# ============================================================
printf '\n\033[1m== 汇总 ==\033[0m\n'
printf '通过 %s / 失败 %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '失败用例：%s\n' "$FAILED_CASES"
  exit 1
fi
exit 0
