/**
 * mutation-gen.ts — 生成式判据变异（S4 第 4 项）
 *
 * 用法：
 *   node scripts/redline/mutation-gen.ts            跑全部变异
 *   node scripts/redline/mutation-gen.ts --filter R2  只跑门号含 R2 的
 *   node scripts/redline/mutation-gen.ts --list     只列出会跑哪些变异（不执行）
 *
 * 它回答的问题只有一个：**gates.yaml 里写的每条判据，改坏了黄金集会红吗？**
 *
 * 🔴 为什么手写变异清单不够：
 *   手写清单（曾有一版 cases/mutation-yaml.sh，8 条）是「想起来才加」的精选，覆盖不了 28 个门条目。
 *   手写清单永远落后于门表 —— 新加一道门、加一个判据字段，没人想起来补变异，
 *   这条判据就没人验证过。生成式的做法是：**遍历门表 × 字段类型**，一个不漏。
 *
 * 🔴 为什么判定要跟 expected 逐字节比，而不是只看 exit code：
 *   很多用例本来就是「红的」（阳性用例预期 exit=1）。变异后仍然 exit=1，看退出码
 *   完全分不出「判据坏了」还是「本来就这样」。必须比输出内容 —— 少报一条、loc 变了、
 *   文案变了，都是行为变化。
 *
 * 🔴 为什么要 --work 复用夹具：
 *   夹具构造 14s，直接调 gate.ts 只要 0.2s。不复用的话 50+ 个变异要 10 分钟，
 *   慢到没人会跑第二次；一个「跑不动的检查」等于不存在。
 *
 * 退出码：0=全部变异都被捕获 1=有变异未被捕获（判据或用例有缺口） 2=环境问题
 *
 * 🔴 已知盲区（不是遗漏，是这类判据天然不在 YAML 里）：
 *   R19「空提交」、R21「旧格式豁免解析」等门的判定逻辑在 gate.ts 代码里，YAML 只声明
 *   「这扇门存在」。变异 YAML 只能验「声明的参数有没有被用例盯着」，验不到
 *   「代码实现是否符合预期」—— 后者只能靠黄金用例的期望值本身是否写对。
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml, YamlError } from "./lib/yaml-mini.ts";
import type { YamlMap, YamlValue } from "./lib/yaml-mini.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOP = resolve(HERE, "../..");
const GATES_YAML = join(HERE, "gates.yaml");
const CASES_DIR = join(HERE, "cases");
const SCENARIOS = join(CASES_DIR, "scenarios.tsv");
const GATE = join(HERE, "gate.ts");
const RUN_SH = join(CASES_DIR, "run.sh");
/**
 * 已知缺口基线。
 *
 * 为什么需要它：第一次全量跑出 38 个未捕获（用例没覆盖到的判据分支）。让 CI 直接红
 * 等于把整条流水线钉死 —— 而「全红」的结果是没人看，跟不跑一样。
 *
 * baseline 的作用是把「存量缺口」与「新引入的缺口」分开：
 *   · 在 baseline 里 → 已知，列出但不阻断（这是技术债清单，不是许可）
 *   · 不在 baseline 里 → 新缺口，立刻红
 *   · 已捕获却还在 baseline 里 → 提示移除（防止修好了没人摘，基线永久腐化）
 */
const BASELINE = join(CASES_DIR, "mutation-baseline.tsv");

interface Gate {
  id: string;
  sub: string | null;
  key: string;
  level: string;
  evidence: string[];
  /** 该门里所有「判据类」字段的点分路径（trigger.* / credential.* / level / exempt） */
  judgmentFields: string[];
  /** 在 gates.yaml 原文里的字符区间 [start, end) */
  start: number;
  end: number;
}

interface Scenario {
  id: string;
  mode: string;
  args: string;
  desc: string;
}

interface Mutator {
  name: string;
  /** 它能变异的判据字段（用于反查「哪些字段根本没有变异器」） */
  covers: string[];
  applies: (g: Gate) => boolean;
  /** 输入门块原文，返回变异后的门块；null = 这个门的写法不适用 */
  apply: (block: string) => string | null;
}

