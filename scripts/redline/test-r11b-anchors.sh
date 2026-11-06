#!/usr/bin/env bash
# ============================================================
# test-r11b-anchors.sh — R11b（原型锚点漂移）专用验收测试
#
# 用法：bash scripts/redline/test-r11b-anchors.sh
#
# 为什么单独一个文件（而不是往 cases/scenarios.tsv 里加行）：
#   scenarios.tsv 的四列是「id / mode / args / 描述」，**没有环境变量列**，
#   而 R11b 的判定完全由 DESIGN_ANCHOR_MODE 三档开关决定 —— 加不进去。
#   改 scenarios 格式要同时动 run.sh 与 shadow.sh 两个运行器，风险大于收益。
#
# 🔴 为什么 R11b 此前一条用例都没有（2026-11-06 查明）：
#   cases/ 与 test-gate-hardening.sh 都造**临时仓库**，而 scan-rules.sh 的 TOP 取
#   `git rev-parse --show-toplevel`（= cwd 的仓库根），check_r11b 又只在
#   `$TOP/scripts/redline/scan-design-drift.py` 存在时才跑。
#   临时仓库里没有这个脚本 → `[ -f "$py" ] || return 0` → **R11b 被静默跳过**，
#   用例永远绿、也永远测不到它。本文件把脚本**复制进临时仓库**，才能真正驱动它。
#
# 隔离：造临时 git 仓库，不碰真实仓库；每个用例都标了变异测试（改坏实现该用例必红）。
# ============================================================
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_SCAN="$SCRIPTS_DIR/scan-rules.sh"
REAL_PY="$SCRIPTS_DIR/scan-design-drift.py"
[ -f "$REAL_SCAN" ] || { echo "找不到 $REAL_SCAN" >&2; exit 2; }
[ -f "$REAL_PY" ]   || { echo "找不到 $REAL_PY" >&2; exit 2; }

PASS=0
FAIL=0
FAILED_CASES=""

