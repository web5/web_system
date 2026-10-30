/**
 * gates-lint.ts — gates.yaml 自检器（S1 的验证手段，不进扫描路径）
 *
 * 用途：`node scripts/redline/gates-lint.ts`
 *
 * 为什么需要它：一份「看起来像配置的散文」没用。YAML 必须被机器钉在 bash 行为上，
 *   否则它只是第二份会漂移的文档 —— 那正是 S1 要消灭的问题。
 *
 * 四类检查：
 *   ① 结构   —— 解析 + 必填字段 + 枚举 + 引用完整性（scope 名、gate 号）
 *   ② 漂移   —— YAML 里的 glob 必须与 bash 里 case 分支**逐个相等**（含 gate-shared 的重复实现）
 *   ③ 用例   —— 每道门要么有黄金用例，要么进 uncovered（承认没覆盖，不许含糊）
 *   ④ 接线   —— 声明必须可豁免的门，代码里真的接了豁免
 *
 * 退出码：0=全部通过 1=有失败 2=用法错误
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml, YamlError } from "./lib/yaml-mini.ts";
import type { YamlMap, YamlValue } from "./lib/yaml-mini.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOP = resolve(HERE, "../..");
const GATES_YAML = join(HERE, "gates.yaml");
const SCAN_RULES = join(HERE, "scan-rules.sh");
const GATE_SHARED = join(HERE, "gate-shared.sh");
const SCENARIOS = join(HERE, "cases", "scenarios.tsv");

const LEVELS = ["error", "warning", "notice"];
const ACCEPTS = ["pass", "path", "sha"];
const BATCHES = ["1", "2", "3", "external"];

interface Failure {
  kind: string;
  detail: string;
}

const failures: Failure[] = [];
const passes: string[] = [];

function ok(label: string, note?: string): void {
  passes.push(note ? `${label}（${note}）` : label);
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

/** 从 bash 的 case 分支抽出 `pattern) return 0` 的模式集合 */
function extractCasePatterns(src: string, func: string): string[] | null {
  const lines = src.split("\n");
  const startIdx = lines.findIndex((l) => new RegExp(`^${func}\\(\\)\\s+\\{`).test(l));
  if (startIdx < 0) return null;
  let endIdx = startIdx;
  if (!lines[startIdx].includes("esac")) {
    endIdx = lines.findIndex((l, i) => i > startIdx && /^\}/.test(l));
    if (endIdx < 0) return null;
  }
  const body = lines.slice(startIdx, endIdx + 1).join("\n");
  const out: string[] = [];
  const re = /([^\s)]+)\)\s*return 0/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    for (const p of m[1].split("|")) {
      const t = p.trim();
      if (t.length > 0) out.push(t);
    }
  }
  return out;
}

function diffSets(label: string, yamlList: string[], bashList: string[]): void {
  const a = [...yamlList].sort();
  const b = [...bashList].sort();
  if (a.join("\u0000") === b.join("\u0000")) {
    ok(`${label} 与 bash 一致`, `${a.length} 条`);
    return;
  }
  const onlyYaml = a.filter((x) => !b.includes(x));
  const onlyBash = b.filter((x) => !a.includes(x));
  const parts: string[] = [];
  if (onlyYaml.length > 0) parts.push(`YAML 多出: ${onlyYaml.join(" , ")}`);
  if (onlyBash.length > 0) parts.push(`bash 有而 YAML 缺: ${onlyBash.join(" , ")}`);
  bad("漂移", `${label} 与 bash 不一致 —— ${parts.join("；")}`);
}

function resolveSpecRef(ref: string): { external: boolean; exists: boolean } {
  if (ref.startsWith("~")) {
    const p = join(homedir(), ref.slice(1));
    return { external: true, exists: existsSync(p) };
  }
  if (ref.startsWith("/")) return { external: true, exists: existsSync(ref) };
  return { external: false, exists: existsSync(join(TOP, ref)) };
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

  // ---------- ① 结构 ----------
  const schema = asStr(doc.schema, "schema");
  if (schema !== "gate-spec/v1") bad("结构", `schema 应为 gate-spec/v1，实际 ${schema}`);
  const status = asStr(doc.status, "status");
  const meta = asMap(doc.meta, "meta");
  if (status === "declared") {
    if (asStr(meta.authority, "meta.authority") !== "bash") {
      bad("结构", "status=declared 时权威必须是 bash（声明阶段不许出现两个权威）");
    } else {
      ok("权威声明一致", "status=declared → 权威为 bash");
    }
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

  // ---------- ② 与 bash 的触发面漂移 ----------
  const scanSrc = readFileSync(SCAN_RULES, "utf8");
  const sharedSrc = readFileSync(GATE_SHARED, "utf8");
  const bindings: Array<[scope: string, file: string, func: string]> = [
    ["code_file", scanSrc, "is_code_file"],
    ["ts_file", scanSrc, "is_ts_file"],
    ["ui_file", scanSrc, "is_ui_file"],
    ["contract_file", scanSrc, "is_contract_file"],
    ["release_file", scanSrc, "is_release_file"],
    ["test_path", scanSrc, "is_test_path"],
  ];
  for (const [scope, src, func] of bindings) {
    const declared = scopeIncludes.get(scope);
    const actual = extractCasePatterns(src, func);
    if (declared === undefined) {
      bad("结构", `缺少 scope ${scope}`);
      continue;
    }
    if (actual === null) {
      bad("漂移", `在 bash 里找不到函数 ${func}（YAML 声明的 scope 失去了绑定对象）`);
      continue;
    }
    diffSets(`scope ${scope} ↔ ${func}()`, declared, actual);
  }

  // 重复实现必须与主实现逐字一致（is_ui_file 在 gate-shared 里又写了一份）
  const sharedUi = extractCasePatterns(sharedSrc, "exempt_is_ui_file");
  const mainUi = extractCasePatterns(scanSrc, "is_ui_file");
  if (sharedUi === null || mainUi === null) {
    bad("漂移", "找不到 is_ui_file / exempt_is_ui_file，无法校验重复实现");
  } else {
    diffSets("is_ui_file ↔ exempt_is_ui_file（重复实现）", mainUi, sharedUi);
  }

  // 声明可豁免的门，代码里必须真的接了豁免（R9b 是内联循环，单独认）
  for (const id of eligible) {
    const wired =
      scanSrc.includes(`exempt_for_gate "$c" "$body" "${id}"`) ||
      scanSrc.includes(`exempt_covers "${id}"`) ||
      sharedSrc.includes(`"${id}"`);
    if (!wired) bad("接线", `${id} 在 eligible_gates 里，但 scan-rules.sh 里找不到它的豁免接线`);
  }
  if (eligible.length > 0) ok("豁免接线", `${eligible.length} 道可豁免门均能找到接线`);

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
    if (real > 0) {
      gateWithEvidence++;
    } else if (!uncoveredKeys.has(key)) {
      bad("用例", `${key}: 既没有黄金用例，也不在 uncovered 清单里 —— 空着的门等于没被验证过`);
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

  // ---------- 汇报 ----------
  const out: string[] = [];
  for (const p of passes) out.push(`  ✓ ${p}`);
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
