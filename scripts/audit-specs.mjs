#!/usr/bin/env node
/**
 * specs/ 规格审计（SDD 护栏：防止命名 / 状态 / 死链再次漂移）
 *
 *   node scripts/audit-specs.mjs                    # 审计（CI 用这个）
 *   node scripts/audit-specs.mjs --update-baseline  # 把当前存量缺口记为「已知」
 *   node scripts/audit-specs.mjs --verbose          # 输出每个 feature 的明细
 *
 * 规范真源：~/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md
 *   §1 目录结构 / §2 文件命名 / §3 状态字段
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 2026-11-06 一次性治理（PR #562）把 22 份违规命名、42 份缺状态字段的 spec 修好了，
 * 但**修完不等于守住**：没有机器检查，下一个 agent / 人还会随手 `plan.md`、
 * 随手写「待拍板」。历史已经证明「写进 SOP」拦不住（SOP 生效当天实测仍有 24 份违规）。
 *
 * 机制：**基线（baseline）**，与本仓 scripts/audit-proto-registry.mjs 同款。
 *   第一次跑 --update-baseline 把存量缺口登记为 KNOWN；之后：
 *     · 基线内 → KNOWN（打印，不阻断）
 *     · 基线外新增 → FAIL（退出码 1，强制当场改对）
 *   → 存量缺口可以分批还，但**不允许继续扩大**。
 *
 * 规则编号（R1..R5）：
 *   R1 命名不合规（不在 §2 白名单）
 *   R2 requirements.md / design.md / tech-design-*.md 缺标准状态行
 *   R3 状态取值不在 §3 封闭枚举内
 *   R4 相对 markdown 链接指向不存在的文件（死链）
 *   R5 空壳 feature：目录内无任何「命名合规的产物文件」
 *   R7 requirements.md 无可验判据章节（SOP §4「功能需求 + 验收判据」/ §4.1 EARS）
 *   形态统计（原 R6，notice 级，已不构成欠账）
 *   R8 requirements.md 缺「边界与反例」/「变更日志」（notice 级，只计数）
 *
 * 为什么 R7 能阻断、R8 只能 notice —— 存量实测（8 份 requirements.md，2026-11-06）：
 *   可验判据 8/8 命中（100%）｜ 边界与反例 5/8 ｜ 变更日志 4/8 ｜ SOP §4 八个章节全齐仅 2/8。
 *   → 只有 100% 的那项做硬门才是零误杀；把八个章节名逐个对齐会一次判 6 红，
 *     而那 6 份语义都齐全（只是标题叫「需求辨证」「验证判据表」），改名纯属
 *     形式主义churn。护栏必须比规范宽松，这条已被 R2/R5 的历史误判验证过两次。
 *   → 判据锚点按**语义**匹配（验收|判据|EARS|V\d|验证标准），不认死标题。
 *
 * 「产物文件」的判定见 isProductFile()：R1 白名单内的 .md，加上原型白名单
 * （prototype.html）。这样「命名合规」与「算不算产物」是同一套标准，不会出现
 * 同一份文件 R1 判合规、R5 判无用（2026-11-06 实测：inventory-impact.md 就撞上了）。
 *
 * 为什么 R5 不写成「必须有 requirements.md」：
 *   SOP v1.0 §2.1 字面写「缺一则补」，实测 63 个 feature 里 55 个没有
 *   requirements.md。做成硬门 = 一次判 55 红，唯一结果是批量糊弄式回填。
 *   **2026-11-06 SOP 已升到 v1.1 并新增 §2.1.1「核心产物最小要求」**：
 *   requirements/design 之外，只有 api-design、只有 page-spec、只有
 *   prototype.html、只有 inventory-* 都属合法形态，不再要求补 requirements。
 *   → 于是 R5 只拦「连一个合规产物都没有」的真空壳；形态分布行只做统计。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = path.join(ROOT, 'specs');
const BASELINE = path.join(SPECS, '.sdd-baseline.json');

const CORE = new Set(['requirements.md', 'design.md', 'tasks.md']);
const TYPES = new Set([
  'api-design', 'page-spec', 'tech-design', 'review', 'progress',
  'glossary', 'index', 'handoff', 'guide', 'inventory', 'proposal',
  'adr', 'decision',
]);
// 非 md 的产物：本仓大量 feature 是原型驱动，只有 prototype.html 而无任何 md
// （pipeline-form-preview / popconfirm-width / sider-submenu-spacing 即此形态）。
const PRODUCT_NON_MD = new Set(['prototype.html']);
const STATUS = new Set([
  '草稿', '需求编写中', '方案设计中', '待评审',
  '已评审确认', '实施中', '已实现', '已归档',
]);
const STATUS_RE = /^>\s*状态：\s*(\S+?)\s*(?:｜|\|)/;
const STATUS_SCAN_LINES = 12;

const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update-baseline');
const VERBOSE = args.has('--verbose');

const BY_RULE_NAME = {
  R1: '命名不合规',
  R2: '缺状态字段',
  R3: '状态取值越界',
  R4: '死链',
  R5: '空壳 feature',
  R7: '需求无可验判据',
};

// requirements.md 的「可验判据」锚点：按语义匹配，不认死标题（SOP §4 / §4.1）
const VERIFIABLE_RE = /验收|判据|EARS|V\d|验证标准/;
// 「边界与反例」「变更日志」只做 notice（存量 5/8、4/8，硬门会误杀语义齐全的存量）
const SOFT_SECTION = {
  边界与反例: /边界|反例|非目标|不做/,
  变更日志: /变更日志|changelog/i,
};

const findings = [];
const add = (rule, feature, file, detail) =>
  findings.push({ key: `${rule}|${feature}|${file}`, rule, feature, file, detail });

/** 文件名是否符合 §2.1 白名单 */
function nameCompliant(name) {
  if (CORE.has(name)) return true;
  const base = name.replace(/\.md$/, '');
  // handoff 允许 P0-/P1-/HANDOFF 前缀，归一成 handoff
  const norm = base.replace(/^(P0-|P1-|HANDOFF-?)/i, 'handoff-').replace(/-$/, '');
  // 类型名本身可能带连字符（api-design / page-spec / tech-design），
  // 因此要按「整串等于类型」或「类型 + -」匹配，不能按第一段切分。
  for (const t of TYPES) {
    if (norm === t || norm.startsWith(`${t}-`)) return true;
  }
  return false;
}

