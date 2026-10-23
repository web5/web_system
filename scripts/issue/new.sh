#!/usr/bin/env bash
# ============================================================
# scripts/issue/new.sh —— 自测速记：一行命令开 issue
#
# 定位：**降低「记一下」的成本**，不是替代模板。
#   自测时注意力在测，不在流程；任何需要离开当前操作 15 秒以上的记录方式，
#   最后都不会被使用（事实依据：仓库 390 个 PR 只有 1 个 issue，
#   即「事后补录」从来没真正发生过）。
#   本脚本的价值是**格式不漂移** + AI 代填时可复用同一套字段。
#
# 规范与分级规则：docs/development/issue-workflow.md §8
#
# 用法：
#   scripts/issue/new.sh bug  "采集明细整页 500，列表数据其实是好的"
#   scripts/issue/new.sh bug  "来源筛选选完不生效" --env dev \
#        --evidence "content/sources?enabled=true 返回 200 但列表没变"
#   scripts/issue/new.sh task "admin 自测视觉微调批次（10-23）" --p2
#   scripts/issue/new.sh bug  "..." --dry-run          # 只打印 body，不建单
#
# 选项：
#   --env <dev|prod|local|both>   复现环境，默认 dev（仅 bug 用；task/feature 忽略）
#   --evidence <text>             实证，可重复（日志/接口返回/运行版本）
#   --label <name>                追加标签，可重复
#   --p0 | --p1 | --p2            优先级（默认 p2）
#   --dry-run                     只输出将要创建的 body + 命令，不调 gh
#
# 只做一件事：拼好 title/labels/body 后调 `gh issue create`。
# 不查重、不改已有关单、不自动分配 —— 那些留给人和 AI 会话判断。
# ============================================================
set -euo pipefail

KIND="${1:-}"
if [ -z "$KIND" ] || [ "$KIND" = "-h" ] || [ "$KIND" = "--help" ]; then
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
shift

TITLE=""
ENV_NAME="dev"
PRIORITY="P2-待排期"
DRY_RUN=0
EVIDENCE=()
EXTRA_LABELS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --env) ENV_NAME="${2:?--env 需要值}"; shift 2 ;;
    --evidence) EVIDENCE+=("${2:?--evidence 需要值}"); shift 2 ;;
    --label) EXTRA_LABELS+=("${2:?--label 需要值}"); shift 2 ;;
    --p0) PRIORITY="P0-阻断"; shift ;;
    --p1) PRIORITY="P1-重要"; shift ;;
    --p2) PRIORITY="P2-待排期"; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -*) echo "未知选项：${1}（-h 看用法）" >&2; exit 2 ;;
    *) if [ -z "$TITLE" ]; then TITLE="$1"; shift; else
         echo "多余的参数：${1}（标题只能一个，用引号包住）" >&2; exit 2
       fi ;;
  esac
done

if [ -z "$TITLE" ]; then
  echo "缺标题：scripts/issue/new.sh <bug|task|feature> \"<一句话症状>\" [选项]" >&2
  exit 2
fi

case "$KIND" in
  bug)     PREFIX="fix: ";  BASE_LABEL="bug";        BASE_LABELS="bug" ;;
  task)    PREFIX="chore: "; BASE_LABEL="chore";     BASE_LABELS="chore" ;;
  feature) PREFIX="feat: "; BASE_LABEL="enhancement"; BASE_LABELS="enhancement" ;;
  *) echo "未知类型：${KIND}（只能是 bug / task / feature）" >&2; exit 2 ;;
esac

# ---- 拼 body：硬字段有值就填，没值就留显式 TODO ----
# 为什么留 TODO 而不是编：当事人当时只说了 3 秒的话，
# 编出来的「根因」比空着更有害——它会被下一个人当真。
ev_block=""
if [ ${#EVIDENCE[@]} -eq 0 ]; then
  ev_block="<!-- TODO 必补：原始报错栈 / 接口响应 / 运行版本，任一条 -->"
else
  for e in "${EVIDENCE[@]}"; do
    ev_block+="- ${e}"$'\n'
  done
  ev_block="${ev_block%$'\n'}"
fi

case "$KIND" in
  bug)
    BODY="### 一句话症状

${TITLE}

### 复现环境

${ENV_NAME}

### 实证

${ev_block}

### 已排除的假设

<!-- TODO 可选：查过什么、为什么不成立 -->

### 根因假设 / 定位线索

<!-- TODO 可选：指到文件行号最好 -->

### 回归用例

<!-- TODO 必补：修完靠什么证明不再犯（写断言，不写「已修复」） -->

### 影响面 / 发布影响

<!-- TODO 可选：涉及哪些服务或前端模块、要不要动数据 -->"
    ;;
  task)
    BODY="### 问题（现状）

