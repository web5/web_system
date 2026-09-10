#!/usr/bin/env bash
# ============================================================
# check-kit-structure.sh — web_system 数字人 kit 结构完备检查（L1）
#
# 设计：docs/development/ai-native-sdlc-ci-deployment.md §3.3
# 适配 web_system 的双 skills 根（唯一能力源 = agent-kit 镜像）：
#   能力源 .codebuddy/agent-kit/skills/  13 个（ai-agent-kit 同步，通用层）
#   运行源 .codebuddy/skills/            = 镜像 13 个 + 项目专属 be/fe-developer + karpathy-* 符号链接
#
# 检查项（对应源仓库 eval-gate.yml 的 S1~S6，按 web_system 裁剪）：
#   S1 必需文件齐全（AGENT.md / 方法论 / eval-framework / 5 条红线）
#   S2 无孤儿 skill（目录有 SKILL.md + name frontmatter + 在白名单）
#   S3 frontmatter name: 与目录名一致
#   S4 占位残留禁止（agent-kit 的 rules/references/AGENT.md 不允许 <your-team> 等；
#      运行源 skills 内允许项目占位，不查）
#   S5 决策树引用存在（rd-digital-agent 路由到的子技能须存在）
#   S6 红线绑定（AGENT.md 红线须在对应 skill 有执行项，防"只有口号无执行"）
#
# 用法:
#   bash scripts/redline/check-kit-structure.sh        # 检查并退出码
#   bash scripts/redline/check-kit-structure.sh -v     # 打印每项通过详情
# 返回码: 0=通过  1=存在结构问题
# ============================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOP="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$TOP"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1
[ "${1:-}" = "-h" ] && { sed -n '1,26p' "$0"; exit 0; }

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[1m'; N='\033[0m'
declare -a ERRS=() WARNS=()
add_err()  { ERRS+=("$1"); }
add_warn() { WARNS+=("$1"); }
say() { [ "$VERBOSE" = "1" ] && echo -e "$1"; }

# 运行源白名单（18）：镜像 13 + 项目专属 be/fe + 外部 karpathy-* 符号链接
RUN_SKILLS="be-developer fe-developer code-explore incremental-refactoring karpathy-coding-guidelines karpathy-coding-rules-dami karpathy-llm-wiki rd-brainstorm rd-digital-agent rd-execute rd-plan rd-review requirement-translation systematic-debugging tech-review test-verification user-memory ux-prototype-designer"
# 能力源镜像白名单（13）：通用层（ai-agent-kit 源仓库定义）
KIT_SKILLS="code-explore incremental-refactoring rd-brainstorm rd-digital-agent rd-execute rd-plan rd-review requirement-translation systematic-debugging tech-review test-verification user-memory ux-prototype-designer"

# ---------- S1 必需文件 ----------
say "${B}── S1 必需文件齐全 ──${N}"
for f in \
  .codebuddy/agent-kit/AGENT.md \
  .codebuddy/agent-kit/README.md \
  .codebuddy/agent-kit/references/ai-methodology.md \
  .codebuddy/agent-kit/references/eval-framework.md \
  .codebuddy/agent-kit/rules/general/01-loop-workflow.md \
  .codebuddy/agent-kit/rules/general/02-human-in-loop.md \
  .codebuddy/agent-kit/rules/general/03-versioned-artifacts.md \
  .codebuddy/agent-kit/rules/general/04-subagent-isolation.md \
  .codebuddy/agent-kit/rules/general/05-red-line-check.md \
  .codebuddy/skills/rd-digital-agent/SKILL.md \
  .codebuddy/skills/rd-digital-agent/references/project-context.md; do
  if [ -f "$f" ]; then say "  ✓ $f"; else add_err "S1 缺少必需文件: $f"; fi
done

# ---------- S2 无孤儿 skill + S3 frontmatter ----------
say "${B}── S2/S3 结构检查（目录 / SKILL.md / name frontmatter）──${N}"
check_skills_root() {
  local label="$1" root="$2" whitelist="$3"
  # 目录名 → name frontmatter 双向核对
  local dirs
  dirs="$(ls "$root" 2>/dev/null)"
  for d in $dirs; do
    [ -d "$root/$d" ] || continue
    [ -f "$root/$d/SKILL.md" ] || { add_err "S2 目录缺少 SKILL.md: $root/$d"; continue; }
    local name
    name="$(sed -n '/^name:/{s/^name:[[:space:]]*//;p;q;}' "$root/$d/SKILL.md")"
    if [ -z "$name" ]; then
      add_err "S3 $root/$d/SKILL.md 缺少 name frontmatter"
    elif [ "$name" != "$d" ]; then
      add_err "S3 frontmatter name($name) 与目录名($d) 不一致: $root/$d/SKILL.md"
    else
      say "  ✓ $root/$d (name=$name)"
    fi
  done
  # 白名单外的孤儿目录
  for d in $dirs; do
    [ -d "$root/$d" ] || continue
    if ! echo " $whitelist " | grep -q " $d "; then
      add_warn "S2 白名单外目录（若为新增 skill 请同步白名单）: $root/$d"
    fi
  done
}
check_skills_root "运行源" ".codebuddy/skills" "$RUN_SKILLS"
check_skills_root "镜像"   ".codebuddy/agent-kit/skills" "$KIT_SKILLS"

# ---------- S4 占位残留 ----------
say "${B}── S4 占位残留检查（agent-kit 规则层禁止占位）──${N}"
# 占位符（跳过 AI 编程规范里语义化展示，仅拦显式模板占位）
found="$(grep -rn --include='*.md' -E '<your-team>|<your-project>|<团队名>|<项目名>' \
  .codebuddy/agent-kit/rules/ .codebuddy/agent-kit/references/ .codebuddy/agent-kit/AGENT.md 2>/dev/null | head -10 || true)"
if [ -n "$found" ]; then
  add_err "S4 agent-kit 规则层存在占位残留:"; while IFS= read -r l; do add_err "      $l"; done <<< "$found"
else
  say "  ✓ 无占位残留"
fi

# ---------- S5 决策树引用存在 ----------
say "${B}── S5 决策树路由完整性 ──${N}"
HUB=".codebuddy/skills/rd-digital-agent/SKILL.md"
[ -f "$HUB" ] && hub_refs="$(grep -oE '(rd-brainstorm|rd-plan|rd-execute|rd-review|tech-review|user-memory|code-explore|incremental-refactoring|systematic-debugging|requirement-translation|test-verification|ux-prototype-designer|be-developer|fe-developer)' "$HUB" | sort -u | tr '\n' ' ')"
for s in $hub_refs; do
  if [ -f ".codebuddy/skills/$s/SKILL.md" ] || [ -f ".codebuddy/agent-kit/skills/$s/SKILL.md" ]; then
    say "  ✓ 路由 → $s"
  else
    add_err "S5 决策树引用 skills/$s 但两个 skills 根下均无该 skill"
  fi
done

# ---------- S6 红线绑定 ----------
say "${B}── S6 红线与执行手段绑定 ──${N}"
if grep -q '兜底' .codebuddy/agent-kit/AGENT.md 2>/dev/null; then
  if grep -rq '兜底' .codebuddy/skills/rd-review/SKILL.md .codebuddy/skills/rd-execute/SKILL.md 2>/dev/null; then
    say "  ✓ AGENT.md 红线(兜底判断)在 rd-review/rd-execute 有执行项"
  else
    add_warn "S6 AGENT.md 红线(兜底实现须先做第一性判断) 缺少执行手段: rd-review/rd-execute 未见对应检查项"
  fi
fi

# ---------- S7 运行源 ↔ 能力源零漂移（唯一能力源） ----------
say "${B}── S7 运行源 ↔ 能力源一致性 ──${N}"
drift=0
while IFS= read -r -d '' f; do
  rel="${f#.codebuddy/agent-kit/skills/}"
  # 项目专属文件：允许运行源含项目定制
  case "$rel" in
    rd-digital-agent/references/project-context.md) continue ;;
  esac
  if [ ! -f ".codebuddy/skills/$rel" ]; then
    add_err "S7 运行源缺少镜像文件: .codebuddy/skills/$rel"; drift=1
  elif ! cmp -s "$f" ".codebuddy/skills/$rel"; then
    add_err "S7 运行源与能力源不一致（应保持镜像）: .codebuddy/skills/$rel"; drift=1
  fi
done < <(find .codebuddy/agent-kit/skills -type f -print0)
# 反向：运行源不得存在能力源之外的孤儿文件（项目专属技能/文件除外）
while IFS= read -r -d '' f; do
  rel="${f#.codebuddy/skills/}"
  case "$rel" in
    be-developer/*|fe-developer/*|karpathy-*) continue ;;
    rd-digital-agent/references/project-context.md) continue ;;
  esac
  if [ ! -f ".codebuddy/agent-kit/skills/$rel" ]; then
    add_err "S7 运行源存在能力源之外的孤儿文件: .codebuddy/skills/$rel"; drift=1
  fi
done < <(find .codebuddy/skills -type f -print0)
[ "$drift" = "0" ] && say "  ✓ 运行源与能力源双向一致（项目专属文件除外）"

# ---------- 输出 ----------
code=0
if [ ${#ERRS[@]} -gt 0 ]; then code=1; fi
if [ ${#ERRS[@]} -gt 0 ]; then
  echo -e "${B}══ kit 结构违规（error）══${N}"
  for e in "${ERRS[@]}"; do echo -e "  ${R}✗${N} $e"; done
fi
if [ ${#WARNS[@]} -gt 0 ]; then
  echo -e "${Y}══ kit 结构提示（warning）══${N}"
  for w in "${WARNS[@]}"; do echo -e "  ${Y}!${N} $w"; done
fi
if [ "$code" = "0" ]; then
  echo -e "${G}✓ kit 结构检查通过（${#ERRS[@]} error / ${#WARNS[@]} warning）${N}"
else
  echo -e "${R}✗ kit 结构检查未通过（${#ERRS[@]} error / ${#WARNS[@]} warning）${N}"
fi
exit "$code"