// ------------------------------------------------------------
// 读 YAML 与门块定位
// ------------------------------------------------------------

function asMap(v: YamlValue | undefined, ctx: string): YamlMap {
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) throw new Error(`${ctx} 应为映射`);
  return v;
}

function str(v: YamlValue | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * 非判据字段：写给人看的说明，或执行方式的元数据。
 * 它们改坏了不影响「报不报」，所以不需要变异器 —— 列进审计清单只会制造噪音。
 */
const NON_JUDGMENT = new Set([
  "title",
  "stage",
  "batch",
  "message",
  "hint",
  "spec_ref",
  "owner",
  "validity",
  "evidence",
  "evidence_note",
  "message_report_missing",
  "message_blocking",
  "exempt_note",
  "branches_note",
  "also_enforced_in",
  "note",
  "exclude_reason",
  "delegate_render",
]);

function collectJudgmentFields(trigger: YamlMap, credential: YamlMap | null): string[] {
  const out: string[] = ["level", "exempt"];
  const walk = (obj: YamlMap, prefix: string, depth: number): void => {
    if (depth > 2) return;
    for (const [k, v] of Object.entries(obj)) {
      // `*_note` 一律是写给人看的解释（为什么这么判、踩过什么坑），不是判据
      if (NON_JUDGMENT.has(k) || k.endsWith("_note")) continue;
      const path = prefix + k;
      out.push(path);
      if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        walk(v as YamlMap, `${path}.`, depth + 1);
      }
    }
  };
  walk(trigger, "trigger.", 0);
  if (credential !== null) walk(credential, "credential.", 0);
  return out;
}

/**
 * 用「原文位置」而不是重新序列化 YAML 来定位与改写。
 *
 * 为什么：gates.yaml 里大量注释承载着「为什么这么判」的原因（踩过的坑），
 * 序列化回去会把它们全部丢掉 —— 那份注释比字段值更值钱。
 */
function loadGates(src: string): Gate[] {
  const doc = asMap(parseYaml(src, "gates.yaml"), "顶层");
  const raw = doc.gates;
  if (!Array.isArray(raw)) throw new Error("gates 应为列表");

  const out: Gate[] = [];
  let cursor = 0;
  for (const item of raw) {
    const m = asMap(item, "gates[]");
    const id = str(m.id);
    const sub = m.sub === null || m.sub === undefined ? null : str(m.sub);
    // 定位该门块：从 `  - id: <id>` 到下一个 `  - id: ` 之前
    const marker = `  - id: ${id}\n`;
    const start = src.indexOf(marker, cursor);
    if (start < 0) throw new Error(`定位不到门块 ${id}`);
    const next = src.indexOf("\n  - id: ", start + marker.length);
    const end = next < 0 ? src.length : next + 1;
    cursor = start + marker.length;
    out.push({
      id,
      sub,
      key: sub ?? id,
      level: str(m.level),
      evidence: Array.isArray(m.evidence) ? m.evidence.map((e) => str(e)) : [],
      judgmentFields: collectJudgmentFields(
        m.trigger !== null && typeof m.trigger === "object" && !Array.isArray(m.trigger) ? (m.trigger as YamlMap) : {},
        m.credential !== null && typeof m.credential === "object" && !Array.isArray(m.credential)
          ? (m.credential as YamlMap)
          : null,
      ),
      start,
      end,
    });
  }
  return out;
}

// ------------------------------------------------------------
// 变异器：按字段类型穷举，不按门号手写
// ------------------------------------------------------------

function replaceOnce(block: string, from: string, to: string): string | null {
  const i = block.indexOf(from);
  if (i < 0) return null;
  return block.slice(0, i) + to + block.slice(i + from.length);
}