${TITLE}

### 证据

${ev_block}

### 建议动作

<!-- TODO 可选：可执行步骤；成本明显超出收益的写「不做」+ 理由 -->"
    BODY+=$'\n\n'"### 完成判据

<!-- TODO 必补：怎么验证改完了（一条命令 / 一次负向验证） -->"
    ;;
  feature)
    BODY="### 目标（用户可见的结果）

${TITLE}

### 为什么现在做

<!-- TODO 可选 -->

### 范围外（明确不做什么）

<!-- TODO 必补：留空必然被追加需求 -->

### 验收标准（可判定）

<!-- TODO 必补：每条都要能判通过/不通过 -->

### 影响面

<!-- TODO 必补：涉及哪些服务或前端模块（决定过哪道门） -->

### 实证 / 依据

${ev_block}"
    ;;
esac

LABEL_ARGS=(--label "$BASE_LABELS" --label "$PRIORITY")
for l in ${EXTRA_LABELS+"${EXTRA_LABELS[@]}"}; do LABEL_ARGS+=(--label "$l"); done

FULL_TITLE="${PREFIX}${TITLE}"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "将创建的 issue"
  echo "─────────────"
  echo "title : ${FULL_TITLE}"
  echo "labels: ${BASE_LABELS}, ${PRIORITY}${EXTRA_LABELS[*]:+ , ${EXTRA_LABELS[*]}}"
  echo "─────────────"
  printf '%s\n' "$BODY"
  exit 0
fi

# gh 在本机沙箱 PATH 外（见 docs/协作指令速查.md §0），显式回退到 ~/.local/bin/gh
GH_BIN="${GH:-$(command -v gh || true)}"
[ -n "$GH_BIN" ] || GH_BIN="${HOME}/.local/bin/gh"
if [ ! -x "$GH_BIN" ]; then
  echo "找不到 gh（试过 PATH 与 ${HOME}/.local/bin/gh）。装 gh 或设 GH=/path/to/gh" >&2
  exit 3
fi

LAST_OUT="$("$GH_BIN" issue create --title "$FULL_TITLE" --body "$BODY" "${LABEL_ARGS[@]}" 2>&1)" || {
  printf '%s\n' "$LAST_OUT" >&2
  exit 5
}
printf '%s\n' "$LAST_OUT"

# ---- 建完校验标签是否真的生效 ----
# 实测（2026-10-23）：fine-grained PAT 若没给 Issues: Read and write，
# `gh issue create --label` 仍然**成功返回 URL，但标签被静默丢弃**（后续 edit/comment/close 全 403）。
# 静默失败比报错更糟 —— 优先级轴空了却没人知道，等于这套标签体系没生效。
# 所以这里必须回查一次；查不到就明确报错并给修法，不假装成功。
ISSUE_URL="$(printf '%s\n' "$LAST_OUT" | grep -oE 'https://github.com/[^ ]+/issues/[0-9]+' | tail -n 1)"
echo
if [ -n "$ISSUE_URL" ]; then
  echo "已创建：$ISSUE_URL"
  ISSUE_NO="${ISSUE_URL##*/}"
  REPO_SLUG="$("$GH_BIN" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
  if [ -n "$REPO_SLUG" ]; then
    APPLIED="$("$GH_BIN" api "repos/${REPO_SLUG}/issues/${ISSUE_NO}" --jq '[.labels[].name] | join(",")' 2>/dev/null || true)"
    MISSING=""
    for l in "$BASE_LABELS" "$PRIORITY" ${EXTRA_LABELS+"${EXTRA_LABELS[@]}"}; do
      case ",${APPLIED}," in *,${l},*) ;; *) MISSING+=" ${l}" ;; esac
    done
    if [ -n "$MISSING" ]; then
      echo "🔴 标签没生效（issue 已创建，但以下标签被丢弃）：${MISSING}" >&2
      echo "   原因通常是 token 缺 Issues 写权限（实测：能 create，不能 edit/label/comment/close）。" >&2
      echo "   修法：GitHub → Settings → Developer settings → Fine-grained tokens →" >&2
      echo "         选中当前 token → Permissions → Issues: Read and write → 保存后重试。" >&2
      exit 4
    fi
    echo "标签已生效：${APPLIED}"
  fi
else
  echo "已创建（未能解析 URL，跳过标签校验）"
fi

echo
echo "→ 记得回填：① 根因 ② 回归用例（缺这两项，这条 issue 只能算线索，不算登记）"
