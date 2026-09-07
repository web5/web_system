#!/usr/bin/env bash
# ============================================================
# changed-packages.sh — CI 提取改动波及的包并逐个 build/test
#
# 用法:
#   changed-packages.sh <ref-range>     # 默认对 origin/master...HEAD 改动
#   changed-packages.sh <ref-range> --lint
#
# 设计（docs/development/ai-native-sdlc-ci-deployment.md §2.3）：
#   - 从 git diff 文件路径推断属于哪个子包（apps|servers|packages 下含 package.json 的目录）
#   - 对每个包跑 build（= R6，内含 vue-tsc/tsc/nest build 类型检查）
#   - 有 test 脚本的包再跑 test（= R7，jest --runInBand CI 模式）
#   - set -e：任何包 build 非零即整体失败（门禁不吞错）
# ============================================================
set -euo pipefail

RANGE="${1:?用法: changed-packages.sh <ref-range> [--lint]}"
DO_LINT=0
[ "${2:-}" = "--lint" ] && DO_LINT=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# 收集改动文件归属的包目录（去重）
changed_dirs="$(git diff --name-only "$RANGE" 2>/dev/null \
  | awk -F/ '{ if ($1=="apps"||$1=="servers"||$1=="packages") print $1"/"$2 }' \
  | sort -u)"

if [ -z "$changed_dirs" ]; then
  echo "== 未命中任何子包改动（可能只改 docs/.github/scripts/.codebuddy），跳过 build/test =="
  exit 0
fi

fail=0
for dir in $changed_dirs; do
  [ -f "$dir/package.json" ] || continue
  name="$(node -p "require('./$dir/package.json').name" 2>/dev/null || echo "$dir")"
  scripts="$(node -p "JSON.stringify(Object.keys(require('./$dir/package.json').scripts||{}))" 2>/dev/null || echo '[]')"

  has() { [[ "$scripts" == *"\"$1\""* ]]; }

  echo
  echo "================ $name ($dir) ================"

  # R6 build（内含类型检查）
  if has build; then
    echo "→ pnpm build"
    if (cd "$dir" && pnpm build); then
      echo "  ✓ build 通过"
    else
      echo "  ✗ build 失败"; fail=1
    fi
  else
    echo "  (无 build 脚本，跳过)"
  fi

  # R7 test（先跑后 tail，避免管道吞退出码）
  if has test; then
    echo "→ pnpm test -- --runInBand"
    if (cd "$dir" && pnpm test -- --runInBand >/tmp/ws-test-$$.log 2>&1); then
      tail -20 /tmp/ws-test-$$.log || true
      echo "  ✓ test 通过"
    else
      tail -20 /tmp/ws-test-$$.log || true
      echo "  ✗ test 失败"; fail=1
    fi
    rm -f /tmp/ws-test-$$.log
  fi

  # 可选 lint（--lint 档）：只读检查用 lint:ci（无 --fix），无则回退 lint
  if [ "$DO_LINT" = "1" ]; then
    if has lint:ci || has lint; then
      lint_cmd="lint:ci"; has lint:ci || lint_cmd="lint"
      echo "→ pnpm ${lint_cmd} [只读，不自动修复]"
      if (cd "$dir" && pnpm "$lint_cmd" >/tmp/ws-lint-$$.log 2>&1); then
        tail -30 /tmp/ws-lint-$$.log || true
        echo "  ✓ lint 通过"
      else
        tail -30 /tmp/ws-lint-$$.log || true
        echo "  ✗ lint 失败（有未修复的 lint 错误）"; fail=1
      fi
      rm -f /tmp/ws-lint-$$.log
    else
      echo "  (无 lint 脚本，跳过)"
    fi
  fi
done

echo
if [ "$fail" = "1" ]; then
  echo "✗ 存在失败的包构建/测试"
  exit 1
fi
echo "✓ 所有改动包 build/test 通过"
