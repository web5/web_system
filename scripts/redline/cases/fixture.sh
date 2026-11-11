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

  # R13 的「报告路径」分支：凭证指向一个不存在的文件 → 必须报 error。
  # 🔴 为什么必须单独造一个：上面两个迁移场景都**不带**契约凭证，走的是「缺凭证」分支，
  #    把 accept 或 path_exists_in_commit_tree 改坏对它们毫无影响 —— 变异测试会因此
  #    报「变异未被捕获」，看起来像判据没生效，其实是覆盖缺口（2026-11-11 切主实测）。
  _fx_write archive/migrations/20260103-fixture-fake.sql \
    'ALTER TABLE fixture ADD COLUMN f INT;' \
    'ALTER TABLE fixture ADD COLUMN g INT;' \
    'ALTER TABLE fixture ADD COLUMN h INT;' \
    'ALTER TABLE fixture ADD COLUMN i INT;' \
    'ALTER TABLE fixture ADD COLUMN j INT;' \
    'CREATE INDEX idx_fixture_f ON fixture (f);'
  git add -A
  _fx_commit "feat(db): 加列（凭证指向不存在的报告）
Contract: docs/development/reviews/does-not-exist.md
TestScope: pass" $t; t=$((t + 60))
  echo "C_R13_FAKE $(git rev-parse HEAD)"

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
  #   但 `src/x.controller.ts`（单层）会被 R13 静默漏掉。是否补齐待拍板（台账 #8255）。
  _fx_write servers/api/src/shallow.controller.ts \
    'export class ShallowController {' \
    '  ping() { return "pong"; }' \
    '  pong() { return "ping"; }' \
    '  echo() { return "echo"; }' \
    '}'
  git add -A
  _fx_commit "feat: 新增浅层 controller" $t; t=$((t + 60))
  echo "C_CTRL_SHALLOW $(git rev-parse HEAD)"

  # ---- R11 设计评审凭证：四个分支 ----
  # R11 是唯一 error 级 commit 门，此前零用例（台账 #8256）。它的输出文案有四种，
  #   如果只测「缺凭证」一种，其余三种改错了也没人发现。
  #   ① UI 分支  Design 非 pass     → 「UI commit 的 Design 凭证非 pass」
  #   ② spec 分支 报告不存在        → 「Design 凭证指向的报告不存在」
  #   ③ spec 分支 阻塞项未清零      → 「设计评审阻塞项未清零」（带 阻塞: N）
  #   ④ spec 分支 阻塞为 0          → 阴性，一条都不报
  # ⚠️ 为什么 ②③④ 必须用「非 UI 的 spec commit」：bash 的分支是
  #   isui=0 走报告内容校验，isui=1 只认 `Design: pass`。在 UI commit 上写报告路径
  #   命中的是「凭证非 pass」，永远走不到「报告不存在」——这就是只测阳性的盲区。

  # ① UI commit 带 Design: 但值不是 pass
  _fx_write apps/admin/src/views/R11Nonpass.vue '<template><div>r11</div></template>'
  git add -A
  _fx_commit "feat(admin): 新增 r11 面板
Design: warn" $t; t=$((t + 60))
  echo "C_R11_NONPASS $(git rev-parse HEAD)"

  # ② spec commit 指向不存在的报告
  _fx_write docs/ui/prototypes/r11-missing.md '# r11 原型（缺报告）'
  git add -A
  _fx_commit "docs(proto): r11 原型（报告未落盘）
Design: docs/ui/reviews/r11-missing.md" $t; t=$((t + 60))
  echo "C_R11_SPEC_MISSING $(git rev-parse HEAD)"

  # ③ spec commit 报告存在但阻塞未清零
  _fx_write docs/ui/reviews/r11-blocked.md \
    '# r11 设计评审' \
    '阻塞: 2' \
    '- 空态未定义' \
    '- 移动端断点缺失'
  _fx_write docs/ui/prototypes/r11-blocked.md '# r11 原型（有阻塞）'
  git add -A
  _fx_commit "docs(proto): r11 原型（评审有阻塞）
