/**
 * gates-lint.ts — gates.yaml 自检器（S1 的验证手段，不进扫描路径）
 *
 * 用途：`node scripts/redline/gates-lint.ts`
 *
 * 为什么需要它：一份「看起来像配置的散文」没用。YAML 必须被机器钉住，
 *   否则它只是第二份会漂移的文档 —— 那正是 S1 要消灭的问题。
 *
 * 五类检查：
 *   ① 结构   —— 解析 + 必填字段 + 枚举 + 引用完整性（scope 名、gate 号）
 *   ② 自洽   —— scope 双向引用闭合、豁免清单与门声明对齐、档位被 gate.ts 读
 *   ③ 用例   —— 每道门要么有黄金用例（evidence → scenarios.tsv），要么有专用测试脚本
 *             （evidence_external → 脚本必须存在），要么进 uncovered（承认没覆盖，不许含糊）
 *   ④ 接线   —— 主链路四个入口 + commit-msg 钩子都真的跑 gate.ts
 *   ⑤ 生成物 —— 文档门表 / PR 模板 / 观察日志表头都与 YAML 同步
 *
 * 🔴 S5（2026-11-11）删掉 legacy bash 后，② 从「与 bash 逐条比对」降级成「YAML 内部自洽」。
 *   这是一次**真实的能力损失**，不是等价替换：bash 是独立实现，能发现「改了 YAML 忘改代码」；
 *   自洽检查发现不了这个。补位的是行为侧的两层（黄金用例 + 生成式变异，见 cases/ 与
 *   mutation-gen.ts），它们直接跑引擎，不读源码猜。残留的盲区写在
 *   docs/development/gates/00-单一真相源.md §三 与 §八。
 *
 * 退出码：0=全部通过 1=有失败 2=用法错误
 */

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml, YamlError } from "./lib/yaml-mini.ts";
import type { YamlMap, YamlValue } from "./lib/yaml-mini.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOP = resolve(HERE, "../..");
const GATES_YAML = join(HERE, "gates.yaml");
const GATE_TS = join(HERE, "gate.ts");
const SCENARIOS = join(HERE, "cases", "scenarios.tsv");

/**
 * 主链路执行点 —— status=enforcing 后，这几处必须跑 gate.ts。
 * （.githooks/commit-msg 单独查：它调的是另一套子命令 commit-msg，见 checkCommitMsgHook）
 *
 * 为什么要机器检查：改 YAML 的 status 不改这三个文件，就是**假切主** ——
 * 声明写着 enforcing、文档写着「以 gates.yaml 为准」，实际判案子的还是 bash。
 * 这种状态比不切更糟：两份权威并存且无人知道哪份在生效。
 */
const MAIN_CHAIN = [
  { path: join(TOP, ".githooks", "pre-commit"), label: ".githooks/pre-commit", varname: "SCANNER" },
  { path: join(TOP, ".github", "workflows", "quality-gate.yml"), label: ".github/workflows/quality-gate.yml", varname: null },
  { path: join(HERE, "collect-gate-observations.sh"), label: "scripts/redline/collect-gate-observations.sh", varname: null },
  // 🔴 黄金用例运行器必须被测引擎是 gate.ts —— 这处最容易漏，因为它是"测试"不是"链路"。
  //   2026-11-11 切主时实测踩到：三处入口都切了，run.sh 还在跑 bash，于是
  //   「把 gates.yaml 的判据改坏」这件事没有任何测试会红 —— CI 全绿，判据已失效。
  { path: join(HERE, "cases", "run.sh"), label: "scripts/redline/cases/run.sh", varname: "SCAN" },
];

const LEVELS = ["error", "warning", "notice"];
const ACCEPTS = ["pass", "path", "sha"];
const BATCHES = ["1", "2", "3", "external"];
const SCAN_MODES = ["cached", "diff", "files", "tree"];
const ACTIONS = ["skip"];
const SCOPE_KEYS = ["loc_prefix"];
const RENDERS = ["detail", "message_tag"];

interface Failure {
  kind: string;
  detail: string;
}

const failures: Failure[] = [];
const passes: string[] = [];
/** 提示项：既不阻断也不计入通过，用于「切主后属预期」的差异 */
const notes: string[] = [];

/**
 * status 的运行时值（main 里解析后赋值）。
 * S5 删 bash 后它只剩一个分支（enforcing），留着是因为状态字段仍在 schema 里。
 */
let specStatus = "";

function ok(label: string, note?: string): void {
  passes.push(note ? `${label}（${note}）` : label);
}
function note(text: string): void {
  notes.push(text);
}
function bad(kind: string, detail: string): void {
  failures.push({ kind, detail });
}

function asMap(v: YamlValue, ctx: string): YamlMap {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    bad("结构", `${ctx} 应为映射，实际是 ${describe(v)}`);
    return {};
  }
  return v;
}
function asList(v: YamlValue, ctx: string): YamlValue[] {
  if (!Array.isArray(v)) {
    bad("结构", `${ctx} 应为数组，实际是 ${describe(v)}`);
    return [];
  }
  return v;
}
function asStr(v: YamlValue, ctx: string): string {
  if (typeof v !== "string") {
    bad("结构", `${ctx} 应为字符串，实际是 ${describe(v)}`);
    return "";
  }
  return v;
}
function describe(v: YamlValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "数组";
  if (typeof v === "object") return "映射";
  return `${typeof v}(${String(v)})`;
}

