#!/usr/bin/env node
/**
 * requirements.md 验收判据「可证伪性」实测（存量度量，不是门禁）
 *
 *   node scripts/report-spec-criteria.mjs          # 人读报告
 *   node scripts/report-spec-criteria.mjs --json   # 结构化输出（给后续分析/图表）
 *
 * 规范真源：~/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md §4 / §4.1（EARS）
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * R7 门禁（scripts/audit-specs.mjs）只判 requirements.md 里**有没有**一个叫
 * 「验收 / 判据 / EARS」的章节锚点。这意味着加一个空标题就能过 R7 —— 门禁
 * 判得了「有没有」，判不了「写的东西能不能被证伪」。
 *
 * 本脚本先**量存量**：把每条判据按可证伪强度分成 A/B/C 三档，看清欠账规模。
 * 刻意不设门禁、不改任何文件、不阻断任何流程 —— 在分布未知的情况下立门禁，
 * 唯一结果是逼出一轮糊弄式回填（R5 的历史已经证明过一次）。
 *
 * ── 三档口径（判定顺序 A → B → C）────────────────────────────────────────
 * A 可执行级：判据本身能被一条命令/一个断言判定。命中任一即算：
 *     · 可直接执行的命令（curl / bash / node / npm / npx / grep / git / psql…）
 *     · 脚本或测试文件路径（*.sh / *.mjs / *.spec.ts / tests/…）
 *     · 接口调用（`POST /api/...`、带端口的 URL）
 *     · HTTP 状态码（401/403/200…）、exit code、SQL 语句
 *     · 断言表达式（expect( / assert / === / ≥ / ≤ / 0 命中 / 逐字节一致）
 * B 数值级：没有可执行形式，但有具体锚点：数字、阈值、枚举值、字段名、
 *     接口路径、UI 文案、表名。人可据此复验，机器不能直接跑。
 * C 文字级：只有自然语言形容词（「正确」「正常」「流畅」「合理」「明确」），
 *     没有任何可对照的锚点 —— **不可证伪**，验收时只能靠吵。
 *
 * ⚠️ 与任务书的一处有意差异：任务书把「含 Given/When/Then」列为 A 的判据之一，
 *    本脚本**不**这么判。理由是实测教训：EARS 模板本身就是 When…应… 句式，
 *    一旦把句式当可执行性，`When 用户登录，系统应正常签发令牌` 也会算 A，
 *    整个度量立刻失去区分度（这与 R7 只认锚点、被空标题骗过是同一类错误）。
 *    句式仍然有用：它让「行为 + 触发条件」显式化，但**可证伪性取决于锚点**。
 *    若一条 GWT 判据同时给出命令/断言/状态码，它照样归 A。
 *
 * 区域识别 ────────────────────────────────────────────────────────────
 * 章节标题匹配 验收|判据|EARS|验证标准，且不含 验证结果|核对|矩阵|追溯|证据|
 * 统计|样例|示例|反例|边界|必然失败|待确认。子章节（如 release-platform 的
 * L1…L8）继承父章节的「命中」状态；但「验证结果」「反例」这类子章节即便在
 * 验收章节之下也排除 —— 它们是结果与边界，不是判据本身。
 * 例外：H1 是文档标题（如「流水线并发 · 需求与验收」），不参与继承，否则
 * 全文每个章节都会被当成判据区（实测会把「使用场景」表算成判据）。
 *
 * 判据单元：表格数据行（一行一条，跳过表头/分隔行/编号列）+ 列表项
 * （- / * / 1. / 复选框）。一条判据不按标点再切分，避免把一句话拆成三条刷量。
 * 「`CONSOLE_API` = ...」这类统一约定/变量定义不是判据，按定义行跳过。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = path.join(ROOT, 'specs');
const JSON_OUT = new Set(process.argv.slice(2)).has('--json');

const REGION_RE = /验收|判据|EARS|验证标准/i;
const EXCLUDE_RE = /验证结果|实测|核对|矩阵|追溯|证据|统计|样例|示例|反例|边界|必然失败|待确认/;

// ── A 档：可执行锚点 ────────────────────────────────────────────────────
const CMD_RE = /(?:^|[\s（(`])(?:curl|bash|sh|node|npm|npx|pnpm|yarn|grep|git|psql|mysql|docker|pm2|make|python3?)\s/;
const CODE_CMD_RE = /^(?:curl|bash|sh|node|npm|npx|pnpm|yarn|grep|git|psql|mysql|docker|pm2|make|python3?)\b/i;
const CODE_SQL_RE = /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i;
const CODE_VERB_RE = /^(?:GET|POST|PUT|PATCH|DELETE)\s+\//;
const PATH_RE = /(?:^|[\s`(])(?:[\w.@-]+\/)*[\w.@-]+\.(?:sh|mjs|cjs|js|ts|tsx|sql|json|ya?ml)\b/;
const TEST_PATH_RE = /\.(?:spec|test)\.[cm]?[jt]sx?\b|(?:^|\/)tests?\//;
const TEST_CMD_RE = /\b(?:npx\s+tsc|npm\s+(?:run|test)|pnpm\s+(?:run|test)|playwright\s+test)\b/;
// 常见 HTTP 状态码：这些数字几乎不存在被误当普通数值的场景
const HTTP_RE = /(?<!\d)(?:200|201|204|301|302|400|401|403|404|405|409|422|429|500|502|503|504)(?!\d)/;
const ASSERT_RE = /expect\(|\bassert\b|===|!==|≥|≤|exit\s*(?:0|≠|非\s*0)|0\s*命中|逐字节一致/;
const API_PATH_RE = /`[^`]*\/api\/[^`]*`/;

// ── B 档：具体锚点 ──────────────────────────────────────────────────────
const DIGIT_RE = /\d/;                       // 数量 / 阈值 / 端口 / 版本 / 百分比
const CODE_SPAN_RE = /`[^`]+`/;              // 字段名 / 表名 / 函数名 / 文件路径
const QUOTE_RE = /「[^」]+」|"[^"]{2,}"/;     // UI 文案 / 报错原文

function classify(raw) {
  if (CMD_RE.test(raw) || TEST_CMD_RE.test(raw)) return 'A';
  if (HTTP_RE.test(raw)) return 'A';
  if (TEST_PATH_RE.test(raw) || PATH_RE.test(raw)) return 'A';
  if (ASSERT_RE.test(raw) || API_PATH_RE.test(raw)) return 'A';
  for (const m of raw.matchAll(/`([^`]+)`/g)) {
    const s = m[1].trim();
    if (CODE_CMD_RE.test(s) || CODE_SQL_RE.test(s) || CODE_VERB_RE.test(s)) return 'A';
    if (/\s-\w/.test(s) || /:\d{4,5}\b/.test(s)) return 'A';
  }
  if (DIGIT_RE.test(raw) || CODE_SPAN_RE.test(raw) || QUOTE_RE.test(raw)) return 'B';
  return 'C';
}

/** 章节树：每个标题的「直属内容区」= 到下一个任意级别标题为止 */
function blocks(text) {
  const lines = text.split('\n');
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) heads.push({ i, level: m[1].length, title: m[2] });
  }
  const out = [];
  const stack = [];
  for (let k = 0; k < heads.length; k++) {
    const h = heads[k];
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    // H1 是文档标题，不是章节：不作为「验收区」传给子章节，也不单独成区
    const ancestors = stack.filter((a) => a.level > 1);
    stack.push(h);
    const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    // 判断排除词前先剥掉括号补语：「验收判据（EARS + 反例）」「（EARS，可机器核对）」
    // 指的是判据区本身，不能被「反例 / 核对」误杀；而「与 EARS 的覆盖核对」没有
    // 括号，剥完仍命中「核对」→ 正确排除。
    const core = (t) => t.replace(/[（(][^（）()]*[）)]/g, '');
    const selfHit = h.level > 1 && REGION_RE.test(h.title);
    const inherited = ancestors.some((a) => REGION_RE.test(a.title));
    const bad = EXCLUDE_RE.test(core(h.title)) || ancestors.some((a) => EXCLUDE_RE.test(core(a.title)));
    const qualified = (selfHit || inherited) && !bad;
    out.push({ title: h.title, body: lines.slice(h.i + 1, end), qualified });
  }
  return out;
}

