#!/usr/bin/env bash
# ============================================================
# fixture.sh — 门禁黄金用例集的**确定性**夹具仓库
#
# 用途：给 cases/run.sh 提供「固定输入」。被 source 使用，不单独执行。
#
# 🔴 为什么必须确定性：
#   黄金快照的判据是「新旧引擎输出逐字节一致」。任何随机成分让比对噪声大于信号：
#     · 文件内容用 $RANDOM        → 报错内容行不同
#     · commit 日期用当前时间      → R20 的生效日期边界判定会漂
#     · commit sha 随机            → 输出里若出现 sha 就永远比不平（由别名反向归一化兜底）
#   所以：内容写死、时间用固定 unix 偏移、sha 只用于构造 range 不参与比对。
#
# 🔴 为什么另造一个仓库，不复用 test-gate-hardening.sh：
#   两者分工不同（见 README §分工）：
#     · test-gate-hardening.sh = 单元测试 → 断言「该报哪个门」（改实现时跑，快，布尔判据）
#     · cases/                 = 黄金快照 → 断言「完整输出一字不差」（换引擎时跑，慢，全量比对）
#   复用会让「改一条断言」和「重写引擎」互相污染：影子期需要一份**未被改动过**的期望。
# ============================================================

# 2026-01-01T00:00:00 +0800 —— 固定基准时间，每个 commit 顺序 +60s
FIXTURE_BASE_TS=1767225600

# 2026-11-01T00:00:00 +0800 —— 豁免理由质量门（R20）的生效时刻（EXEMPT_QUALITY_STRICT_FROM）
FIXTURE_STRICT_TS=1793462400

_fx_commit() { # $1=message  $2=时间偏移(秒，相对 FIXTURE_BASE_TS)
  local msg="$1" off="${2:-0}"
  GIT_AUTHOR_DATE="@$((FIXTURE_BASE_TS + off)) +0800" \
  GIT_COMMITTER_DATE="@$((FIXTURE_BASE_TS + off)) +0800" \
    git commit -q --cleanup=verbatim -F - <<<"$msg"
}

_fx_write() { # $1=path  $2..=行内容（每行一条）
  local p="$1"; shift
  mkdir -p "$(dirname "$p")"
  : > "$p"
  local l
  for l in "$@"; do printf '%s\n' "$l" >> "$p"; done
}