function resolveSpecRef(ref: string): { external: boolean; exists: boolean } {
  if (ref.startsWith("~")) {
    const p = join(homedir(), ref.slice(1));
    return { external: true, exists: existsSync(p) };
  }
  if (ref.startsWith("/")) return { external: true, exists: existsSync(ref) };
  return { external: false, exists: existsSync(join(TOP, ref)) };
}

/**
 * 防假切主：status=enforcing 时，主链路必须真的跑 gate.ts。
 *
 * 分文件判，不做通用正则 —— 三处的写法本来就不一样：
 *   pre-commit  用 SCANNER 变量 + exec，字面量里没有路径拼接后的调用
 *   CI          只看 `run:` 行（注释里提到 scan-rules.sh 是合法的）
 *   采集脚本    非注释行里的实际命令
 * 通用正则会同时误判注释和真调用，那种检查绿了也不可信。
 */
function checkMainChain(): void {
  const stale: string[] = [];

  // ① 用变量中转引擎路径的入口（pre-commit / cases/run.sh）：变量必须指向 gate.ts，
  //    且调用它的运行时必须是 node（.ts 不能用 bash 跑）
  for (const entry of MAIN_CHAIN) {
    if (entry.varname === null) continue;
    const src = safeRead(entry.path);
    if (src === null) {
      bad("接线", `读不到 ${entry.label}（切主后这个文件是必需的）`);
      continue;
    }
    const declared = new RegExp(`^${entry.varname}="([^"]+)"`, "m").exec(src);
    const value = declared === null ? "" : declared[1];
    if (!value.endsWith("gate.ts")) stale.push(`${entry.label} 的 ${entry.varname}=${value || "(缺失)"}`);

    // 调用行：`exec node "$SCANNER"` 或 `( cd … && node "$SCAN" … )`
    const callRe = new RegExp(`(?:exec|&&)\\s+(\\S+)\\s+"\\$${entry.varname}"`, "m");
    const call = callRe.exec(src);
    if (call === null) bad("接线", `${entry.label} 里找不到调用 $${entry.varname} 的行（无法确认执行器）`);
    else if (call[1] !== "node") stale.push(`${entry.label} 用 ${call[1]} 执行 gate.ts（ts 必须用 node）`);
  }

  // ② CI：redline-scan job 的 run: 行必须调 gate.ts，且不得调 bash scan-rules.sh
  const ci = safeRead(MAIN_CHAIN[1].path);
  if (ci === null) {
    bad("接线", "读不到 .github/workflows/quality-gate.yml");
  } else {
    const runLines = ci
      .split("\n")
      .filter((l) => /^\s*(run:\s*)?[^#\s]/.test(l) && !/^\s*#/.test(l))
      .filter((l) => l.includes("scan-rules.sh") || l.includes("redline/gate.ts"));
    for (const l of runLines) {
      if (/bash\s+\S*scan-rules\.sh/.test(l)) stale.push(`CI 仍在跑 bash scan-rules.sh：${l.trim().slice(0, 60)}`);
    }
    if (!runLines.some((l) => /node\s+\S*redline\/gate\.ts/.test(l))) {
      bad("接线", "CI 里找不到 `node scripts/redline/gate.ts`（切主后主扫描器必须是它）");
    }
  }

  // ③ 采集脚本：非注释行不得调 bash scan-rules.sh
  const collect = safeRead(MAIN_CHAIN[2].path);
  if (collect === null) {
    bad("接线", "读不到 scripts/redline/collect-gate-observations.sh");
  } else {
    for (const l of collect.split("\n")) {
      if (/^\s*#/.test(l)) continue;
      if (/bash\s+\S*scan-rules\.sh/.test(l)) stale.push(`采集脚本仍在跑 bash scan-rules.sh：${l.trim().slice(0, 60)}`);
    }
  }

  if (stale.length === 0) {
    ok("主链路已切到 gate.ts", "pre-commit / CI / 采集 / 黄金用例运行器 四处");
  } else {
    for (const s of stale) bad("接线", `假切主：${s}`);
  }
}

function safeRead(p: string): string | null {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * ⑤-a 文档生成区块必须最新。
 *
 * 为什么用子进程调 `gen-docs.ts --check` 而不是 import 它的函数：
 *   gen-docs.ts 是脚本（末尾 process.exit），import 会直接把 lint 进程带走。
 *   子进程的退出码正好就是要的信号，也不必把渲染逻辑搬进来复制一份。
 *
 * 为什么这条要卡在 CI：手抄的门号清单不会「报错」，只会慢慢和实际不符。
 *   读者按文档判断「这提交会不会被拦」——文档说三道门、实际五道，是最难查的那种错。
 */
function checkGeneratedDocs(): void {
  const r = spawnSync("node", [join(HERE, "gen-docs.ts"), "--check"], { encoding: "utf8", cwd: TOP });
  if (r.status === 0) {
    ok("文档生成区块最新", "3 处（03 门表 / 质量门禁总纲 / PR 模板）");
    return;
  }
  if (r.status === 2) {
    bad("生成物", `gen-docs.ts 无法运行：${(r.stderr || "").trim().split("\n").slice(0, 3).join(" / ")}`);
    return;
  }
  // 过期：stderr 里每行 `    <file>  [<id>]` 是被判定过期的目标
  const stale = (r.stderr || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes("[") && l.includes("]") && l.includes(".md"));
  bad("生成物", "文档里的门号清单与 gates.yaml 不一致，跑 `node scripts/redline/gen-docs.ts` 重新生成");
  for (const s of stale) bad("生成物", `过期区块：${s}`);
}

/**
 * ⑤-b 观察期口径：观测清单在 YAML 一处，日志表头必须与它同序。
 *
 * 这条要防的是「列错位」——不是文件不存在那种明显故障，而是：
 *   加了一个观察指标却没改日志表头 → 新数据插到旧列下，每列的数字都还是数字，
 *   看起来完全正常，但那一列的含义变了。观察期数据是用来判断「该不该升 error」的，
 *   列错位等于用错的数据做决定。
 *
 * 2026-11-04 还发生过另一种失效：日志被归档到 archive/，而采集脚本仍写活跃区路径，
 * 于是 `--append` 打印「跳过追加」并 exit 0 —— 7 天一行数据没落，没人发现。
 * 所以这里也检查文件存在性。
 */
function checkObservations(doc: YamlMap, ids: Set<string>): void {
  let o: YamlMap;
  try {
    o = asMap(doc.observations, "observations");
  } catch {
    bad("观察口径", "缺 observations 段 —— 采集脚本拒绝在无声明的情况下采数据");
    return;
  }

  const docPath = asStr(o.doc, "observations.doc");
  if (docPath === "") {
    bad("观察口径", "observations.doc 为空，采集无处落盘");
    return;
  }
  const full = join(TOP, docPath);
  if (!existsSync(full)) {
    bad("观察口径", `observations.doc 指向的文件不存在：${docPath}（采集 --append 会失败）`);
    return;
  }

  const metricKeys = (v: YamlValue | undefined, ctx: string): string[] => {
    if (v === undefined) return [];
    return asList(v, ctx).map((item) => {
      const m = asMap(item, ctx);
      const key = asStr(m.key, `${ctx}[].key`);
      if (!ids.has(key)) bad("观察口径", `${ctx} 引用了不存在的门 ${key}`);
      return key;
    });
  };
  const upg = metricKeys(o.upgrade_candidates, "observations.upgrade_candidates");
  const ref = metricKeys(o.reference, "observations.reference");
  if (upg.length === 0) bad("观察口径", "upgrade_candidates 为空 —— 没有观察对象的采集没有意义");

  // 表头比对：定位 `## 2 采集记录` 段里的第一行表格
  const text = readFileSync(full, "utf8");
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^## 2 /.test(l));
  if (start < 0) {
    bad("观察口径", `${docPath} 里找不到「## 2 采集记录」段（采集行无处插入）`);
    return;
  }
  const header = lines.slice(start).find((l) => l.startsWith("|"));
  if (header === undefined) {
    bad("观察口径", `${docPath} 的「## 2 采集记录」段里没有表格`);
    return;
  }
  const cols = header
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim().replace(/\*$/, "")); // `R16*` 的星号是脚注标记，不参与比较

  const expected = ["采集时间", "范围", "commits", ...upg, ...ref, "Micro-exempt", "UI_GATE=off"];
  if (cols.join("\u0000") === expected.join("\u0000")) {
    ok("观察日志表头对齐", `${cols.length} 列，与 observations 声明同序`);
    return;
  }
  bad(
    "观察口径",
    `日志表头与 observations 声明不一致 —— 实得 [${cols.join(" | ")}]，应为 [${expected.join(" | ")}]`,
  );
}

function main(): number {
  let raw: string;
  try {
    raw = readFileSync(GATES_YAML, "utf8");
  } catch {
    process.stderr.write(`读不到 ${GATES_YAML}\n`);
    return 2;
  }

  let root: YamlValue;
  try {
    root = parseYaml(raw, "gates.yaml");
  } catch (e) {
    if (e instanceof YamlError) {
      process.stdout.write(`✗ YAML 解析失败\n  ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  const doc = asMap(root, "顶层");
  const gateSrc = readFileSync(GATE_TS, "utf8");
  /** 档位声明（门循环里收集，接线检查在扫过 bash/ts 源码之后做） */
  const switches: Array<{ key: string; env: string; modes: string[] }> = [];

  // ---------- ① 结构 ----------
  const schema = asStr(doc.schema, "schema");
  if (schema !== "gate-spec/v1") bad("结构", `schema 应为 gate-spec/v1，实际 ${schema}`);
  const status = asStr(doc.status, "status");
  specStatus = status;
  const meta = asMap(doc.meta, "meta");
  if (status === "declared") {
    if (asStr(meta.authority, "meta.authority") !== "bash") {
      bad("结构", "status=declared 时权威必须是 bash（声明阶段不许出现两个权威）");
    } else {
      ok("权威声明一致", "status=declared → 权威为 bash");
    }
  } else if (status === "enforcing") {
    if (asStr(meta.authority, "meta.authority") !== "gate.ts") {
      bad("结构", "status=enforcing 时 meta.authority 必须是 gate.ts（切主后 bash 不再是权威）");
    } else {
      ok("权威声明一致", "status=enforcing → 权威为 gate.ts");
    }
    checkMainChain();
  } else {
    bad("结构", `status 只能是 declared / enforcing，实际 ${status}`);
  }
  if (asStr(doc.owner, "owner") === "") bad("结构", "缺 owner（没有归属的门不会有人管退场）");

  const conventions = asMap(doc.conventions, "conventions");
  const stages = asList(conventions.stages, "conventions.stages").map((s) => asStr(s, "stage"));
  const levels = asList(conventions.levels ? Object.keys(asMap(conventions.levels, "levels")) : [], "levels");
  for (const l of levels) if (!LEVELS.includes(l)) bad("结构", `conventions.levels 出现未知级别 ${l}`);

  // 豁免机制
  const exemption = asMap(doc.exemption, "exemption");
  const eligible = asList(exemption.eligible_gates, "exemption.eligible_gates").map((s) => asStr(s, "gate"));
  const ineligible = asList(exemption.ineligible_gates, "exemption.ineligible_gates").map((s) => asStr(s, "gate"));
  const q = asMap(exemption.quality, "exemption.quality");
  const minReason = q.min_reason_chars;
  if (typeof minReason !== "number" || minReason <= 0) bad("结构", "exemption.quality.min_reason_chars 应为正整数");
  const strictFrom = q.strict_from;
  if (typeof strictFrom !== "number") bad("结构", "exemption.quality.strict_from 应为 unix 时间戳");
  else ok("豁免质量门生效日", new Date(strictFrom * 1000).toISOString());

  // 触发面 scope 名
  const scopesRaw = asMap(doc.scopes, "scopes");
  const scopeNames = Object.keys(scopesRaw);
  const scopeIncludes = new Map<string, string[]>();
  for (const name of scopeNames) {
    const m = asMap(scopesRaw[name], `scopes.${name}`);
    const inc = asList(m.include, `scopes.${name}.include`).map((s) => asStr(s, `scopes.${name}.include`));
    if (inc.length === 0) bad("结构", `scopes.${name}.include 为空`);
    scopeIncludes.set(name, inc);
  }

  // ---------- 门清单 ----------
  const gatesRaw = asList(doc.gates, "gates");
  const ids = new Map<string, YamlMap[]>();
  for (const g of gatesRaw) {
    const gm = asMap(g, "gates[]");
    const id = asStr(gm.id, "gates[].id");
    const sub = gm.sub === null ? null : asStr(gm.sub, `gates[${id}].sub`);
    const key = sub === null ? id : `${id} / ${sub}`;

    if (!/^R\d+[a-z]?$/.test(id)) bad("结构", `${key}: id 形态应为 R<数字>[a-z]?`);
    if (!LEVELS.includes(asStr(gm.level, `${key}.level`))) bad("结构", `${key}: level 非法（${String(gm.level)}）`);
    const stage = asStr(gm.stage, `${key}.stage`);
    if (!stages.includes(stage)) bad("结构", `${key}: stage 非法（${stage}）`);
    const batch = String(gm.batch);
    if (!BATCHES.includes(batch)) bad("结构", `${key}: batch 非法（${batch}）`);
    if (asStr(gm.title, `${key}.title`) === "") bad("结构", `${key}: 缺 title`);
    if (asStr(gm.message, `${key}.message`) === "") bad("结构", `${key}: 缺 message（没有文案就无法复现输出）`);
    if (asStr(gm.spec_ref, `${key}.spec_ref`) === "") bad("结构", `${key}: 缺 spec_ref`);

    // 豁免声明 vs 两个清单
    const exemptVal = gm.exempt;
    if (typeof exemptVal !== "boolean") bad("结构", `${key}: exempt 应为布尔`);
    else if (exemptVal && !eligible.includes(id)) bad("接线", `${key}: 声明可豁免，但不在 exemption.eligible_gates`);
    else if (!exemptVal && eligible.includes(id)) bad("接线", `${key}: 声明不可豁免，却在 exemption.eligible_gates`);
    if (ineligible.includes(id) && exemptVal === true) bad("接线", `${key}: 同时在 eligible 语义下声明可豁免`);

    // credential 结构
    if (gm.credential !== null) {
      const c = asMap(gm.credential, `${key}.credential`);
      const trailer = asStr(c.trailer, `${key}.credential.trailer`);
      if (trailer === "") bad("结构", `${key}: credential 缺 trailer`);
      const acc = asList(c.accept, `${key}.credential.accept`).map((s) => asStr(s, "accept"));
      if (acc.length === 0) bad("结构", `${key}: credential.accept 为空`);
      for (const a of acc) if (!ACCEPTS.includes(a)) bad("结构", `${key}: credential.accept 出现未知取值 ${a}`);
    }

    // trigger 里引用的 scope 必须存在
    const trig = gm.trigger === null ? null : asMap(gm.trigger, `${key}.trigger`);
    if (trig) {
      const walk = (v: YamlValue, path: string): void => {
        if (Array.isArray(v)) {
          v.forEach((it, i) => walk(it, `${path}[${i}]`));
          return;
        }
        if (v === null || typeof v !== "object") return;
        for (const [k, val] of Object.entries(v)) {
          if (k === "scope" || k === "range_contains_scope") {
            const name = asStr(val, `${key}.${path}.${k}`);
            if (!scopeNames.includes(name)) bad("结构", `${key}: trigger 引用了不存在的 scope「${name}」`);
          }
          if (k === "exclude_scopes") {
            for (const name of asList(val, `${key}.exclude_scopes`).map((s) => asStr(s, "scope"))) {
              if (!scopeNames.includes(name)) bad("结构", `${key}: exclude_scopes 引用了不存在的 scope「${name}」`);
            }
          }
          walk(val, `${path}.${k}`);
        }
      };
      walk(trig, "trigger");
    }

    // 档位开关：声明了就必须能被引擎求值（#8602 —— 声明四档、引擎只读写死的 level）
    if (gm.level_switch !== undefined && gm.level_switch !== null) {
      const ls = asMap(gm.level_switch, `${key}.level_switch`);
      const env = asStr(ls.env, `${key}.level_switch.env`);
      if (env === "") bad("结构", `${key}: level_switch.env 为空`);
      const vals = asMap(ls.values, `${key}.level_switch.values`);
      const modes = Object.keys(vals);
      if (modes.length === 0) bad("结构", `${key}: level_switch.values 为空（开关没有任何档位）`);
      const dflt = asStr(ls.default, `${key}.level_switch.default`);
      if (!modes.includes(dflt)) {
        bad("结构", `${key}: level_switch.default「${dflt}」不在 values（${modes.join("/")}）—— 默认值取不到就是静默降级`);
      }
      for (const mode of modes) {
        const mv = asMap(vals[mode], `${key}.level_switch.values.${mode}`);
        const action = mv.action === undefined ? null : asStr(mv.action, `${key}: ${mode}.action`);
        const level = mv.level === undefined ? null : asStr(mv.level, `${key}: ${mode}.level`);
        if (action === null && level === null) bad("结构", `${key}: 档位 ${mode} 既没有 action 也没有 level —— 该档位没有行为`);
        if (action !== null && level !== null) bad("结构", `${key}: 档位 ${mode} 同时声明 action 与 level（二选一）`);
        if (action !== null && !ACTIONS.includes(action)) bad("结构", `${key}: 档位 ${mode} 的 action 非法（${action}）`);
        if (level !== null && !LEVELS.includes(level)) bad("结构", `${key}: 档位 ${mode} 的 level 非法（${level}）`);
        const scopeEnv = mv.scope_env === undefined ? null : asStr(mv.scope_env, `${key}: ${mode}.scope_env`);
        if (scopeEnv !== null) {
          if (level === null) bad("结构", `${key}: 档位 ${mode} 有 scope_env 却没有 level（分级无落点）`);
          const sk = mv.scope_key === undefined ? "" : asStr(mv.scope_key, `${key}: ${mode}.scope_key`);
          if (!SCOPE_KEYS.includes(sk)) bad("结构", `${key}: 档位 ${mode} 的 scope_key 非法（${sk}；可选 ${SCOPE_KEYS.join("/")}）`);
          const se = mv.scope_escalate === undefined ? "" : asStr(mv.scope_escalate, `${key}: ${mode}.scope_escalate`);
          if (!LEVELS.includes(se)) bad("结构", `${key}: 档位 ${mode} 的 scope_escalate 非法（${se}）`);
        }
      }
      if (ls.skip_scan_modes !== undefined) {
        for (const sm of asList(ls.skip_scan_modes, `${key}.level_switch.skip_scan_modes`).map((s) => asStr(s, "scan_mode"))) {
          if (!SCAN_MODES.includes(sm)) bad("结构", `${key}: skip_scan_modes 出现未知扫描模式 ${sm}`);
        }
      }
      if (env !== "" && modes.length > 0) switches.push({ key, env, modes });
    }

    // 委派门的输出排版：声明了就必须被引擎读取，且只对 delegated 门有意义
    if (gm.delegate_render !== undefined && gm.delegate_render !== null) {
      const rd = asStr(gm.delegate_render, `${key}.delegate_render`);
      if (!RENDERS.includes(rd)) bad("结构", `${key}: delegate_render 非法（${rd}；可选 ${RENDERS.join("/")}）`);
      else if (stage !== "delegated") bad("结构", `${key}: delegate_render 只对 stage=delegated 有意义`);
      else if (!gateSrc.includes("delegate_render")) bad("接线", `${key}: 声明了 delegate_render，gate.ts 却没读它`);
    }

    const arr = ids.get(id) ?? [];
    arr.push(gm);
    ids.set(id, arr);
  }
  if (failures.filter((f) => f.kind === "结构").length === 0) {
    ok("结构校验", `${gatesRaw.length} 个门条目 / ${ids.size} 个门号 / ${scopeNames.length} 个触发面`);
  }

  // 同号必须用 sub 区分（一号两义的根治手段）
  for (const [id, list] of ids) {
    if (list.length > 1) {
      const subs = list.map((g) => (g.sub === null ? "<null>" : String(g.sub)));
      if (subs.some((s) => s === "<null>")) {
        bad("结构", `${id} 有多条定义但存在 sub=null —— 同号多义必须用 sub 拆开并把 sub 加进报错文案`);
      } else {
        ok(`${id} 一号多义已拆`, subs.join(" / "));
      }
    }
  }

  // ---------- ② YAML 内部自洽（S5 删掉 legacy bash 后唯一的静态对照物） ----------
  // 🔴 这一节必须写明「删 bash 丢了什么」，否则下一个人会把「lint 全绿」理解成切主前的意思：
  //   切主前的 ② 是「YAML 的 glob ↔ bash 的 case 分支逐个相等」。bash 是**独立实现**，
  //   所以它能抓到「改了 YAML 忘了改代码」。
  //   bash 删掉后这个对照物不存在了。现在的 ② 只能保证 YAML **自己说得通**：
  //   没有死配置、引用不悬空、两侧说的是同一批门。这类错是**更弱**的一档 ——
  //   「YAML 写了、gate.ts 没读」它抓不到。那一类交给：
  //     · mutation-gen.ts 的字段审计（列出「没有变异器」的字段 = 没测过）
  //     · 黄金用例（真跑引擎，不读源码猜）
  //   这不是等价替换。写在这里是为了别让人误以为保证等级没变。

  // ②-a 档位开关：gate.ts 必须真的读 level_switch（否则声明即空文，#8602 的前半因）
  for (const sw of switches) {
    if (sw.modes.length === 0) bad("结构", `${sw.key}: level_switch.values 为空（没有合法档位）`);
  }
  if (switches.length > 0) {
    if (!gateSrc.includes("level_switch")) {
      bad("接线", `gates.yaml 有 ${switches.length} 处 level_switch 声明，但 gate.ts 从不读它 —— strict/scoped 会被静默降级成写死的 level`);
    } else {
      ok("档位开关接线", `${switches.length} 处声明，gate.ts 已读`);
    }
  }

  // ②-b scope 双向引用闭合：
  //   门引用不存在的 scope → 该门会静默不触发（最坏的错：门在，但从不响）
  //   声明了没人用的 scope → 死配置（改了以为生效，其实没门读）
  const usedScopes = new Set<string>();
  // 「被引用」按名字收集：门的任意字段值只要**恰好等于**某个声明过的 scope 名，就算引用。
  // 为什么不做字段白名单：scope 会被 trigger.scope / exclude_scopes / range_contains_scope /
  // conditions.* 等多处引用，白名单每加一种写法就要改一次 lint —— 那本身又是一个漂移源。
  const collectRefs = (v: YamlValue): void => {
    if (typeof v === "string") {
      if (scopeIncludes.has(v)) usedScopes.add(v);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) collectRefs(x);
      return;
    }
    if (v !== null && typeof v === "object") {
      for (const x of Object.values(v as YamlMap)) collectRefs(x);
    }
  };
  for (const g of gatesRaw) {
    const gm = asMap(g, "gates[]");
    collectRefs(gm);
    // 反方向（引用了不存在的 scope）只能查显式字段：拼错的名字没法按名字匹配发现，
    // 但「门声明了 scope: xxx 而 xxx 不存在」是可以确定的死门 —— 它永远不会触发。
    const trig = gm.trigger;
    if (trig === null || trig === undefined || typeof trig !== "object" || Array.isArray(trig)) continue;
    for (const field of ["scope", "exclude_scopes", "range_contains_scope"]) {
      const v = (trig as YamlMap)[field];
      const list: string[] =
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : [];
      for (const sc of list) {
        if (!scopeIncludes.has(sc)) bad("结构", `${String(gm.id)}: trigger.${field} 引用了不存在的 scope「${sc}」`);
      }
    }
  }
  for (const name of scopeNames) {
    if (!usedScopes.has(name)) bad("结构", `scopes.${name} 声明了但没有任何门引用 —— 死配置，改了不会生效`);
  }
  if (scopeNames.length > 0) {
    ok("scope 引用闭合", `${scopeNames.length} 个 scope 均被门引用；门引用的 scope 均存在`);
  }

  // ②-c 豁免：eligible_gates 与门上的 exempt: true 必须逐一对齐（双向）
  //   切主前这条靠 grep bash 里的接线代码，只能证明「某处出现过这个字符串」；
  //   对齐能证明两侧说的是同一批门 —— 删 bash 之后这里反而更硬了。
  const exemptTrue = new Set<string>();
  for (const g of gatesRaw) {
    const gm = asMap(g, "gates[]");
    if (gm.exempt === true) exemptTrue.add(asStr(gm.id, "id"));
  }
  const eligibleSet = new Set(eligible);
  for (const id of eligibleSet) {
    if (!exemptTrue.has(id)) bad("接线", `${id} 在 exemption.eligible_gates 里，但门上写的是 exempt: false —— 豁免永远不会生效`);
  }
  for (const id of exemptTrue) {
    if (!eligibleSet.has(id)) bad("接线", `${id} 声明 exempt: true，但不在 exemption.eligible_gates 里 —— 同一件事两个说法`);
    if (ineligible.includes(id)) bad("接线", `${id} 同时出现在 eligible_gates 与 ineligible_gates`);
  }
  if (eligibleSet.size > 0) ok("豁免接线", `${eligibleSet.size} 道可豁免门与 exempt: true 逐一对齐`);

  // ②-d commit-msg 阶段的门清单（local_commit_msg）
  //   这一份清单决定「本地 commit 前判哪几道门」。它写错的两种形态都是静默的：
  //   写成不存在的门 → gate.ts 报错退出（还算响）；漏写 → 本地少判一门，只有 CI 兜。
  const lcm = doc.local_commit_msg === undefined || doc.local_commit_msg === null ? null : asMap(doc.local_commit_msg, "local_commit_msg");
  if (lcm === null) {
    bad("结构", "缺 local_commit_msg.gates —— commit-msg 钩子会在没有声明的情况下判门");
  } else {
    const lcmGates = asList(lcm.gates, "local_commit_msg.gates").map((x) => asStr(x, "local_commit_msg.gates[]"));
    if (lcmGates.length === 0) bad("结构", "local_commit_msg.gates 为空 —— commit-msg 阶段等于不判任何门");
    for (const id of lcmGates) {
      if (!ids.has(id)) bad("结构", `local_commit_msg.gates 引用了不存在的门 ${id}`);
    }
    const hookSrc = safeRead(join(TOP, ".githooks", "commit-msg"));
    if (hookSrc === null) {
      bad("接线", "读不到 .githooks/commit-msg（S5 之后它必须存在并调 gate.ts commit-msg）");
    } else {
      // 只查非注释行：新钩子的注释里写着「check-commit-msg.sh 已删除」，
      // 整文件 grep 会把这句说明当成调用（实测踩到）。
      const hookCode = hookSrc
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      if (hookCode.includes("check-commit-msg.sh")) {
        bad("接线", ".githooks/commit-msg 仍在调已删除的 check-commit-msg.sh");
      }
      if (!/gate\.ts"?\s+commit-msg/.test(hookSrc) && !hookSrc.includes("commit-msg \"$1\"")) {
        bad("接线", ".githooks/commit-msg 没有调 gate.ts commit-msg —— 本地凭证门形同虚设");
      } else if (lcmGates.length > 0) {
        ok("commit-msg 接线", `${lcmGates.length} 道门在 commit 前判（${lcmGates.join(" / ")}）`);
      }
    }
  }

  // ---------- ③ 黄金用例覆盖 ----------
  const scenarioIds = new Set<string>();
  for (const line of readFileSync(SCENARIOS, "utf8").split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    scenarioIds.add(t.split("\t")[0]);
  }
  const uncovered = doc.uncovered === undefined ? [] : asList(doc.uncovered, "uncovered");
  const uncoveredKeys = new Set<string>();
  for (const u of uncovered) {
    const um = asMap(u, "uncovered[]");
    const gateId = asStr(um.gate, "uncovered[].gate");
    const sub = um.sub === undefined || um.sub === null ? null : asStr(um.sub, "uncovered[].sub");
    if (!ids.has(gateId)) bad("用例", `uncovered 里出现了不存在的门 ${gateId}`);
    const reason = asStr(um.reason, "uncovered[].reason");
    if (reason === "") bad("用例", `${gateId}: uncovered 必须写原因（写「暂时没空」也算原因，留空不行）`);
    uncoveredKeys.add(sub === null ? gateId : `${gateId} / ${sub}`);
  }

  const referenced = new Set<string>();
  let gateWithEvidence = 0;
  for (const g of gatesRaw) {
    const gm = asMap(g, "gates[]");
    const id = asStr(gm.id, "id");
    const sub = gm.sub === null ? null : asStr(gm.sub, "sub");
    const key = sub === null ? id : `${id} / ${sub}`;
    const ev = gm.evidence === undefined ? [] : asList(gm.evidence, `${key}.evidence`).map((s) => asStr(s, "evidence"));
    let real = 0;
    for (const e of ev) {
      if (!scenarioIds.has(e)) {
        bad("用例", `${key}: evidence「${e}」在 scenarios.tsv 里不存在`);
        continue;
      }
      referenced.add(e);
      real++;
    }
    // evidence_external：覆盖在专用测试脚本里的门（如 R6 的 changed-packages.sh、
    // R11b/R16 的 python 委派门 —— scenarios.tsv 没有环境变量列 / 临时仓缺 python 脚本，
    // 驱动不了它们，只能走 test-*.sh）。脚本必须真实存在且可执行，不许空挂。
    const ext =
      gm.evidence_external === undefined
        ? []
        : asList(gm.evidence_external, `${key}.evidence_external`).map((s) => asStr(s, "evidence_external"));
    for (const p of ext) {
      if (!existsSync(join(TOP, p))) {
        bad("用例", `${key}: evidence_external「${p}」不存在 —— 挂一个不存在的脚本等于没覆盖`);
      }
    }
    if (real > 0 || ext.length > 0) {
      gateWithEvidence++;
      // 既有用例又挂 uncovered = 条目已过时（曾真实发生：#636 探针恢复误回滚，
      // 4 条已覆盖门在 uncovered 里又躺了一天）。不拦，后来人会把「已覆盖」读成「没覆盖」。
      if (uncoveredKeys.has(key)) {
        bad("用例", `${key}: 已有用例却仍在 uncovered 清单里 —— 删掉那条过时登记`);
      }
    } else if (!uncoveredKeys.has(key)) {
      bad("用例", `${key}: 既没有黄金用例，也没有 evidence_external，也不在 uncovered 清单里 —— 空着的门等于没被验证过`);
    }
    void gm;
  }

  // 反过来：每个场景都要有人认领，否则是没人维护的孤儿用例
  const harness = doc.harness_evidence === undefined ? [] : asList(doc.harness_evidence, "harness_evidence");
  for (const h of harness) {
    const hm = asMap(h, "harness_evidence[]");
    const hid = asStr(hm.id, "harness_evidence[].id");
    if (!scenarioIds.has(hid)) bad("用例", `harness_evidence「${hid}」在 scenarios.tsv 里不存在`);
    else referenced.add(hid);
  }
  const orphans = [...scenarioIds].filter((s) => !referenced.has(s));
  if (orphans.length > 0) bad("用例", `scenarios.tsv 里这些场景没有任何门认领: ${orphans.join(", ")}`);
  ok(
    "黄金用例覆盖",
    `${scenarioIds.size} 个场景 / ${gateWithEvidence} 个门条目有用例 / ${uncovered.length} 条明确记录未覆盖`,
  );

  // ---------- ④ 文档引用与分歧登记 ----------
  for (const g of gatesRaw) {
    const gm = asMap(g, "gates[]");
    const id = asStr(gm.id, "id");
    const ref = asStr(gm.spec_ref, `${id}.spec_ref`);
    if (ref === "") continue;
    const r = resolveSpecRef(ref);
    if (!r.external && !r.exists) bad("文档", `${id}: spec_ref 指向的文件不存在（${ref}）`);
  }
  ok("spec_ref 存在性", "仓库内引用已校验；仓外引用（~/ 或绝对路径）不阻断 CI");

  const divergences = doc.known_divergences === undefined ? [] : asList(doc.known_divergences, "known_divergences");
  let divergenceOk = 0;
  for (const d of divergences) {
    const dm = asMap(d, "known_divergences[]");
    const did = asStr(dm.id, "known_divergences[].id");
    const gates = asList(dm.gates, `${did}.gates`).map((s) => asStr(s, "gate"));
    for (const gid of gates) if (!ids.has(gid)) bad("分歧", `${did}: 引用了不存在的门 ${gid}`);
    const ledger = dm.ledger;
    if (typeof ledger !== "number") bad("分歧", `${did}: 缺台账号 —— 没有台账号的分歧等于没人管`);
    const ev = asList(dm.evidence, `${did}.evidence`).map((s) => asStr(s, "evidence"));
    for (const e of ev) if (!scenarioIds.has(e)) bad("分歧", `${did}: evidence「${e}」不存在`);
    if ((dm.status as YamlValue) === null) bad("分歧", `${did}: 缺 status（待拍板 / 待定 / 已修）`);
    divergenceOk++;
  }
  ok("已知分歧登记", `${divergenceOk} 条，均带台账号`);

  // ---------- ⑤ 生成物与观察口径（S4）----------
  checkGeneratedDocs();
  checkObservations(doc, ids);

  // ---------- 汇报 ----------
  const out: string[] = [];  for (const p of passes) out.push(`  ✓ ${p}`);
  if (notes.length > 0) {
    out.push("");
    for (const n of notes) out.push(`  · ${n}`);
  }
  if (failures.length > 0) {
    out.push("");
    out.push(`✗ ${failures.length} 项失败`);
    for (const f of failures) out.push(`  [${f.kind}] ${f.detail}`);
    process.stdout.write(`gates.yaml 自检\n\n${out.join("\n")}\n`);
    return 1;
  }
  process.stdout.write(`gates.yaml 自检 · 全部通过\n\n${out.join("\n")}\n`);
  return 0;
}

process.exit(main());
