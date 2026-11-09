#!/usr/bin/env bash
# ============================================================================
# check-governance.sh — 五层闸门健康检查（薄编排 / A6 / #8577）
#
# 形态：不重写体检逻辑。复用 scripts/redline/ 下已有 741 行三脚本
#       （selfcheck-ui-gate.sh / test-gate-hardening.sh / mutation-test.sh），
#       本文件只做「挂载关系 + 生效判定 + 分层汇总 + 退出码契约」。
# 规格：30-任务产物/2026-11-09-五层治理SOP落地跟进/03-五层闸门自检-规格与派单.md
#       §2 三条硬约束 / §3 五层检查项 / §4 退出码与输出契约
#
# 用法：
#   npm run check:governance                 # 巡检/默认档：轻量，秒级，只读
#   npm run check:governance -- --json      # 同上，JSON 输出供 automation 消费
#   npm run check:governance -- --full      # 手动/验收档：追加三脚本 + 黄金用例实跑
#
# 分档理由（2026-11-09 实测）：三脚本单跑 selfcheck 18s / test-gate-hardening 86s，
#   全套 >2min；mutation-test.sh 会临时改写 scan-rules.sh 再还原，被强杀会留下
#   未还原的实现改动。默认档必须保持只读且秒级，否则每日 16:00 巡检会污染工作树。
#
# 硬约束：
#   1) 判「生效」不判「存在」：存在 + 可解析/可执行 + 挂载关系 + 关键门实跑/实读
#   2) 禁止写死存量数字：specs / *.spec.ts / worktree 数量只输出，不设阈值
#   3) 任一 FAIL → exit 1，且每条 FAIL 必须给可执行的修复命令
#
# 变异验证注入点（默认指向真源，用于不改共享文件即可验证 FAIL 判定确实生效）：
#   CHECK_GOV_LEDGER→台账  CHECK_GOV_WORKFLOW→CI 文件
#   CHECK_GOV_PKG→package.json（F4 值校验变异）  CHECK_GOV_E2E_CMD→② 层实跑命令（F3 变异）
# ============================================================================
set -uo pipefail

TOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1
cd "$TOP" || exit 1
export CODEBUDDY_PROJECT_DIR="$TOP"

BIN="$TOP/scripts/redline"
JSON=0
FULL=0
for a in "$@"; do
  case "$a" in
    --json) JSON=1 ;;
    --full) FULL=1 ;;
    -h|--help) sed -n '2,32p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) printf '未知参数: %s（可用 --json / --full / --help）\n' "$a" >&2; exit 2 ;;
  esac
done

# ---- 真源路径（本机专用：本脚本要检查用户级 hook / 台账 / 保护状态） ----
LEDGER="${CHECK_GOV_LEDGER:-$HOME/AiWorkspace/30-任务产物/_待验证清单.md}"
WORKFLOW="${CHECK_GOV_WORKFLOW:-$TOP/.github/workflows/quality-gate.yml}"
PKG="${CHECK_GOV_PKG:-$TOP/package.json}"
# F11：workflow 可读性只算一次；不可读时不调 awk → 不泄漏 stderr、不把「不可读」误报成「N 个 job 全缺」
WF_OK=0
if [ -f "${WORKFLOW}" ] && [ -r "${WORKFLOW}" ]; then WF_OK=1; fi
SDD_SOP="$HOME/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md"
THREE_TABLES="$HOME/AiWorkspace/20-私域资产/AI协作交付规范-表格化收尾.md"
USER_SETTINGS="$HOME/.workbuddy/settings.json"
USER_HOOK="$HOME/.workbuddy/hooks/session-cost-gate.py"
PROTECT="$HOME/AiWorkspace/90-工具/保护.sh"
HOME_AW="$HOME/AiWorkspace"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/gov-check.XXXXXX")" || exit 1
trap 'rm -rf "$TMP"' EXIT
REC="$TMP/records.tsv"    # FAIL: level \t layer \t item \t fix
WARNF="$TMP/warns.tsv"    # WARN: level \t layer \t item \t fix
: > "$REC"; : > "$WARNF"

