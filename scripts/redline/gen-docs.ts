/**
 * gen-docs.ts — 从 gates.yaml 生成文档里的门号清单（S4）
 *
 * 用法：
 *   node scripts/redline/gen-docs.ts           生成（就地改写标记区块）
 *   node scripts/redline/gen-docs.ts --check   只检查是否过期（exit 1 = 有区块过期）
 *
 * 🔴 为什么需要它：
 *   S3 让 gates.yaml 成了判据的唯一来源，但**文档里的门号清单还是手抄的**。
 *   加一道门要记得改 3 处文档 —— 漏了不报错、不崩溃，只是文档慢慢和实际不符。
 *   这类漂移有毒：读者按文档判断「这提交会被拦吗」，而文档说的是三个月前的事。
 *
 *   以前 03 的表格里有一列「实现函数」（`check_r9`、`check_line_error`…），
 *   切主后那些 bash 函数全部退场，这一列整整一列都是假的 —— 手抄表格的典型下场。
 *
 * 🔴 边界（哪些表不生成）：
 *   只生成**纯清单** —— 字段能一对一映射到 YAML 的部分。
 *   含判断的表（如 01 §2「想让它真拦需要」里写的「--strict 不建议：CORS 形态多」）
 *   不生成：那是人的决策理由，YAML 里没有对应字段，硬生成只会把判断压成模板话术。
 *   这类表的价值恰在判断，不在清单。
 *
 * 退出码：0=成功/未过期 1=--check 发现过期 2=用法或解析错误
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml, YamlError } from "./lib/yaml-mini.ts";
import type { YamlMap, YamlValue } from "./lib/yaml-mini.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOP = resolve(HERE, "../..");
const GATES_YAML = join(HERE, "gates.yaml");

interface Gate {
  id: string;
  sub: string | null;
  /** 条目名：sub 优先（R2.secret-file / R2.cred 必须分开，它们判的是两回事） */
  key: string;
  title: string;
  level: string;
  stage: string;
  trigger: YamlMap;
  credential: YamlMap | null;
  specRef: string;
  /** 有 level_switch 且 default=off 的门在运行时不参与判定，文档里单列一组 */
  switchDefault: string | null;
}

/** 生成目标：哪个文件的哪个标记区块 */
interface Target {
  id: string;
  file: string;
  /** 生成内容（不含标记本身） */
  render: (gates: Gate[]) => string;
}

// ------------------------------------------------------------
// 读 gates.yaml
// ------------------------------------------------------------

function asMap(v: YamlValue | undefined, ctx: string): YamlMap {
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`${ctx} 应为映射`);
  }
  return v;
}

function asMapOrNull(v: YamlValue | undefined): YamlMap | null {
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) return null;
  return v;
}