Design: docs/ui/reviews/r11-blocked.md" $t; t=$((t + 60))
  echo "C_R11_SPEC_BLOCKING $(git rev-parse HEAD)"

  # ④ spec commit 报告阻塞为 0 —— 阴性
  _fx_write docs/ui/reviews/r11-clean.md \
    '# r11 设计评审' \
    '阻塞: 0'
  _fx_write docs/ui/prototypes/r11-clean.md '# r11 原型（评审通过）'
  git add -A
  _fx_commit "docs(proto): r11 原型（评审通过）
Design: docs/ui/reviews/r11-clean.md" $t; t=$((t + 60))
  echo "C_R11_SPEC_OK $(git rev-parse HEAD)"

  # ---- R23 测试范围决策（命中共享面 → 须交代全量/抽样）----
  # 用 scripts/ci/* 作共享面代表：它命中 test_surface 但**不**命中 contract_file / release_file，
  # 这样每条用例只报 R23，断言不被别的门污染。
  _fx_write scripts/ci/changed-packages.sh 'echo changed'
  git add -A
  _fx_commit "chore(ci): 调整改动包选择" $t; t=$((t + 60))
  echo "C_TS_MISSING $(git rev-parse HEAD)"

  # 阳性：TestScope 指向没落盘的清单
  _fx_write scripts/ci/changed-packages.sh 'echo changed' 'echo more'
  git add -A
  _fx_commit "chore(ci): 再调改动包选择
TestScope: docs/test-scope/missing.md" $t; t=$((t + 60))
  echo "C_TS_SAMPLE_MISSING $(git rev-parse HEAD)"

  # 阴性：全量已跑
  _fx_write scripts/ci/changed-packages.sh 'echo changed' 'echo more' 'echo full'
  git add -A
  _fx_commit "chore(ci): 全量已跑
TestScope: pass" $t; t=$((t + 60))
  echo "C_TS_PASS $(git rev-parse HEAD)"

  # 阴性：抽样，清单随本 commit 落盘
  _fx_write docs/test-scope/scope.md \
    '# 测试范围决策' \
    '| 编号 | 接口 | 包 | 为什么核心 | 用例 |' \
    '|---|---|---|---|---|' \
    '| C-01 | a | servers/x | ① | a.spec.ts |' \
    '| C-02 | b | servers/y | ② | b.spec.ts |' \
    '核心接口 2 条（夹具只验证「清单已落盘」能放行，条数门槛由人审）'
  _fx_write scripts/ci/changed-packages.sh 'echo changed' 'echo more' 'echo full' 'echo sample'
  git add -A
  _fx_commit "chore(ci): 抽样跑
TestScope: docs/test-scope/scope.md" $t; t=$((t + 60))
  echo "C_TS_SAMPLE $(git rev-parse HEAD)"

  # 劣质理由（只有 yes）——时间落在 R20 生效日之后，确保质量门会判
  _fx_write servers/api/src/ex_weak.ts 'export const e3 = 1;'
  git add -A
  local off_weak=$((FIXTURE_STRICT_TS - FIXTURE_BASE_TS + 3600))
  _fx_commit "feat: 改 ex_weak
Micro-exempt: R17: yes" "$off_weak"
  echo "C_EXEMPT_WEAK $(git rev-parse HEAD)"

  # ============================================================
  # 2026-11-11 #8722/#8256 扩展段：八仙豁免 + 凭证分支 + R9/R9b
  # ============================================================

  # ---- R9 阳性：新增页面、同 range 无 passport ----
  # Proto 用 BASE 的 sha（祖先判定通过）、Design: pass —— 把 R10/R11 隔离开，只留 R9
  _fx_write apps/admin/pages/r9new/index.wxml '<view>r9</view>'
  git add -A
  _fx_commit "feat(admin): 新增 r9 页面（无原型）