# F3：② 层关键门实跑（npm run test:e2e:list --list）。实测 ~1.7s（≤5s）、rc=0 → 默认档补实跑；
#   与其余检查并行，避免默认档耗时被抬高（守住秒级 / 不显著退化）。rc 在 ② 层统一收集。
#   5s 超时闸门（14 号 §4.1）：perl→timeout→gtimeout→裸跑，首个可用即用。
#   超时判据取「信号」——既不看退出码字面值，也不看耗时：
#     命令自己 exit / 自打信号，都会被当成「超时」或「通过」（前者曾用标记文件区分，但 exit 走不到写标记那行，
#     与「被杀」同形）；只有父进程 waitpid 拿到子进程原始 status，才分得清「自己退出」与「被信号杀死」。
#     perl 分支 fork+waitpid：子进程 sig=14(SIGALRM) → 哨兵码 250（真超时，降级）；
#     其余信号 → 128+sig（非零 → 判红）；无信号 → 透传子进程真实退出码（exit 142→142 判红、exit 3→3 判红）。
#   E2E_TIMEOUT_KIND / E2E_TIMEOUT_CODE 记录闸门种类与该种闸门的超时哨兵码
#     （perl→250 / timeout·gtimeout→124；kind=none 时留空 → 任何 rc 都不当超时）。
#   已知边界（本轮不修，仅记录）：① 命令主动模仿哨兵码（自行 exit 250 / exit 124）在对应 kind 下无法与真超时区分；
#     ② perl 分支 kill 只杀直接子进程，孙进程（如 npm 下的 node）超时后可能留孤儿——与既有行为一致。
E2E_LOG="${TMP}/e2e-list.log"
E2E_CMD="${CHECK_GOV_E2E_CMD:-npm run test:e2e:list --silent}"
E2E_TIMEOUT_KIND="none"
E2E_TIMEOUT_CODE=""
if command -v perl >/dev/null 2>&1; then
  E2E_TIMEOUT_KIND="perl";    E2E_TIMEOUT_CODE=250
  perl -e '
    my $t = shift; my $pid;
    $SIG{ALRM} = sub { kill "ALRM", $pid if $pid };
    $pid = fork;
    exit 127 unless defined $pid;
    if (!$pid) { exec @ARGV; exit 127 }
    alarm $t;
    my $got;
    do { $got = waitpid($pid, 0) } while ($got == -1 && $! == 4);   # 4=EINTR：被 alarm 打断后重试，避免取到陈旧 $?
    alarm 0;
    my $r = $?;
    my $sig = $r & 127;
    exit( $sig ? ($sig == 14 ? 250 : 128 + $sig) : ($r >> 8) );
  ' 5 sh -c "${E2E_CMD}" >"${E2E_LOG}" 2>&1 &
elif command -v timeout >/dev/null 2>&1; then
  E2E_TIMEOUT_KIND="timeout"; E2E_TIMEOUT_CODE=124
  timeout 5 sh -c "${E2E_CMD}" >"${E2E_LOG}" 2>&1 &
elif command -v gtimeout >/dev/null 2>&1; then
  E2E_TIMEOUT_KIND="gtimeout"; E2E_TIMEOUT_CODE=124
  gtimeout 5 sh -c "${E2E_CMD}" >"${E2E_LOG}" 2>&1 &
else
  sh -c "${E2E_CMD}" >"${E2E_LOG}" 2>&1 &
fi
E2E_PID=$!

LABEL[1]='①'; NAME[1]='意图锚定'
LABEL[2]='②'; NAME[2]='验证契约'
LABEL[3]='③'; NAME[3]='执行隔离'
LABEL[4]='④'; NAME[4]='约束强制'
LABEL[5]='⑤'; NAME[5]='人机协作'
L=1
DETAIL[1]=''; DETAIL[2]=''; DETAIL[3]=''; DETAIL[4]=''; DETAIL[5]=''

fail() { printf 'FAIL\t%s\t%s\t%s\n' "$L" "$1" "${2:-}" >> "$REC"; return 0; }
warn() { printf 'WARN\t%s\t%s\t%s\n' "$L" "$1" "${2:-}" >> "$WARNF"; return 0; }
add()  { [ -z "${DETAIL[$L]}" ] && DETAIL[$L]="$1" || DETAIL[$L]="${DETAIL[$L]}, $1"; }

# mode: file | dir | exec | any
need() {
  local p="$1" desc="$2" fix="$3" mode="${4:-file}" ok=0
  case "$mode" in
    dir)  [ -d "$p" ] && ok=1 ;;
    exec) [ -f "$p" ] && [ -x "$p" ] && ok=1 ;;
    any)  [ -e "$p" ] && ok=1 ;;
    *)    [ -f "$p" ] && ok=1 ;;
  esac
  if [ "$ok" -ne 1 ]; then fail "$desc → $p" "$fix"; return 1; fi
  return 0
}

need_json() {
  local p="$1" desc="$2" fix="$3"
  [ -f "$p" ] || { fail "$desc → $p 不存在" "$fix"; return 1; }
  if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$p" >/dev/null 2>&1; then
    return 0
  fi
  fail "$desc 不可解析（JSON 损坏）" "$fix"; return 1
}

# gates.yaml 不是标准 YAML（含未加引号的 @，PyYAML 会直接拒），
# 项目用自带的 lib/yaml-mini.ts 解析。真「生效」判据 = gates-lint.ts 自检器实跑：
# 它既解析声明，又校验 gates.yaml ↔ bash 的接线漂移（CI gate-cases job 同款命令）。
need_gates_lint() {
  [ -f "$BIN/gates.yaml" ] || { fail "gates.yaml 缺失" "恢复 scripts/redline/gates.yaml"; return 1; }
  [ -f "$BIN/gates-lint.ts" ] || { fail "gates-lint.ts 缺失" "恢复 scripts/redline/gates-lint.ts"; return 1; }
  if node "$BIN/gates-lint.ts" >"$TMP/gates-lint.log" 2>&1; then return 0; fi
  fail "gates-lint.ts 实跑非零（gates.yaml 与 bash 接线漂移，或 Node 不支持原生 TS）" \
       "node scripts/redline/gates-lint.ts 查看漂移项；以 bash 为准改 gates.yaml；本机需 Node ≥22"
  return 1
}

