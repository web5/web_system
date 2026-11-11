#!/usr/bin/env bash
# ============================================================
# mutation-yaml.sh — gates.yaml 判据变异测试（2026-11-11 切主时新建）
#
# 用法：bash scripts/redline/cases/mutation-yaml.sh
#       bash scripts/redline/cases/mutation-yaml.sh --keep   # 保留变异现场
#
# 返回码：0 = 每个变异都被黄金集抓到；1 = 有变异没被抓到（判据形同虚设）；2 = 用法错误
#
# 为什么需要它（和 cases/run.sh 的分工）：
#   run.sh        : 断言「当前行为 = expected」。回答「有没有变」。
#   mutation-yaml : 故意改坏 gates.yaml 的一处判据，确认黄金集会红。
#                   回答「这些断言有没有真的管着那条判据」。
#   只跑 run.sh 的盲区：判据写错了、但 expected 也是照着错的一起更新的 —— 永远绿。
#   变异测试是唯一能发现「断言和实现一起错」的手段。
#
# 🔴 为什么新建而不是改 mutation-test.sh：
#   那个脚本的 16 个变异里有 14 个是针对 legacy bash（scan-rules.sh / gate-shared.sh）源码的。
#   切主后 gate.ts 读 gates.yaml，改 bash 源码**不会改变主链路任何行为** —— 那 14 个变异
#   全部失效（变异后 run.sh 仍绿，会被报成「判据形同虚设」，其实是用错了目标）。
#   本脚本把变异目标换到真正承载判据的地方：gates.yaml 的字段。
#   判据在代码里的那部分（如 R19 空提交检测）无法用 YAML 变异覆盖，见文件末尾的说明。
# ============================================================
set -uo pipefail

CASES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP="$(cd "$CASES_DIR/../../.." && pwd)"
cd "$TOP" || exit 2

GATES="scripts/redline/gates.yaml"
RUNNER="$CASES_DIR/run.sh"
BACKUP="$(mktemp "${TMPDIR:-/tmp}/gates-mut.XXXXXX.yaml")"

KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

PASS=0
FAIL=0
FAILED=""