ok()  { PASS=$((PASS+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED_CASES="${FAILED_CASES}\n    - $1"; printf '  \033[0;31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
sec_head() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/r11b-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---- 造临时仓库 ----
cd "$WORK" || exit 1
git init -q .
git config user.email t@t.io
git config user.name T
git config commit.gpgsign false
git config core.hooksPath /dev/null
mkdir -p apps/demo/prototype apps/demo/src scripts/redline
# 🔴 把真脚本复制进来：否则 check_r11b 找不到 $TOP/scripts/redline/scan-design-drift.py，
#    整条规则静默跳过，所有用例都会"通过"（假绿）。
cp "$REAL_PY" scripts/redline/scan-design-drift.py
# 🔴 必须先垫一个 init commit（不放 apps 文件）。
#    否则第一个用例的 `$sha^..$sha` 左侧 rev 不存在，scan-rules.sh 会**直接中止**
#    （"扫描范围左侧 ref 不可解析"），一条规则都不跑 —— 用例全绿但什么都没测。
#    这种空转是本文件最容易踩的假绿，故由 commit() + r11b_out() 双重拦截。
echo "fixture" > README.md
git add -A >/dev/null 2>&1 && git commit -qm "init" >/dev/null 2>&1

# scan-rules.sh 本身不进临时仓库：它按 cwd 取 TOP，所以从 $WORK 调用就会扫 $WORK。
# 但 scan-design-drift.py 必须进（check_r11b 用 $TOP/scripts/redline/ 下的路径找它）。
SCAN="$REAL_SCAN"

# 断言辅助：在某个 commit 范围上跑 bash 引擎，返回 R11b 相关输出（不含 SKIP/INFO，与真实打印一致）
# 引擎若因范围不可解析而中止，会一条规则都不跑 —— 此时任何断言都是空转，
# 所以在这里直接判死（而不是返回空串让用例"通过"）。
r11b_out() { # $1=mode  $2=range  $3=extra mode(diff|cached)
  local mode="$1" range="$2" sub="${3:-diff}" raw
  raw="$( cd "$WORK" && DESIGN_ANCHOR_MODE="$mode" bash "$SCAN" --no-color "$sub" $range 2>&1 )"
  if printf '%s' "$raw" | grep -q '扫描范围左侧 ref 不可解析\|扫描范围无效'; then
    printf '\033[0;31m夹具错误：引擎因范围不可解析中止（%s %s）—— 用例会空转\033[0m\n' "$sub" "$range" >&2
    exit 1
  fi
  printf '%s\n' "$raw" | grep -E '\[R11b\]' || true
}
# 断言辅助：R11b 这条落在哪个分节 —— "error" / "warning" / 空（没报）
# 不用全局退出码：临时仓库里别的规则也会产生 error，退出码对 R11b 没有区分力。
r11b_sev() { # $1=mode  $2=range
  ( cd "$WORK" && DESIGN_ANCHOR_MODE="$1" bash "$SCAN" --no-color diff "$2" 2>/dev/null ) | awk '
    /红线违规（error）/   { sec="error" }
    /红线提示（warning）/ { sec="warning" }
    /\[R11b\]/            { print sec; exit }
  '
}

proto() { printf '<div data-dr="%s"></div>\n' "$@" > apps/demo/prototype/index.html; }
impl()  { { printf '<template>\n'; for k in "$@"; do printf '  <div data-dr="%s"></div>\n' "$k"; done; printf '</template>\n'; } > apps/demo/src/page.vue; }
# 夹具 commit：必须真的产生新 commit，否则后续 `$sha^..$sha` 会指向上一个 commit，
# 断言就在"别人的提交"上通过 —— 这是黄金用例最隐蔽的一种假绿。
commit() {
  local before after
  before="$(git rev-parse HEAD 2>/dev/null || echo none)"
  git add -A >/dev/null 2>&1
  git commit -qm "$1" >/dev/null 2>&1
  after="$(git rev-parse HEAD)"
  if [ "$before" = "$after" ]; then
    printf '\033[0;31m夹具错误：commit 未产生变化（%s）—— 用例状态设置有误\033[0m\n' "$1" >&2
    exit 1
  fi
  # 还要保证有父 commit：否则用例的 `$sha^..$sha` 不可解析，引擎会静默中止、用例空转变绿
  if ! git rev-parse --verify --quiet "$after^" >/dev/null; then
    printf '\033[0;31m夹具错误：%s 没有父 commit，^.. 范围不可解析（用例会空转）\033[0m\n' "$1" >&2
    exit 1
  fi
  printf '%s' "$after"
}

# ============================================================
sec_head "A. 判据前提：任一侧无锚点 → SKIP（R1 回归 · P0）"

# A1：原型有锚点、实现侧**一条都没有** → 必须 SKIP，不许报 MISSING
#     这就是线上真实状态（实现侧回填 0 / 原型侧 53 个锚点）的最小复现。
#     变异测试：删掉 scan-design-drift.py 里的 `if not impl_keys` 分支 → 本用例红（报 2 条 MISSING）。
proto a b
impl            # 空 = 无锚点
C_A1="$(commit "A1 proto有/impl无")"
out="$(r11b_out warn "$C_A1^..$C_A1")"
if [ -z "$out" ]; then ok "A1 实现侧无锚点 → 静默跳过（未回填≠已漂移）"
else bad "A1 实现侧无锚点却报了漂移（R1 回归）" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"; fi

# A2：原型无锚点、实现有锚点 → 同样 SKIP（另一侧无锚点）
proto
impl a
C_A2="$(commit "A2 proto无/impl有")"
out="$(r11b_out warn "$C_A2^..$C_A2")"
if [ -z "$out" ]; then ok "A2 原型侧无锚点 → 静默跳过"
else bad "A2 原型侧无锚点却报了漂移" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"; fi

# ============================================================
sec_head "B. 两侧都有锚点时才开始比对（不能让 R1 修成「永远 SKIP」）"

# ⚠️ 用例顺序有讲究：R11b 只在**实现侧 UI 文件进 diff** 时才认这个 app
#    （`cmd_anchors` 先用 diff 里的 UI 源文件推 app 列表）。只改原型、不碰实现，
#    会走「本次 diff 无 UI 源码」分支 —— 那是正确行为，但测不到本节的判据。
#    所以每次都要让 apps/demo/src/page.vue 真的发生变化。

# B1：两侧一致 → 无输出（INFO 不打给门禁）
proto a b
impl a b
C_B1="$(commit "B1 两侧一致")"
out="$(r11b_out warn "$C_B1^..$C_B1")"
if [ -z "$out" ]; then ok "B1 两侧一致 → 无告警"
else bad "B1 两侧一致却报警" "$(printf '%s' "$out" | head -2 | tr '\n' ' ')"; fi

# B2：部分回填（proto a,b / impl 只剩 a）→ 必须报 1 条 MISSING。
#     含义：某个 app 想开 strict，它的实现侧要回填到 **100%**，半截回填仍会报。
#     变异测试：把 R1 的跳过条件写成「无条件 SKIP」→ 本用例红。
proto a b
impl a
C_B2="$(commit "B2 部分回填")"
out="$(r11b_out warn "$C_B2^..$C_B2")"
n="$(printf '%s' "$out" | grep -c 'MISSING' || true)"
if [ "$n" = "1" ]; then ok "B2 部分回填报 1 条 MISSING（缺口可见）"
else bad "B2 部分回填未报 MISSING" "实际 ${n} 条：$(printf '%s' "$out" | head -2 | tr '\n' ' ')"; fi

# B3：实现侧多出锚点 → 1 条 EXTRA（新增/改名须在评审报告登记）
proto a b
impl a b c
C_B3="$(commit "B3 实现多出锚点")"
out="$(r11b_out warn "$C_B3^..$C_B3")"
n="$(printf '%s' "$out" | grep -c 'EXTRA' || true)"
if [ "$n" = "1" ]; then ok "B3 实现侧多出锚点报 EXTRA"
else bad "B3 未报 EXTRA" "实际 ${n} 条"; fi

# ============================================================
sec_head "C. 档位：off 静默 / warn 只提示 / strict 才阻断"

proto a b c d
impl a b                    # 相对原型少 c,d → 2 条稳定靶子，且实现侧确实发生变化
C_C="$(commit "C 留两条漂移")"
# 先确认靶子存在，再验档位（否则档位断言可能在"本来就没报警"上空转）
[ -n "$(r11b_out warn "$C_C^..$C_C")" ] && ok "C0 靶子就位（warn 下有输出）" || bad "C0 靶子没造出来"
[ -z "$(r11b_out off "$C_C^..$C_C")" ] && ok "C1 off → 完全不跑" || bad "C1 off 仍输出"
[ "$(r11b_sev warn "$C_C^..$C_C")" = "warning" ] && ok "C2 warn → 落在 warning 节（不阻断）" \
  || bad "C2 warn 未落在 warning 节" "实际：$(r11b_sev warn "$C_C^..$C_C")"
[ "$(r11b_sev strict "$C_C^..$C_C")" = "error" ] && ok "C3 strict → 落在 error 节（阻断）" \
  || bad "C3 strict 未升级为 error" "实际：$(r11b_sev strict "$C_C^..$C_C")"

# ============================================================
sec_head "D. pre-commit（cached 模式）不跑 R11b（R2 · 判不准就别判）"

# 现状：HEAD 里已有 1 条漂移（C_C 造成的）。此时做一次**纯空白**改动并暂存：
#   · 若 R11b 在 cached 下仍运行 → 它 read_at(HEAD) 会把这 1 条旧漂移算到这次提交头上（误伤）
#   · 修好后 → cached 下不跑 R11b，输出为空
# 变异测试：删掉 check_r11b 里的 `[ "$range" = "--cached" ] && return 0` → 本用例红。
printf '\n<!-- whitespace only -->\n' >> apps/demo/src/page.vue
git add apps/demo/src/page.vue >/dev/null 2>&1
cached_out="$(r11b_out warn "" cached)"
if [ -z "$cached_out" ]; then ok "D1 cached 模式不跑 R11b（不把 HEAD 旧账算到本次提交）"
else bad "D1 cached 模式仍在跑 R11b（误伤本次提交）" "$(printf '%s' "$cached_out" | head -2 | tr '\n' ' ')"; fi
# 同一状态下用 diff 模式仍必须能看到那条漂移 —— 证明是"cached 不跑"，不是"规则坏了"
diff_out="$(r11b_out warn "$C_C^..$C_C")"
[ -n "$diff_out" ] && ok "D2 同状态 diff 模式仍能检出（规则本身没被关掉）" || bad "D2 diff 模式也检不出了（改坏了）"
git reset -q HEAD -- apps/demo/src/page.vue >/dev/null 2>&1
git checkout -- apps/demo/src/page.vue >/dev/null 2>&1

# ============================================================
sec_head "E. 双引擎一致：warn / strict / scoped / cached / 未知档位（#8602 回归）"

# #8602 的原始症状：同一 commit、DESIGN_ANCHOR_MODE=strict
#   bash → 40 error；gate.ts → 0 error + 40 warning（写死 level: warning，从不读 level_switch）
# 所以这一节不只断言"级别对不对"，而是断言**两个引擎的 stdout 逐字节相同**。
REAL_GATE="$SCRIPTS_DIR/gate.ts"
[ -f "$REAL_GATE" ] || { printf '\033[0;31m找不到 %s\033[0m\n' "$REAL_GATE" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { printf '\033[0;31m需要 node（gate.ts）\033[0m\n' >&2; exit 2; }

both_same() { # $1=mode $2=scope $3=range → identical / 差异摘要
  local mode="$1" scope="$2" range="$3"
  ( cd "$WORK" && DESIGN_ANCHOR_MODE="$mode" DESIGN_ANCHOR_SCOPE="$scope" bash "$SCAN" --no-color diff "$range" 2>/dev/null ) > "$WORK/.b.out"
  ( cd "$WORK" && DESIGN_ANCHOR_MODE="$mode" DESIGN_ANCHOR_SCOPE="$scope" node "$REAL_GATE" --no-color diff "$range" 2>/dev/null ) > "$WORK/.g.out"
  if cmp -s "$WORK/.b.out" "$WORK/.g.out"; then echo identical
  else echo "diff: $(diff "$WORK/.b.out" "$WORK/.g.out" | head -6 | tr '\n' ' ')"; fi
}
ts_sev() { # $1=mode $2=scope $3=range → gate.ts 侧 R11b 落在哪一节
  ( cd "$WORK" && DESIGN_ANCHOR_MODE="$1" DESIGN_ANCHOR_SCOPE="$2" node "$REAL_GATE" --no-color diff "$3" 2>/dev/null ) | awk '
    /红线违规（error）/   { sec="error" }
    /红线提示（warning）/ { sec="warning" }
    /\[R11b\]/            { print sec; exit }
  '
}

# E0 靶子就位：C_C 上有 2 条 MISSING，warn 下两引擎都必须有输出且有 R11b
ts_out="$( ( cd "$WORK" && DESIGN_ANCHOR_MODE=warn node "$REAL_GATE" --no-color diff "$C_C^..$C_C" 2>/dev/null ) | grep -c '\[R11b\]' || true )"
[ "$ts_out" = "2" ] && ok "E0 gate.ts 在 warn 下检出 2 条 R11b（靶子就位）" \
  || bad "E0 gate.ts 未检出预期 2 条 R11b" "实际 ${ts_out} 条"

# E1 warn：两引擎输出必须逐字节相同
r="$(both_same warn "" "$C_C^..$C_C")"
[ "$r" = "identical" ] && ok "E1 warn → 两引擎 stdout 逐字节一致" || bad "E1 warn 两引擎不一致（#8602）" "$r"

# E2 strict：必须同为 error 节，且输出仍逐字节一致
[ "$(ts_sev strict "" "$C_C^..$C_C")" = "error" ] && ok "E2 strict → gate.ts 升级为 error（不再静默降级）" \
  || bad "E2 strict 下 gate.ts 未升级为 error" "实际：$(ts_sev strict "" "$C_C^..$C_C")"
r="$(both_same strict "" "$C_C^..$C_C")"
[ "$r" = "identical" ] && ok "E2b strict → 两引擎 stdout 逐字节一致" || bad "E2b strict 两引擎不一致" "$r"

# E3 scoped：scope 内的 app（demo）升级 error，scope 外仍 warning
[ "$(ts_sev scoped demo "$C_C^..$C_C")" = "error" ] && ok "E3 scoped 命中 demo → error" \
  || bad "E3 scoped 命中 demo 未升级" "实际：$(ts_sev scoped demo "$C_C^..$C_C")"
[ "$(ts_sev scoped other "$C_C^..$C_C")" = "warning" ] && ok "E3b scoped 未命中 → 仍 warning" \
  || bad "E3b scoped 未命中却升级了" "实际：$(ts_sev scoped other "$C_C^..$C_C")"
r="$(both_same scoped demo "$C_C^..$C_C")"
[ "$r" = "identical" ] && ok "E3c scoped → 两引擎 stdout 逐字节一致" || bad "E3c scoped 两引擎不一致" "$r"

# E4 cached：两引擎都必须不跑 R11b（gate.ts 之前只判 env=off，cached 下会误报）
printf '\n<!-- parity cached -->\n' >> apps/demo/src/page.vue
git add apps/demo/src/page.vue >/dev/null 2>&1
cached_b="$( cd "$WORK" && DESIGN_ANCHOR_MODE=warn bash "$SCAN" --no-color cached 2>/dev/null | grep -c '\[R11b\]' || true )"
cached_g="$( cd "$WORK" && DESIGN_ANCHOR_MODE=warn node "$REAL_GATE" --no-color cached 2>/dev/null | grep -c '\[R11b\]' || true )"
[ "$cached_b" = "0" ] && [ "$cached_g" = "0" ] && ok "E4 cached → 两引擎都不跑 R11b" \
  || bad "E4 cached 下仍有引擎跑 R11b" "bash=${cached_b} gate.ts=${cached_g}"
git reset -q HEAD -- apps/demo/src/page.vue >/dev/null 2>&1
git checkout -- apps/demo/src/page.vue >/dev/null 2>&1

# E5 未知档位：两引擎都必须判死（退出码 2 + stdout 为空），不许回落成 warning
( cd "$WORK" && DESIGN_ANCHOR_MODE=stric bash "$SCAN" --no-color diff "$C_C^..$C_C" > "$WORK/.ub.out" 2> "$WORK/.ub.err" ); eb=$?
( cd "$WORK" && DESIGN_ANCHOR_MODE=stric node "$REAL_GATE" --no-color diff "$C_C^..$C_C" > "$WORK/.ug.out" 2> "$WORK/.ug.err" ); eg=$?
if [ "$eb" = "2" ] && [ "$eg" = "2" ] && [ ! -s "$WORK/.ub.out" ] && [ ! -s "$WORK/.ug.out" ] \
   && grep -q '未知档位' "$WORK/.ub.err" && grep -q '未知档位' "$WORK/.ug.err"; then
  ok "E5 未知档位 stric → 两引擎都 exit 2 且不出违规报告"
else
  bad "E5 未知档位未被判死（会静默降级）" "bash exit=${eb} gate exit=${eg}；stdout 字节 bash=$(wc -c < "$WORK/.ub.out") gate=$(wc -c < "$WORK/.ug.out")"
fi

# ============================================================
printf '\n通过 %s / 失败 %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '失败用例：%s\n' "$FAILED_CASES"
  exit 1
fi
exit 0
