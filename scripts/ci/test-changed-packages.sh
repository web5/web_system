#!/usr/bin/env bash
# ============================================================
# test-changed-packages.sh — R6（改动包选择）专用验收测试
#
# 用法：bash scripts/ci/test-changed-packages.sh
#
# 为什么单独一个文件：changed-packages.sh 的判据是「diff 文件路径 → 选中哪些包」，
#   不在 gate.ts 引擎里（stage: external），cases/scenarios.tsv 够不到它。
#
# 测试什么 / 不测什么：
#   ✅ 测「选择」——改动面到包集合的映射（含无 package.json 跳过、docs-only 短路、
#      依赖预构建过滤器的生成、失败传播、--lint 档选路）。
#   ❌ 不测真实 build/test —— pnpm 用 PATH 桩替换（只记录调用、按指令成败），
#      真实构建正确性由 CI 里真跑的那一遍负责。
#
# 隔离：造临时 git 仓库，不碰真实仓库；每个用例都标了变异测试（改坏实现该用例必红）。
# ============================================================
set -uo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_SH="$SCRIPTS_DIR/changed-packages.sh"
[ -f "$REAL_SH" ] || { echo "找不到 $REAL_SH" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { printf '\033[0;31m需要 node（脚本用 node -p 读 package.json）\033[0m\n' >&2; exit 2; }

PASS=0
FAIL=0
FAILED_CASES=""

ok()  { PASS=$((PASS+1)); printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); FAILED_CASES="${FAILED_CASES}\n    - $1"; printf '  \033[0;31m✗\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      %s\n' "$2"; }
sec_head() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/r6-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ---- 造临时仓库 ----
cd "$WORK" || exit 1
git init -q .
git config user.email t@t.io
git config user.name T
git config commit.gpgsign false
git config core.hooksPath /dev/null
mkdir -p scripts/ci bin apps/demoA/src servers/demoB/src packages/demoC/src apps/noPkg docs

# 被测脚本复制进临时仓（脚本按 BASH_SOURCE 推 ROOT，拷到哪就以哪为根）
cp "$REAL_SH" scripts/ci/changed-packages.sh

# ---- pnpm 桩：只记录调用，不真构建 ----
# PNPM_LOG 收集每次调用；FAIL_PKG 命中包目录名时该包的 build/test/lint 返回 1。
cat > bin/pnpm <<'STUB'
#!/usr/bin/env bash
echo "pnpm|cwd=$(basename "$(pwd)")|args=$*" >> "$PNPM_LOG"
if [ -n "${FAIL_PKG:-}" ] && [ "$(basename "$(pwd)")" = "$FAIL_PKG" ]; then
  echo "模拟 ${FAIL_PKG} 失败" >&2
  exit 1
fi
exit 0
STUB
chmod +x bin/pnpm
export PNPM_LOG="$WORK/pnpm.log"
export PATH="$WORK/bin:$PATH"

# ---- 包夹具 ----
mkpkg() { # $1=dir $2=name $3=scripts json 片段
  printf '{ "name": "%s", "version": "0.0.0", "scripts": { %s } }\n' "$2" "$3" > "$1/package.json"
}
mkpkg apps/demoA "@demo/a" '"build": "true", "test": "true", "lint:ci": "true"'
mkpkg servers/demoB "@demo/b" '"build": "true"'
mkpkg packages/demoC "@demo/c" '"build": "true"'
printf 'not a package\n' > apps/noPkg/README.md
printf '# docs\n' > docs/readme.md

echo "fixture" > README.md
git add -A >/dev/null 2>&1 && git commit -qm "init" >/dev/null 2>&1

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
  printf '%s' "$after"
}

run_r6() { # $1=range [$2=--lint]
  : > "$PNPM_LOG"
  bash scripts/ci/changed-packages.sh "$@" 2>&1
}

# ============================================================
sec_head "A. 选择映射：diff → 包集合"

# A1：只改 apps/demoA → 只选中 @demo/a，不碰 demoB/demoC
#     变异测试：把 awk 的 $1 匹配条件改宽（如 $1=="apps"||$1=="servers"||$1=="packages" 去掉 servers）
#       → demoB 用例红；去掉去重 sort -u → 计数类断言红。
printf 'export const x = 1;\n' > apps/demoA/src/a.ts
C1="$(commit "A1 只改 demoA")"
out="$(run_r6 "$C1^..$C1")"; rc=$?
if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q '@demo/a (apps/demoA)' \
  && ! printf '%s' "$out" | grep -q '@demo/b' && ! printf '%s' "$out" | grep -q '@demo/c'; then
  ok "A1 只改 apps/demoA → 仅选中 @demo/a"
else bad "A1 选择面错误" "rc=${rc}；$(printf '%s' "$out" | grep -E '@demo|未命中' | tr '\n' ' ')"; fi

