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

# V21 设计评审门禁接线完整（R11 挂进 scan-rules.sh；commit-msg 校验 Design trailer）
miss=""
grep -q 'check_r11 ' "$BIN/scan-rules.sh" || miss="$miss check_r11"
grep -q 'DESIGN_ANCHOR_MODE' "$BIN/scan-rules.sh" || miss="$miss DESIGN_ANCHOR_MODE"
grep -q 'DESIGN_ANCHOR_SCOPE' "$BIN/scan-rules.sh" || miss="$miss DESIGN_ANCHOR_SCOPE(分批)"
grep -q 'Design:' "$BIN/check-commit-msg.sh" || miss="$miss Design-trailer"
if [ -z "$miss" ]; then ok "V21 设计评审门禁接线完整"
else bad "V21 设计评审门禁接线完整" "缺：${miss# }"; fi

# V22 锚点比对默认 off（存量回填完成前不阻断，§3.7.1）
if grep -qE '^DESIGN_ANCHOR_MODE="\$\{DESIGN_ANCHOR_MODE:-off\}"' "$BIN/scan-rules.sh"; then
  ok "V22 锚点比对默认 off（未回填不阻断）"
else bad "V22 锚点比对默认 off（未回填不阻断）" "默认值不是 off"; fi

# V23 锚点扫描器可用，且未回填时输出 SKIP（未回填 ≠ 已漂移）
if [ -f "$BIN/scan-design-drift.py" ]; then
  out=$(python3 "$BIN/scan-design-drift.py" anchors HEAD 2>/dev/null)
  lv=$(printf '%s' "$out" | head -n 1 | cut -f1)
  case "$lv" in
    SKIP|INFO|MISSING|EXTRA|"") ok "V23 锚点扫描器可用（首行级别：${lv}）" ;;
    *) bad "V23 锚点扫描器可用" "未知输出级别：${lv}" ;;
  esac
else bad "V23 锚点扫描器可用" "scan-design-drift.py 不存在"; fi

# V24 kit 同源守门接线（通用骨架 + R12 + 保护清单 + 已挂主流程）
miss=""
grep -q 'check_sync_pair' "$BIN/scan-rules.sh" || miss="$miss check_sync_pair"
grep -q 'check_r12' "$BIN/scan-rules.sh" || miss="$miss check_r12"
grep -q 'project-context.md' "$BIN/scan-rules.sh" || miss="$miss 保护清单"
grep -q 'check_r12  ' "$BIN/scan-rules.sh" || grep -q 'check_r12$' "$BIN/scan-rules.sh" || miss="$miss 主流程挂载"
if [ -z "$miss" ]; then ok "V24 kit 同源守门接线完整（含保护清单）"
else bad "V24 kit 同源守门接线完整（含保护清单）" "缺：${miss# }"; fi

# V25 契约/发布评审门禁接线（R13/R14 + 两面判定 + 主流程挂载 + 收窄未回退）
miss=""
grep -q 'check_r13_r14' "$BIN/scan-rules.sh" || miss="$miss check_r13_r14"
grep -q 'is_contract_file' "$BIN/scan-rules.sh" || miss="$miss is_contract_file"
grep -q 'is_release_file' "$BIN/scan-rules.sh" || miss="$miss is_release_file"
grep -q 'check_r13_r14  ' "$BIN/scan-rules.sh" || grep -q 'check_r13_r14 "' "$BIN/scan-rules.sh" || miss="$miss 主流程挂载"
# 防回退：不得把整个 SDK 纳入契约面（应限定到 interfaces 等明确路径）。只检测「全包通配」写法，
# 否则会把合规的窄路径（packages/agent-core/src/interfaces/*）误判为回退。
if grep -A12 '^is_contract_file' "$BIN/scan-rules.sh" | grep -qE 'packages/agent-core/\*\)'; then
  miss="$miss 契约面回退为全SDK"
fi
if [ -z "$miss" ]; then ok "V25 契约/发布评审门禁接线完整（含收窄防回退）"
else bad "V25 契约/发布评审门禁接线完整（含收窄防回退）" "缺：${miss# }"; fi

# V26 CI 兜底层接线（红线规则必须真的挂在 workflow 上）
# 背景（2026-09-24）：redline-scan job 曾在 2026-09-18 随红线机制整体下线，而 9-20 机制回归时
#   未跟着恢复 → R9–R14 全部失去 CI 兜底，仅剩可被 --no-verify 绕过的本地 hook。
#   此前自检只查 hook/规则接线（静态读文件），查不出「CI 层其实是空的」，故补本断言。
if grep -rlsE 'scan-rules\.sh' .github/workflows/ 2>/dev/null | grep -q .; then
  ok "V26 CI 兜底层接线（有 workflow 调用 scan-rules.sh）"
else
  bad "V26 CI 兜底层接线（有 workflow 调用 scan-rules.sh）" "无任何 workflow 引用 scan-rules.sh —— 红线规则失去 CI 兜底，本地 hook 可被 --no-verify 绕过"
fi

# V27 SSE 事件契约一致性机检接线（R16 + 扫描器 + 主流程挂载）
miss=""
grep -q 'check_r16' "$BIN/scan-rules.sh" || miss="$miss check_r16"
[ -f "$BIN/check-sse-contract.py" ] || miss="$miss check-sse-contract.py"
grep -q 'check_r16  ' "$BIN/scan-rules.sh" || grep -q 'check_r16$' "$BIN/scan-rules.sh" || miss="$miss 主流程挂载"
if [ -z "$miss" ]; then ok "V27 SSE 契约一致性机检接线完整"
else bad "V27 SSE 契约一致性机检接线完整" "缺：${miss# }"; fi

# V28 contract-reviewer 角色接线（技能存在 + 已登记 R12 保护清单；两者必须同批）
# 为什么必须同批：保护清单语义是「项目专属、只在运行源」，漏登记会让 R12 把新技能
# 判成「能力源缺失」漂移 → CI 报错。这条断言把「同批纪律」变成可机检。
miss=""
[ -f .codebuddy/skills/contract-reviewer/SKILL.md ] || miss="$miss SKILL.md"
grep -q 'contract-reviewer' "$BIN/scan-rules.sh" || miss="$miss R12保护清单"
if [ -z "$miss" ]; then ok "V28 contract-reviewer 角色接线完整"
else bad "V28 contract-reviewer 角色接线完整" "缺：${miss# }"; fi

# V29 code-reviewer 角色接线（技能 + R12 保护清单 + R15 判定与主流程挂载）
miss=""
[ -f .codebuddy/skills/code-reviewer/SKILL.md ] || miss="$miss SKILL.md"
grep -q 'code-reviewer' "$BIN/scan-rules.sh" || miss="$miss R12保护清单"
grep -q 'check_r15' "$BIN/scan-rules.sh" || miss="$miss check_r15"
grep -qE '^[[:space:]]*check_r15[[:space:]]' "$BIN/scan-rules.sh" || miss="$miss 主流程挂载"
if [ -z "$miss" ]; then ok "V29 code-reviewer 角色接线完整（含 R15 与保护清单）"
else bad "V29 code-reviewer 角色接线完整（含 R15 与保护清单）" "缺：${miss# }"; fi

echo
echo "== 结果：PASS=$PASS FAIL=$FAIL =="
echo "   备份目录（可删）：$BACKUP"
[ "$FAIL" -eq 0 ]