Proto: $BASE
Design: pass" $t; t=$((t + 60))
  echo "C_R9_PAGE $(git rev-parse HEAD)"

  # ---- R9 阴性：新增页面且同 commit 带原型 ----
  _fx_write apps/admin/pages/r9ok/index.wxml '<view>r9ok</view>'
  _fx_write docs/ui/prototypes/r9ok.md '# r9ok 原型'
  git add -A
  _fx_commit "feat(admin): 新增 r9ok 页面（带原型）
Proto: $BASE
Design: pass" $t; t=$((t + 60))
  echo "C_R9_PASSPORT $(git rev-parse HEAD)"

  # ---- R9b 阳性：修改既有 UI（结构标签），无 passport ----
  _fx_write apps/admin/src/views/Base.vue \
    '<template>' \
    '  <view class="card">c1</view>' \
    '  <view class="card">c2</view>' \
    '  <view class="card">c3</view>' \
    '  <view class="card">c4</view>' \
    '  <view class="card">c5</view>' \
    '  <view class="card">c6</view>' \
    '</template>'
  git add -A
  _fx_commit "feat(admin): 重排卡片（无原型）
Proto: $BASE
Design: pass
Test: pass" $t; t=$((t + 60))
  echo "C_R9B_MOD $(git rev-parse HEAD)"

  # ---- R9b 阴性：修改既有 UI 且同 commit 带原型 ----
  _fx_write apps/admin/src/views/Base.vue \
    '<template>' \
    '  <view class="card">c1</view>' \
    '  <view class="card">c2</view>' \
    '  <view class="card">c3</view>' \
    '  <view class="card">c4</view>' \
    '  <view class="card">c5</view>' \
    '  <view class="card">c6</view>' \
    '  <view class="card">c7</view>' \
    '</template>'
  _fx_write docs/ui/prototypes/r9b-ok.md '# r9b 原型'
  git add -A
  _fx_commit "feat(admin): 再排卡片（带原型）
Proto: $BASE
Design: pass
Test: pass" $t; t=$((t + 60))
  echo "C_R9B_PASSPORT $(git rev-parse HEAD)"

  # ---- R9b 豁免通路：既有 UI 修改 ≥5 行 + Micro-exempt: R9b ----
  # R9b 的豁免是内联循环但真读 g.exempt（`if (!g.exempt) break`）——
  # 「exempt: true → false」变异唯一有观测的场景：豁免生效输出零、变异后 R9b 翻红。
  # Proto/Design/Test trailer 齐：隔开 R10/R11/R17，让本场景只盯 R9b 豁免。
  _fx_write apps/admin/src/views/Base.vue \
    '<template>' \
    '  <view class="card">c1</view>' \
    '  <view class="card">c2</view>' \
    '  <view class="card">c3</view>' \
    '  <view class="card">c4</view>' \
    '  <view class="card">c5</view>' \
    '  <view class="card">c6</view>' \
    '  <view class="card">c7</view>' \
    '  <view class="card">c8</view>' \
    '</template>'
  git add -A
  _fx_commit "feat(admin): 三排卡片（豁免）
Proto: $BASE
Design: pass
Test: pass
Micro-exempt: R9b: 卡片重排为纯视觉微调，交互与数据流未变（夹具验证 R9b 豁免通路）" $t; t=$((t + 60))
  echo "C_R9B_EXEMPT $(git rev-parse HEAD)"

  # ---- 八仙豁免：一个 commit 同时命中 8 门 + 一条 scoped 豁免全列 ----
  # 这是「exempt 字段活化」（2026-11-11 #8722，引擎此前从不读 exempt）的主干断言：
  # 豁免后输出为零；任何一门 exempt 被改成 false，对应门立刻翻红 → 变异必捕获。
  _fx_write apps/admin/src/views/Mega.vue '<template><view>mega</view></template>'
  _fx_write servers/api/src/modules/mega/mega.controller.ts \
    'export class MegaController {' \
    '  a() { return 1; }' \
    '  b() { return 2; }' \
    '  c() { return 3; }' \
    '  d() { return 4; }' \
    '  e() { return 5; }' \
    '}'
  _fx_write .github/workflows/mega.yml \
    'name: mega' \
    'on: [push]' \
    'jobs: {a: {runs-on: ubuntu-latest, steps: [{run: echo ok}]}}'
  git add -A
  _fx_commit "feat: 八仙过海（UI + 契约 + 发布面 + 共享面，全豁免）