# A1b：改动包有 name → 必须先生成「工作区依赖预构建」过滤器（防 CI 全新 checkout 缺 dist）
if grep -qF 'args=-r --filter @demo/a^... build' "$PNPM_LOG"; then
  ok "A1b 生成了依赖预构建过滤器（@demo/a^...）"
else bad "A1b 未生成依赖预构建过滤器（CI 全新 checkout 会 TS2307）" "$(cat "$PNPM_LOG" 2>/dev/null | tr '\n' ' ')"; fi

# A2：只改 docs/ → 短路「未命中任何子包改动」exit 0，且一次 pnpm 都不调
#     变异测试：删掉空集合短路 → 会对空集合循环/误报 → 输出文案变 → 本用例红。
printf 'more\n' >> docs/readme.md
C2="$(commit "A2 只改 docs")"
out="$(run_r6 "$C2^..$C2")"; rc=$?
if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q '未命中任何子包改动' && [ ! -s "$PNPM_LOG" ]; then
  ok "A2 docs-only → 短路跳过且零 pnpm 调用"
else bad "A2 docs-only 未短路" "rc=${rc}；pnpm 调用 $(wc -l < "$PNPM_LOG" | tr -d ' ') 次"; fi

# A3：跨层改动（packages/demoC + servers/demoB）→ 两个都选中
#     变异测试：把 packages 从 awk 条件里拿掉 → 本用例红（packages 改动静默漏构建）。
printf 'export const y = 2;\n' > packages/demoC/src/c.ts
printf 'export const z = 3;\n' > servers/demoB/src/b.ts
C3="$(commit "A3 跨面改动")"
out="$(run_r6 "$C3^..$C3")"; rc=$?
if [ $rc -eq 0 ] && printf '%s' "$out" | grep -q '@demo/b (servers/demoB)' \
  && printf '%s' "$out" | grep -q '@demo/c (packages/demoC)'; then
  ok "A3 packages+servers 跨面改动 → 两包都选中"
else bad "A3 跨面选择漏包" "rc=${rc}；$(printf '%s' "$out" | grep -E '@demo' | tr '\n' ' ')"; fi

# A4：改动目录无 package.json（apps/noPkg）→ 跳过不报错、不选中
#     变异测试：删掉 [ -f package.json ] || continue → node -p 读不到 name 会拿目录名顶替 → 出现 noPkg 段。
printf 'x\n' >> apps/noPkg/README.md
C4="$(commit "A4 改无 package.json 目录")"
out="$(run_r6 "$C4^..$C4")"; rc=$?
if [ $rc -eq 0 ] && ! printf '%s' "$out" | grep -q 'noPkg'; then
  ok "A4 无 package.json 的改动目录 → 静默跳过"
else bad "A4 无 package.json 目录未跳过" "rc=${rc}；$(printf '%s' "$out" | grep -E 'noPkg|===' | tr '\n' ' ')"; fi

# ============================================================
sec_head "B. 失败传播与档位"

# B1：某包 build 失败 → 整体 exit 1 且点名
#     变异测试：吞掉 fail=1（set -e 被管道吃掉那种改法）→ 本用例红。
printf 'export const w = 4;\n' >> apps/demoA/src/a.ts
C5="$(commit "B1 demoA 再改")"
out="$(FAIL_PKG=demoA run_r6 "$C5^..$C5")"; rc=$?
if [ $rc -eq 1 ] && printf '%s' "$out" | grep -q 'build 失败' && printf '%s' "$out" | grep -q '存在失败的包构建/测试'; then
  ok "B1 build 失败 → exit 1 且点名（不吞错）"
else bad "B1 失败未传播" "rc=${rc}；$(printf '%s' "$out" | tail -3 | tr '\n' ' ')"; fi

# B2：--lint 档选 lint:ci（只读），不带 --lint 不跑 lint
#     变异测试：把 lint:ci 优先回退成 lint → 桩日志里出现 lint 而非 lint:ci → 红。
printf 'export const v = 5;\n' >> apps/demoA/src/a.ts
C6="$(commit "B2 lint 档")"
out="$(run_r6 "$C6^..$C6" --lint)"; rc=$?
if [ $rc -eq 0 ] && grep -qF 'cwd=demoA|args=lint:ci' "$PNPM_LOG"; then
  ok "B2 --lint → 选 lint:ci（只读档）"
else bad "B2 lint 选路错误" "rc=${rc}；$(grep demoA "$PNPM_LOG" | tr '\n' ' ')"; fi

printf 'export const u = 6;\n' >> apps/demoA/src/a.ts
C7="$(commit "B2b 无 lint 档")"
out="$(run_r6 "$C7^..$C7")"; rc=$?
if [ $rc -eq 0 ] && ! grep -q 'lint' "$PNPM_LOG"; then
  ok "B2b 不带 --lint → 不跑 lint"
else bad "B2b 不带 --lint 却跑了 lint" "$(grep demoA "$PNPM_LOG" | tr '\n' ' ')"; fi

printf '\n通过 %s / 失败 %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf '失败用例：%s\n' "$FAILED_CASES"
  exit 1
fi
exit 0