const MUTATORS: Mutator[] = [
  {
    name: "level: error → notice",
    covers: ["level"],
    applies: (g) => g.level === "error",
    apply: (b) => replaceOnce(b, "    level: error\n", "    level: notice\n"),
  },
  {
    name: "credential.accept 去掉 path 分支",
    covers: ["credential.accept"],
    applies: (g) => g.level !== "",
    apply: (b) => replaceOnce(b, "accept: [pass, path]", "accept: [pass]"),
  },
  {
    name: "credential.checks 路径存在性改 false",
    covers: ["credential.checks"],
    applies: () => true,
    apply: (b) => replaceOnce(b, "- path_exists_in_commit_tree: true", "- path_exists_in_commit_tree: false"),
  },
  {
    name: "credential.checks 阻塞归零改 false",
    covers: ["credential.checks"],
    applies: () => true,
    apply: (b) => replaceOnce(b, "- report_header_blocking_zero: true", "- report_header_blocking_zero: false"),
  },
  {
    name: "trigger.threshold.lines 放大到 99999",
    covers: ["trigger.threshold.lines"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)lines: \d+$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)lines: \d+$/m, "$1lines: 99999");
    },
  },
  {
    name: "行级 trigger.match 改成永不命中",
    covers: ["trigger.match"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)match: '.*'$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)match: '.*'$/m, "$1match: 'zzz-never-hit-zzz'");
    },
  },
  {
    name: "路径 trigger.match_re 改成永不命中",
    covers: ["trigger.match_re"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)match_re: '.*'$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)match_re: '.*'$/m, "$1match_re: 'zzz-never-hit-zzz'");
    },
  },
  {
    name: "路径 trigger.match_path 改成永不命中",
    covers: ["trigger.match_path"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)match_path: '.*'$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)match_path: '.*'$/m, "$1match_path: 'zzz-never-hit-zzz'");
    },
  },
  {
    name: "exempt: true → false",
    covers: ["exempt"],
    applies: () => true,
    apply: (b) => replaceOnce(b, "    exempt: true\n", "    exempt: false\n"),
  },
  // ---- 高频判据字段：这几个字段覆盖面最广（scope 11 门 / trailer 8 门 / skip_comment_line 8 门），
  //      不补的话「44 个变异全绿」会让人以为门禁判据都被验证过了 ----
  {
    name: "trigger.scope 换成另一个合法 scope（匹配面变窄）",
    covers: ["trigger.scope"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)scope: (\w+)$/m.exec(b);
      if (m === null) return null;
      const other = m[2] === "ts_file" ? "code_file" : "ts_file";
      return b.replace(/^(\s+)scope: \w+$/m, `$1scope: ${other}`);
    },
  },
  {
    name: "credential.trailer 改名（凭证读不到）",
    covers: ["credential.trailer"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)trailer: (\w+)$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)trailer: \w+$/m, "$1trailer: ZzRenamedTrailer");
    },
  },
  {
    name: "trigger.skip_comment_line 反转",
    covers: ["trigger.skip_comment_line"],
    applies: () => true,
    apply: (b) => {
      if (b.includes("skip_comment_line: true")) return replaceOnce(b, "skip_comment_line: true", "skip_comment_line: false");
      if (b.includes("skip_comment_line: false")) return replaceOnce(b, "skip_comment_line: false", "skip_comment_line: true");
      return null;
    },
  },
  {
    name: "trigger.match_any 改成永不命中",
    covers: ["trigger.match_any"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)match_any: \[.*\]$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)match_any: \[.*\]$/m, "$1match_any: [\"zzz-never-hit-zzz\"]");
    },
  },
  {
    name: "trigger.exclude_paths 排除全仓库",
    covers: ["trigger.exclude_paths"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)exclude_paths: \[.*\]$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)exclude_paths: \[.*\]$/m, '$1exclude_paths: ["*"]');
    },
  },
  {
    name: "trigger.status 换成不存在的状态字母",
    covers: ["trigger.status"],
    applies: () => true,
    apply: (b) => {
      const m = /^(\s+)status: \[.*\]$/m.exec(b);
      if (m === null) return null;
      return b.replace(/^(\s+)status: \[.*\]$/m, '$1status: ["X"]');
    },
  },
];

