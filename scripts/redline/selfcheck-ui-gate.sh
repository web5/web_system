#!/usr/bin/env bash
# ============================================================
# selfcheck-ui-gate.sh — UI 门禁自检（v1.1）
#
# 设计：specs/kit-sop-enforcement/design.md §3.4.1 ④ · 判据 V20
# 用法：bash scripts/redline/selfcheck-ui-gate.sh
# 作用：断言 shell/IDE 双通道门禁行为符合判据；hook 静默失效时本脚本会 FAIL。
#      用例 Tanzengl 对照 §5 V1–V4、V10–V13、V20。
# 约定：使用独立 session_id 前缀 selfcheck-*，并把既有标记备份到 /tmp 后隔离运行，
#      结束恢复现场（不删生产标记）。
# ============================================================
set -uo pipefail

TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$TOP"
# 钉死项目根：不导出时 hook 的 project_root 会优先吃调用方环境里的
# CODEBUDDY_PROJECT_DIR（如 WorkBuddy 的 AiWorkspace）→ 用例路径全成「仓库外」，
# 门禁空转、自检假绿（2026-10-26 实测）。一律以本仓库为准。
export CODEBUDDY_PROJECT_DIR="$TOP"
BIN="$TOP/scripts/redline"

PASS=0
FAIL=0
SID="selfcheck-$(date +%s)"
STATE=".codebuddy/.state"
BACKUP="/tmp/ui-gate-state-backup-$(date +%s)"

# --- payload 构造（用 python 生成，避免引号转义地狱）---
mk() { # mk <tool> <input_key> <input_value> <session>
  python3 -c 'import json,sys; print(json.dumps({"hook_event_name":"PreToolUse","tool_name":sys.argv[1],"tool_input":{sys.argv[2]:sys.argv[3]},"session_id":sys.argv[4]}))' \
    "$1" "$2" "$3" "$4"
}