Micro-exempt: R10,R11,R13,R14,R15,R17,R18,R23: 夹具验证八门豁免通路各自独立生效" $t; t=$((t + 60))
  echo "C_EXEMPT_ALL $(git rev-parse HEAD)"

  # ---- R13 阻塞分支：Contract 指向真实报告但阻塞未清零 ----
  _fx_write archive/migrations/20260104-fixture-blocked.sql \
    'ALTER TABLE fixture ADD COLUMN g1 INT;' \
    'ALTER TABLE fixture ADD COLUMN g2 INT;' \
    'ALTER TABLE fixture ADD COLUMN g3 INT;' \
    'ALTER TABLE fixture ADD COLUMN g4 INT;' \
    'ALTER TABLE fixture ADD COLUMN g5 INT;' \
    'CREATE INDEX idx_fixture_g1 ON fixture (g1);'
  _fx_write docs/reviews/c13-blocked.md \
    '# 契约评审' \
    '阻塞: 1' \
    '- 字段命名未收敛'
  git add -A
  _fx_commit "feat(db): 加列（评审有阻塞）
Contract: docs/reviews/c13-blocked.md
TestScope: pass" $t; t=$((t + 60))
  echo "C_R13_BLOCKING $(git rev-parse HEAD)"

  # ---- R14 三分支：有效路径 / 假路径 / 阻塞（Release 凭证）----
  _fx_write .github/workflows/r14v.yml \
    'name: r14v' \
    'on: [push]' \
    'jobs: {a: {runs-on: ubuntu-latest, steps: [{run: echo ok}]}}'
  _fx_write docs/reviews/c14.md \
    '# 发布评审' \
    '阻塞: 0'
  git add -A
  _fx_commit "chore(ci): 加 r14v（凭证齐全）
Release: docs/reviews/c14.md
TestScope: pass" $t; t=$((t + 60))
  echo "C_R14_VALID $(git rev-parse HEAD)"

  _fx_write .github/workflows/r14f.yml \
    'name: r14f' \
    'on: [push]' \
    'jobs: {a: {runs-on: ubuntu-latest, steps: [{run: echo ok}]}}'
  git add -A
  _fx_commit "chore(ci): 加 r14f（凭证指向不存在）
Release: docs/reviews/no-such-release.md
TestScope: pass" $t; t=$((t + 60))
  echo "C_R14_FAKE $(git rev-parse HEAD)"

  _fx_write .github/workflows/r14b.yml \
    'name: r14b' \
    'on: [push]' \
    'jobs: {a: {runs-on: ubuntu-latest, steps: [{run: echo ok}]}}'
  _fx_write docs/reviews/c14b.md \
    '# 发布评审' \
    '阻塞: 2' \
    '- 回滚方案未评审' \
    '- 灰度比例未定'
  git add -A
  _fx_commit "chore(ci): 加 r14b（评审有阻塞）
Release: docs/reviews/c14b.md
TestScope: pass" $t; t=$((t + 60))
  echo "C_R14_BLOCKING $(git rev-parse HEAD)"

  # ---- R15 三分支（Code 凭证；浅层 controller 避开 R13，Test/Plan 用 pass 隔离）----
  _fx_write servers/api/src/r15v.controller.ts \
    'export class R15vController {' \
    '  ping() { return "pong"; }' \
    '}'
  _fx_write docs/reviews/c15.md \
    '# 方案评审' \
    '阻塞: 0'
  git add -A
  _fx_commit "feat(api): 新增 r15v 接口（凭证齐全）