/**
 * 全局配置层变异（不属于任何单个门块，改的是 YAML 顶层的 `exemption:` 等横切配置）。
 *
 * 🔴 为什么单开一段而不是硬塞进门块循环：
 *   `exemption.quality.min_reason_chars` / `empty_values` 横跨 8 道门的豁免判定，
 *   它们不在 `gates[]` 里，门块切片碰不到，只能整文件替换（见 GLOBAL_MUTATIONS）。
 *
 * 🔴 为什么要「组合变异」（先降长度下限再清空白名单）：
 *   empty_values 里的词（yes / no / 无…）全都短于 min_reason_chars=10，所以「长度不足」
 *   永远先命中 —— 在当前配置下 empty_values 这条判据**根本触发不到**（配置层死判据）。
 *   只清空白名单不会有任何行为变化，会被误判成「缺口」；必须先解除遮蔽，它才成为唯一拦截者。
 *   这也顺带验证了「降低阈值时那条兜底判据仍然在岗」。
 */
interface GlobalMutation {
  name: string;
  /** 覆盖的全局配置字段（只用于审计展示，不进 triggers/credential 的字段审计） */
  covers: string[];
  /** 挂在哪个门的用例上判定（这些配置影响哪道门就用哪个门的 evidence） */
  gateKey: string;
  apply: (src: string) => string | null;
}

const GLOBAL_MUTATIONS: GlobalMutation[] = [
  {
    name: "exemption.quality.min_reason_chars 降到 1（理由长度底线失效）",
    covers: ["exemption.quality.min_reason_chars"],
    gateKey: "R20",
    apply: (s) => {
      const i = s.indexOf("    min_reason_chars: 10");
      if (i < 0) return null;
      return s.slice(0, i) + "    min_reason_chars: 1" + s.slice(i + "    min_reason_chars: 10".length);
    },
  },
  {
    name: "exemption.quality.empty_values 清空（先降长度下限到 2 解除遮蔽）",
    covers: ["exemption.quality.empty_values"],
    gateKey: "R20",
    apply: (s) => {
      // 顺序不能反：先降阈值，后面的清空才可能有可观测行为
      const i = s.indexOf("    min_reason_chars: 10");
      if (i < 0) return null;
      const lowered = s.slice(0, i) + "    min_reason_chars: 2" + s.slice(i + "    min_reason_chars: 10".length);
      const m = /^(\s+)empty_values: \[.*\]$/m.exec(lowered);
      if (m === null) return null;
      return lowered.replace(/^(\s+)empty_values: \[.*\]$/m, "$1empty_values: []");
    },
  },
];

// ------------------------------------------------------------
// 场景与夹具
// ------------------------------------------------------------

function readScenarios(): Scenario[] {
  return readFileSync(SCENARIOS, "utf8")
    .split("\n")
    .map((l) => l.replace(/^\uFEFF/, ""))
    .filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => {
      const [id, mode, args, desc] = l.split("\t");
      return { id, mode, args: args ?? "", desc: desc ?? "" };
    });
}

function readAliases(work: string): Map<string, string> {
  const p = join(work, ".aliases");
  if (!existsSync(p)) return new Map();
  const m = new Map<string, string>();
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const [name, sha] = line.trim().split(" ");
    if (name !== undefined && sha !== undefined && name !== "" && sha !== "") m.set(name, sha);
  }
  return m;
}

/**
 * 判据字段审计：报出「门表里有、但没有任何变异器」的字段。
 *
 * 🔴 这一段是防自欺的关键。44/44 全捕获很容易被读成「每条判据都验证过了」，
 *   实际只验证了变异器覆盖的那 8 类字段。剩下的字段（trigger.scope、exclude_paths、
 *   case_insensitive…）改坏了**没有任何检查会红** —— 那不是「已知缺失」，
 *   是「从来没测过」。不把它显式列出来，全绿就是一句误导性的话。
 */