ok()   { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL  %s  -- %s\n' "$1" "$2"; }

expect_deny() { # expect_deny <name> <stdout>
  if printf '%s' "$2" | grep -q '"permissionDecision": *"deny"'; then ok "$1"
  else bad "$1" "期望 deny，实际输出：$(printf '%s' "$2" | head -c 200)"; fi
}
expect_empty() { # expect_empty <name> <stdout>
  if [ -z "$(printf '%s' "$2" | tr -d '[:space:]')" ]; then ok "$1"
  else bad "$1" "期望零输出，实际：$(printf '%s' "$2" | head -c 200)"; fi
}
expect_ctx() { # expect_ctx <name> <stdout>
  if printf '%s' "$2" | grep -q 'additionalContext' && ! printf '%s' "$2" | grep -q '"permissionDecision": *"deny"'; then ok "$1"
  else bad "$1" "期望放行且含 additionalContext，实际：$(printf '%s' "$2" | head -c 200)"; fi
}

# --- 现场隔离：备份既有标记，保证 V1「未动原型」前提成立 ---
mkdir -p "$BACKUP" 2>/dev/null
[ -f "$STATE/proto-touched" ] && cp "$STATE/proto-touched" "$BACKUP/" 2>/dev/null
rm -f "$STATE/proto-touched" 2>/dev/null
restore() {
  [ -f "$BACKUP/proto-touched" ] && cp "$BACKUP/proto-touched" "$STATE/" 2>/dev/null
  rm -f "$STATE/$SID-proto.json" 2>/dev/null
}
trap restore EXIT

UI_WXSS="apps/kedou-ai-minigram/pages/chat/index/index.wxss"
UI_VUE="apps/admin/src/views/Demo.vue"
PROTO="apps/kedou-ai-minigram/prototype/index.html"
NON_UI="servers/ai-agent/src/agent/agent.controller.ts"

echo "== UI 门禁自检 session=$SID =="

# V1 未动原型 → 写 UI 被拒
out=$(mk write_to_file filePath "$UI_WXSS" "$SID" | python3 "$BIN/hook-ui-prototype-gate.py")
expect_deny "V1  未动原型写 UI 被拒" "$out"

# V3 非 UI 文件零摩擦
out=$(mk write_to_file filePath "$NON_UI" "$SID" | python3 "$BIN/hook-ui-prototype-gate.py")
expect_empty "V3  非 UI 文件零摩擦" "$out"

# V2/V13 先动原型 → 同 app UI 写放行且带提醒
mk write_to_file filePath "$PROTO" "$SID" | python3 "$BIN/hook-mark-proto-touched.py" >/dev/null
out=$(mk write_to_file filePath "$UI_WXSS" "$SID" | python3 "$BIN/hook-ui-prototype-gate.py")
expect_ctx "V2/V13 已动原型同 app 放行且输出提醒" "$out"

# V12 跨端改代码被拒（通行证属 kedou-ai-minigram，改 admin/.vue）
out=$(mk write_to_file filePath "$UI_VUE" "$SID" | python3 "$BIN/hook-ui-prototype-gate.py")
expect_deny "V12 跨端改代码被拒" "$out"

# V4 环境变量豁免
out=$(UI_GATE=off sh -c "printf '%s' '{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"write_to_file\",\"tool_input\":{\"filePath\":\"apps/admin/src/views/Demo.vue\"},\"session_id\":\"$SID\"}' | python3 $BIN/hook-ui-prototype-gate.py")
expect_empty "V4  UI_GATE=off 豁免有效" "$out"

# V10 shell 写 UI 被拒
out=$(mk execute_command command "sed -i s/12px/16px/g $UI_WXSS" "$SID" | python3 "$BIN/hook-shell-ui-gate.py")
expect_deny "V10 shell sed -i 写 UI 被拒" "$out"

# V10b shell 重定向写 UI 被拒
out=$(mk execute_command command "echo hello > $UI_WXSS" "$SID" | python3 "$BIN/hook-shell-ui-gate.py")
expect_deny "V10b shell 重定向写 UI 被拒" "$out"

# V10c 只读 + 2>/dev/null + 复合命令引用 UI 路径 → 不误判重定向写（2026-10-26 回归）
out=$(mk execute_command command "grep -n switch $UI_VUE 2>/dev/null | head -5; wc -l $UI_VUE" "$SID" | python3 "$BIN/hook-shell-ui-gate.py")
expect_empty "V10c 只读+2>/dev/null+复合命令零摩擦" "$out"

# V10d 引号包裹的重定向目标仍拦（防 strip_quoted 吃掉目标导致漏判）
out=$(mk execute_command command "cat > \"$UI_WXSS\"" "$SID" | python3 "$BIN/hook-shell-ui-gate.py")
expect_deny "V10d 引号重定向目标写 UI 被拒" "$out"

# V11 白名单/构建命令零摩擦
for c in "bash scripts/publish-deploy-console.sh" "pnpm i" "npx vite build" "git diff" "cat $UI_WXSS"; do
  out=$(mk execute_command command "$c" "$SID" | python3 "$BIN/hook-shell-ui-gate.py")
  expect_empty "V11 白名单零摩擦 [$c]" "$out"
done

# V20 hook 接线完整（settings.json 挂了 gate / mark / shell）
if [ -f .codebuddy/settings.json ]; then
  miss=""
  grep -q 'hook-ui-prototype-gate.py' .codebuddy/settings.json || miss="$miss gate"
  grep -q 'hook-mark-proto-touched.py' .codebuddy/settings.json || miss="$miss mark"
  grep -q 'hook-shell-ui-gate.py' .codebuddy/settings.json || miss="$miss shell"
  if [ -z "$miss" ]; then ok "V20 settings.json 接线完整"
  else bad "V20 settings.json 接线完整" "缺：${miss# }"; fi
else
  bad "V20 settings.json 接线完整" "文件不存在"
fi

# V21 设计评审门禁接线完整
# 🔴 S5（2026-11-11）：判据全在 gates.yaml，执行者是 gate.ts，commit-msg 钩子也走 gate.ts。
#   原来 grep scan-rules.sh / check-commit-msg.sh 的两条已失去对象（文件已删），
#   改成查「判据在 YAML 里 + 引擎读了档位 + 钩子接的是 gate.ts」——
#   这三处任一处断掉，R11 都会静默失效。
miss=""
grep -q '^  - id: R11$' "$BIN/gates.yaml" || miss="$miss R11判据"
grep -q 'env: DESIGN_ANCHOR_MODE' "$BIN/gates.yaml" || miss="$miss DESIGN_ANCHOR_MODE"
grep -q 'level_switch' "$BIN/gate.ts" || miss="$miss level_switch接线"
grep -q 'commit-msg' "$TOP/.githooks/commit-msg" || miss="$miss commit-msg入口"
if [ -z "$miss" ]; then ok "V21 设计评审门禁接线完整"
else bad "V21 设计评审门禁接线完整" "缺：${miss# }"; fi

# V22 锚点比对默认 off（存量回填完成前不阻断，§3.7.1）
# 默认值现在声明在 gates.yaml 的 level_switch.default（单一真相源），不再写在 bash 里。
if grep -A 2 'env: DESIGN_ANCHOR_MODE' "$BIN/gates.yaml" | grep -q 'default: off'; then
  ok "V22 锚点比对默认 off（未回填不阻断）"
else bad "V22 锚点比对默认 off（未回填不阻断）" "level_switch.default 不是 off"; fi

# V23 锚点扫描器可用，且未回填时输出 SKIP（未回填 ≠ 已漂移）
if [ -f "$BIN/scan-design-drift.py" ]; then
  out=$(python3 "$BIN/scan-design-drift.py" anchors HEAD 2>/dev/null)
  lv=$(printf '%s' "$out" | head -n 1 | cut -f1)
  case "$lv" in
    SKIP|INFO|MISSING|EXTRA|"") ok "V23 锚点扫描器可用（首行级别：${lv}）" ;;
    *) bad "V23 锚点扫描器可用" "未知输出级别：${lv}" ;;
  esac
