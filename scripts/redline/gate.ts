#!/usr/bin/env node
/**
 * gate.ts — 红线门禁执行引擎（重构 S2 · 影子期）
 *
 * 用法与 scan-rules.sh 完全一致（影子期两者必须可以互相替换）：
 *   node scripts/redline/gate.ts cached
 *   node scripts/redline/gate.ts diff <range>
 *   node scripts/redline/gate.ts files <path...>
 *   node scripts/redline/gate.ts tree [dir]
 * 选项：--strict / --no-color / --max-commits <N>
 *
 * ★ 本文件解决的两个结构问题
 *
 *  1)「加一门要改 13 处」。8 道 commit 级凭证门在 bash 里是同一个骨架抄了 8 遍
 *     （取 commits → 遍历 name-status 匹配 glob → 取 body → 豁免判定 → 校验 trailer）。
 *     这里只有**一个** runCredentialGates()，门的差异全部来自 gates.yaml 的
 *     trigger / credential / message —— 加一门 = 加一条 YAML，不动这里。
 *
 *  2)「每道门各自遍历一遍 commit」。bash 实测 1517 commit 要 17m27s，其中 commit 门占
 *     704s（67%）。根因不是哪一门写得慢，是 8 道门 × N 个 commit × 2~6 次 git 子进程。
 *     这里一次快照（一条 git log 拿全部 commit 的元数据与改动文件），门与门共用。
 *
 * ★ 行为权威仍是 bash（gates.yaml 的 status=declared）
 *   影子期的判据 = 对同一输入，两个引擎的 stdout 必须逐字节一致。
 *   所以本文件里凡是"看起来可以更优雅"的地方，都先问一句：改了会不会动输出。
 *   有意保留的差异只有一处，见 render() 上方关于 echo -e 的说明。
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml, YamlError } from "./lib/yaml-mini.ts";
import type { YamlMap, YamlValue } from "./lib/yaml-mini.ts";

// ============================================================
// 0. 运行环境
// ============================================================

const HERE = dirname(fileURLToPath(import.meta.url));

function resolveTop(): string {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim();
  return resolve(HERE, "../..");
}

const TOP = resolveTop();
process.chdir(TOP);

// ============================================================
// 1. 违规收集与渲染
// ============================================================

type Level = "error" | "warning" | "notice";

interface Finding {
  level: Level;
  rule: string;
  desc: string;
  loc: string;
  content: string;
}

const errors: Finding[] = [];
const warnings: Finding[] = [];
const notices: Finding[] = [];

function emitRule(level: Level, rule: string, desc: string, loc: string, content: string): void {
  const f: Finding = { level, rule, desc, loc, content };
  if (level === "error") errors.push(f);
  else if (level === "warning") warnings.push(f);
  else notices.push(f);
}

const C = { G: "\u001b[0;32m", Y: "\u001b[1;33m", R: "\u001b[0;31m", B: "\u001b[1m", N: "\u001b[0m" };
let color = true;
let strict = false;

/**
 * bash 用 `echo -e` 输出每一条，文案里出现 `\t` `\n` 会被解释成控制字符。
 * 引擎不复制这个行为（它让"源码里的一行"能改写报告结构），改为原样输出。
 * 这是**唯一**的有意差异：黄金用例里没有任何反斜杠文案，故影子比对不受影响；
 * 差别只在"某行源码恰好含 \t"时出现 —— 那种情况下 bash 的输出本身是坏的。
 */
function render(): number {
  const g = color ? C.G : "";
  const y = color ? C.Y : "";
  const r = color ? C.R : "";
  const b = color ? C.B : "";
  const n = color ? C.N : "";
  const out: string[] = [];

  if (errors.length > 0) {
    out.push(`${b}══ 红线违规（error）══${n}`);
    for (const f of errors) {
      out.push(`  ${r}[${f.rule}]${n} ${b}${f.desc}${n}`);
      out.push(`       ${b}${f.loc}${n}`);
      if (f.content !== "") out.push(`       ${y}${f.content}${n}`);
    }
  }
  if (warnings.length > 0) {
    out.push(`${b}══ 红线提示（warning）══${n}`);
    for (const f of warnings) {
      out.push(`  ${y}[${f.rule}]${n} ${f.desc}`);
      out.push(`       ${b}${f.loc}${n}`);
      if (f.content !== "") out.push(`       ${f.content}`);
    }
  }
  if (notices.length > 0) {
    out.push(`${b}══ 门禁提示（notice）══${n}`);
    for (const f of notices) {
      out.push(`  ${b}[${f.rule}]${n} ${f.desc}`);
      if (f.loc !== "") out.push(`       ${b}${f.loc}${n}`);
      if (f.content !== "") out.push(`       ${y}${f.content}${n}`);
    }
  }

  let code = 0;
  if (errors.length > 0) code = 1;
  else if (warnings.length > 0 && strict) code = 1;

  out.push(
    code === 0
      ? `${g}✓ 红线扫描通过（${errors.length} error / ${warnings.length} warning）${n}`
      : `${r}✗ 红线扫描未通过（${errors.length} error / ${warnings.length} warning）${n}`,
  );
  process.stdout.write(out.join("\n") + "\n");
  return code;
}

// ============================================================
// 2. glob / 正则辅助
// ============================================================

/**
 * bash `case` 的 glob：`*` 跨 `/`（与 gitignore / minimatch 都不同，必须自己实现），
 * `?` 单字符，`[...]` 字符类。
 */
function caseGlob(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (ch === "[") {
      const j = pattern.indexOf("]", i + 1);
      if (j < 0) re += "\\[";
      else {
        re += pattern.slice(i, j + 1);
        i = j;
      }
    } else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(re + "$");
}

const globCache = new Map<string, RegExp>();
function matchGlob(pattern: string, s: string): boolean {
  let re = globCache.get(pattern);
  if (re === undefined) {
    re = caseGlob(pattern);
    globCache.set(pattern, re);
  }
  return re.test(s);
}

function matchAnyGlob(patterns: string[], s: string): boolean {
  for (const p of patterns) if (matchGlob(p, s)) return true;
  return false;
}

const POSIX_CLASS: Record<string, string> = {
  space: "\\s",
  blank: "\\s",
  alnum: "A-Za-z0-9",
  digit: "0-9",
  alpha: "A-Za-z",
  upper: "A-Z",
  lower: "a-z",
  xdigit: "0-9A-Fa-f",
  punct: "!-/:-@\\[-`{-~",
};