function auditFields(gates: Gate[]): { uncovered: Array<[string, number]>; covered: string[] } {
  const covered = [...new Set(MUTATORS.flatMap((m) => m.covers))].sort();
  const owners = new Map<string, Set<string>>();
  for (const g of gates) {
    for (const f of g.judgmentFields) {
      if (!owners.has(f)) owners.set(f, new Set());
      owners.get(f)?.add(g.key);
    }
  }
  const uncovered: Array<[string, number]> = [];
  for (const [f, gs] of owners) {
    if (!covered.includes(f)) uncovered.push([f, gs.size]);
  }
  uncovered.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { uncovered, covered };
}

/** 场景参数里的 ${C_XXX} 占位展开成真实 sha（与 run.sh 的 eval 同义） */
function expandArgs(args: string, aliases: Map<string, string>): string {
  return args.replace(/\$\{(\w+)\}/g, (_, name: string) => aliases.get(name) ?? "");
}

/** 夹具仓库：没有就调 run.sh 造一份（借它的 fixture.sh，不重复实现） */
function ensureFixture(work: string): boolean {
  if (existsSync(join(work, ".aliases"))) return true;
  const r = spawnSync("bash", [RUN_SH, "--work", work, "--filter", "__bootstrap_never_matches__"], {
    cwd: TOP,
    encoding: "utf8",
  });
  return r.status === 0 && existsSync(join(work, ".aliases"));
}

/** 跑一个场景，返回归一化后的 stdout */
function runScenario(sc: Scenario, work: string, aliases: Map<string, string>): { stdout: string; code: number } {
  const args = expandArgs(sc.args, aliases).split(/\s+/).filter((a) => a !== "");
  const argv = [GATE, "--no-color", sc.mode, ...args];
  const r = spawnSync("node", argv, { cwd: work, encoding: "utf8" });
  return { stdout: normalize(r.stdout ?? "", work, aliases), code: r.status ?? -1 };
}

/**
 * 归一化：把夹具绝对路径与 commit sha 换成占位。
 * 与 fixture.sh 的 normalize_output 同义（那边用 sed，这边用 split/join —— 结果一致，
 * 区别是 JS 的 split/join 天然全局替换，不会像 sed 那样被特殊字符咬到）。
 */
function normalize(out: string, work: string, aliases: Map<string, string>): string {
  let s = out.split(work).join("<WORK>");
  for (const [name, sha] of aliases) s = s.split(sha).join(`<${name}>`);
  return s;
}

/** 读期望文件里的 stdout 段（格式：exit=/errors=/warnings=/--- stdout ---/…） */
function readExpected(scenarioId: string): { stdout: string; code: number } | null {
  const p = join(CASES_DIR, "expected", `${scenarioId}.txt`);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  const m = /^exit=(-?\d+)$/m.exec(text);
  const i = text.indexOf("--- stdout ---");
  const stdout = i < 0 ? "" : text.slice(i + "--- stdout ---".length).replace(/^\n/, "").replace(/\n$/, "");
  return { stdout, code: m === null ? 0 : Number(m[1]) };
}

// ------------------------------------------------------------
// 主流程
// ------------------------------------------------------------

interface PlanItem {
  gateKey: string;
  mutator: string;
  scenarios: Scenario[];
  /** 全文 → 变异后全文；null = 该变异对本仓库当前写法不适用 */
  mutate: (src: string) => string | null;
}

interface Result {
  gateKey: string;
  mutator: string;
  scenario: string;
  caught: boolean;
  /** 变异无效（引擎 exit=2）：YAML 被改坏或范围无效，不能算「捕获」 */
  invalid: boolean;
  reason: string;
}