/** 目录内是否存在「算得上产物」的文件：命名合规的 .md，或原型白名单 */
function isProductFile(name) {
  return PRODUCT_NON_MD.has(name) || (name.endsWith('.md') && nameCompliant(name));
}

/**
 * 缺 requirements.md 的 feature 属于哪种形态。
 * R6 只做计数，但要让人一眼看出欠账性质：36 个「有 design 无需求」跟
 * 11 个「纯 api-design」是完全不同的两件事，前者可议、后者是合理形态。
 * 分类口径见 30-任务产物/2026-11-06-web_system-specs治理/04-R6欠账分类-*.md
 */
function shapeOf(allFiles) {
  const names = allFiles.map((f) => path.basename(f));
  const has = (re) => names.some((n) => re.test(n));
  if (names.includes('design.md')) return 'design';
  const hasApi = has(/^api-design/);
  const hasPage = has(/^page-spec/);
  const hasTd = has(/^tech-design/);
  if (hasApi && !hasPage && !hasTd) return 'api';
  if (hasPage && !hasApi && !hasTd) return 'page';
  if (hasTd) return 'techDesign';
  if (names.includes('prototype.html')) return 'proto';
  if (has(/^inventory-/)) return 'inventory';
  return 'other';
}

const SHAPE_LABEL = {
  design: '有 design',
  api: '纯 api-design',
  page: '纯 page-spec',
  techDesign: '有 tech-design',
  proto: '纯原型',
  inventory: '纯 inventory',
  other: '其它',
};

/** 目录内所有文件（含非 md）—— 空目录判定与产物判定共用 */
function walkAll(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAll(p, acc);
    else acc.push(p);
  }
  return acc;
}

if (!fs.existsSync(SPECS)) {
  console.error(`specs/ 不存在：${SPECS}`);
  process.exit(1);
}