else bad "V23 锚点扫描器可用" "scan-design-drift.py 不存在"; fi

# V24 kit 同源守门接线（R12 + 保护清单 + 已挂主流程）
# 🔴 S5（2026-11-11）：判据从 scan-rules.sh 迁到 gates.yaml（R12 的 compare_pair / exclude），
#   执行在 gate.ts（runR12）。原来 grep bash 函数名的断言全部失去对象，改为查声明与接线。
miss=""
grep -q '^  - id: R12$' "$BIN/gates.yaml" || miss="$miss R12判据"
grep -q 'compare_pair' "$BIN/gates.yaml" || miss="$miss compare_pair"
grep -q 'project-context.md' "$BIN/gates.yaml" || miss="$miss 保护清单"
grep -q 'function runR12' "$BIN/gate.ts" || miss="$miss runR12"
grep -q 'runR12()' "$BIN/gate.ts" || miss="$miss 主流程挂载"
if [ -z "$miss" ]; then ok "V24 kit 同源守门接线完整（含保护清单）"
else bad "V24 kit 同源守门接线完整（含保护清单）" "缺：${miss# }"; fi

# V25 契约/发布评审门禁接线（R13/R14 + 两面判定 + 收窄未回退）
miss=""
grep -q '^  - id: R13$' "$BIN/gates.yaml" || miss="$miss R13判据"
grep -q '^  - id: R14$' "$BIN/gates.yaml" || miss="$miss R14判据"
# BSD grep 的 BRE 不认 \|，用 -E（2026-11-11 实测：写成 'a\|b' 在 macOS 上恒不匹配）
grep -qE 'contract_file' "$BIN/gates.yaml" || miss="$miss contract_file"
grep -q 'release_file' "$BIN/gates.yaml" || miss="$miss release_file"
grep -q 'runCredentialGates(\["R13", "R14"\])' "$BIN/gate.ts" || miss="$miss 主流程挂载"
# 防回退：契约面不得退化成「整个 SDK」。判据现在是 scopes.contract_file 的 include 列表，
# 只要出现 `packages/agent-core/*`（不带 src/interfaces）就算回退。
if grep -A 2 '^  contract_file:' "$BIN/gates.yaml" | grep -qE '"packages/agent-core/\*"|packages/agent-core/\*"'; then
  miss="$miss 契约面回退为全SDK"