# F4（14 号 §4.2）：不只判 scripts[key] truthy，还判「值是否指向目标脚本」——
#   每个键对应一个目标脚本文件名子串；值须包含该子串，且子串命中的那个 token 指向的文件须存在。
#   只判「包含子串」，不逐字比对整条命令（允许 --silent/--check 等参数）。CHECK_GOV_PKG 仅作变异注入点。
need_pkg_script() {
  local key="${1}" target="" line code detail val
  case "${key}" in
    check:specs)       target="audit-specs.mjs" ;;
    specs:index:check) target="gen-specs-index.mjs" ;;
    test:e2e:list)     target="playwright.config.ts" ;;
    check:governance)  target="check-governance.sh" ;;
    *)                 # G3：未知键若静默放过，target 为空会让 node 侧 `if (target && …)` 短路成 OK（假绿）。
                       # 文案固定短语「内部错误：need_pkg_script 未知键」供外部机器判定命中本分支。
                       fail "内部错误：need_pkg_script 未知键 ${key}（case 缺分支，未配目标子串映射）" \
                            "在 need_pkg_script 的 case 里为 ${key} 补 target 映射后重跑"; return 1 ;;
  esac
  line="$(node -e '
    const fs=require("fs"), path=require("path");
    const pkg=process.argv[1], key=process.argv[2], top=process.argv[3], target=process.argv[4];
    let v;
    try { v=(JSON.parse(fs.readFileSync(pkg,"utf8")).scripts||{})[key]; }
    catch(e){ process.stdout.write("BAD_JSON||"); process.exit(0); }
    if (typeof v!=="string" || !v.trim()) { process.stdout.write("MISSING||"); process.exit(0); }
    if (target && v.indexOf(target)<0) { process.stdout.write("NOT_TARGET|"+target+"|"+v); process.exit(0); }
    const toks=v.trim().split(/\s+/);
    const hit = target ? toks.find(t=>t.indexOf(target)>=0) : null;
    if (hit && hit.charAt(0)!=="-" && !fs.existsSync(path.resolve(top,hit))) { process.stdout.write("MISS_FILE|"+hit+"|"+v); process.exit(0); }
    process.stdout.write("OK||"+v);
  ' "${PKG}" "${key}" "${TOP}" "${target}" 2>/dev/null)"
  IFS='|' read -r code detail val <<< "${line}"
  case "${code}" in
    OK) return 0 ;;
    BAD_JSON) fail "package.json 不可解析 → ${PKG}" "node -e 'JSON.parse(require(\"fs\").readFileSync(\"${PKG}\",\"utf8\"))' 定位 JSON 语法错误"; return 1 ;;
    MISSING) fail "package.json 缺 script 键 ${key}（键不存在或值为空）" "在根 package.json（${PKG}）的 scripts 段补回 \"${key}\""; return 1 ;;
    NOT_TARGET) fail "package.json 的 ${key} 未指向 ${detail}（现值: ${val}）" "在根 package.json 的 scripts 补回 \"${key}\": \"…${detail}…\""; return 1 ;;
    MISS_FILE) fail "package.json 的 ${key} 指向的 ${detail} 文件不存在（现值: ${val}）" "恢复 ${detail} 对应文件，或修正根 package.json 的 scripts.${key}"; return 1 ;;
    *) fail "package.json 的 ${key} 值校验异常（node 无输出）" "检查根 package.json 的 scripts.${key}"; return 1 ;;
  esac
}