Code: docs/reviews/c15.md
Test: pass
Plan: pass" $t; t=$((t + 60))
  echo "C_R15_VALID $(git rev-parse HEAD)"

  _fx_write servers/api/src/r15f.controller.ts \
    'export class R15fController {' \
    '  ping() { return "pong"; }' \
    '}'
  git add -A
  _fx_commit "feat(api): 新增 r15f 接口（凭证指向不存在）
Code: docs/reviews/no-such-code.md
Test: pass
Plan: pass" $t; t=$((t + 60))
  echo "C_R15_FAKE $(git rev-parse HEAD)"

  _fx_write servers/api/src/r15b.controller.ts \
    'export class R15bController {' \
    '  ping() { return "pong"; }' \
    '}'
  _fx_write docs/reviews/c15b.md \
    '# 方案评审' \
    '阻塞: 1' \
    '- 错误码未定义'
  git add -A
  _fx_commit "feat(api): 新增 r15b 接口（评审有阻塞）
Code: docs/reviews/c15b.md
Test: pass
Plan: pass" $t; t=$((t + 60))
  echo "C_R15_BLOCKING $(git rev-parse HEAD)"

  # ---- R18 三分支（Plan 凭证，与 R15 同构）----
  _fx_write servers/api/src/r18v.controller.ts \
    'export class R18vController {' \
    '  ping() { return "pong"; }' \
    '}'
  _fx_write docs/reviews/c18.md \
    '# 方案评审' \
    '阻塞: 0'
  git add -A
  _fx_commit "feat(api): 新增 r18v 接口（凭证齐全）
Plan: docs/reviews/c18.md
Code: pass
Test: pass" $t; t=$((t + 60))
  echo "C_R18_VALID $(git rev-parse HEAD)"

  _fx_write servers/api/src/r18f.controller.ts \
    'export class R18fController {' \
    '  ping() { return "pong"; }' \
    '}'
  git add -A
  _fx_commit "feat(api): 新增 r18f 接口（凭证指向不存在）
Plan: docs/reviews/no-such-plan.md
Code: pass
Test: pass" $t; t=$((t + 60))
  echo "C_R18_FAKE $(git rev-parse HEAD)"

  _fx_write servers/api/src/r18b.controller.ts \
    'export class R18bController {' \
    '  ping() { return "pong"; }' \
    '}'
  _fx_write docs/reviews/c18b.md \
    '# 方案评审' \
    '阻塞: 1' \
    '- 回退策略未评审'
  git add -A
  _fx_commit "feat(api): 新增 r18b 接口（评审有阻塞）
Plan: docs/reviews/c18b.md
Code: pass
Test: pass" $t; t=$((t + 60))
  echo "C_R18_BLOCKING $(git rev-parse HEAD)"

  # ---- R23 阻塞分支：TestScope 清单存在但阻塞未清零 ----
  _fx_write scripts/ci/r23b.sh 'echo r23b'
  _fx_write docs/test-scope/blocked.md \
    '# 测试范围决策' \
    '阻塞: 1' \
    '- 抽样比例未评审'
  git add -A
  _fx_commit "chore(ci): r23b（清单有阻塞）