fi
if [ -z "$miss" ]; then ok "V25 契约/发布评审门禁接线完整（含收窄防回退）"
else bad "V25 契约/发布评审门禁接线完整（含收窄防回退）" "缺：${miss# }"; fi

# V26 CI 兜底层接线（红线规则必须真的挂在 workflow 上）
# 背景（2026-09-24）：redline-scan job 曾在 2026-09-18 随红线机制整体下线，而 9-20 机制回归时
#   未跟着恢复 → R9–R14 全部失去 CI 兜底，仅剩可被 --no-verify 绕过的本地 hook。
# 🔴 S5：扫描器换成 gate.ts，本条改为「有 workflow 真的执行 gate.ts」。
# [[:space:]] 而不是 \s：\s 是 GNU 扩展，macOS 的 BSD grep -E 不认
if grep -rqsE 'node[[:space:]]+[^[:space:]]*redline/gate\.ts' .github/workflows/ 2>/dev/null; then
  ok "V26 CI 兜底层接线（workflow 执行 gate.ts）"
else
  bad "V26 CI 兜底层接线（workflow 执行 gate.ts）" "无任何 workflow 执行 gate.ts —— 红线规则失去 CI 兜底，本地 hook 可被 --no-verify 绕过"
fi

# V27 SSE 事件契约一致性机检接线（R16 + 扫描器 + 主流程挂载）
miss=""
grep -q '^  - id: R16$' "$BIN/gates.yaml" || miss="$miss R16判据"
[ -f "$BIN/check-sse-contract.py" ] || miss="$miss check-sse-contract.py"
grep -q 'check-sse-contract.py' "$BIN/gates.yaml" || miss="$miss delegate 指向"
grep -q 'runDelegated("R16"' "$BIN/gate.ts" || miss="$miss 主流程挂载"
if [ -z "$miss" ]; then ok "V27 SSE 契约一致性机检接线完整"
else bad "V27 SSE 契约一致性机检接线完整" "缺：${miss# }"; fi

# V28 contract-reviewer 角色接线（技能存在 + 已登记 R12 保护清单；两者必须同批）
# 为什么必须同批：保护清单语义是「项目专属、只在运行源」，漏登记会让 R12 把新技能
# 判成「能力源缺失」漂移 → CI 报错。这条断言把「同批纪律」变成可机检。
miss=""
[ -f .codebuddy/skills/contract-reviewer/SKILL.md ] || miss="$miss SKILL.md"
grep -q 'contract-reviewer' "$BIN/gates.yaml" || miss="$miss R12保护清单"
if [ -z "$miss" ]; then ok "V28 contract-reviewer 角色接线完整"
else bad "V28 contract-reviewer 角色接线完整" "缺：${miss# }"; fi

# V29 code-reviewer 角色接线（技能 + R12 保护清单 + R15 判定与主流程挂载）
miss=""
[ -f .codebuddy/skills/code-reviewer/SKILL.md ] || miss="$miss SKILL.md"
grep -q 'code-reviewer' "$BIN/gates.yaml" || miss="$miss R12保护清单"
grep -q '^  - id: R15$' "$BIN/gates.yaml" || miss="$miss R15判据"
grep -q 'runCredentialGates(\["R15"\])' "$BIN/gate.ts" || miss="$miss 主流程挂载"
if [ -z "$miss" ]; then ok "V29 code-reviewer 角色接线完整（含 R15 与保护清单）"
else bad "V29 code-reviewer 角色接线完整（含 R15 与保护清单）" "缺：${miss# }"; fi

echo
echo "== 结果：PASS=$PASS FAIL=$FAIL =="
echo "   备份目录（可删）：$BACKUP"
[ "$FAIL" -eq 0 ]