/**
 * POSIX ERE → JS RegExp。bash 的 `[[ =~ ]]` 用 POSIX 字符类（`[[:space:]]`），
 * JS 不支持 —— 直接 new RegExp 会**静默不匹配**，那是最坏的一种失败：
 * 门禁不报，且看起来一切正常。所以遇到不认识的类直接抛错。
 */
function posixToJs(re: string): string {
  return re.replace(/\[(\^?)\[:([a-z]+):\]\]/g, (whole: string, neg: string, name: string) => {
    const ch = POSIX_CLASS[name];
    if (ch === undefined) throw new Error(`不支持的 POSIX 字符类 ${whole}（gates.yaml 的 match）`);
    return neg === "^" ? `[^${ch}]` : ch;
  });
}

const reCache = new Map<string, RegExp>();
function cachedRe(src: string, flags: string): RegExp {
  const key = `${flags}\u0000${src}`;
  let re = reCache.get(key);
  if (re === undefined) {
    re = new RegExp(posixToJs(src), flags);
    reCache.set(key, re);
  }
  return re;
}

function lstrip(s: string): string {
  return s.replace(/^[ \t]+/, "");
}
function isCommentLine(s: string): boolean {
  return (
    s.startsWith("//") || s.startsWith("/*") || s.startsWith("*") || s.startsWith("#") || s.startsWith("<!--")
  );
}

// ============================================================
// 3. gates.yaml
// ============================================================

interface GateSpec {
  id: string;
  sub: string | null;
  /** 唯一键：无 sub 用 id，有 sub 用 sub（如 R3.placeholder） */
  key: string;
  level: Level;
  stage: string;
  trigger: YamlMap;
  credential: YamlMap | null;
  message: string;
  raw: YamlMap;
}

interface Spec {
  gates: GateSpec[];
  byKey: Map<string, GateSpec>;
  scopes: Map<string, string[]>;
}