function str(v: YamlValue | undefined, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function loadGates(): Gate[] {
  const doc = asMap(parseYaml(readFileSync(GATES_YAML, "utf8"), "gates.yaml"), "顶层");
  const raw = doc.gates;
  if (!Array.isArray(raw)) throw new Error("gates 应为列表");
  return raw.map((item) => {
    const m = asMap(item, "gates[]");
    const id = str(m.id);
    const sub = m.sub === null || m.sub === undefined ? null : str(m.sub);
    const sw = asMapOrNull(m.level_switch);
    return {
      id,
      sub,
      key: sub ?? id,
      title: str(m.title),
      level: str(m.level),
      stage: str(m.stage),
      trigger: asMapOrNull(m.trigger) ?? {},
      credential: asMapOrNull(m.credential),
      specRef: str(m.spec_ref),
      switchDefault: sw === null ? null : str(sw.default, ""),
    };
  });
}

// ------------------------------------------------------------
// 分组：阻断 / 只提示 / 失效（默认关）
// ------------------------------------------------------------

interface Groups {
  blocking: Gate[];
  advisory: Gate[];
  disabled: Gate[];
}

function groupOf(g: Gate): keyof Groups {
  if (g.switchDefault === "off" || g.switchDefault === "skip") return "disabled";
  if (g.level === "error") return "blocking";
  return "advisory";
}

function groupGates(gates: Gate[]): Groups {
  const out: Groups = { blocking: [], advisory: [], disabled: [] };
  for (const g of gates) out[groupOf(g)].push(g);
  return out;
}

/** 组内按「门号 + sub」自然序：R2 在 R10 前面，R10 在 R11b 前面 */
function sortKeys(gates: Gate[]): string[] {
  return gates
    .map((g) => g.key)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

// ------------------------------------------------------------
// 触发面摘要：给明细表用，不追求完整，只求能认出「什么改动会触发」
// ------------------------------------------------------------

function triggerSummary(g: Gate): string {
  const t = g.trigger;
  const parts: string[] = [];
  const short = (s: string): string => (s.length > 26 ? `${s.slice(0, 26)}…` : s);

  switch (g.stage) {
    case "line": {
      const scope = str(t.scope);
      if (scope !== "") parts.push(`scope=${scope}`);
      if (t.skip_comment_line === true) parts.push("跳过注释行");
      break;
    }
    case "file": {
      // 正则用 /…/ 包起来标出「这是正则」，与 glob 区分 —— 两者语义不同，
      // 2026-11-11 就是因为混用导致 .env 完全不报（见 gate.ts triggerPathHit 注释）
      const re = str(t.match_re);
      const glob = str(t.match_path);
      const alt = asMapOrNull(t.alt);
      const altRe = alt === null ? "" : str(alt.match_re);
      const altGlob = alt === null ? "" : str(alt.match_path);
      if (re !== "") parts.push(`/${short(re)}/${altRe !== "" ? " +alt" : ""}`);
      else if (glob !== "") parts.push(`${glob}${altGlob !== "" ? ` +alt ${altGlob}` : ""}`);
      break;
    }
    case "commit":
    case "range": {
      const scope = str(t.scope);
      if (scope !== "") parts.push(`scope=${scope}`);
      const th = asMapOrNull(t.threshold);
      if (th !== null && typeof th.lines === "number") parts.push(`≥${th.lines} 行`);
      break;
    }
    case "delegated": {
      parts.push(str(t.delegate));
      break;
    }
    case "external": {
      // 仓外门：读 implementer（谁实现的），不读 note —— note 是「为什么编号长这样」的
      // 背景说明，不是触发条件。把它当触发面显示会让读者以为「碰到无 R7 就会触发」。
      const impl = str(t.implementer);
      parts.push(impl !== "" ? `\`${impl}\`（仓外）` : "仓外脚本");
      break;
    }
    default: {
      parts.push(g.stage);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** 凭证摘要：`Contract: pass|路径`，无凭证写「—」 */
function credentialSummary(g: Gate): string {
  if (g.credential === null) return "—";
  const trailer = str(g.credential.trailer);
  const accept = g.credential.accept;
  const forms: string[] = [];
  if (Array.isArray(accept)) {
    for (const a of accept) {
      if (a === "pass") forms.push("pass");
      else if (a === "path") forms.push("报告路径");
      else if (a === "sha") forms.push("sha");
      else if (typeof a === "string") forms.push(a);
    }
  }
  return forms.length > 0 ? `\`${trailer}: pass\` / ${forms.filter((f) => f !== "pass").join("、") || "—"}` : `\`${trailer}\``;
}

/** 判据源：仓外路径保留原样（它就是要人去看那个文件的），仓内路径保留相对路径 */
function specRefCell(g: Gate): string {
  if (g.specRef === "") return "—";
  return `\`${g.specRef}\``;
}

// ------------------------------------------------------------
// 各目标的渲染
// ------------------------------------------------------------

/**
 * 03 · A.1 全量门表。
 *
 * 🔴 「实现函数」列已删除：那一列写的是 bash 函数名（check_r9 / _trailer_check_one），
 *    切主后 bash 退场，整列都是失效信息。换成「阶段 + 触发面」，这是读者真正要的 ——
 *    「什么改动会被这道门看见」。
 */
function renderGateTable(gates: Gate[]): string {
  const lines: string[] = [
    "| 条目 | 名称 | 级别 | 阶段 | 触发面 | 凭证 | 判据源 |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const g of gates) {
    const level = g.switchDefault === "off" ? `${g.level}（默认 off）` : g.level;
    lines.push(
      `| \`${g.key}\` | ${g.title} | ${level} | ${g.stage} | ${triggerSummary(g)} | ${credentialSummary(g)} | ${specRefCell(g)} |`,
    );
  }
  return lines.join("\n");
}

/**
 * 分组清单 —— 两个目标共用同一套分组，但列不同：
 *   summary（质量门禁总纲）：类别 | 数量 | 含义 | 编号
 *   pr（PR 模板）：        类别 | 含义 | 本次
 *
 * 非红线门的固定尾巴（B6 原型三件套 / L1 L5 L9 流水线 / D1 D2 D3 / L6）写在这里，
 * 因为它们不在 gates.yaml 里 —— gates.yaml 只收红线门。尾巴是常量，不是手抄清单。
 *
 * 🔴 数量口径要写清构成：只报「8」会让人以为门变少了（旧文档写 13）。
 *   旧口径把 R1–R4 当 4 个门号算，实际它们展开是 6 个条目（R2/R3/R4 各一号两义），
 *   而且旧文档漏了 R19（error 级空提交门）。所以数字对不上不是「门少了」，是旧口径少算。
 */
const PIPELINE_BLOCKING = 7; // B6 原型三件套(1) + L1 L5 L9(3) + D1 D2 D3(3)
const PIPELINE_ADVISORY = 1; // L6

function renderGroupedLines(gates: Gate[], style: "summary" | "pr"): string {
  const gs = groupGates(gates);
  const join = (arr: Gate[]): string => sortKeys(arr).map((k) => `\`${k}\``).join(" ");
  const p = gs.blocking.length;
  const a = gs.advisory.length;
  const d = gs.disabled.length;

  if (style === "summary") {
    const rows = [
      `| **门禁**（会阻断） | **${p + PIPELINE_BLOCKING}**（红线 ${p} + 流水线 ${PIPELINE_BLOCKING}） | 错了就合不进去 | ${join(gs.blocking)} · B6 原型三件套 · L1 L5 L9 · D1 D2 D3 |`,
      `| **体检项**（只提示） | **${a + PIPELINE_ADVISORY}**（红线 ${a} + L6） | PR 上恒绿，仅提醒 | ${join(gs.advisory)} · L6 |`,
    ];
    if (d > 0) rows.push(`| 失效 | **${d}** | 默认不跑 | ${join(gs.disabled)}（\`DESIGN_ANCHOR_MODE=off\`） |`);
    return rows.join("\n");
  }

  const rows = [
    `| **门禁**（会阻断） | ${join(gs.blocking)} · 原型三件套 · L1/L5/L9 流水线 · build/test/lint | CI 全绿即通过 |`,
    `| **体检项**（只提示） | ${join(gs.advisory)} · L6 | 有输出请贴摘要 + 一句「为何可接受」 |`,
  ];
  if (d > 0) rows.push(`| 默认关闭（不参与判定） | ${join(gs.disabled)} | 需显式设 \`DESIGN_ANCHOR_MODE\` 才生效 |`);
  return rows.join("\n");
}

// ------------------------------------------------------------
// 标记区块替换
// ------------------------------------------------------------

function markerBegin(id: string): string {
  return `<!-- gen:${id} BEGIN -->`;
}
function markerEnd(id: string): string {
  return `<!-- gen:${id} END -->`;
}

/** 返回标记之间的内容；标记缺失返回 null（调用方报错，不静默跳过） */
function extractBlock(text: string, id: string): string | null {
  const b = markerBegin(id);
  const e = markerEnd(id);
  const i = text.indexOf(b);
  if (i < 0) return null;
  const j = text.indexOf(e, i);
  if (j < 0) return null;
  return text.slice(i + b.length, j).replace(/^\n/, "").replace(/\n$/, "");
}

function replaceBlock(text: string, id: string, content: string): string {
  const b = markerBegin(id);
  const e = markerEnd(id);
  const i = text.indexOf(b);
  const j = text.indexOf(e, i);
  return text.slice(0, i + b.length) + "\n" + content + "\n" + text.slice(j);
}

// ------------------------------------------------------------
// 目标清单
// ------------------------------------------------------------

const TARGETS: Target[] = [
  {
    id: "gate-table",
    file: "docs/development/gates/03-治理与索引.md",
    render: renderGateTable,
  },
  {
    id: "gate-summary",
    file: "docs/development/质量门禁总纲.md",
    render: (g) => renderGroupedLines(g, "summary"),
  },
  {
    id: "pr-gates",
    file: ".github/pull_request_template.md",
    render: (g) => renderGroupedLines(g, "pr"),
  },
];

// ------------------------------------------------------------
// 主流程
// ------------------------------------------------------------

function main(argv: string[]): number {
  const checkOnly = argv.includes("--check");
  if (argv.some((a) => a.startsWith("--") && a !== "--check")) {
    process.stderr.write("用法: gen-docs.ts [--check]\n");
    return 2;
  }

  let gates: Gate[];
  try {
    gates = loadGates();
  } catch (e) {
    if (e instanceof YamlError) {
      process.stderr.write(`✗ gates.yaml 解析失败: ${e.message}\n`);
      return 2;
    }
    throw e;
  }

  const stale: Target[] = [];
  const missingMarker: Target[] = [];

  for (const t of TARGETS) {
    const path = join(TOP, t.file);
    if (!existsSync(path)) {
      missingMarker.push(t);
      process.stderr.write(`✗ ${t.file} 不存在\n`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    const current = extractBlock(text, t.id);
    if (current === null) {
      missingMarker.push(t);
      process.stderr.write(`✗ ${t.file} 缺少标记 <!-- gen:${t.id} BEGIN/END -->\n`);
      continue;
    }
    const next = t.render(gates);
    if (current === next) continue;
    stale.push(t);
    if (!checkOnly) writeFileSync(path, replaceBlock(text, t.id, next), "utf8");
  }

  if (missingMarker.length > 0) {
    process.stderr.write(
      [
        "",
        `✗ ${missingMarker.length} 个目标缺少标记区块，无法生成。`,
        "  修法：在目标位置补上一对标记（内容写在两行之间，会被整体替换）：",
        ...missingMarker.map((t) => `    <!-- gen:${t.id} BEGIN -->\n    ...\n    <!-- gen:${t.id} END -->   ← ${t.file}`),
        "",
      ].join("\n"),
    );
    return 2;
  }

  if (checkOnly) {
    if (stale.length === 0) {
      process.stdout.write(`✓ 文档生成区块与 gates.yaml 一致（${TARGETS.length} 处）\n`);
      return 0;
    }
    process.stderr.write(
      [
        "",
        `✗ ${stale.length} 处文档区块已过期（gates.yaml 改了但没重新生成）：`,
        ...stale.map((t) => `    ${t.file}  [${t.id}]`),
        "",
        "  修法：node scripts/redline/gen-docs.ts",
        "  为什么要卡这一步：手抄的门号清单会慢慢和实际不符，而读者是照着文档判断",
        "  「这个提交会不会被拦」的。文档说三道门、实际五道，是最难查的那种错。",
        "",
      ].join("\n"),
    );
    return 1;
  }

  if (stale.length === 0) {
    process.stdout.write(`✓ 已是最新（${TARGETS.length} 处，无改动）\n`);
  } else {
    process.stdout.write(`✓ 已生成 ${stale.length} 处：\n`);
    for (const t of stale) process.stdout.write(`    ${t.file}  [${t.id}]\n`);
  }
  return 0;
}

process.exit(main(process.argv.slice(2)));
