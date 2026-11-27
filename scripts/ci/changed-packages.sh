#!/usr/bin/env bash
# ============================================================
# changed-packages.sh — CI 提取改动波及的包并逐个 build/test
#
# 用法:
#   changed-packages.sh <ref-range>     # 默认对 origin/master...HEAD 改动
#   changed-packages.sh <ref-range> --lint
#
# 设计：
#   - 从 git diff 文件路径推断属于哪个子包（apps|servers|packages 下含 package.json 的目录）
#   - 对每个包跑 build（内含 vue-tsc/tsc/nest build 类型检查）
#   - 有 typecheck 脚本的包跑 typecheck（小程序 app 的 build 是 echo 占位，类型检查全靠这一步，9198）
#   - 有 test 脚本的包再跑 test（jest --runInBand CI 模式）
#   - 改了共享层 scripts/lib/** 时，动态补跑「引用共享层的子包」（见下方 why）
#   - set -e：任何包 build 非零即整体失败（门禁不吞错）
#
# 🔴 为什么要补跑共享层引用方（2026-11-27 发现）：
#   下面的包归属判据只认 apps|servers|packages 三个前缀。只改 `scripts/lib/**`
#   （preflight 门禁 / git-identity 版本判据 / 各种共享工具）时，`changed_dirs` 为空，
#   脚本会直接打印「未命中任何子包改动，跳过 build/test」并 exit 0 ——
#   也就是**共享层判据被改坏时 CI 一个测试都不跑**，绿灯是假的。
#   共享层没有自己的 package.json，只能从「谁引用它」反推要跑哪些包。
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

# ---- 共享层改动 → 补跑引用它的子包 ----
# scripts/lib/** 不在 apps|servers|packages 下，上面收集不到任何包；不补这一段就会 exit 0 跳过。
# 发现方式：谁在源码/测试里出现 `scripts/lib/` 这个字符串（require / import / path.resolve 都算）。
#   - apps/*：两个小程序 app 的 preflight 走共享层
#   - packages/*：mp-e2e 的 version-guard 直接 require 共享层判据（它的单测就是共享层的直接判据）
# servers/* 有意不扫：那里只有个别 spec 的临时目录字符串恰好含该路径，不是真依赖，扫进来只是白跑构建。
shared_refs=""
if git diff --name-only "$RANGE" 2>/dev/null | grep -q '^scripts/lib/'; then
  shared_refs="$(grep -rl --include=*.ts --include=*.js 'scripts/lib/' apps/*/ packages/*/ 2>/dev/null \
    | grep -v node_modules | cut -d/ -f1-2 | sort -u || true)"
  if [ -z "$shared_refs" ]; then
    # 🔴 兜底：动态发现失效时**不许静默退化成「跳过」**（那正是这段要修的毛病）。
    # 可能原因：引用方式改成路径拼装/别名 import、或首次引入共享层还没人引用。
    echo "⚠️  改了共享层 scripts/lib/**，但动态发现不到任何引用它的子包。" >&2
    echo "    这不等于「无需验证」：**必须人工确认**本次共享层改动该由哪些包来验证，" >&2
    echo "    并手动跑这些包的 build/test。" >&2
  else
    echo "== 共享层 scripts/lib/** 改动 → 补跑引用方：$(echo "$shared_refs" | tr '\n' ' ')=="
  fi
fi

# 合并去重（未改 scripts/lib 时 shared_refs 为空，输出与改前逐字相同）
changed_dirs="$(printf '%s\n%s\n' "$changed_dirs" "$shared_refs" | sed '/^$/d' | sort -u)"

if [ -z "$changed_dirs" ]; then
  echo "== 未命中任何子包改动（可能只改 docs/.github/scripts/.codebuddy），跳过 build/test =="
  exit 0
fi

# ---- R6 前置：先构建「改动包的工作区依赖」 ----
# 为什么需要：CI 是全新 checkout，`packages/*` 的 dist 不存在。脚本原本只 build 改动到的包，
# 一旦改动包（apps/ servers/）依赖 packages/*（如 @web-system/shared / @web-system/ui），
# TS 就会报 `TS2307 Cannot find module '@web-system/shared'` —— 表现为"本地能过、CI 挂"。
# （历史现象：同时改了 packages/* 的 PR 恰好先构建了它们，于是"看起来随机通过"。）
# 这里用 pnpm 的依赖过滤器 `<name>^...`（= 该包的全部工作区依赖，不含自身）按拓扑序构建。
dep_filters=()
for dir in $changed_dirs; do
  [ -f "$dir/package.json" ] || continue
  dep_name="$(node -p "require('./$dir/package.json').name" 2>/dev/null || echo '')"
  if [ -n "$dep_name" ]; then
    dep_filters+=("--filter" "${dep_name}^...")
  fi
done
if [ "${#dep_filters[@]}" -gt 0 ]; then
  echo "== 先构建改动包的工作区依赖（packages/*）=="
  if ! pnpm -r ${dep_filters[@]+"${dep_filters[@]}"} build; then
    echo "✗ 工作区依赖构建失败"
    exit 1
  fi
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
  #
  # `--passWithNoTests`（2026-09-22）：存量现实是多个服务还没写测试
  # （user / todo / ai-service 无 spec 文件 → jest「No tests found」退出 1；
  #  system-service 有空 suite）——jest 默认把「没有测试」也判失败，会让**任何改动这些包的 PR 必然红**，
  # 与改动内容无关（同 lint 档那次的性质）。这里只放宽「没有测试可跑」，
  # **不掩盖真失败**：有 spec 但断言失败、或 suite 跑不起来，仍会红。
  if has test; then
    echo "→ pnpm test -- --runInBand --passWithNoTests"
    if (cd "$dir" && pnpm test -- --runInBand --passWithNoTests >/tmp/ws-test-$$.log 2>&1); then
      tail -20 /tmp/ws-test-$$.log || true
      echo "  ✓ test 通过"
    else
      # 失败需完整输出，勿截断：tail -20 会吞掉首个 FAIL 的完整报错栈，CI 排障必须看到全量 jest 输出
      cat /tmp/ws-test-$$.log || true
      echo "  ✗ test 失败"; fail=1
    fi
    rm -f /tmp/ws-test-$$.log
  fi

  # R8 typecheck（2026-11-27，台账 9198）
  #
  # 为什么必须单列：两个小程序 app 的 `build` 是 `echo 'Mini app build'` 占位，
  # 不含任何类型检查；它们唯一的类型判据就是 `typecheck` 脚本（tsc --noEmit）。
  # 此前 changed-packages 只跑 build/test/lint ⇒ PR 里的 TS2339 之类类型错误 CI 全部拦不住，
  # 只有本地 tsc 能发现（实例：PR #710 的 TS2339 就是本地拦下、CI 放行的）。
  #
  # 门禁级别：只对**声明了 typecheck 脚本**的包跑（当前恰好两个小程序 app），
  # 存量已量：两包在干净 master 上 tsc --noEmit 均 exit 0（100% 通过才配阻断）。
  # 没声明的包跳过——不为没配该脚本的包临时造判据，避免扩大覆盖面。
  if has typecheck; then
    echo "→ pnpm typecheck"
    if (cd "$dir" && pnpm typecheck); then
      echo "  ✓ typecheck 通过"
    else
      echo "  ✗ typecheck 失败"; fail=1
    fi
  else
    echo "  (无 typecheck 脚本，跳过)"
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