# 按 jobs: 块解析 job 名（不全文 grep，避免把 on: 下的事件名当成 job）
#   WF_OK=0 时不调用 awk → 不泄漏 stderr、不把「不可读」误报成「N 个 job 全缺」（F11）
ci_jobs() {
  [ "${WF_OK}" -eq 1 ] || return 0
  awk '
    /^jobs:[[:space:]]*$/ { inj=1; next }
    inj && /^[^[:space:]#]/ { inj=0 }
    inj && /^  [A-Za-z0-9_-]+:[[:space:]]*$/ { line=$0; gsub(/[:[:space:]]/,"",line); print line }
  ' "${WORKFLOW}" 2>/dev/null
}
# F2：判 job 是否「真会执行」——输出每 job 一行 <job> <if恒假:0|1> <has_steps:0|1> <steps非空:0|1>
#   只解析 jobs: 块（job 名 2 空格 / job 级键 4 空格 / step 列表项 6 空格，与 ci_jobs 同一约定）。
#   恒假 if 用严格白名单匹配（false/0/-0/0.0/null/''/""，含 ${{ }} 包装），
#   合法条件表达式（含 github./==/contains 等）一律不命中 → 不误阻断。
ci_job_health() {
  [ "${WF_OK}" -eq 1 ] || return 0
  awk '
    function trim(s){ gsub(/^[[:space:]]+/,"",s); gsub(/[[:space:]]+$/,"",s); return s }
    function is_false(v,  t){
      v=trim(v)
      if (index(v,"#")>0) return 0
      if (substr(v,1,3)=="${{" && substr(v,length(v)-1,2)=="}}") { t=substr(v,4,length(v)-5); v=trim(t) }
      return (v=="false"||v=="FALSE"||v=="False"||v=="0"||v=="-0"||v=="0.0"||v=="null"||v=="NULL"||v=="Null"||v=="\047\047"||v=="\"\"")
    }
    function emit(){ if (cur!="") printf "%s %d %d %d\n", cur, iffalse, hassteps, stepsok }
    /^jobs:[[:space:]]*$/ { inj=1; next }
    inj && /^[^[:space:]#]/ { inj=0 }
    inj {
      line=$0
      if (line ~ /^[[:space:]]*$/ || line ~ /^[[:space:]]*#/) next
      ind=0; n=length(line)
      for (k=1;k<=n;k++){ if (substr(line,k,1)==" ") ind++; else break }
      if (ind==2 && line ~ /^  [A-Za-z0-9_-]+:[[:space:]]*$/) {
        emit()
        cur=line; sub(/^  /,"",cur); sub(/[[:space:]]*:[[:space:]]*$/,"",cur)
        iffalse=0; hassteps=0; stepsok=0; in_steps=0
        next
      }
      if (ind==4) {
        in_steps=0
        if (line ~ /^    if:/) { v=line; sub(/^    if:[[:space:]]*/,"",v); if (is_false(v)) iffalse=1 }
        if (line ~ /^    steps:/) { hassteps=1; in_steps=1 }
        next
      }
      if (ind>=6 && in_steps==1 && line ~ /^      -[[:space:]]/) stepsok=1
    }
    END { emit() }
  ' "${WORKFLOW}" 2>/dev/null
}
need_job() {
  local j="${1}"
  [ "${WF_OK}" -eq 1 ] || return 0
  if ci_jobs | grep -qx "${j}"; then return 0; fi
  fail "CI job 缺失: ${j}（job 被改名或删掉是静默失效高发点）" \
       "检查 ${WORKFLOW} 的 jobs 段，补回 ${j}"
  return 1
}

# ============================ ① 意图锚定层 ============================
L=1
SPECS_N=0
if [ -d "$TOP/specs" ]; then SPECS_N=$(find "$TOP/specs" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '); fi
[ "$SPECS_N" -gt 0 ] || fail "specs/ 为空或不存在" "恢复 specs/ 规格目录（数量只输出，不设阈值）"
need "$TOP/scripts/audit-specs.mjs" "规格门禁脚本" "恢复 scripts/audit-specs.mjs" file
if node --check "$TOP/scripts/audit-specs.mjs" >/dev/null 2>&1; then :; else
  fail "audit-specs.mjs 不可解析" "node --check scripts/audit-specs.mjs 定位语法错误并修复"
fi
need_pkg_script 'check:specs'
need_pkg_script 'specs:index:check'
# 关键门实跑
if npm run check:specs --silent >"$TMP/check-specs.log" 2>&1; then
  add "check:specs exit 0"
else
  fail "关键门实跑 npm run check:specs 非零" "npm run check:specs 查看违规明细并修复"
fi
need_job 'specs-gate'
need "$SDD_SOP" "规格驱动开发 SDD-SOP 真源" "恢复 ~/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md" file
if [ -d "$TOP/docs/decisions" ]; then add "ADR 落点在"; else
  warn "docs/decisions/ 未建（已知缺口 A5 / #8605，按规格不计 FAIL）" "见台账 #8605，由研发部落地 ADR 仓库目录"
fi
add "specs=$SPECS_N"

# ============================ ② 验证契约层 ============================
L=2
need "$TOP/tests/playwright.config.ts" "统一 E2E 入口配置" "恢复 tests/playwright.config.ts" file
need_pkg_script 'test:e2e:list'
# F3：实跑 test:e2e:list --list（顶部已后台启动 + 5s 超时闸门；实测 ~1.7s，默认档补实跑）
#   rc=0 → PASS；rc 等于该种闸门的超时哨兵码（perl 250 / timeout·gtimeout 124）= 子进程被闸门信号杀死
#   → 等价降级不判 FAIL；其余 rc（含命令自行 exit 142/124 以外的失败）→ FAIL ②。
E2E_RC=0
wait "${E2E_PID}" 2>/dev/null || E2E_RC=$?
# G2：无闸门时任何 rc 都不作超时；但「闸门未生效」必须在 ② 层看得见（WARN + detail，不静默、不阻断）
if [ "${E2E_TIMEOUT_KIND}" = "none" ]; then
  warn "test:e2e:list：无 perl/timeout，5s 闸门未生效（rc=${E2E_RC}，仅裸跑无超时保护）" \
       "安装 perl 或 coreutils 的 timeout/gtimeout 以启用 F3 5s 超时闸门（当前非阻断）"
  add "无超时工具，闸门未生效（无 perl/timeout/gtimeout）"
fi
if [ "${E2E_RC}" -eq 0 ]; then
  add "test:e2e:list --list 实跑 exit 0"
elif [ "${E2E_TIMEOUT_KIND}" != "none" ] && [ -n "${E2E_TIMEOUT_CODE}" ] \
     && [ "${E2E_RC}" -eq "${E2E_TIMEOUT_CODE}" ]; then
  # 真超时（子进程被 alarm/timeout 以信号杀死 → 哨兵码）→ 等价降级（§4.1.1），不判 FAIL
  if [ -f "${TOP}/tests/playwright.config.ts" ] && [ -e "${TOP}/node_modules/.bin/playwright" ]; then
    add "test:e2e:list 超时降级（config 在 + playwright CLI 在位）"
  else
    fail "test:e2e:list --list 超时且等价判定不满足（tests/playwright.config.ts 或 node_modules/.bin/playwright 缺失）" \
         "确认 tests/playwright.config.ts 存在、node_modules/.bin/playwright 可执行；npm run test:e2e:list --silent 复现"
  fi
else
  fail "关键门实跑 test:e2e:list --list 非零（rc=${E2E_RC}）" \
       "npm run test:e2e:list --silent 查看错误；确认 tests/playwright.config.ts 可解析、playwright 依赖在位"
fi
need "$TOP/servers/ai-agent/e2e/contract-risk/README.md" "唯一 eval harness README" \
     "恢复 servers/ai-agent/e2e/contract-risk/README.md" file
FIX_N=0
[ -d "$TOP/servers/ai-agent/e2e/contract-risk/fixtures" ] && \
  FIX_N=$(find "$TOP/servers/ai-agent/e2e/contract-risk/fixtures" -type f | wc -l | tr -d ' ')
[ "$FIX_N" -gt 0 ] || fail "eval harness golden fixtures 为空" \
  "补回 servers/ai-agent/e2e/contract-risk/fixtures/ 下的黄金用例"
need_job 'changed-packages'
need_job 'gate-cases'
need "$TOP/scripts/ci/changed-packages.sh" "改动包选择器" \
     "chmod +x scripts/ci/changed-packages.sh" exec
need "$BIN/cases/run.sh" "黄金用例集 run.sh" "chmod +x scripts/redline/cases/run.sh" exec
need "$BIN/cases/shadow.sh" "黄金用例集 shadow.sh" "chmod +x scripts/redline/cases/shadow.sh" exec
SPEC_N=$(find . -path ./.git -prune -o -path ./node_modules -prune -o -name '*.spec.ts' -type f -print 2>/dev/null | wc -l | tr -d ' ')
add "harness fixtures=$FIX_N / spec=${SPEC_N}（仅信息）"

# ============================ ③ 执行隔离层 ============================
L=3
if need_json "$TOP/.codebuddy/settings.json" "项目级 hook 配置" \
    "恢复 .codebuddy/settings.json 并保证 JSON 可解析"; then
  if node -e '
    const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const all=JSON.stringify(s.hooks||{});
    process.exit(all.includes("hook-worktree-gate.py")?0:1);
  ' "$TOP/.codebuddy/settings.json" >/dev/null 2>&1; then add "worktree hook 挂载"; else
    fail ".codebuddy/settings.json 未挂载 hook-worktree-gate.py" \
         "在 hooks.PreToolUse[].hooks[] 补回 python3 .../scripts/redline/hook-worktree-gate.py"
  fi
fi
# python hook 由解释器调用，按「可解析」口径判生效（不要求 +x）
if [ -f "$BIN/hook-worktree-gate.py" ]; then
  if python3 -m py_compile "$BIN/hook-worktree-gate.py" >/dev/null 2>&1; then :; else
    fail "hook-worktree-gate.py 不可解析" "python3 -m py_compile scripts/redline/hook-worktree-gate.py 定位错误"
  fi
else
  fail "守卫脚本 hook-worktree-gate.py 缺失" "恢复 scripts/redline/hook-worktree-gate.py"
fi
# F1：判 `git worktree list` 的**退出码**——
#   旧实现 `[ -n "$WT_N" ]` 判 wc -l 的输出字符串，空输入恒返回 "0"（非空）→ FAIL 分支永不触发。
WT_OUT="$(git worktree list 2>/dev/null)"; WT_RC=$?
if [ "${WT_RC}" -ne 0 ]; then
  WT_N=0
  fail "git worktree list 不可用（rc=${WT_RC}，会话自发现失效）" \
       "检查 git 仓库完整性：git worktree list 查看报错；确认 .git 完整"
else
  WT_N=$(printf '%s\n' "${WT_OUT}" | tail -n +2 | wc -l | tr -d ' ')
fi
BRANCH="$(git branch --show-current 2>/dev/null)"
if [ -z "$BRANCH" ]; then
  # CI checkout / 临时验收 worktree 默认就是 detached HEAD，属合法形态
  #（2026-11-09 在 origin/master 干净快照实跑踩到误报 FAIL 3，规格 03 §3 只要求
  #  「能返回分支名即可，不要求等于 master」，意图是防分支归属误判，不是禁 detached）。
  # 只有连 HEAD 都解析不出来才算仓库损坏。
  HEAD_SHA="$(git rev-parse --verify --short HEAD 2>/dev/null || true)"
  if [ -n "$HEAD_SHA" ]; then
    BRANCH="detached@${HEAD_SHA}"
  else
    fail "git branch --show-current 无返回且 HEAD 不可解析（仓库损坏）" \
         "git rev-parse --verify HEAD 定位；确认 .git 完整"
  fi
fi
# roster 是 gitignored 的本地状态，CI / 新 worktree 必然没有 → 只做信息项，不 WARN
ROSTER_N=0
[ -d "$TOP/.agent-roster" ] && ROSTER_N=$(find "$TOP/.agent-roster" -maxdepth 1 -type f | wc -l | tr -d ' ')
if [ -d "$TOP/.agent-roster" ] && [ "$WT_N" -gt 0 ] && [ $((WT_N - ROSTER_N)) -gt 3 ]; then
  warn "roster=$ROSTER_N 与 worktree=$WT_N 差值过大（roster 允许滞后，不判 FAIL）" \
       "清理退出的会话：git worktree prune 并同步 .agent-roster/"
  add "roster 差值 $((WT_N - ROSTER_N))"
else
  add "roster=${ROSTER_N}（仅信息）"
fi
add "hooks 挂载 / worktree=$WT_N / branch=$BRANCH"

# ============================ ④ 约束强制层 ============================
L=4
# 最易静默失效的一项：hooksPath 被改掉时，脚本存在也照样绿
HP="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ "$HP" = ".githooks" ]; then add "hooksPath=.githooks"; else
  fail "core.hooksPath='${HP:-<空>}'（应为 .githooks）" "git config core.hooksPath .githooks"
fi
need "$TOP/.githooks/pre-commit" "pre-commit hook" "chmod +x .githooks/pre-commit 并恢复文件" exec
need "$BIN/scan-rules.sh" "红线扫描器" "恢复 scripts/redline/scan-rules.sh" file
need_gates_lint && add "gates-lint 实跑通过"
need "$BIN/gate.ts" "gate.ts" "恢复 scripts/redline/gate.ts" file
need "$BIN/gates-lint.ts" "gates-lint.ts" "恢复 scripts/redline/gates-lint.ts" file
JOBS='redline-scan pipeline-lint changed-packages deliverables-check gate-cases proto-static-check specs-gate'
if [ "${WF_OK}" -ne 1 ]; then
  # F11：不可读只报一条明确 FAIL（不再逐 job 误报 N 条），fix 带实际注入路径
  fail "CI workflow 不可读: ${WORKFLOW}（job 生效判定无法进行，不再逐 job 误报）" \
       "ls -l ${WORKFLOW}；确认注入文件存在且可读：${WORKFLOW}"
  add "CI job 检查跳过（workflow 不可读）"
else
  JOB_N=0
  for j in ${JOBS}; do need_job "${j}" && JOB_N=$((JOB_N+1)); done
  # F2：白名单内逐个 job 判「真会执行」——恒假 if: / steps: 缺失或为空 → FAIL ④
  JOB_HEALTH="${TMP}/job-health.tsv"
  ci_job_health > "${JOB_HEALTH}" 2>/dev/null
  while read -r _hbj _iffalse _hassteps _stepsok; do
    [ -z "${_hbj}" ] && continue
    case " ${JOBS} " in *" ${_hbj} "*) : ;; *) continue ;; esac
    if [ "${_iffalse:-0}" = "1" ]; then
      fail "CI job ${_hbj} 被 job 级恒假 if 禁用（CI 上永不执行，闸门被悄悄关掉）" \
           "grep -n -A8 '^  ${_hbj}:' ${WORKFLOW} 定位后删除其 job 级 'if: false'，或改成合法条件如 if: github.event_name == 'push'"
    fi
    if [ "${_hassteps:-0}" = "1" ]; then
      [ "${_stepsok:-0}" = "1" ] || fail "CI job ${_hbj} 的 steps: 为空（job 体被掏空）" \
           "grep -n -A8 '^  ${_hbj}:' ${WORKFLOW} 定位后给 steps: 补回至少一个 '      - run: …' 或 '      - uses: …'"
    else
      fail "CI job ${_hbj} 缺 steps:（job 无可执行步骤）" \
           "grep -n -A8 '^  ${_hbj}:' ${WORKFLOW} 定位后补回 '    steps:' 及至少一个步骤"
    fi
  done < "${JOB_HEALTH}"
  add "$JOB_N/7 CI job 齐 / job 级 if:·steps: 已判生效"
fi
if need_json "$USER_SETTINGS" "用户级 hook settings" \
    "恢复 ~/.workbuddy/settings.json 顶层 hooks"; then
  if node -e '
    const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const a=(s.hooks&&s.hooks.PreToolUse)||[];
    process.exit(a.length>0?0:1);
  ' "$USER_SETTINGS" >/dev/null 2>&1; then :; else
    fail "用户级 hooks.PreToolUse 为空" "在 ~/.workbuddy/settings.json 顶层 hooks.PreToolUse 补回门禁"
  fi
fi
need "$USER_HOOK" "用户级会话成本门禁" "恢复 ~/.workbuddy/hooks/session-cost-gate.py" exec
# 等价快速判定（实测 0.3s）：保护.sh status 的「可写」= 权限 != 444，
#   list_files() 覆盖三个受保护目录 + 根 README.md / AGENTS.md。
#   完整 status 逐文件 ls -l 实测 31s，巡检档不跑；--full 里跑一次做判据交叉校验。
P_N=0
for d in "$HOME_AW/00-总控台" "$HOME_AW/10-主线工作" "$HOME_AW/20-私域资产"; do
  [ -d "$d" ] && P_N=$((P_N + $(find "$d" -type f ! -perm 444 2>/dev/null | wc -l | tr -d ' ')))
done
for f in "$HOME_AW/README.md" "$HOME_AW/AGENTS.md"; do
  [ -f "$f" ] && [ "$(stat -f '%Lp' "$f" 2>/dev/null)" != "444" ] && P_N=$((P_N+1))
done
if [ "$P_N" -eq 0 ]; then add "保护=只读"; else
  warn "保护状态：可写文件 ${P_N} 个（非 0 不判 FAIL；常见为 16:00 日报幂等解锁的两个看板生成物）" \
       "确认无人在改真源后运行 bash ~/AiWorkspace/90-工具/保护.sh on"
fi
if [ "$FULL" -eq 1 ] && [ -f "$PROTECT" ]; then
  FULL_N="$(bash "$PROTECT" status 2>/dev/null | grep -oE '可写文件：[0-9]+' | grep -oE '[0-9]+' | tail -1)"
  [ "${FULL_N:-?}" = "$P_N" ] || \
    fail "保护状态快速判定($P_N) 与 保护.sh status(${FULL_N:-?}) 不一致" \
         "同步 check-governance.sh 的保护口径与 ~/AiWorkspace/90-工具/保护.sh 的 list_files/status"
fi
# 薄编排接线：三脚本存在 + 可执行位 + npm 入口挂载（实跑放 --full）
SELFTESTS='selfcheck-ui-gate.sh test-gate-hardening.sh mutation-test.sh'
for s in $SELFTESTS; do
  need "$BIN/$s" "自检脚本 $s" "chmod +x scripts/redline/$s" exec
done
need_pkg_script 'check:governance'
if [ "$FULL" -eq 1 ]; then
  # 工作树守护：mutation-test.sh 靠 trap 还原被它故意改坏的实现；若进程被强杀，
  #   trap 不执行就会留下变异态实现（2026-11-09 实测两次：scan-rules.sh / gate-shared.sh）。
  #   跑前记下所有已有改动，跑后凡是「新增」的已跟踪文件改动一律还原并判 FAIL。
  SNAP="$TMP/tracked-before.txt"
  git diff --name-only HEAD > "$SNAP" 2>/dev/null || : > "$SNAP"
  gov_restore_guard() {
    local f
    for f in $(git diff --name-only HEAD 2>/dev/null); do
      grep -qxF "$f" "$SNAP" 2>/dev/null || git restore --source=HEAD -- "$f" 2>/dev/null
    done
  }
  trap 'gov_restore_guard; rm -rf "$TMP"' EXIT
  FULL_OK=0
  for s in $SELFTESTS; do
    if bash "$BIN/$s" >"$TMP/$s.log" 2>&1; then FULL_OK=$((FULL_OK+1)); else
      fail "--full 实跑 $s 非零" "bash scripts/redline/$s 查看失败用例（日志摘要见 --json 的 fails）"
    fi
  done
  if bash "$BIN/cases/run.sh" >"$TMP/cases-run.log" 2>&1; then :; else
    fail "--full 实跑 cases/run.sh 非零" "bash scripts/redline/cases/run.sh 查看失败用例"
  fi
  if bash "$BIN/cases/shadow.sh" >"$TMP/cases-shadow.log" 2>&1; then :; else
    fail "--full 实跑 cases/shadow.sh 非零" "bash scripts/redline/cases/shadow.sh 查看失败用例"
  fi
  LEFTOVER=""
  for f in $(git diff --name-only HEAD 2>/dev/null); do
    grep -qxF "$f" "$SNAP" 2>/dev/null || LEFTOVER="$LEFTOVER $f"
  done
  if [ -n "$LEFTOVER" ]; then
    fail "--full 后工作树出现预期外改动:$LEFTOVER（变异脚本未还原，已自动还原）" \
         "排查 scripts/redline/mutation-test.sh 的 restore_all；被强杀会漏还原，须在隔离 worktree 跑"
    gov_restore_guard
  fi
  add "--full 自检 $FULL_OK/3 通过"
else
  add "三脚本接线 3/3（实跑用 --full）"
fi

# ============================ ⑤ 人机协作层 ============================
L=5
if [ -f "$LEDGER" ]; then
  [ -w "$LEDGER" ] || fail "台账被锁成只读（登记率会归零）" "chmod u+w $LEDGER"
  DUP="$(grep -oE '^\| [0-9]+ \|' "$LEDGER" | tr -d '| ' | sort -n | uniq -d | head -5 | tr '\n' ' ')"
  DUP="$(printf '%s' "$DUP" | sed 's/[[:space:]]*$//')"
  if [ -n "$DUP" ]; then
    fail "台账重号: ${DUP}（回执会落不到唯一一条）" "合并重复编号行：grep -nE '^\\| ($(printf '%s' "$DUP" | tr ' ' '|')) ' $LEDGER"
  else
    add "台账可写 / 无重号"
  fi
else
  fail "台账不存在 → $LEDGER" "恢复 30-任务产物/_待验证清单.md（唯一入口）"
fi
need "$THREE_TABLES" "三表化交付规范真源" \
     "恢复 ~/AiWorkspace/20-私域资产/AI协作交付规范-表格化收尾.md" file

# ============================ 汇总与输出 ============================
N_FAIL=$(awk -F'\t' '$1=="FAIL"' "$REC" | wc -l | tr -d ' ')
N_WARN=$(awk -F'\t' '$1=="WARN"' "$WARNF" | wc -l | tr -d ' ')
[ "$N_FAIL" -gt 0 ] && EXIT_CODE=1 || EXIT_CODE=0
STAMP="$(date '+%Y-%m-%dT%H:%M:%S%z')"

if [ "$JSON" -eq 1 ]; then
  GOV_REC="$REC" GOV_WARN="$WARNF" GOV_EXIT="$EXIT_CODE" GOV_STAMP="$STAMP" \
  GOV_D1="${DETAIL[1]}" GOV_D2="${DETAIL[2]}" GOV_D3="${DETAIL[3]}" \
  GOV_D4="${DETAIL[4]}" GOV_D5="${DETAIL[5]}" GOV_FULL="$FULL" \
  python3 <<'PY'
import os, json
rec, warn = os.environ['GOV_REC'], os.environ['GOV_WARN']
names = ['意图锚定','验证契约','执行隔离','约束强制','人机协作']
labels = ['①','②','③','④','⑤']
def load(p):
    out=[]
    with open(p, encoding='utf-8') as f:
        for line in f:
            parts=line.rstrip('\n').split('\t')
            if len(parts)>=4 and parts[0] in ('FAIL','WARN'):
                out.append(dict(level=parts[0], layer=parts[1], item=parts[2], fix=parts[3]))
    return out
fails, warns = load(rec), load(warn)
layers=[]
for i in range(1,6):
    fs=[x for x in fails if x['layer']==str(i)]
    ws=[x for x in warns if x['layer']==str(i)]
    layers.append(dict(id=i, label=labels[i-1], name=names[i-1],
                       status='FAIL' if fs else 'OK',
                       detail=os.environ.get('GOV_D%d'%i,''),
                       fails=fs, warnings=ws))
print(json.dumps(dict(
    script='check-governance', timestamp=os.environ['GOV_STAMP'],
    mode='full' if os.environ['GOV_FULL']=='1' else 'quick',
    exitCode=int(os.environ['GOV_EXIT']),
    summary=dict(fail=len(fails), warn=len(warns)),
    layers=layers,
    fails=fails,
    warnings=warns,
), ensure_ascii=False, indent=2))
PY
else
  for i in 1 2 3 4 5; do
    ST=OK
    awk -F'\t' -v l="$i" '$1=="FAIL" && $2==l {found=1} END{exit found?0:1}' "$REC" && ST=FAIL
    WN=$(awk -F'\t' -v l="$i" '$1=="WARN" && $2==l' "$WARNF" | wc -l | tr -d ' ')
    printf '%s %-6s %-4s (%s)' "${LABEL[$i]}" "${NAME[$i]}" "$ST" "${DETAIL[$i]}"
    [ "$WN" -gt 0 ] && printf '  [WARN %s]' "$WN"
    printf '\n'
  done
  printf -- '--\n'
  if [ "$N_FAIL" -gt 0 ]; then
    awk -F'\t' '$1=="FAIL"{
      printf "FAIL %s · %s\n", $2, $3;
      if ($4 != "") printf "  → 修复: %s\n", $4
    }' "$REC"
  fi
  if [ "$N_WARN" -gt 0 ]; then
    awk -F'\t' '$1=="WARN"{ printf "WARN %s · %s\n", $2, $3 }' "$WARNF"
  fi
  printf 'FAIL: %s  WARN: %s  → exit %s\n' "$N_FAIL" "$N_WARN" "$EXIT_CODE"
fi

exit "$EXIT_CODE"
