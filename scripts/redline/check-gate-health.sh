#!/usr/bin/env bash
# ============================================================
# check-gate-health.sh — 五层治理「闸门还在生效」自检（P0）
#
# 定位：规范《Vibe Coding 治理规范》§4 P0 —— 五层最大的系统性风险
#   不是缺层，而是**闸门静默失效**（换机器 / --no-verify / hook 脚本报错
#   跳过 / CI job 被删）时无人知晓。本脚本只验「载体在、接线对」，
#   不验拦截效果（拦截效果由黄金用例 + 变异测试负责）。
#
# 用法：
#   bash scripts/redline/check-gate-health.sh        # 全绿 exit 0，任一 ❌ exit 1
#   CI=1 bash scripts/redline/check-gate-health.sh   # CI 模式：跳过本地专属项
#
# 分层口径（与规范五层一一对应）：
#   ① 意图锚定  specs/ + audit-specs.mjs + check:specs 脚本
#   ② 验证契约  黄金用例资产 + 变异器（门禁子系统的验证契约）
#   ③ 执行隔离  worktree 守卫 hook 接线（CodeBuddy 专属，缺失只警告）
#   ④ 约束强制  core.hooksPath / .githooks / gate.ts 入口 / CI jobs
#   ⑤ 人机协作  待验证台账存在（本机专属，CI 跳过）
# ============================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2

FAIL=0
ok()   { printf '  ✅ %s\n' "$1"; }
bad()  { printf '  ❌ %s\n' "$1"; FAIL=1; }
warn() { printf '  ⚠️  %s（警告，不阻断）\n' "$1"; }

IN_CI=0
[ "${CI:-}" = "1" ] || [ "${GITHUB_ACTIONS:-}" = "true" ] && IN_CI=1

echo "== 五层治理闸门自检 =="

# ---- ① 意图锚定 ----
echo "① 意图锚定"
[ -d specs ] && [ -n "$(ls specs 2>/dev/null)" ] && ok "specs/ 存在且非空" || bad "specs/ 缺失或为空"
[ -f scripts/audit-specs.mjs ] && ok "audit-specs.mjs 在" || bad "scripts/audit-specs.mjs 缺失"
grep -q '"check:specs"' package.json && ok "package.json check:specs 接线在" || bad "check:specs 脚本被移除"
[ -d docs/decisions ] && ok "docs/decisions/ ADR 目录在" || warn "docs/decisions/ 仍缺（已知缺口，等首篇 ADR）"

# ---- ② 验证契约（门禁子系统部分）----
echo "② 验证契约"
[ -f scripts/redline/cases/scenarios.tsv ] && ok "scenarios.tsv 在" || bad "scenarios.tsv 缺失"
[ -x scripts/redline/cases/run.sh ] && ok "cases/run.sh 可执行" || bad "cases/run.sh 不可执行"
n_exp=$(ls scripts/redline/cases/expected/*.txt 2>/dev/null | wc -l | tr -d ' ')
[ "$n_exp" -gt 0 ] && ok "expected/ 期望文件 $n_exp 个" || bad "expected/ 为空"
[ -f scripts/redline/mutation-gen.ts ] && ok "mutation-gen.ts 在" || bad "mutation-gen.ts 缺失"

# ---- ③ 执行隔离 ----
echo "③ 执行隔离"
if [ -f .codebuddy/settings.json ]; then
  hit=$(grep -c "hook-worktree-gate.py" .codebuddy/settings.json || true)
  [ "$hit" -gt 0 ] && ok "worktree 守卫已接线（settings.json）" || warn "settings.json 未引用 hook-worktree-gate.py"
else
  warn ".codebuddy/settings.json 不存在（CodeBuddy 专属层，本机未装则无妨）"
fi
for h in hook-worktree-gate.py hook-worktree-session.py; do
  [ -f "scripts/redline/$h" ] && ok "scripts/redline/$h 在" || warn "scripts/redline/$h 缺失"
done

# ---- ④ 约束强制 ----
echo "④ 约束强制"
[ -f scripts/redline/gates.yaml ] && ok "gates.yaml 在" || bad "gates.yaml 缺失"
[ -f scripts/redline/gate.ts ] && ok "gate.ts 在" || bad "gate.ts 缺失"
[ -f scripts/redline/gates-lint.ts ] && ok "gates-lint.ts 在" || bad "gates-lint.ts 缺失"
if [ "$IN_CI" = "0" ]; then
  hp=$(git config core.hooksPath 2>/dev/null || true)
  [ "$hp" = ".githooks" ] && ok "core.hooksPath=.githooks" || bad "core.hooksPath 未指 .githooks（当前: ${hp:-未设置}）——换机器/克隆后最常见失效点"
fi
for h in pre-commit commit-msg; do
  [ -x ".githooks/$h" ] && ok ".githooks/$h 可执行" || bad ".githooks/$h 缺失或不可执行"
done
grep -q "gate.ts" .githooks/pre-commit 2>/dev/null && ok "pre-commit 走 gate.ts" || bad "pre-commit 未接线 gate.ts"
# 只查可执行行：注释里的历史提及（如「scan-rules.sh 已退场」）不算回退
grep -v '^[[:space:]]*#' .githooks/pre-commit 2>/dev/null | grep -q "scan-rules.sh" && bad "pre-commit 回退到 scan-rules.sh（假切主）" || ok "pre-commit 无 legacy bash 残留"
if [ -f .github/workflows/quality-gate.yml ]; then
  for job in redline-scan gate-cases specs-gate; do
    grep -qE "^  ${job}:" .github/workflows/quality-gate.yml && ok "CI job $job 在" || bad "CI job $job 被删"
  done
else
  bad "quality-gate.yml 缺失"
fi

# ---- ⑤ 人机协作 ----
echo "⑤ 人机协作"
if [ "$IN_CI" = "0" ]; then
  LEDGER="$HOME/AiWorkspace/30-任务产物/_待验证清单.md"
  [ -f "$LEDGER" ] && ok "待验证台账在" || warn "台账缺失（本机专属层）：$LEDGER"
else
  echo "  - CI 模式跳过（本机专属）"
fi

echo
if [ "$FAIL" = "0" ]; then
  echo "✅ 五层闸门载体全部在位"
  exit 0
else
  echo "❌ 有闸门失效（见上），请先修再信任任何一次全绿"
  exit 1
fi