const features = fs
  .readdirSync(SPECS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const emptyDirs = [];
const noReqDirs = [];
const softMissing = [];
let mdTotal = 0;

for (const feature of features) {
  const dir = path.join(SPECS, feature);
  const allFiles = walkAll(dir);
  // 空目录按「递归无任何文件」判。旧版按 .md 计数，把只有 prototype.html 的
  // 原型目录误报成空目录（2026-11-06 实测误报 3 个）。
  if (allFiles.length === 0) { emptyDirs.push(feature); continue; }

  const files = allFiles.filter((f) => f.endsWith('.md'));
  mdTotal += files.length;

  // R5 空壳守卫：目录里有文件，但没有一个算产物（命名违规 / 纯素材）。
  // 刻意**不**要求「每 feature 必有 requirements.md」——那会一次判 52 个存量
  // feature 违规（含 16 个只有 api-design 的纯接口契约 feature、含 nce 这类
  // 只有 page-spec 的），逼着人去补 52 份文档，只会逼出糊弄式回填。
  // 「requirements.md 覆盖率」按 §2.1 的欠账另行跟踪（见 R6 提示），不进阻断面。
  if (!allFiles.some((f) => isProductFile(path.basename(f)))) {
    add('R5', feature, '(dir)', `无命名合规的产物文件（现有：${allFiles.map((f) => path.basename(f)).join(', ')}）`);
  }

  if (!files.some((f) => path.basename(f) === 'requirements.md')) {
    noReqDirs.push({ feature, shape: shapeOf(allFiles) });
  }

  for (const abs of files) {
    // 相对 feature 目录的路径，输出时前面再拼 feature 名（否则会显示成 a/a/x.md）
    const rel = path.relative(dir, abs);
    const name = path.basename(abs);
    const text = fs.readFileSync(abs, 'utf8');

    // R1 命名
    if (!nameCompliant(name)) add('R1', feature, rel, `文件名不在白名单：${name}`);

    // R2 / R3 状态字段（SOP §3 只约束 requirements.md / design.md；
    // tech-design-* 不在强制面，不检查 —— 护栏不能比规范更严，否则就是噪音）
    if (/^(requirements\.md|design\.md)$/.test(name)) {
      const head = text.split('\n').slice(0, STATUS_SCAN_LINES);
      const line = head.find((l) => STATUS_RE.test(l));
      if (!line) add('R2', feature, rel, '顶部缺 `> 状态：<枚举> ｜ <YYYY-MM-DD>`');
      else {
        const val = line.match(STATUS_RE)[1];
        if (!STATUS.has(val)) add('R3', feature, rel, `状态取值不在枚举内：${val}`);
      }
    }

    // R7 / R8 requirements.md 章节完整性（SOP §4）
    // 只扫**标题行**：正文里提一句「验收」不算写了验收判据。
    if (name === 'requirements.md') {
      const heads = (text.match(/^#{1,4} .+$/gm) ?? []).join('\n');
      if (!VERIFIABLE_RE.test(heads)) {
        add('R7', feature, rel, '无可验判据章节（SOP §4「功能需求 + 验收判据」/ §4.1 EARS）');
      } else {
        const miss = Object.keys(SOFT_SECTION).filter((k) => !SOFT_SECTION[k].test(heads));
        if (miss.length) softMissing.push({ feature, file: rel, miss });
      }
    }

    // R4 死链
    const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
    let m;
    while ((m = re.exec(text))) {
      let target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      target = target.split('#')[0];
      if (!target) continue;
      const targetAbs = target.startsWith('/')
        ? path.join(ROOT, target)
        : path.resolve(path.dirname(abs), target);
      if (!fs.existsSync(targetAbs)) add('R4', feature, rel, `死链 -> ${m[1]}`);
    }
  }
}

// ── 基线比对 ────────────────────────────────────────────────────────────
const known = fs.existsSync(BASELINE)
  ? JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  : { updatedAt: null, entries: {} };
const knownKeys = new Set(Object.keys(known.entries ?? {}));
const currentKeys = new Set(findings.map((f) => f.key));

const fresh = findings.filter((f) => !knownKeys.has(f.key));
const stale = [...knownKeys].filter((k) => !currentKeys.has(k));

if (UPDATE) {
  const entries = {};
  for (const f of findings) entries[f.key] = { rule: f.rule, detail: f.detail };
  fs.writeFileSync(
    BASELINE,
    JSON.stringify({ updatedAt: new Date().toISOString().slice(0, 10), entries }, null, 2) + '\n',
  );
  console.log(`基线已更新：${Object.keys(entries).length} 条 → ${path.relative(ROOT, BASELINE)}`);
  process.exit(0);
}

// ── 报告 ────────────────────────────────────────────────────────────────
const byRule = {};
for (const f of findings) (byRule[f.rule] ??= []).push(f);

console.log(`specs 审计：${features.length} 个 feature / ${mdTotal} 份 md`);
console.log(`已知存量（基线内）：${findings.length - fresh.length} ｜ 本次新增：${fresh.length} ｜ 基线已失效：${stale.length}`);
for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5', 'R7']) {
  const list = byRule[rule] ?? [];
  if (!list.length) continue;
  const freshN = list.filter((f) => !knownKeys.has(f.key)).length;
  console.log(`  ${rule} ${BY_RULE_NAME[rule]}：${list.length} 处（新增 ${freshN}）`);
}
if (emptyDirs.length) {
  console.log(`  提示 · 空目录 ${emptyDirs.length} 个（git 不跟踪，建议清理）：${emptyDirs.join(', ')}`);
}
// R8 notice：SOP §4 的「边界与反例」「变更日志」两章节。只计数，不阻断
// （存量实测 5/8、4/8；缺的多是 9 月早期 spec，语义另有承载，硬门只会逼改名）
if (softMissing.length) {
  const c = {};
  for (const r of softMissing) for (const k of r.miss) c[k] = (c[k] ?? 0) + 1;
  console.log(
    `  R8 章节欠账（notice，不阻断）：${softMissing.length} 份 requirements.md —— ` +
      Object.entries(c).map(([k, v]) => `缺${k} ${v}`).join(' ｜ '),
  );
  if (VERBOSE) for (const r of softMissing) console.log(`     · ${r.feature}/${r.file}：缺 ${r.miss.join('、')}`);
}
// 形态统计：SOP v1.1 §2.1.1 已认定这些形态全部合法，只做分布统计，永不阻断
if (noReqDirs.length) {
  const byShape = {};
  for (const { feature, shape } of noReqDirs) (byShape[shape] ??= []).push(feature);
  const summary = Object.keys(SHAPE_LABEL)
    .filter((s) => byShape[s])
    .map((s) => `${SHAPE_LABEL[s]} ${byShape[s].length}`)
    .join(' ｜ ');
  console.log(
    `  形态分布 · 无 requirements.md 的 feature：${noReqDirs.length}/${features.length}` +
      '（按 SOP §2.1.1 均属合法形态，非欠账）',
  );
  console.log(`     ${summary}`);
  if (VERBOSE) {
    for (const s of Object.keys(SHAPE_LABEL)) {
      if (byShape[s]) console.log(`     · ${SHAPE_LABEL[s]}（${byShape[s].length}）：${byShape[s].join(', ')}`);
    }
  }
}
if (VERBOSE) {
  console.log('\n--- 明细 ---');
  for (const f of findings) {
    console.log(`${knownKeys.has(f.key) ? 'KNOWN' : 'FAIL '} ${f.rule} ${f.feature}/${f.file} — ${f.detail}`);
  }
}
if (stale.length) {
  console.log('\n基线内已修复的条目（可跑 --update-baseline 收缩）：');
  for (const k of stale.slice(0, 20)) console.log(`  ${k}`);
  if (stale.length > 20) console.log(`  … 共 ${stale.length} 条`);
}
if (fresh.length) {
  console.log('\n🔴 新增违规（必须当场修正，或明确立项后再进基线）：');
  for (const f of fresh) console.log(`  ${f.rule} ${f.feature}/${f.file} — ${f.detail}`);
  console.log('\n规则真源：~/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md §2 / §3');
  process.exit(1);
}
console.log('\n✅ 无新增违规（存量缺口见基线）');
process.exit(0);