function main(argv: string[]): number {
  const filterIdx = argv.indexOf("--filter");
  const filter = filterIdx >= 0 ? (argv[filterIdx + 1] ?? "") : "";
  const listOnly = argv.includes("--list");
  const work = process.env.GATE_MUTATION_WORK ?? "/tmp/gate-mutation-work";

  const src = readFileSync(GATES_YAML, "utf8");
  let gates: Gate[];
  try {
    gates = loadGates(src);
  } catch (e) {
    if (e instanceof YamlError) {
      process.stderr.write(`✗ gates.yaml 解析失败: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const scenarios = new Map(readScenarios().map((s) => [s.id, s]));

  // 先列出计划（--list 不执行，用来预估成本）
  //
  // 每个计划项的 mutate 收「全文 → 变异后全文」，把「门块切片」与「全局替换」两种
  // 变异方式统一成一种执行路径 —— 否则执行循环里要分叉两套还原逻辑，很容易漏还原。
  const plan: PlanItem[] = [];
  for (const g of gates) {
    // 🔴 必须精确匹配 id 或 key，不能用 includes：
    //    `--filter R1` 用 includes 会把 R10/R11/R13… 全部卷进来（实测 2 个变异变成 50 个），
    //    「我只想验这一道门」的意图完全失效，而被淹掉的恰好是这道门真正的问题。
    if (filter !== "" && g.id !== filter && g.key !== filter) continue;
    if (g.evidence.length === 0) continue; // 没有用例的门，变异了也无从判定 —— 归 uncovered，不在这里假装测过
    // 🔴 跑**该门全部**用例，不是只跑第一个：
    //    一道门常有多个用例覆盖不同分支（R1 有 console.log 阳性 + scripts/*.mjs 豁免阴性）。
    //    只跑第一个时，第二个分支上的缺口永远看不见 —— 实测 R1 就是这样漏掉 2 个真缺口。
    const scs = g.evidence
      .map((id) => scenarios.get(id))
      .filter((x): x is Scenario => x !== undefined);
    if (scs.length === 0) continue;
    const block = src.slice(g.start, g.end);
    for (const mu of MUTATORS) {
      if (!mu.applies(g)) continue;
      if (mu.apply(block) === null) continue; // 该门没这个字段
      plan.push({
        gateKey: g.key,
        mutator: mu.name,
        scenarios: scs,
        mutate: (s) => {
          const b = s.slice(g.start, g.end);
          const m = mu.apply(b);
          return m === null ? null : s.slice(0, g.start) + m + s.slice(g.end);
        },
      });
    }
  }
  // 全局配置层：挂到目标门的用例上判，--filter 时同样精确匹配
  for (const gm of GLOBAL_MUTATIONS) {
    if (filter !== "" && gm.gateKey !== filter) continue;
    const g = gates.find((x) => x.key === gm.gateKey || x.id === gm.gateKey);
    if (g === undefined) continue;
    const scs = g.evidence.map((id) => scenarios.get(id)).filter((x): x is Scenario => x !== undefined);
    if (scs.length === 0) continue;
    if (gm.apply(src) === null) continue; // 配置段写法变了，找不到锚点
    plan.push({ gateKey: gm.gateKey, mutator: gm.name, scenarios: scs, mutate: gm.apply });
  }

  const audit = auditFields(gates);

  if (listOnly) {
    process.stdout.write(`计划 ${plan.length} 个变异：\n`);
    for (const p of plan) {
      process.stdout.write(`  ${p.gateKey.padEnd(18)} ${p.mutator}  →  ${p.scenarios.map((x) => x.id).join(", ")}\n`);
    }
    const globalCovered = GLOBAL_MUTATIONS.flatMap((m) => m.covers);
    process.stdout.write(`\n门块变异器覆盖 ${audit.covered.length} 类字段：${audit.covered.join(", ")}\n`);
    if (globalCovered.length > 0) {
      process.stdout.write(`全局配置层另有 ${globalCovered.length} 类：${globalCovered.join(", ")}\n`);
    }
    if (audit.uncovered.length > 0) {
      process.stdout.write(`\n另有 ${audit.uncovered.length} 类判据字段没有变异器：\n`);
      for (const [f, n] of audit.uncovered) process.stdout.write(`  ${f.padEnd(30)} 出现在 ${n} 个门\n`);
    }
    return 0;
  }

  if (!ensureFixture(work)) {
    process.stderr.write(`✗ 夹具准备失败（${work}）—— 先手动跑一次 bash scripts/redline/cases/run.sh --work ${work}\n`);
    return 2;
  }
  const aliases = readAliases(work);

  const results: Result[] = [];
  const backup = src;

  try {
    for (const p of plan) {
      // 每次都从**原始** src 变异：还原是整文件覆盖，不存在累积漂移。
      const next = p.mutate(src);
      if (next === null) continue;
      writeFileSync(GATES_YAML, next, "utf8");

      // 跑该门全部用例：任一场景输出变了就算「捕获」。
      // 全都不变才叫「判据改坏了没人发现」—— 那是真缺口。
      let caught = false;
      let changedIn = "";
      let invalidReason = "";
      const missingExpected: string[] = [];
      for (const sc of p.scenarios) {
        const got = runScenario(sc, work, aliases);
        // 🔴 exit=2 = 引擎拒绝执行（YAML 解析失败 / 范围无效）。
        // 这时输出当然与期望不同，但那是「变异把配置改坏了」，不是「判据被用例盯着」。
        // 不排掉这一条，变异测试就会用一堆「YAML 写坏」刷出满屏绿色 —— 假捕获比不测更糟。
        if (got.code === 2) {
          invalidReason = `变异后引擎 exit=2（配置被改坏，不是判据失效）：${sc.id}`;
          break;
        }
        const exp = readExpected(sc.id);
        if (exp === null) {
          missingExpected.push(sc.id);
          continue;
        }
        // 🔴 比较前必须统一尾部换行：
        //    gate.ts 的 stdout 以换行结尾，而 readExpected 解析预期文件时去掉了尾部换行。
        //    两边不归一会导致「永远不相等」→ 每个变异都被算成捕获 → 满屏假绿。
        //    这个 bug 在 44 个变异「全捕获」时看起来一切正常，正是最危险的地方。
        const gotText = got.stdout.replace(/\n+$/, "");
        const expText = exp.stdout.replace(/\n+$/, "");
        if (gotText !== expText || got.code !== exp.code) {
          caught = true;
          changedIn = sc.id;
          break;
        }
      }

      writeFileSync(GATES_YAML, backup, "utf8");

      if (invalidReason !== "") {
        results.push({
          gateKey: p.gateKey,
          mutator: p.mutator,
          scenario: p.scenarios.map((x) => x.id).join(","),
          caught: false,
          invalid: true,
          reason: invalidReason,
        });
        continue;
      }
      if (missingExpected.length > 0 && !caught) {
        results.push({
          gateKey: p.gateKey,
          mutator: p.mutator,
          scenario: missingExpected.join(","),
          caught: false,
          invalid: true,
          reason: "缺期望文件",
        });
        continue;
      }
      results.push({
        gateKey: p.gateKey,
        mutator: p.mutator,
        scenario: caught ? changedIn : p.scenarios.map((x) => x.id).join(","),
        caught,
        invalid: false,
        reason: caught ? "" : "该门全部用例的输出都与期望一致（判据改坏了却没被发现）",
      });
    }
  } finally {
    // 无论如何都要还原：中途抛异常留下变异版 YAML，会让后续所有门禁按坏判据跑
    writeFileSync(GATES_YAML, backup, "utf8");
  }

  const caught = results.filter((r) => r.caught);
  const invalid = results.filter((r) => r.invalid);
  const missed = results.filter((r) => !r.caught && !r.invalid);

  const bkey = (r: Result): string => `${r.gateKey}\t${r.mutator}`;
  const baseline = new Set<string>();
  if (existsSync(BASELINE)) {
    for (const line of readFileSync(BASELINE, "utf8").split("\n")) {
      const t = line.trim();
      if (t !== "" && !t.startsWith("#")) baseline.add(t);
    }
  }
  const writeBaseline = argv.includes("--write-baseline");
  const newGaps = missed.filter((r) => !baseline.has(bkey(r)));
  const knownGaps = missed.filter((r) => baseline.has(bkey(r)));
  const staleBaseline = [...baseline].filter((k) => !missed.some((r) => bkey(r) === k));

  if (writeBaseline) {
    const lines = [
      "# 判据变异已知缺口基线（生成式变异测试的存量债）",
      "#",
      "# 每行 = 一个「判据改坏了但用例没发现」的组合：<门条目>\t<变异器名>",
      "# 这不是许可清单：补了用例就从这里删掉，mutation-gen 会提示哪些行已经可移除。",
      "# 重新生成：node scripts/redline/mutation-gen.ts --write-baseline",
      ...missed.map(bkey).sort(),
    ];
    writeFileSync(BASELINE, lines.join("\n") + "\n", "utf8");
    process.stdout.write(`已写入基线 ${missed.length} 条 → ${BASELINE}\n`);
    return 0;
  }

  process.stdout.write(
    `判据变异：${caught.length} 捕获 / ${missed.length} 未捕获 / ${invalid.length} 无效（共 ${results.length}）\n`,
  );

  if (invalid.length > 0) {
    process.stdout.write("\n无效变异清单（变异器写坏了 YAML，或该场景缺期望文件 —— 需人工修）：\n");
    for (const r of invalid) process.stdout.write(`  ⚠ ${r.gateKey.padEnd(18)} ${r.mutator}  ${r.reason}\n`);
  }

  // 🔴 无论下面什么结论，都把「没被任何变异器碰过的字段」摆出来 ——
  //    「44/44 全捕获」不等于「所有判据都验证过了」，只等于「变异器覆盖的那几类验证过了」。
  if (audit.uncovered.length > 0) {
    process.stdout.write(
      `\n⚠ 变异器只覆盖 ${audit.covered.length} 类字段；门表里另有 ${audit.uncovered.length} 类判据字段没有变异器：\n`,
    );
    for (const [f, n] of audit.uncovered) process.stdout.write(`    ${f.padEnd(30)} 出现在 ${n} 个门\n`);
    process.stdout.write("  这些字段改坏了目前没有任何检查会红 —— 不是已知缺失，是没测过。\n");
  }

  // 无效变异（YAML 被改坏 / 缺期望文件）永远阻断 —— 那不是「已知缺口」，是工具坏了
  if (invalid.length > 0) {
    process.stdout.write("\n✗ 存在无效变异，判定不可信；先修变异器或缺的期望文件\n");
    return 1;
  }

  if (newGaps.length > 0) {
    process.stdout.write(`\n✗ ${newGaps.length} 个【新增】缺口（不在 baseline 里）：\n`);
    for (const r of newGaps) {
      process.stdout.write(`  ✗ ${r.gateKey.padEnd(18)} ${r.mutator}\n`);
      process.stdout.write(`      用例 ${r.scenario}：${r.reason}\n`);
    }
    process.stdout.write(
      [
        "",
        "怎么处理（二选一，不许直接改代码让它变绿）：",
        "  A) 补用例：该判据确实该被覆盖 —— 在 cases/fixture.sh 造夹具 + scenarios.tsv 加一行",
        "  B) 登记现状：确认该字段对本门无效（例如 only-pass 的门没有路径分支），",
        "     跑 --write-baseline 把它写进基线，并在 PR 里说明为什么",
        "",
      ].join("\n"),
    );
    return 1;
  }

  process.stdout.write(`✓ 无新增缺口（已知 ${knownGaps.length} 条在 baseline 里，属存量债）\n`);
  if (staleBaseline.length > 0) {
    process.stdout.write(`\n💡 baseline 里有 ${staleBaseline.length} 条已经修好了，可以删掉：\n`);
    for (const k of staleBaseline) process.stdout.write(`    ${k.replace("\t", "  ").padEnd(30)} ← 已捕获\n`);
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