ok()  { PASS=$((PASS+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED="${FAILED}\n    - $1"; printf '  \033[0;31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
mh()  { printf '\n\033[1m== %s\033[0m\n' "$1"; }

cp "$GATES" "$BACKUP"
restore() { cp "$BACKUP" "$GATES"; }
cleanup() {
  restore
  [ "$KEEP" = "1" ] || rm -f "$BACKUP"
}
trap cleanup EXIT

# 在某个门条目内部替换（同一串在多道门里都出现时，必须限定段，否则改错门）
mutate_gate() { # $1=门id $2=旧串 $3=新串
  python3 - "$GATES" "$1" "$2" "$3" <<'PYEOF'
import re, sys, pathlib
path, gid, old, new = sys.argv[1:5]
p = pathlib.Path(path)
s = p.read_text()
m = re.search(rf'^  - id: {re.escape(gid)}\n(.*?)(?=^  - id: |\Z)', s, re.M | re.S)
if m is None:
    sys.exit(f'找不到门 {gid}')
body = m.group(1)
if body.count(old) != 1:
    sys.exit(f'{gid} 段内锚点命中 {body.count(old)} 次（期望 1）：{old!r}')
p.write_text(s[:m.start(1)] + body.replace(old, new, 1) + s[m.end(1):])
PYEOF
}

# 全文件替换（用于全局字段，如豁免质量门阈值）
mutate_global() { # $1=旧串 $2=新串
  python3 - "$GATES" "$1" "$2" <<'PYEOF'
import sys, pathlib
path, old, new = sys.argv[1:4]
p = pathlib.Path(path)
s = p.read_text()
if s.count(old) != 1:
    sys.exit(f'全局锚点命中 {s.count(old)} 次（期望 1）：{old!r}')
p.write_text(s.replace(old, new, 1))
PYEOF
}

# 跑变异 → 期望指定场景变红 → 还原
# 用法：expect_caught "<名称>" "<场景filter>" <变异命令...>
expect_caught() {
  local name="$1" filter="$2"
  shift 2
  restore
  if ! "$@" >/dev/null 2>&1; then
    bad "$name" "变异本身失败（锚点不唯一或语法错），这一条没有验证到任何东西"
    restore
    return
  fi

  local out rc
  out="$(bash "$RUNNER" --filter "$filter" 2>&1)"
  rc=$?
  restore

  if [ "$rc" -eq 0 ]; then
    bad "$name" "变异后黄金集仍全绿 → 这条判据没有任何断言在管它"
  elif [ "$rc" -eq 2 ]; then
    bad "$name" "变异把 gates.yaml 写坏了（解析失败），测的是语法不是判据"
  else
    local first
    first="$(printf '%s' "$out" | grep -E '^  ✗' | head -1 | sed 's/^  ✗ //')"
    # 🔴 必须用 ${name} 而不是 $name：macOS 自带 bash 3.2 会把紧跟其后的多字节中文
    #    当成变量名的一部分，报 `name（: unbound variable`。写 $name（ 在 Linux 的
    #    bash 5 上正常、在 macOS 上直接崩 —— 属于「CI 绿、本地炸」的典型。
    ok "${name}（变异后如预期变红：${first:-见输出}）"
  fi
}

# ============================================================
mh "行级门 · 判据是否真的来自 YAML"
# ============================================================
# R1 的匹配串换成不存在的词 → console.log 不再算调试残留
expect_caught "R1 匹配串失效 → console.log 漏报" line-r1-console-log \
  mutate_gate R1 'console\.(log|debug)\(' 'console\.(looog|debugd)\('

# ============================================================
mh "commit 门 · 凭证判据"
# ============================================================
# R17 不再接受 Test: pass（判据过严 → 本该放行的 commit 被拦）
expect_caught "R17 不再接受 Test: pass" commit-r17-pass \
  mutate_gate R17 'accept: [pass, path]' 'accept: [passX, path]'

# R17 去掉「路径必须存在」校验（判据过松 → 假路径被放行）
expect_caught "R17 去掉路径存在性校验" commit-r17-fake-path \
  mutate_gate R17 '- path_exists_anywhere: true' '- path_exists_anywhere: false'

# R13 的 Contract 凭证改成只认 pass（不再接收任何报告路径）
# 注意：必须把 path 整个去掉。写成 [passX, path] 是无效变异 —— 用例的凭证本身就是路径，
# 两种写法都走「路径存在性」分支，输出一模一样，看起来像「判据没生效」其实变异没改到点上。
expect_caught "R13 不再接受报告路径" commit-r13 \
  mutate_gate R13 'accept: [pass, path]' 'accept: [pass]'

# R13 去掉 commit 树里路径存在性校验
expect_caught "R13 去掉路径存在性校验" commit-r13 \
  mutate_gate R13 '- path_exists_in_commit_tree: true' '- path_exists_in_commit_tree: false'

# ============================================================
mh "R23 测试范围决策"
# ============================================================
expect_caught "R23 去掉路径存在性校验" commit-r23-sample-missing \
  mutate_gate R23 '- path_exists_in_commit_tree: true' '- path_exists_in_commit_tree: false'

# ============================================================
mh "豁免质量门（R20）· 阈值来自 YAML"
# ============================================================
# 理由最短长度从 10 降到 1 → 劣质理由不再被拦
expect_caught "R20 去掉理由长度下限" commit-exempt-weak-reason \
  mutate_global 'min_reason_chars: 10' 'min_reason_chars: 1'

# 无信息量取值白名单清空 → 「yes」这类理由算合格
#
# 🔴 为什么这条要同时把长度下限降到 2，而不是只清空 empty_values：
#    empty_values 里的词（yes / no / n/a / 无…）全都短于 min_reason_chars=10，
#    所以「长度不足」永远先命中，empty_values 这条判据在当前配置下**根本触发不到**
#    （2026-11-11 切主时变异测试发现的「配置层死判据」）。
#    降长度下限后它才成为唯一拦截者 —— 这样变异它才有意义，也顺便验证了
#    「降低阈值时那条兜底判据仍然在岗」。
mutate_r20_empty() {
  mutate_global 'min_reason_chars: 10' 'min_reason_chars: 2' &&
    mutate_global 'empty_values: ["yes", "no", "true", "false", "ok", "n/a", "none", "tbd", "wip", "skip", "是", "否", "无", "不需要", "不用"]' 'empty_values: []'
}
expect_caught "R20 去掉无信息量取值判定" commit-exempt-weak-reason mutate_r20_empty

# ============================================================
printf '\n\033[1m== 汇总 ==\033[0m\n'
printf '变异被捕获 %s / 未被捕获 %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '失败用例：%s\n' "$FAILED"
  printf '\n🔴 「未被捕获」意味着：这条判据改坏了也没人发现 —— 要么补用例，要么该判据根本没生效。\n'
  [ "$KEEP" = "1" ] && echo "变异现场保留在: $BACKUP（--keep）"
  exit 1
fi
exit 0