/** 从直属内容区抽判据：表格数据行 + 列表项 */
function criteriaOf(bodyLines) {
  const items = [];
  let inTable = false;
  let sepSeen = false;
  for (const line of bodyLines) {
    const t = line.trim();
    if (t.startsWith('|')) {
      const isSep = /^\|[\s:|-]+\|?$/.test(t);
      if (!inTable) {
        // 表头行：跳过（下一行若是分隔行，则确认是表格）
        inTable = true;
        sepSeen = false;
        continue;
      }
      if (isSep) { sepSeen = true; continue; }
      if (!sepSeen) continue;      // 没有分隔行 → 不是合法表格，按普通行忽略
      const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (!cells.length) continue;
      // 编号列（V1 / E1 / AC3 / FR-1 / #）不参与分类，否则每个数字都会被当锚点
      if (/^[*_`\s]*(?:[A-Z]{1,4}-?\d+[a-z]?[′']?|\d+)[*_`\s]*$/i.test(cells[0])) cells.shift();
      const body = cells.filter(Boolean).join(' ').trim();
      if (body) items.push(body);
      continue;
    }
    inTable = false;
    sepSeen = false;
    const lm = t.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (!lm) continue;
    const body = lm[1].replace(/^\[[ xX]\]\s*/, '').trim();
    // 「`VAR` = 说明」是变量约定，不是判据
    if (/^`[^`]+`\s*[=＝]/.test(body)) continue;
    if (body) items.push(body);
  }
  return items;
}

function scan() {
  const reqs = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'requirements.md') reqs.push(p);
    }
  };
  walk(SPECS);
  reqs.sort();

  const features = [];
  for (const abs of reqs) {
    const file = path.relative(SPECS, abs).split(path.sep).join('/');
    const feature = file.replace(/\/requirements\.md$/, '');
    const rows = blocks(fs.readFileSync(abs, 'utf8'))
      .filter((b) => b.qualified)
      .flatMap((b) => criteriaOf(b.body));
    const items = rows.map((raw) => ({ feature, raw, grade: classify(raw) }));
    features.push({
      feature,
      file,
      hasRegion: items.length > 0,
      total: items.length,
      A: items.filter((i) => i.grade === 'A').length,
      B: items.filter((i) => i.grade === 'B').length,
      C: items.filter((i) => i.grade === 'C').length,
      items,
    });
  }

  const all = features.flatMap((f) => f.items);
  const n = (g) => all.filter((i) => i.grade === g).length;
  return {
    scanned: {
      requirementsFiles: features.length,
      withRegion: features.filter((f) => f.hasRegion).length,
      withoutRegion: features.filter((f) => !f.hasRegion).length,
    },
    totals: { criteria: all.length, A: n('A'), B: n('B'), C: n('C') },
    features,
    cSamples: all.filter((i) => i.grade === 'C').slice(0, 10),
  };
}

const data = scan();
const { totals } = data;
const pct = (x) => (totals.criteria === 0 ? '0.0' : ((x / totals.criteria) * 100).toFixed(1));

if (JSON_OUT) {
  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    scanned: data.scanned,
    totals: {
      ...totals,
      ratio: { A: `${pct(totals.A)}%`, B: `${pct(totals.B)}%`, C: `${pct(totals.C)}%` },
    },
    features: data.features.map(({ items, ...rest }) => rest),
    cSamples: data.cSamples,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

console.log('specs 判据可执行性实测（存量度量，不阻断；判定口径见脚本头注释）');
console.log(
  `扫描 ${data.scanned.requirementsFiles} 份 requirements.md：` +
    `有判据区 ${data.scanned.withRegion} ｜ 无判据区 ${data.scanned.withoutRegion}`,
);
console.log(`判据总数 ${totals.criteria}`);
console.log('');
console.log(`  A 可执行级  ${String(totals.A).padStart(3)}  (${pct(totals.A)}%)`);
console.log(`  B 数值级    ${String(totals.B).padStart(3)}  (${pct(totals.B)}%)`);
console.log(`  C 文字级    ${String(totals.C).padStart(3)}  (${pct(totals.C)}%)`);
console.log('');

const ranked = [...data.features].filter((f) => f.total > 0).sort((a, b) => b.total - a.total || a.feature.localeCompare(b.feature));
console.log(`按 feature（判据数前 ${Math.min(15, ranked.length)}）：`);
console.log('   feature                                      总数    A    B    C');
for (const f of ranked.slice(0, 15)) {
  console.log(
    `   ${f.feature.padEnd(44)} ${String(f.total).padStart(4)} ${String(f.A).padStart(4)} ` +
      `${String(f.B).padStart(4)} ${String(f.C).padStart(4)}`,
  );
}
const noRegion = data.features.filter((f) => !f.hasRegion);
if (noRegion.length) {
  console.log('');
  console.log(`无判据区（${noRegion.length}）：${noRegion.map((f) => f.feature).join(', ')}`);
}

console.log('');
console.log('C 级样例（前 10 条，不可证伪 —— 只有形容词、没有可对照的锚点）：');
data.cSamples.forEach((s, i) => {
  const text = s.raw.replace(/\s+/g, ' ').trim();
  const cut = text.length > 60 ? `${text.slice(0, 60)}…` : text;
  console.log(`  ${String(i + 1).padStart(2)}. [${s.feature}] ${cut}`);
});
console.log('');
console.log('注：A 档含命令/断言/状态码等可直接判定的锚点；B 档有数字/字段/文案等具体锚点；');
console.log('    C 档仅形容词。GWT/EARS 句式本身不计入 A —— 否则模板句式会掩盖不可证伪的判据。');
