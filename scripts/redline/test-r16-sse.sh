#!/usr/bin/env bash
# ============================================================
# test-r16-sse.sh — R16（SSE 事件契约一致性）专用验收测试
#
# 用法：bash scripts/redline/test-r16-sse.sh
#
# 为什么单独一个文件（而不是往 cases/scenarios.tsv 里加行）：
#   与 R11b 同一个坑（2026-11-06 查明）：cases/ 造的是**临时仓库**，引擎 TOP 取
#   `git rev-parse --show-toplevel`，runDelegated 只在
#   `$TOP/scripts/redline/check-sse-contract.py` 存在时才跑。
#   临时仓库里没有这个脚本 → 静默跳过 → 用例永远绿、永远测不到它。
#   本文件把 python 脚本与四份契约文件**复制/造进临时仓库**，才能真正驱动。
#
# 隔离：造临时 git 仓库，不碰真实仓库；每个用例都标了变异测试（改坏实现该用例必红）。
# ============================================================
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_GATE="$SCRIPTS_DIR/gate.ts"
REAL_PY="$SCRIPTS_DIR/check-sse-contract.py"
[ -f "$REAL_GATE" ] || { echo "找不到 $REAL_GATE" >&2; exit 2; }
[ -f "$REAL_PY" ]   || { echo "找不到 $REAL_PY" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { printf '\033[0;31m需要 python3\033[0m\n' >&2; exit 2; }
command -v node >/dev/null 2>&1 || { printf '\033[0;31m需要 node（gate.ts）\033[0m\n' >&2; exit 2; }

PASS=0
FAIL=0
FAILED_CASES=""

ok()  { PASS=$((PASS+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED_CASES="${FAILED_CASES}\n    - $1"; printf '  \033[0;31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
sec_head() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/r16-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---- 造临时仓库 ----
cd "$WORK" || exit 1
git init -q .
git config user.email t@t.io
git config user.name T
git config commit.gpgsign false
git config core.hooksPath /dev/null
mkdir -p scripts/redline packages/agent-core/src/interfaces \
  apps/portal/src/api apps/kedou-ai-minigram/services apps/admin/src/views/Agents
# 🔴 把真脚本复制进来：否则 runDelegated 找不到 $TOP/scripts/redline/check-sse-contract.py，
#    整条规则静默跳过，所有用例都会"通过"（假绿）。
cp "$REAL_PY" scripts/redline/check-sse-contract.py
# 🔴 必须先垫一个 init commit（不放契约文件）：否则第一个用例的 `$sha^..$sha` 左侧
#    rev 不存在，引擎直接中止（"扫描范围左侧 ref 不可解析"），一条规则都不跑。
echo "fixture" > README.md
git add -A >/dev/null 2>&1 && git commit -qm "init" >/dev/null 2>&1

SCAN="$REAL_GATE"
BASE="$(git rev-parse HEAD)"

# ---- 契约文件夹具 ----
# 真相源：事件集合 {alpha, beta, gamma}
# 🔴 消费方联合体内不许出现成员内分号：union_block 截到首个 ';'，
#    写 `{ type: 'alpha'; payload: x }` 会把联合体拦腰截断（python 注释里的既有陷阱）。
write_source() { # $@ = 事件成员
  { printf 'export type StreamEventType =\n'
    local last="${!#}"
    for m in "$@"; do
      if [ "$m" = "$last" ]; then printf "  | '%s';\n" "$m"; else printf "  | '%s'\n" "$m"; fi
    done
  } > packages/agent-core/src/interfaces/runtime.interface.ts
}
write_portal() { # $@ = portal 联合体的 type 成员（或字面 LOOSE 追加裸 string）
  local members=""
  for m in "$@"; do
    if [ "$m" = "LOOSE" ]; then members="$members | string"; else members="$members | { type: '$m' }"; fi
  done
  # 去掉首个 " | "
  printf 'export type AgentStreamEvent = %s;\n' "${members# | }" > apps/portal/src/api/agent.ts
}
write_minigram() { # $@ = 小程序联合体的 type 成员
  local members=""
  for m in "$@"; do members="$members | { type: '$m' }"; done
  printf 'export type StreamEvent = %s;\n' "${members# | }" > apps/kedou-ai-minigram/services/agent-stream.ts
}
write_admin() { # $@ = admin switch 的 case 成员
  { printf 'export function onEvent(t: string) {\n  switch (t) {\n'
    for m in "$@"; do printf "    case '%s': break;\n" "$m"; done
    printf '    default: break;\n  }\n}\n'
  } > apps/admin/src/views/Agents/AgentPlayground.vue
}

# 夹具 commit：必须真的产生新 commit，否则后续 `$sha^..$sha` 会指向上一个 commit，
# 断言就在"别人的提交"上通过 —— 这是黄金用例最隐蔽的一种假绿。
# Proto/Design/Test trailer 齐：.vue/.ts 会顺带触发 R10/R17，隔开只留 R16。
commit() {
  local before after
  before="$(git rev-parse HEAD 2>/dev/null || echo none)"
  git add -A >/dev/null 2>&1
  git commit -qm "$1

Proto: $BASE
Design: pass
Test: pass" >/dev/null 2>&1
  after="$(git rev-parse HEAD)"
  if [ "$before" = "$after" ]; then
    printf '\033[0;31m夹具错误：commit 未产生变化（%s）—— 用例状态设置有误\033[0m\n' "$1" >&2
    exit 1
  fi
  if ! git rev-parse --verify --quiet "$after^" >/dev/null; then
    printf '\033[0;31m夹具错误：%s 没有父 commit，^.. 范围不可解析（用例会空转）\033[0m\n' "$1" >&2
    exit 1
  fi
  printf '%s' "$after"
}

# 断言辅助：跑引擎 diff，只取 [R16] 行；引擎中止直接判死（防空转绿）。
r16_out() { # $1=range
  local raw
  raw="$( cd "$WORK" && node "$SCAN" --no-color diff "$1" 2>&1 )"
  if printf '%s' "$raw" | grep -q '扫描范围左侧 ref 不可解析\|扫描范围无效'; then
    printf '\033[0;31m夹具错误：引擎因范围不可解析中止（%s）—— 用例会空转\033[0m\n' "$1" >&2
    exit 1
  fi
  printf '%s\n' "$raw"
}

# 只看 [R16] 行（用于「零输出」断言）
r16_lines() { printf '%s' "$1" | grep -E '\[R16\]' || true; }

# ============================================================
sec_head "A. 接线自证：先造靶子证明 R16 真的在跑（防「脚本没复制进来」式假绿）"

# A0：portal 缺 gamma → 必须报 1 条 MISSING。此条挂了说明整条链路没驱动起来，
#     后面所有「无输出即通过」的断言都不可信。
#     变异测试：删掉 check_unions 里的 missing 分支 → 本用例红。
write_source alpha beta gamma
write_portal alpha beta
write_minigram alpha beta gamma
write_admin alpha beta gamma
C_A="$(commit "A 靶子：portal 缺 gamma")"
out="$(r16_out "$C_A^..$C_A")"
n="$(printf '%s' "$(r16_lines "$out")" | grep -c . || true)"
if [ "$n" = "1" ] && printf '%s' "$out" | grep -q '缺：gamma'; then ok "A0 靶子就位：portal 缺 gamma 被检出（链路真的在跑）"
else bad "A0 靶子没造出来（链路没驱动起来，后续断言全不可信）" "R16 行 ${n} 条：$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi

# ============================================================
sec_head "B. 三类检查：MISSING / EXTRA / LOOSE / 死 case"

# B1：四处全一致 → 零输出
#     变异测试：把 members() 的正则改坏（多收/少收）→ 一致状态也会报 → 本用例红。
write_portal alpha beta gamma
C_B1="$(commit "B1 四处一致")"
out="$(r16_out "$C_B1^..$C_B1")"
if [ -z "$(r16_lines "$out")" ]; then ok "B1 真相源与三个消费方一致 → 无告警"
else bad "B1 一致状态却报警" "$(r16_lines "$out" | head -2 | tr '\n' ' ')"; fi

# B2：消费方多出未登记事件 → 1 条 EXTRA
#     变异测试：删掉 extra 分支 → 本用例红。
write_portal alpha beta gamma delta
C_B2="$(commit "B2 portal 多出 delta")"
out="$(r16_out "$C_B2^..$C_B2")"
n="$(printf '%s' "$(r16_lines "$out")" | grep -c . || true)"
if [ "$n" = "1" ] && printf '%s' "$out" | grep -q '多出（死类型或本地事件混入契约）：delta'; then ok "B2 消费方多出 delta → 报 1 条 EXTRA"
else bad "B2 未报 EXTRA" "R16 行 ${n} 条：$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi

# B3：裸 | string 兜底 → 1 条 LOOSE（类型检查失效）
#     变异测试：删掉 is_loose 判定 → 本用例红。
write_portal alpha beta gamma LOOSE
C_B3="$(commit "B3 portal 裸 string 兜底")"
out="$(r16_out "$C_B3^..$C_B3")"
n="$(printf '%s' "$(r16_lines "$out")" | grep -c . || true)"
if [ "$n" = "1" ] && printf '%s' "$out" | grep -q '裸 string 兜底'; then ok "B3 裸 string 兜底 → 报 1 条 LOOSE"
else bad "B3 未报 LOOSE" "R16 行 ${n} 条：$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi

# B4：admin switch 出现真相源之外的 case → 1 条 EXTRA（死 case）
#     变异测试：删掉 check_cases 的 dead 分支 → 本用例红。
write_portal alpha beta gamma
write_admin alpha beta gamma delta
C_B4="$(commit "B4 admin 死 case delta")"
out="$(r16_out "$C_B4^..$C_B4")"
n="$(printf '%s' "$(r16_lines "$out")" | grep -c . || true)"
if [ "$n" = "1" ] && printf '%s' "$out" | grep -q 'switch case 不在真相源集合内'; then ok "B4 admin 死 case → 报 1 条 EXTRA"
else bad "B4 未报死 case" "R16 行 ${n} 条：$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi

# ============================================================
sec_head "C. 边界：fail-open 与多消费方独立判定"

# C1：真相源文件消失 → 静默不检查（fail-open），引擎不炸、无输出
#     变异测试：把「取不到真相源就 return」改成「按空集合比对」→ 会全量报 MISSING → 红。
write_admin alpha beta gamma
rm packages/agent-core/src/interfaces/runtime.interface.ts
C_C1="$(commit "C1 删掉真相源")"
out="$(r16_out "$C_C1^..$C_C1")"
if [ -z "$(r16_lines "$out")" ]; then ok "C1 真相源缺失 → fail-open 静默（不阻断提交）"
else bad "C1 真相源缺失却报警（fail-open 被破坏）" "$(r16_lines "$out" | head -2 | tr '\n' ' ')"; fi

# C2：恢复真相源后，minigram 单独缺项 → 只报 minigram 的 1 条 MISSING（定位到消费方）
#     变异测试：emit 的 loc 不带消费方名 → 本用例红。
write_source alpha beta gamma
write_minigram alpha beta
C_C2="$(commit "C2 minigram 缺 gamma")"
out="$(r16_out "$C_C2^..$C_C2")"
n="$(printf '%s' "$(r16_lines "$out")" | grep -c . || true)"
loc_ok=0; printf '%s' "$out" | grep -q 'kedou-ai-minigram' && loc_ok=1
msg_ok=0; printf '%s' "$out" | grep -q '缺：gamma' && msg_ok=1
if [ "$n" = "1" ] && [ "$loc_ok" = "1" ] && [ "$msg_ok" = "1" ]; then ok "C2 minigram 缺项 → 1 条且定位到 kedou-ai-minigram"
else bad "C2 未正确定位 minigram 缺口" "R16 行 ${n} 条 / loc=${loc_ok} / msg=${msg_ok}"; fi

printf '\n通过 %s / 失败 %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '失败用例：%s\n' "$FAILED_CASES"
  exit 1
fi
exit 0