# ------------------------------------------------------------
# build_fixture <目标目录>
#   返回：在 stdout 打印 `<别名> <sha>` 行（供 run.sh 建归一化映射）
#   副作用：把目标目录变成 git 仓库（不 cd 回来，调用方负责）
# ------------------------------------------------------------
build_fixture() {
  local dir="$1"
  mkdir -p "$dir" && cd "$dir" || return 1
  git init -q .
  git config user.email fixture@example.com
  git config user.name Fixture
  git config commit.gpgsign false
  git config core.autocrlf false

  # ---- 基线：每个门都可能碰到的目录骨架 ----
  _fx_write servers/api/src/app.ts 'export const base = 1;'
  _fx_write apps/admin/src/views/Base.vue '<template><div>base</div></template>'
  _fx_write docs/ui/prototypes/README.md '# 原型索引'
  _fx_write scripts/existing.sh '#!/usr/bin/env bash'
  _fx_write package.json '{"name":"fixture","private":true}'
  git add -A
  _fx_commit "chore: 基线" 0
  local BASE
  BASE="$(git rev-parse HEAD)"

  local t=60

  # ---- 行级规则夹具（files 模式直接扫，不需要 commit 语义）----
  _fx_write servers/api/src/dbg.ts \
    'export function run() {' \
    '  console.log("debug");' \
    '}'
  _fx_write scripts/tool.mjs 'console.log("进度输出是产品行为");'
  _fx_write servers/api/src/todo.ts \
    '// TODO: 补齐空值分支' \
    'export const v = 1;'
  _fx_write servers/api/src/any.ts 'export const payload: any = {};'
  _fx_write servers/api/src/typed.spec.ts 'export const payload: any = {};'
  _fx_write servers/api/src/main.ts \
    'const app = await NestFactory.create(AppModule);' \
    'app.enableCors();'
  _fx_write servers/api/src/cred.ts \
    "export const apiSecret = 'abcd1234efgh';"
  # 末尾故意不写换行：验证「read 返回非零但 content 有值」不被整行跳过（踩坑注释 #967）
  printf 'export const tail = 1;\nconst leaked: any = 2;' > servers/api/src/nonl.ts
  git add -A
  _fx_commit "chore: 行级规则夹具" $t; t=$((t + 60))
  echo "BASE $BASE"

  # ---- R10 / R11 / R9b：改既有 UI，不带 Proto / Design ----
  _fx_write apps/admin/src/views/Base.vue \
    '<template>' \
    '  <div class="card">changed</div>' \
    '  <div class="card">changed2</div>' \
    '</template>'
  git add -A
  _fx_commit "feat(admin): 调整卡片布局" $t; t=$((t + 60))
  echo "C_UI_NO_PROTO $(git rev-parse HEAD)"

  # ---- R15 / R18 / R13：新增对外接口，无 Code/Plan/Contract ----
  _fx_write servers/api/src/thing.controller.ts \
    'export class ThingController {' \
    '  list() { return []; }' \
    '  detail() { return null; }' \
    '}' 
  _fx_write servers/api/src/thing.service.ts \
    'export class ThingService {' \
    '  findAll() { return []; }' \
    '}'
  git add -A
  _fx_commit "feat(api): 新增 thing 接口" $t; t=$((t + 60))
  echo "C_NEW_API $(git rev-parse HEAD)"

  # ---- R13：迁移文件（契约面）----
  # 两条：① 6 行（过 R13_LINE_THRESHOLD=5，须报）② 1 行（低于阈值，不报）
  # 为什么阈值两边都要有用例：阈值是 R13 最容易改坏的一处（有人改 5→0 就变成「一行 SQL 也拦」，
  #   改 5→50 就变成「迁移随便写」，两种都不会在「只测阳性」的用例里暴露）。
  _fx_write archive/migrations/20260101-fixture-small.sql \
    'ALTER TABLE fixture ADD COLUMN note VARCHAR(64);'
  git add -A
  _fx_commit "feat(db): 加 note 列（单行微调）" $t; t=$((t + 60))
  echo "C_MIGRATION_SMALL $(git rev-parse HEAD)"

  _fx_write archive/migrations/20260102-fixture.sql \
    'ALTER TABLE fixture ADD COLUMN a INT;' \
    'ALTER TABLE fixture ADD COLUMN b INT;' \
    'ALTER TABLE fixture ADD COLUMN c INT;' \
    'ALTER TABLE fixture ADD COLUMN d INT;' \
    'ALTER TABLE fixture ADD COLUMN e INT;' \
    'CREATE INDEX idx_fixture_a ON fixture (a);'
  git add -A
  _fx_commit "feat(db): 批量加列并建索引" $t; t=$((t + 60))
  echo "C_MIGRATION $(git rev-parse HEAD)"

  # ---- R14：发布面（CI workflow）----
  _fx_write .github/workflows/fixture.yml \
    'name: fixture' \
    'on: [push]' \
    'jobs: {a: {runs-on: ubuntu-latest, steps: [{run: echo ok}]}}'
  git add -A
  _fx_commit "chore(ci): 加 fixture workflow" $t; t=$((t + 60))
  echo "C_RELEASE $(git rev-parse HEAD)"

  # ---- R19：空提交（必须绕过 hooks，因为 no-verify 才是被测对象）----
  GIT_AUTHOR_DATE="@$((FIXTURE_BASE_TS + t)) +0800" \
  GIT_COMMITTER_DATE="@$((FIXTURE_BASE_TS + t)) +0800" \
    git commit -q --allow-empty -m "chore: 空提交仅重跑 CI"
  t=$((t + 60))
  echo "C_EMPTY $(git rev-parse HEAD)"

  # ---- R17 三态：假路径 / pass / 真实路径 ----
  _fx_write servers/api/src/r17a.ts 'export const a17 = 1;'
  git add -A
  _fx_commit "feat: 改 r17a
Test: docs/不存在的用例文档.md" $t; t=$((t + 60))
  echo "C_TEST_FAKE $(git rev-parse HEAD)"

  _fx_write servers/api/src/r17b.ts 'export const b17 = 1;'
  git add -A
  _fx_commit "feat: 改 r17b
Test: pass" $t; t=$((t + 60))
  echo "C_TEST_PASS $(git rev-parse HEAD)"

  _fx_write docs/tests/r17c.md '用例文档（真实落盘）'
  _fx_write servers/api/src/r17c.ts 'export const c17 = 1;'
  git add -A
  _fx_commit "feat: 改 r17c
Test: docs/tests/r17c.md" $t; t=$((t + 60))
  echo "C_TEST_REAL $(git rev-parse HEAD)"

  # ---- 豁免三态：旧格式（一票否决）/ 按门分类 / 劣质理由 ----
  _fx_write servers/api/src/ex_legacy.ts 'export const e1 = 1;'
  git add -A
  _fx_commit "feat: 改 ex_legacy
Micro-exempt: 纯视觉微调，本次改动不涉及任何门禁面" $t; t=$((t + 60))
  echo "C_EXEMPT_LEGACY $(git rev-parse HEAD)"

  # 按门分类的豁免：必须让**同一个 commit 同时命中多门**才测得出「只放行指定的那一门」。
  #   只改 .ts（仅 R17 触发）时，豁免与不豁免的结果都是 0 warning —— 用例会假绿。
  #   所以这里同时新增 controller（命中 R13 契约行数 + R15 新增接口 + R17 测试用例 + R18 方案），
  #   再用 `Micro-exempt: R17: <理由>` 只放行 R17 → 期望 R13/R15/R18 仍报。
  _fx_write servers/api/src/ex_scoped.ts 'export const e2 = 1;'
  # 放在两层目录下（servers/*/src/<子目录>/*.controller.ts）——这是 R13 唯一认的形状
  _fx_write servers/api/src/modules/scoped/scoped.controller.ts \
    'export class ScopedController {' \
    '  create() { return 1; }' \
    '  update() { return 2; }' \
    '  remove() { return 3; }' \
    '}'
  git add -A
  _fx_commit "feat: 改 ex_scoped 并新增 controller
Micro-exempt: R17: 纯样式改动，不涉及行为，用例沿用上一批" $t; t=$((t + 60))
  echo "C_EXEMPT_SCOPED $(git rev-parse HEAD)"

  # ---- R13 触发面差异：浅层 controller（servers/*/src/*.controller.ts）----
  # ⚠ 本条是「现状记录」，不是「正确行为」：
  #   R13 的模式是 `servers/*/src/*/*.controller.ts`（要求 src 下还有一层目录），
  #   而 R15/R18 用的是 `*/*.controller.ts`（任意层）→ 同一个文件 R13 不判、R15/R18 判。
  #   真实仓库的 controller 多在 `src/modules/<域>/x.controller.ts`（两层，能命中），
  #   但 `src/x.controller.ts`（单层）会被 R13 静默漏掉。是否补齐待拍板（台账 #8252）。
  _fx_write servers/api/src/shallow.controller.ts \
    'export class ShallowController {' \
    '  ping() { return "pong"; }' \
    '  pong() { return "ping"; }' \
    '  echo() { return "echo"; }' \
    '}'
  git add -A
  _fx_commit "feat: 新增浅层 controller" $t; t=$((t + 60))
  echo "C_CTRL_SHALLOW $(git rev-parse HEAD)"

  # 劣质理由（只有 yes）——时间落在 R20 生效日之后，确保质量门会判
  _fx_write servers/api/src/ex_weak.ts 'export const e3 = 1;'
  git add -A
  local off_weak=$((FIXTURE_STRICT_TS - FIXTURE_BASE_TS + 3600))
  _fx_commit "feat: 改 ex_weak
Micro-exempt: R17: yes" "$off_weak"
  echo "C_EXEMPT_WEAK $(git rev-parse HEAD)"

  return 0
}

# ------------------------------------------------------------
# normalize_output <输入文件> <sha别名映射文件> <仓库路径>
#   把随机成分替换成稳定占位：
#     · 仓库绝对路径      → <WORK>
#     · 每个已知 commit sha → <别名>
#   为什么要反查 sha：R12/R16/R19 等门的定位字段可能带 sha；不归一化则每次比对都红。
# ------------------------------------------------------------
normalize_output() {
  local in="$1" map="$2" work="$3" out="$4"
  local tmp="$out.tmp.$$"
  sed -e "s|$work|<WORK>|g" "$in" > "$tmp"
  local name sha
  while read -r name sha; do
    [ -n "${sha:-}" ] || continue
    # BSD sed 不支持 \b，用「前后不是十六进制字符」近似词边界
    sed -e "s|$sha|<${name}>|g" "$tmp" > "$tmp.2" && mv "$tmp.2" "$tmp"
  done < "$map"
  mv "$tmp" "$out"
}