function asMap(v: YamlValue, ctx: string): YamlMap {
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error(`${ctx} 应为映射`);
  return v;
}
function asMapOrNull(v: YamlValue | undefined): YamlMap | null {
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) return null;
  return v;
}
function asStr(v: YamlValue, ctx: string): string {
  if (typeof v !== "string") throw new Error(`${ctx} 应为字符串，实际 ${String(v)}`);
  return v;
}
function strOr(v: YamlValue | undefined, dflt: string): string {
  return typeof v === "string" ? v : dflt;
}
function strList(v: YamlValue | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
function numOr(v: YamlValue | undefined, dflt: number): number {
  return typeof v === "number" ? v : dflt;
}

let SPEC: Spec;
// 以下常量都由 gates.yaml 派生（可由环境变量覆盖，语义与 bash 同名变量一致）
let MIN_REASON = 10;
let BATCH_MIN = 5;
let STRICT_FROM = 0;
let R9B_LINES = 5;
let R13_LINES = 5;

function envNum(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

function loadSpec(): void {
  const raw = readFileSync(join(HERE, "gates.yaml"), "utf8");
  const doc = asMap(parseYaml(raw, "gates.yaml"), "顶层");

  const gates: GateSpec[] = [];
  const byKey = new Map<string, GateSpec>();
  for (const g of asList(doc.gates, "gates")) {
    const gm = asMap(g, "gates[]");
    const id = asStr(gm.id, "gates[].id");
    const sub = gm.sub === null || gm.sub === undefined ? null : asStr(gm.sub, "sub");
    const spec: GateSpec = {
      id,
      sub,
      key: sub === null ? id : sub,
      level: asStr(gm.level, `${id}.level`) as Level,
      stage: asStr(gm.stage, `${id}.stage`),
      trigger: asMapOrNull(gm.trigger) ?? {},
      credential: asMapOrNull(gm.credential),
      message: asStr(gm.message, `${id}.message`),
      raw: gm,
    };
    gates.push(spec);
    byKey.set(spec.key, spec);
  }

  const scopes = new Map<string, string[]>();
  for (const [name, v] of Object.entries(asMap(doc.scopes, "scopes"))) {
    scopes.set(name, strList(asMap(v, `scopes.${name}`).include));
  }

  SPEC = { gates, byKey, scopes };

  const ex = asMap(doc.exemption, "exemption");
  const q = asMap(ex.quality, "exemption.quality");
  const batch = asMap(q.batch, "exemption.quality.batch");

  MIN_REASON = envNum("EXEMPT_MIN_REASON_LEN") ?? numOr(q.min_reason_chars, 10);
  BATCH_MIN = envNum("EXEMPT_BATCH_MIN_FILES") ?? numOr(batch.min_ui_files, 5);
  STRICT_FROM = envNum("EXEMPT_QUALITY_STRICT_FROM") ?? numOr(q.strict_from, 0);
  R9B_LINES = envNum("R9B_LINE_THRESHOLD") ?? thresholdOf("R9b", 5);
  R13_LINES = envNum("R13_LINE_THRESHOLD") ?? thresholdOf("R13", 5);
}

function asList(v: YamlValue, ctx: string): YamlValue[] {
  if (!Array.isArray(v)) throw new Error(`${ctx} 应为数组`);
  return v;
}

function gate(key: string): GateSpec {
  const g = SPEC.byKey.get(key);
  if (g === undefined) throw new Error(`gates.yaml 里没有 ${key}`);
  return g;
}

function thresholdOf(key: string, dflt: number): number {
  const g = SPEC.byKey.get(key);
  if (g === undefined) return dflt;
  const m = asMapOrNull(g.trigger.threshold);
  if (m === null) return dflt;
  return typeof m.lines === "number" ? m.lines : dflt;
}

// ============================================================
// 4. git 快照（一次取全，门与门共用）
// ============================================================

interface ChangedFile {
  status: string; // A / M / D / R100 …
  path: string;
}

interface CommitInfo {
  sha: string;
  ct: number;
  parents: string[];
  subject: string;
  body: string;
  files: ChangedFile[];
  isMerge: boolean;
}

interface Snapshot {
  range: string;
  commits: CommitInfo[];
  /** range 级 diff（等价 git diff --name-status --no-renames <range>） */
  rangeFiles: ChangedFile[];
}

let gitCalls = 0;
function git(args: string[]): { status: number; out: string } {
  gitCalls++;
  const r = spawnSync("git", args, { cwd: TOP, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  return { status: r.status ?? 1, out: r.stdout ?? "" };
}

function splitRecords(out: string): string[] {
  return out.split("\u001e").filter((s) => s.length > 0);
}

/** 解析 name-status 行：模式 + 路径（重命名时 bash 的 `read -r st f` 会把 old/new 拼进 f，这里保持一致） */
function parseStatusLine(line: string): ChangedFile | null {
  const parts = line.split("\t");
  if (parts.length < 2) return null;
  return { status: parts[0], path: parts.slice(1).join("\t") };
}

function buildSnapshot(range: string): Snapshot {
  const commits: CommitInfo[] = [];
  const filesOf = new Map<string, ChangedFile[]>();

  // ---- 一条 git log 拿全部 commit 元数据 ----
  const meta = git(["log", "--reverse", "--no-color", "--format=%H%x1f%ct%x1f%P%x1f%s%x1f%B%x1e", range]);
  if (meta.status === 0) {
    for (const chunk of splitRecords(meta.out)) {
      const s = chunk.startsWith("\n") ? chunk.slice(1) : chunk;
      const f = s.split("\u001f");
      if (f.length < 5) continue;
      const sha = f[0];
      const ct = Number(f[1]) || 0;
      const parents = f[2].trim() === "" ? [] : f[2].trim().split(/\s+/);
      const subject = f[3];
      // 第 5 段起是 body；`$(...)` 会剥掉尾部所有换行，这里保持一致
      const body = f.slice(4).join("\u001f").replace(/\n+$/, "");
      commits.push({ sha, ct, parents, subject, body, files: [], isMerge: parents.length > 1 });
      filesOf.set(sha, []);
    }
  }

  // ---- 一条 git log 拿全部 commit 的改动文件（等价 git show --name-status --format=）----
  const names = git(["log", "--reverse", "--no-color", "--format=%x1e%H", "--name-status", range]);
  if (names.status === 0) {
    for (const chunk of splitRecords(names.out)) {
      const lines = chunk.split("\n");
      const sha = lines[0].trim();
      const list: ChangedFile[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "") continue;
        const cf = parseStatusLine(lines[i]);
        if (cf !== null) list.push(cf);
      }
      if (filesOf.has(sha)) filesOf.set(sha, list);
    }
  }
  for (const c of commits) c.files = filesOf.get(c.sha) ?? [];

  // ---- range 级 name-status（R9/R9b 用；--no-renames 与 bash 一致）----
  const rangeFiles: ChangedFile[] = [];
  const rd = git(["diff", "--name-status", "--no-renames", range, "--"]);
  if (rd.status === 0) {
    for (const line of rd.out.split("\n")) {
      if (line === "") continue;
      const cf = parseStatusLine(line);
      if (cf !== null) rangeFiles.push(cf);
    }
  }

  return { range, commits, rangeFiles };
}

// ---- 懒加载 numstat：只有需要行数阈值时才付这个成本 ----
let numstatLoaded = false;
const numstatByCommit = new Map<string, { add: string; del: string; path: string }[]>();

function loadNumstat(range: string): void {
  if (numstatLoaded) return;
  numstatLoaded = true;
  const r = git(["log", "--reverse", "--no-color", "--format=%x1e%H", "--numstat", range]);
  if (r.status !== 0) return;
  for (const chunk of splitRecords(r.out)) {
    const lines = chunk.split("\n");
    const sha = lines[0].trim();
    const list: { add: string; del: string; path: string }[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "") continue;
      const parts = lines[i].split("\t");
      if (parts.length < 3) continue;
      list.push({ add: parts[0], del: parts[1], path: parts.slice(2).join("\t") });
    }
    numstatByCommit.set(sha, list);
  }
}

function commitLineCount(range: string, sha: string, filter: (p: string) => boolean): number {
  loadNumstat(range);
  let n = 0;
  for (const e of numstatByCommit.get(sha) ?? []) {
    if (!filter(e.path)) continue;
    if (!/^[0-9]+$/.test(e.add) || !/^[0-9]+$/.test(e.del)) continue; // 二进制为 `-`
    n += Number(e.add) + Number(e.del);
  }
  return n;
}

// ============================================================
// 5. 判定辅助（与 bash 同名函数一一对应）
// ============================================================

function scopeMatch(scope: string, path: string): boolean {
  const inc = SPEC.scopes.get(scope);
  if (inc === undefined) throw new Error(`gates.yaml 引用了不存在的 scope ${scope}`);
  return matchAnyGlob(inc, path);
}

function isUiFile(path: string): boolean {
  return scopeMatch("ui_file", path);
}

/** 卡 2.6 规格书识别（gate-shared.sh is_spec_doc） */
function isSpecDoc(p: string): boolean {
  if (!(p.startsWith("docs/ui/page-specs/") || p.startsWith("specs/"))) return false;
  const slash = p.lastIndexOf("/");
  const base = slash < 0 ? p : p.slice(slash + 1);
  const dir = slash < 0 ? "" : p.slice(0, slash);
  const has = (s: string): boolean => s.includes("page-spec") || s.includes("prototype") || s.includes("原型");
  if (has(base)) return true;
  for (const seg of dir.split("/")) if (seg !== "" && has(seg)) return true;
  return false;
}

// 与 bash 的 passport 四个 glob + is_spec_doc 逐条对齐（不用块注释：glob 里含 `/`+`*` 会截断注释）
function isPassportPath(p: string): boolean {
  if (matchGlob("*/prototype/*", p)) return true;
  if (matchGlob("docs/ui/prototypes/*", p)) return true;
  if (matchGlob("*/page-spec*.md", p)) return true;
  return isSpecDoc(p);
}

// ============================================================
// 6. 豁免机制（gate-shared.sh §1）
// ============================================================

interface ExemptState {
  legacy: boolean;
  gates: string[];
  reason: string;
}

function charLen(s: string): number {
  return [...s].length;
}

function exemptSplit(rest0: string): ExemptState {
  const rest = rest0.replace(/^\s+/, "");
  // 门号列表后必须紧跟冒号才是分类豁免；否则按旧格式（一票否决）
  const m = /^(R\d+[a-z]?(?:\s*,\s*R\d+[a-z]?)*):([\s\S]*)$/.exec(rest);
  if (m !== null) {
    const gates = m[1].replace(/\s+/g, "").split(",").filter((x) => x !== "");
    return { legacy: false, gates, reason: m[2].replace(/^\s+/, "") };
  }
  return { legacy: true, gates: [], reason: rest };
}

function exemptParse(body: string): ExemptState | null {
  for (const line of body.split("\n")) {
    if (line.startsWith("Micro-exempt:")) return exemptSplit(line.slice("Micro-exempt:".length));
  }
  return null;
}

function exemptCovers(st: ExemptState, gateId: string): boolean {
  // 旧格式 = 全门豁免（向后兼容）。这条曾写错过一次：旧格式下 gates 恒为空，
  // 若再比 gateId 就恒假 → 豁免全线失效，存量 R11 被追溯翻红（2026-10-30 实测 11 error）。
  if (st.legacy) return true;
  return st.gates.includes(gateId);
}

interface QualityResult {
  ok: boolean;
  msg: string;
}

function exemptQuality(reason: string, uiN: number, totN: number): QualityResult {
  const len = charLen(reason);
  if (len < MIN_REASON) return { ok: false, msg: `豁免理由过短（${len} 字 < ${MIN_REASON} 字）` };

  const trimmed = reason.toLowerCase().replace(/^\s+/, "").replace(/\s+$/, "");
  if (empties().includes(trimmed)) return { ok: false, msg: `豁免理由无信息量（取值「${trimmed}」）` };

  if (uiN >= BATCH_MIN) {
    const hasNum = (n: number): boolean => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(reason);
    if (!hasNum(uiN) && !(totN !== uiN && hasNum(totN))) {
      return { ok: false, msg: `批量豁免（UI 改动 ${uiN} 个文件）未在理由中标注文件数` };
    }
    if (!rootcauseKeywords().some((k) => reason.includes(k))) {
      return { ok: false, msg: `批量豁免（UI 改动 ${uiN} 个文件）未在理由中说明统一根因` };
    }
  }
  return { ok: true, msg: "" };
}

let emptiesCache: string[] | null = null;
let kwCache: string[] | null = null;
function empties(): string[] {
  return emptiesCache ?? [];
}
function rootcauseKeywords(): string[] {
  return kwCache ?? [];
}

const exemptReported = new Set<string>();
const hinted = new Set<string>();
let legacyCount = 0;

function countsOf(c: CommitInfo): { uiN: number; totN: number } {
  let ui = 0;
  for (const f of c.files) if (isUiFile(f.path)) ui++;
  return { uiN: ui, totN: c.files.length };
}

/**
 * bash: exempt_for_gate <commit> <body> <GATE>
 *   返回 true = 被豁免（跳过该门）；false = 未豁免（该门照常判定，可能已报 R20）
 * `suffix` 是 R20「存量不追溯」文案的尾句差异：exempt_for_gate 与 R9b 的内联循环
 * 两处文案不完全相同，必须各自保留（逐字节比对会抓）。
 */
function exemptForGate(c: CommitInfo, gateId: string, suffix: string): boolean {
  const st = exemptParse(c.body);
  if (st === null) return false;
  if (!exemptCovers(st, gateId)) return false;

  if (st.legacy && !hinted.has(c.sha)) {
    hinted.add(c.sha);
    legacyCount++;
  }

  const { uiN, totN } = countsOf(c);
  const q = exemptQuality(st.reason, uiN, totN);
  if (q.ok) return true;

  // 存量（生效日之前）不追溯翻红：只提醒，豁免照常生效
  if (c.ct < STRICT_FROM) {
    const k = `legacy-q|${c.sha}`;
    if (!hinted.has(k)) {
      hinted.add(k);
      emitRule("warning", "R20", "豁免理由待改进（存量·未追溯，豁免仍生效）", c.subject, `${q.msg}；新提交起该理由将导致豁免失效${suffix}`);
    }
    return true;
  }

  if (!exemptReported.has(c.sha)) {
    exemptReported.add(c.sha);
    emitRule("warning", "R20", "豁免理由不达标（豁免未生效）", c.subject, `${q.msg}；请补充可审计的理由后重写 trailer`);
  }
  return false;
}

// ============================================================
// 7. 行级 / 文件级门（YAML 驱动）
// ============================================================

/**
 * 输出顺序固定为 bash 的调用顺序。为什么不由 YAML 条目顺序决定：
 * 它影响逐字节输出，属兼容性约束，不是可自由重排的配置。
 */
const LINE_ORDER = [
  "R1",
  "R3.placeholder",
  "R4.ts-ignore",
  "R4.any",
  "R3.weak",
  "R5.enable-cors",
  "R5.wildcard-origin",
  "R2.cred",
];

function lineGateApplies(g: GateSpec, file: string): boolean {
  const t = g.trigger;
  if (typeof t.scope === "string" && !scopeMatch(t.scope, file)) return false;
  for (const s of strList(t.exclude_scopes)) if (scopeMatch(s, file)) return false;
  const exPaths = strList(t.exclude_paths);
  if (exPaths.length > 0 && matchAnyGlob(exPaths, file)) return false;
  if (typeof t.match_path === "string" && !matchGlob(t.match_path, file)) return false;
  return true;
}

function lineGatesFor(file: string, line: string, lineNo: string): void {
  const s = lstrip(line);
  const seenR5 = new Set<string>();
  for (const key of LINE_ORDER) {
    const g = SPEC.byKey.get(key);
    if (g === undefined) continue;
    if (!lineGateApplies(g, file)) continue;
    const t = g.trigger;
    if (t.skip_comment_line === true && isCommentLine(s)) continue;
    const match = strOr(t.match, "");
    if (match === "") continue;
    if (!cachedRe(match, t.case_insensitive === true ? "i" : "").test(line)) continue;

    // bash 的 R5 是两个正则 OR 成一条警告；这里按 rule+desc 去重，避免同一行报两条
    if (g.id === "R5") {
      if (seenR5.has(g.message)) continue;
      seenR5.add(g.message);
    }
    emitRule(g.level, g.id, g.message, `${file}:${lineNo}`, line);
  }
}

/** 文件级门：R2.secret-file / R5.main-cors / R8。bash 里 main.ts 只判一次（_MAINTS_SEEN） */
const mainTsSeen = new Set<string>();

function fileGatesFor(file: string): void {
  const r2 = SPEC.byKey.get("R2.secret-file");
  if (r2 !== undefined) {
    const t = r2.trigger;
    if (typeof t.match_path === "string" && matchGlob(t.match_path, file)) {
      emitRule(r2.level, r2.id, r2.message, file, "证书/私钥文件不应提交");
    }
    const alt = asMapOrNull(t.alt);
    if (alt !== null && typeof alt.match_path === "string" && matchGlob(alt.match_path, file)) {
      const ex = strList(alt.exclude_paths);
      if (!(ex.length > 0 && matchAnyGlob(ex, file))) {
        emitRule(r2.level, r2.id, r2.message, file, ".env* 不应提交（.gitignore 已兜底）");
      }
    }
  }

  const mainGate = SPEC.byKey.get("R5.main-cors");
  const r8 = SPEC.byKey.get("R8");
  const pats: string[] = [];
  if (mainGate !== undefined && typeof mainGate.trigger.match_path === "string") pats.push(mainGate.trigger.match_path);
  if (r8 !== undefined && typeof r8.trigger.match_path === "string") pats.push(r8.trigger.match_path);
  if (pats.length === 0 || !pats.every((p) => matchGlob(p, file))) return;
  if (mainTsSeen.has(file)) return;
  mainTsSeen.add(file);
  if (!existsSync(file) || !statSync(file).isFile()) return;

  const text = readFileSync(file, "utf8");

  if (mainGate !== undefined) {
    const m = strOr(mainGate.trigger.file_contains, "");
    if (m !== "" && cachedRe(m, "").test(text)) {
      emitRule(mainGate.level, mainGate.id, mainGate.message, file, strOr(mainGate.raw.hint, ""));
    }
  }
  if (r8 !== undefined) {
    const has = strOr(r8.trigger.file_contains, "");
    const not = strOr(r8.trigger.file_not_contains, "");
    if (has !== "" && text.includes(has) && !(not !== "" && text.includes(not))) {
      emitRule(r8.level, r8.id, r8.message, file, strOr(r8.raw.hint, ""));
    }
  }
}

// ============================================================
// 8. 通用 commit 级凭证门（8 道门共用这一份实现）
// ============================================================

function commitTriggerHit(g: GateSpec, c: CommitInfo, range: string): boolean {
  const t = g.trigger;
  const statuses = strList(t.status);
  const matchAny = strList(t.match_any);
  const exts = strList(t.extensions);
  const exPaths = strList(t.exclude_paths);
  const scope = typeof t.scope === "string" ? t.scope : null;

  const matchOne = (path: string): boolean => {
    if (scope !== null && !scopeMatch(scope, path)) return false;
    if (matchAny.length > 0 && !matchAnyGlob(matchAny, path)) return false;
    if (exts.length > 0 && !exts.some((e) => path.endsWith(e))) return false;
    if (exPaths.length > 0 && matchAnyGlob(exPaths, path)) return false;
    return true;
  };

  let hit = false;
  for (const f of c.files) {
    if (statuses.length > 0 && !statuses.some((s) => f.status.startsWith(s))) continue;
    if (!matchOne(f.path)) continue;
    hit = true;
    break;
  }
  if (!hit) return false;

  const threshold = asMapOrNull(t.threshold);
  if (threshold !== null && typeof threshold.lines === "number") {
    const n = commitLineCount(range, c.sha, matchOne);
    if (n < threshold.lines) return false;
  }
  return true;
}

/** 取 trailer 值：`^Name:[[:space:]]*[^[:space:]]+` 的第一个匹配行，去前缀与 \r */
function trailerValue(body: string, name: string): string {
  for (const line of body.split("\n")) {
    if (!new RegExp(`^${name}:[ \\t]*\\S`).test(line)) continue;
    return line.replace(new RegExp(`^${name}:[ \\t]*`), "").replace(/\r/g, "");
  }
  return "";
}

function reportBlocking(sha: string, path: string): number {
  const r = git(["show", `${sha}:${path}`]);
  if (r.status !== 0) return 0;
  for (const line of r.out.split("\n")) {
    const m = /^阻塞:[ \t]*([0-9]+)/.exec(line);
    if (m !== null) return Number(m[1]);
  }
  return 0;
}

function blobAtPath(sha: string, path: string): boolean {
  return git(["cat-file", "-e", `${sha}:${path}`]).status === 0;
}

function pathExistsAnywhere(sha: string, p: string, base: string): boolean {
  if (p === "") return false;
  if (p.startsWith("/")) return existsSync(p);
  const t = git(["cat-file", "-t", `${sha}:${p}`]);
  if (t.status === 0 && t.out.trim() === "blob") return true;
  if (base !== "" && existsSync(join(base, p))) return true;
  return existsSync(p);
}

/**
 * credential.checks 在 YAML 里写成「键值对列表」（`- path_exists_in_commit_tree: true`），
 * 不是字符串列表。第一版按字符串读 → 全是 undefined → 所有路径校验被**静默跳过**，
 * R17 假路径用例因此假绿（影子比对抓到）。这里统一摊平成名字列表。
 */
function checkNames(cred: YamlMap): string[] {
  const out: string[] = [];
  for (const item of strOrList(cred.checks)) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    const m = asMapOrNull(item as YamlValue);
    if (m !== null) for (const k of Object.keys(m)) out.push(k);
  }
  return out;
}

function strOrList(v: YamlValue | undefined): YamlValue[] {
  return Array.isArray(v) ? v : [];
}

/** 凭证校验（_trailer_check_one 与 _r17_credential_check 的超集，差异由 YAML 的 checks 决定） */
function credentialCheck(g: GateSpec, c: CommitInfo): void {
  const cred = g.credential;
  if (cred === null) return;
  const trailer = strOr(cred.trailer, "");
  const tval = trailerValue(c.body, trailer);
  // bash 的文案是 `${desc} commit 缺评审凭证`，而 YAML 的 message 已含 "commit"
  const bare = g.message.replace(/ commit 缺评审凭证$/, "");

  if (tval === "") {
    emitRule(g.level, g.id, `${bare} commit 缺评审凭证`, c.subject, strOr(g.raw.hint, ""));
    return;
  }
  if (tval === "pass") return;

  const checks = checkNames(cred);

  if (checks.includes("path_exists_anywhere")) {
    if (!pathExistsAnywhere(c.sha, tval, TOP)) {
      emitRule(
        g.level,
        g.id,
        strOr(g.raw.message_report_missing, `${trailer} 凭证指向的报告不存在`),
        tval,
        "Test: <路径> 须指向真实存在的用例文档（仓库内或任务目录内）；确无用例需求写 Test: pass",
      );
    }
    return;
  }

  if (!checks.includes("path_exists_in_commit_tree")) return;

  if (!blobAtPath(c.sha, tval)) {
    emitRule(
      g.level,
      g.id,
      strOr(g.raw.message_report_missing, `${trailer} 凭证指向的报告不存在`),
      tval,
      "报告须随该 commit 落盘",
    );
    return;
  }
  if (checks.includes("report_header_blocking_zero")) {
    const n = reportBlocking(c.sha, tval);
    if (n > 0) {
      emitRule(
        g.level,
        g.id,
        strOr(g.raw.message_blocking, `${bare}评审阻塞项未清零`),
        `${tval}（阻塞: ${n}）`,
        "报告头部 阻塞: N 且 N>0 不得放行",
      );
    }
  }
}

// ============================================================
// 9. 各门
// ============================================================

let SNAP: Snapshot;

function runR9(): void {
  const g = gate("R9");
  const newPages: string[] = [];
  let passport = 0;
  for (const f of SNAP.rangeFiles) {
    if (f.status.startsWith("A") && matchGlob("apps/*/pages/*", f.path)) newPages.push(f.path);
    if (matchGlob("*/prototype/*", f.path) || matchGlob("docs/ui/prototypes/*", f.path) || matchGlob("*/page-spec*.md", f.path)) {
      passport++;
    } else if (isSpecDoc(f.path)) passport++;
  }

  let ia = false;
  const iaFiles = git(["diff", "--name-only", "--no-renames", SNAP.range, "--", "app.json", "apps/*/app.json"]);
  if (iaFiles.status === 0 && iaFiles.out.trim() !== "") {
    const d = git(["diff", "-U0", "--no-color", SNAP.range, "--", "app.json", "apps/*/app.json"]);
    if (d.status === 0) {
      for (const line of d.out.split("\n")) {
        if (!(line.startsWith("+") || line.startsWith("-"))) continue;
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (/"(pages|tabBar)"/.test(line)) {
          ia = true;
          break;
        }
      }
    }
  }

  if (newPages.length === 0 && !ia) return;
  if (passport > 0) return;

  const loc = newPages.length > 0 ? `新增 UI 页面 ${newPages.length} 个` : "app.json 信息架构(pages/tabBar)变化";
  emitRule(g.level, g.id, g.message, loc, strOr(g.raw.hint, ""));
}

function runR9b(): void {
  const g = gate("R9b");
  let passport = 0;
  const uiFiles: string[] = [];
  for (const f of SNAP.rangeFiles) {
    // ⚠️ passport 判定必须先于「新增文件 continue」——否则「先提原型再提 UI」的正规走法
    //    反而被判无同行原型，逼人用 Micro-exempt 后门（2026-10-11 实测误报）
    if (isPassportPath(f.path)) passport++;
    if (f.status.startsWith("A")) continue;
    if (isUiFile(f.path)) uiFiles.push(f.path);
  }
  if (uiFiles.length === 0) return;
  if (passport > 0) return;

  let lines = 0;
  const ns = git(["diff", "--numstat", "--no-renames", SNAP.range, "--", ...uiFiles]);
  if (ns.status === 0) {
    for (const line of ns.out.split("\n")) {
      if (line === "") continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      lines += (Number(parts[0]) || 0) + (Number(parts[1]) || 0);
    }
  }

  let struct = false;
  const d = git(["diff", "-U0", "--no-color", SNAP.range, "--", ...uiFiles]);
  if (d.status === 0) {
    for (const line of d.out.split("\n")) {
      if (!line.startsWith("+")) continue;
      if (/<(view|template|block)/.test(line)) {
        struct = true;
        break;
      }
    }
  }
  if (lines < R9B_LINES && !struct) return;

  // 豁免：R9b 在 bash 里是内联循环（不走 exempt_for_gate），文案后缀与后者略有不同 —— 保留
  for (const c of SNAP.commits) {
    const st = exemptParse(c.body);
    if (st === null) continue;
    if (!exemptCovers(st, "R9b")) continue;
    const { uiN, totN } = countsOf(c);
    const q = exemptQuality(st.reason, uiN, totN);
    if (q.ok) return;
    if (c.ct < STRICT_FROM) {
      emitRule("warning", "R20", "豁免理由待改进（存量·未追溯，豁免仍生效）", c.subject, `${q.msg}；新提交起该理由将导致豁免失效`);
      return;
    }
    emitRule("warning", "R20", "豁免理由不达标（豁免未生效）", c.subject, `${q.msg}；请补充可审计的理由后重写 trailer`);
  }

  emitRule(g.level, g.id, g.message, `${uiFiles.length} 个文件 / ${lines} 行`, strOr(g.raw.hint, ""));
}

/** R10：UI commit 的 Proto 必须是祖先（sha 语义，与其它凭证门的「路径存在」不同） */
function runR10(): void {
  const g = gate("R10");
  for (const c of SNAP.commits) {
    if (!c.files.some((f) => isUiFile(f.path))) continue;
    if (exemptForGate(c, "R10", "")) continue;

    let sha = "";
    for (const line of c.body.split("\n")) {
      if (!/^Proto:[ \t]/.test(line)) continue;
      const m = /[0-9a-fA-F]{7,40}/.exec(line);
      if (m !== null) {
        sha = m[0];
        break;
      }
    }
    if (sha === "") {
      emitRule(g.level, g.id, g.message, c.subject, strOr(g.raw.hint, ""));
      continue;
    }
    if (git(["merge-base", "--is-ancestor", sha, `${c.sha}^`]).status !== 0) {
      emitRule(
        g.level,
        g.id,
        strOr(g.raw.message_ancestor, "UI commit 的 Proto 指向非祖先"),
        sha,
        strOr(g.raw.hint, ""),
      );
    }
  }
}

/** R11：两个分支（UI commit 只认 pass；spec commit 校验报告内容），只有 UI 分支可豁免 */
function runR11(): void {
  const g = gate("R11");
  for (const c of SNAP.commits) {
    const isui = c.files.some((f) => isUiFile(f.path));
    const dval = trailerValue(c.body, "Design");

    if (!isui) {
      if (dval === "" || dval === "pass") continue;
      if (!blobAtPath(c.sha, dval)) {
        emitRule(
          g.level,
          g.id,
          strOr(g.raw.message_report_missing, "Design 凭证指向的报告不存在"),
          dval,
          "报告须落盘 docs/ui/reviews/*.md 并与原型/规格同 commit（§3.7）",
        );
        continue;
      }
      const n = reportBlocking(c.sha, dval);
      if (n > 0) {
        emitRule(
          g.level,
          g.id,
          strOr(g.raw.message_blocking, "设计评审阻塞项未清零"),
          `${dval}（阻塞: ${n}）`,
          "报告头部 阻塞: N 且 N>0 不得进入实现（§3.7）",
        );
      }
      continue;
    }

    if (exemptForGate(c, "R11", "，请按 §3.7 补可审计理由")) continue;
    if (dval === "") {
      emitRule(g.level, g.id, g.message, c.subject, strOr(g.raw.hint, ""));
      continue;
    }
    if (dval !== "pass") {
      emitRule(
        g.level,
        g.id,
        strOr(g.raw.message_non_pass, "UI commit 的 Design 凭证非 pass"),
        dval,
        "UI commit 须写 Design: pass；报告路径应挂在原型/规格 commit 上（§3.7）",
      );
    }
  }
}

/** R13/R14/R15/R17/R18：同一骨架，门的差异全在 gates.yaml */
function runCredentialGates(keys: string[]): void {
  const specs = keys.map((k) => gate(k));
  for (const c of SNAP.commits) {
    if (c.isMerge) continue; // bash: --no-merges
    for (const g of specs) {
      if (!commitTriggerHit(g, c, SNAP.range)) continue;
      if (exemptForGate(c, g.id, "，请按 §3.7 补可审计理由")) continue;
      credentialCheck(g, c);
    }
  }
}

function runR19(): void {
  const g = gate("R19");
  for (const c of SNAP.commits) {
    if (c.isMerge) continue;
    if (c.files.length !== 0) continue;
    emitRule(g.level, g.id, g.message, c.subject, strOr(g.raw.hint, ""));
  }
}

/** R12：两处应同源的路径比对 */
function runR12(): void {
  const g = gate("R12");
  const pair = asMapOrNull(g.trigger.compare_pair);
  if (pair === null) return;
  const src = strOr(pair.src, "");
  const dst = strOr(pair.dst, "");
  if (src === "" || !existsSync(src)) return;
  const excl = strList(g.trigger.exclude);
  const files: string[] = [];
  walk(src, files);
  const hint = (rel: string): string =>
    `建议：bash scripts/redline/apply-agent-kit.sh（第二跳一键镜像；单项亦可 cp "${src}/${rel}" "${dst}/${rel}"）`;
  for (const f of files) {
    const rel = f.slice(src.length + 1);
    if (excl.some((x) => rel.includes(x))) continue;
    if (!existsSync(join(dst, rel))) {
      emitRule(g.level, g.id, `${g.message}（目标缺失，未同步）`, rel, hint(rel));
    } else if (statSync(join(dst, rel)).isFile() && !readFileSync(f).equals(readFileSync(join(dst, rel)))) {
      emitRule(g.level, g.id, `${g.message}（内容漂移）`, rel, hint(rel));
    }
  }
}

/** find 的语义：readdir 原序 + 先序遍历（bash 用 find，顺序依赖文件系统，不排序） */
function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push(p);
  }
}