TestScope: docs/test-scope/blocked.md" $t; t=$((t + 60))
  echo "C_R23_BLOCKING $(git rev-parse HEAD)"

  # ---- R2.secret-file：路径判据是**正则**不是 glob ----
  #
  # 🔴 为什么单独造、且**故意不提交**：
  #   2026-11-11 切主后发现 gate.ts 把 R2 的 `(^|/)[^/]*\.(pem|key|crt|cert)$` 当 glob 处理，
  #   `(^|/)` 被转义成字面量 → .env 与证书文件一条都不报。当时 R2.secret-file **零用例**，
  #   影子比对因此一直绿（两个引擎在没人测过的分支上一样地错）。
  #
  #   为什么不能 git add：这几个文件一旦进 BASE commit，30 个 diff 场景的输出全都会多出 R2 条目，
  #   所有期望文件都得跟着改 —— 那是为了测一条判据把整个基线搅一遍。
  #   files 模式只看工作区文件、不看 commit，所以「写而不提交」正好够用。
  mkdir -p r2fx
  printf 'SECRET=1\n' > r2fx/.env
  printf -- '-----BEGIN KEY-----\n' > r2fx/server.pem
  printf 'SECRET=<placeholder>\n' > r2fx/.env.example

  # ============================================================
  # 2026-11-11 #8722/#8256：工作区文件（写而不提交，与 r2fx 同理）
  # ============================================================

  # ---- scope 边界组：code_file 含 *.js 而 ts_file 不含 ----
  # scope 变异（code_file↔ts_file 互换）此前无观测差异（baseline 4 条）：
  # 既有夹具全是 .ts，两个 scope 都命中。补 .js 违规文件后：
  #   R1/R2.cred/R3（code_file→ts_file）由「报」变「不报」；
  #   R4.any（ts_file→code_file）由「不报」变「报」。
  _fx_write servers/api/src/dbg.js 'console.log("js debug");'
  _fx_write servers/api/src/cred2.js "const apiSecret = 'cdef5678ijkl';"
  _fx_write servers/api/src/todo2.js 'const t2 = 1; // TODO: js todo'
  _fx_write servers/api/src/any3.js 'export const p3: any = {};'

  # ---- 行级三门阳性（uncovered 清零：R3.weak / R4.ts-ignore / R5.wildcard-origin）----
  _fx_write servers/api/src/weak.ts 'export const w = 1; // HACK: 临时代替'
  _fx_write servers/api/src/tsignore.ts \
    '// @ts-ignore 历史包袱' \
    'export const ti = 1;'
  _fx_write servers/api/src/corswild.ts "app.enableCors({ origin: '*' });"

  # ---- skip_comment_line 观测面：在既有文件**末尾**追加注释形态的违规 ----
  # skip=true（现状）不报、反转后报 → 4 条 baseline 变捕获。
  # 🔴 必须在末尾追加：既有 finding 的行号不进期望偏移；diff 场景读 commit 树不受影响。
  printf '// console.log("commented out");\n' >> servers/api/src/dbg.ts
  printf '// password = "commented99";\n' >> servers/api/src/cred.ts
  printf '// const commented: any = 0;\n' >> servers/api/src/any.ts

  # ---- 2026-11-11 #8722 第二批：新认领门的变异观测面 ----
  # weak2.js：R3.weak 的 scope 边界（.js 属 code_file 不属 ts_file）
  #   + skip_comment_line 观测（整行注释：skip=false 报 / 反转 true 跳过）
  _fx_write servers/api/src/weak2.js '// HACK: js 整行注释弱占位'
  # tsignore2.js：R4.ts-ignore 的 scope 边界 + skip 观测（整行注释，同 weak2.js 双杀）
  _fx_write servers/api/src/tsignore2.js '// @ts-ignore js 历史包袱'
  # corscomment.ts：R5.wildcard-origin 的 skip 观测 —— 基线 skip=true **不报**（期望零输出），
  #   反转成 false 后整行注释被扫 → 报 → 捕获
  _fx_write servers/api/src/corscomment.ts "// origin: '*' 注释形态"

  printf '// app.enableCors();\n' >> servers/api/src/main.ts

  # ---- R12 阴性：双源一致（无漂移不报）----
  # 阳性（造漂移）会让**每个** diff 场景的期望都带上 R12 条目 —— 为测一门污染全部基线，
  # 与 r2fx 不提交同理，只守「不误报」这一半；阳性分支维持 uncovered 登记。
  mkdir -p .codebuddy/agent-kit/skills/demo .codebuddy/skills/demo
  printf '# demo\n' > .codebuddy/agent-kit/skills/demo/SKILL.md
  printf '# demo\n' > .codebuddy/skills/demo/SKILL.md

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