/** R11b / R16：判定在 python 辅助脚本里，引擎只按同一口径翻译结果 */
function runDelegated(key: string, args: string[], levels: string[]): void {
  const g = gate(key);
  const rel = strOr(g.trigger.delegate, "");
  const py = join(TOP, rel);
  if (rel === "" || !existsSync(py)) return;
  const r = spawnSync("python3", [py, ...args], { cwd: TOP, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || (r.stdout ?? "") === "") return;
  for (const line of (r.stdout ?? "").split("\n")) {
    if (line === "") continue;
    const parts = line.split("\t");
    if (parts.length < 4) continue;
    const [lvl, rule, loc, msg] = parts;
    if (!levels.includes(lvl)) continue;
    emitRule(g.level, rule === "" ? g.id : rule, msg, loc, strOr(g.raw.hint, ""));
  }
}

// ============================================================
// 10. 模式
// ============================================================

function readLines(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  // bash `while read || [ -n "$content" ]`：末尾有换行时最后一行是空串，要丢掉
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function scanOneFile(file: string): void {
  let st;
  try {
    st = statSync(file);
  } catch {
    process.stderr.write(`跳过(不存在): ${file}\n`);
    return;
  }
  if (!st.isFile()) {
    process.stderr.write(`跳过(不存在): ${file}\n`);
    return;
  }
  fileGatesFor(file);
  if (!scopeMatch("code_file", file)) return;
  const lines = readLines(file);
  for (let i = 0; i < lines.length; i++) lineGatesFor(file, lines[i], String(i + 1));
}

function scanDiffRange(range: string): void {
  SNAP = buildSnapshot(range);

  runR9();
  runR9b();
  runR10();
  runR11();
  const anchorMode = process.env.DESIGN_ANCHOR_MODE ?? "off";
  if (anchorMode !== "off") runDelegated("R11b", ["anchors", range], ["MISSING", "EXTRA"]);
  runCredentialGates(["R13", "R14"]);
  runCredentialGates(["R15"]);
  runCredentialGates(["R17"]);
  runCredentialGates(["R18"]);
  runR19();
  runR12();
  runDelegated("R16", [], ["MISSING", "EXTRA", "LOOSE"]);

  if (legacyCount > 0) {
    const g = gate("R21");
    emitRule("notice", g.id, g.message.replace("{count}", String(legacyCount)), "", strOr(g.raw.hint, ""));
  }

  // ---- 行级：只扫新增行 ----
  const d = git([
    "diff",
    "--no-color",
    "--unified=0",
    range,
    "--",
    "*.ts",
    "*.tsx",
    "*.vue",
    "*.js",
    "*.jsx",
    "*.mjs",
    "*.cjs",
  ]);
  if (d.status !== 0 || d.out === "") return;

  // 按文件分组，保持 diff 中的出现顺序；同一文件内保持行序
  const groups: { file: string; lines: string[] }[] = [];
  let cur: { file: string; lines: string[] } | null = null;
  for (const raw of d.out.split("\n")) {
    if (raw.startsWith("+++ b/")) {
      cur = { file: raw.slice(6), lines: [] };
      groups.push(cur);
      continue;
    }
    if (raw.startsWith("+++")) {
      cur = null;
      continue;
    }
    if (raw.startsWith("@@")) continue;
    if (raw.startsWith("+") && cur !== null) {
      const content = raw.slice(1);
      if (content !== "") cur.lines.push(content);
    }
  }
  for (const grp of groups) {
    if (grp.lines.length === 0) continue;
    fileGatesFor(grp.file);
    for (const content of grp.lines) lineGatesFor(grp.file, content, "");
  }
}

function scanTree(dir: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write(`目录不存在: ${dir}\n`);
    return;
  }
  const all: string[] = [];
  walk(dir, all);
  const exts = [".ts", ".tsx", ".vue", ".js", ".jsx", ".mjs", ".cjs"];
  for (const p of all) {
    const rel = p.startsWith("./") ? p.slice(2) : p;
    if (/^(\.git|node_modules)\//.test(rel) || /\/node_modules\//.test(rel)) continue;
    if (/\/(dist|build|coverage)\//.test(rel)) continue;
    if (rel.startsWith("public/static/modules/")) continue;
    if (!exts.some((e) => rel.endsWith(e))) continue;
    scanOneFile(rel);
  }
}

// ============================================================
// 11. 入口
// ============================================================

function main(argv: string[]): number {
  let mode = "";
  const modeArgs: string[] = [];
  let maxCommits = process.env.SCAN_MAX_COMMITS ?? "300";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") strict = true;
    else if (a === "--no-color") color = false;
    else if (a === "--max-commits") maxCommits = argv[++i] ?? "";
    else if (a === "-h" || a === "--help") {
      process.stdout.write("用法: gate.ts [--strict] [--no-color] [--max-commits N] <cached|diff <range>|files <path...>|tree [dir]>\n");
      return 0;
    } else if (a.startsWith("--")) {
      process.stderr.write(`未知选项: ${a}\n`);
      return 2;
    } else if (mode === "") mode = a;
    else modeArgs.push(a);
  }

  if (!/^[0-9]+$/.test(maxCommits)) {
    process.stderr.write(`✗ --max-commits 需要非负整数（收到: '${maxCommits}'）；0 = 不限制\n`);
    return 2;
  }

  try {
    loadSpec();
  } catch (e) {
    if (e instanceof YamlError) {
      process.stderr.write(`✗ gates.yaml 解析失败: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  emptiesCache = loadEmpties();
  kwCache = loadRootcauseKeywords();

  switch (mode) {
    case "cached":
      scanDiffRange("--cached");
      break;
    case "diff": {
      if (modeArgs.length < 1) {
        process.stderr.write("用法: gate.ts diff <range>（如 origin/master...HEAD）\n");
        return 2;
      }
      const range = modeArgs[0];
      const left = range.includes("..") ? range.slice(0, range.indexOf("..")) : range;
      if (spawnSync("git", ["rev-parse", "--verify", "--quiet", left], { encoding: "utf8" }).status !== 0) {
        process.stderr.write(
          [
            `✗ 扫描范围左侧 ref 不可解析: ${range}`,
            "  常见原因：① shallow clone 深度不足（worktree 未 fetch 到该 ref 的历史）② ref 拼写错误",
            "  处理：git fetch --unshallow 或 git fetch --depth=<N> origin '+refs/heads/*:refs/remotes/origin/*'",
            `        验证：git rev-parse --verify --quiet '${left}'`,
          ].join("\n") + "\n",
        );
        return 2;
      }
      const cnt = spawnSync("git", ["rev-list", "--count", range], { encoding: "utf8" });
      const n = Number((cnt.stdout ?? "").trim());
      if (cnt.status !== 0 || Number.isNaN(n)) {
        process.stderr.write(`✗ 无法枚举扫描范围（git rev-list 失败）: ${range}\n`);
        return 2;
      }
      if (n === 0) {
        process.stderr.write(`✗ 扫描范围为 0 个 commit，拒绝静默通过: ${range}\n`);
        return 2;
      }
      if (maxCommits !== "0" && n > Number(maxCommits)) {
        process.stderr.write(
          [
            `✗ 扫描范围过大：${n} 个 commit（上限 ${maxCommits}）`,
            "  处理（任选其一）：",
            "    1) 缩到本次改动（推荐）：MB=$(git merge-base origin/master HEAD); gate.ts diff \"$MB..HEAD\"",
            `    2) 只这一次放行：gate.ts diff '${range}' --max-commits 0`,
            "    3) 全量后台跑：SCAN_PROFILE=1 SCAN_MAX_COMMITS=0 gate.ts diff '<range>' > /tmp/g.out 2> /tmp/g.err &",
          ].join("\n") + "\n",
        );
        return 2;
      }
      process.stderr.write(`扫描范围: ${range}（${n} 个 commit）\n`);
      scanDiffRange(range);
      break;
    }
    case "files": {
      if (modeArgs.length < 1) {
        process.stderr.write("用法: gate.ts files <path...>\n");
        return 2;
      }
      for (const f of modeArgs) scanOneFile(f);
      break;
    }
    case "tree":
      scanTree(modeArgs[0] ?? ".");
      break;
    default:
      process.stderr.write("用法: gate.ts <cached|diff <range>|files <path...>|tree [dir]>\n");
      return 2;
  }

  const code = render();
  // SCAN_PROFILE=1 时把「实际调了多少次 git」打到 stderr —— 这是本次重构的核心指标：
  // bash 的成本 = 门数 × commit 数 × 每门 2~6 次子进程；这里应该只与「范围大小」弱相关。
  if (process.env.SCAN_PROFILE === "1") {
    process.stderr.write(`[prof] git 子进程 ${gitCalls} 次（范围内 commit 数见上一行）\n`);
  }
  return code;
}

function loadEmpties(): string[] {
  const raw = readFileSync(join(HERE, "gates.yaml"), "utf8");
  const doc = asMap(parseYaml(raw, "gates.yaml"), "顶层");
  const q = asMap(asMap(doc.exemption, "exemption").quality, "exemption.quality");
  return strList(q.empty_values);
}

function loadRootcauseKeywords(): string[] {
  const raw = readFileSync(join(HERE, "gates.yaml"), "utf8");
  const doc = asMap(parseYaml(raw, "gates.yaml"), "顶层");
  const q = asMap(asMap(doc.exemption, "exemption").quality, "exemption.quality");
  return strList(asMap(q.batch, "exemption.quality.batch").rootcause_keywords);
}

process.exit(main(process.argv.slice(2)));
