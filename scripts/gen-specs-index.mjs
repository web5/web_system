#!/usr/bin/env node
/**
 * specs/ 规格索引生成器（给 65 个 feature 一个可读入口）
 *
 *   node scripts/gen-specs-index.mjs          # 生成 / 覆盖 specs/README.md
 *   node scripts/gen-specs-index.mjs --check  # 只校验磁盘上的索引是否最新（CI/本地）
 *
 * 规范真源：~/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md
 *   §1 目录结构 / §2 文件命名 / §3 状态字段 / §4 requirements 章节
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 2026-11-06 实测：specs/ 下 65 个 feature、117 份 md，但**没有任何索引入口**
 * —— 新人 / agent 打开 specs/ 只看到一堆目录名，不知道哪个有方案、哪个只是
 * 一张接口契约、哪个还是空壳。「找不到」直接导致重复立项与重复讨论。
 *
 * 机制：**生成而非手写**。索引里每个数字、每个日期都由脚本现算：
 *   · 形态分组复用 audit-specs.mjs 的 shapeOf()（同一套判定，不另立口径）
 *   · 状态复用 STATUS 封闭枚举（越界值打 ⚠️，不静默吞掉）
 *   · 最后更新一律取 `git log -1 --format=%cs`，**不用文件 mtime**
 *
 * ── 为什么禁用 mtime ────────────────────────────────────────────────────
 * mtime 在 git checkout / clone 后全部变成「刚才」，于是 --check 会永远红，
 * 红久了就没人再跑它。提交时间才是「这份 spec 最后一次被人动过」的稳定事实。
 * 为了 65 个 feature 不跑 65 次 git，这里一次 `git log --name-only` 全量解析。
 *
 * ── 空目录为什么要单列 ──────────────────────────────────────────────────
 * git 不跟踪空目录，但它们若存在就是本地残留（删了一半的 feature）。静默丢掉
 * 等于让「消失的 feature」无从发现，所以索引里保留一行「空目录」告警。
 *
 * ── 与门禁的关系 ────────────────────────────────────────────────────────
 * 本脚本**不是**门禁：`--check` 目前只手动跑（npm run specs:index:check），
 * 没挂进 check:specs / CI。索引是阅读辅助，红一次不该挡住任何人的提交。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  STATUS, STATUS_RE, STATUS_SCAN_LINES, VERIFIABLE_RE, SOFT_SECTION,
  shapeOf, SHAPE_LABEL, walkAll,
} from './lib/spec-rules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = path.join(ROOT, 'specs');
const OUT = path.join(SPECS, 'README.md');
const CHECK = new Set(process.argv.slice(2)).has('--check');

// 分组顺序固定（阅读顺序 = 从最完整到最空）。techDesign / other 只有在真的
// 出现时才输出一节 —— 2026-11-06 实测两者均为 0，输出里不会凭空多出空表。
const GROUP_ORDER = ['design', 'api', 'page', 'proto', 'inventory', 'techDesign', 'other'];

/**
 * 从 md 头部 12 行提取状态原值；抽不到返回 null。
 * 优先级：requirements.md → design.md → 其余按字母序（feature 状态以需求/方案为准）。
 */
function statusOfFeature(mdFiles) {
  const ordered = [...mdFiles].sort((a, b) => {
    const rank = (p) => {
      const n = path.basename(p);
      if (n === 'requirements.md') return 0;
      if (n === 'design.md') return 1;
      return 2;
    };
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  for (const abs of ordered) {
    const head = fs.readFileSync(abs, 'utf8').split('\n').slice(0, STATUS_SCAN_LINES);
    const line = head.find((l) => STATUS_RE.test(l));
    if (line) return line.match(STATUS_RE)[1];
  }
  return null;
}

/**
 * 状态列。原值可能带 Markdown 加粗 / 括号日期（如 `**待负责人确认**（2026-09-22）`），
 * 先剥符号与尾注再判枚举 —— 否则「合法状态被加粗」会被误报成越界。
 * 真越界时保留原值（截断 12 字），只写「⚠️ 原值」读者无从判断该改成什么。
 */
function statusCell(raw) {
  if (raw === null) return '（未声明）';
  const clean = raw
    .replace(/[*_`~]/g, '')
    .replace(/[（(][^（）()]*[）)]\s*$/, '')
    .trim();
  if (STATUS.has(clean)) return clean;
  const shown = clean.length > 12 ? `${clean.slice(0, 12)}…` : clean;
  return `⚠️ 原值：${shown || '（空）'}`;
}

/**
 * 每个 feature 的最后提交日期。一次 git log 全量解析，避免 65 次进程启动。
 * 输出形如：
 *   \x1f2026-11-06
 *
 *   specs/deploy-console/design.md
 *   specs/deploy-console/page-spec.md
 * 取路径第一段作为 feature 名；同一个 feature 只记第一次出现（log 是倒序）。
 */
function lastCommitDates(features) {
  const map = new Map();
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['-c', 'core.quotepath=false', 'log', '--format=\x1f%cs', '--name-only', '--', 'specs/'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    // 非 git 环境（如从 tarball 解压）：无法取提交日期，全部留空。
    // 不用 mtime 兜底，否则 --check 在 checkout 后会随机变红。
    return map;
  }
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('\x1f')) {
      map.set('\x00current', line.slice(1).trim());
      continue;
    }
    if (!line.startsWith('specs/')) continue;
    const seg = line.slice('specs/'.length).split('/')[0];
    if (!seg || !features.has(seg)) continue;
    if (!map.has(seg)) map.set(seg, map.get('\x00current') ?? '—');
  }
  map.delete('\x00current');
  return map;
}

function readFeatures() {
  const names = fs
    .readdirSync(SPECS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const rows = [];
  for (const name of names) {
    const dir = path.join(SPECS, name);
    const allFiles = walkAll(dir);
    const mdFiles = allFiles.filter((f) => f.endsWith('.md'));
    rows.push({
      name,
      dir,
      empty: allFiles.length === 0,
      allFiles,
      mdFiles,
      shape: allFiles.length === 0 ? 'empty' : shapeOf(allFiles),
      status: allFiles.length === 0 ? null : statusOfFeature(mdFiles),
    });
  }
  return rows;
}

/** 文件列：requirements → design → tasks → 其余字母序，最多 3 个 */
function fileCell(mdFiles) {
  const names = mdFiles.map((f) => path.relative(SPECS, f).split(path.sep).slice(1).join('/'));
  const rank = (n) => {
    const base = n.split('/').pop();
    if (base === 'requirements.md') return 0;
    if (base === 'design.md') return 1;
    if (base === 'tasks.md') return 2;
    return 3;
  };
  const sorted = [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (sorted.length === 0) return '（无 md）';
  const shown = sorted.slice(0, 3);
  const more = sorted.length - shown.length;
  return shown.join(' · ') + (more > 0 ? ` … +${more}` : '');
}

function r8Debt(rows) {
  const out = [];
  for (const r of rows) {
    const req = r.mdFiles.find((f) => path.basename(f) === 'requirements.md');
    if (!req) continue;
    const heads = (fs.readFileSync(req, 'utf8').match(/^#{1,4} .+$/gm) ?? []).join('\n');
    // 与 audit-specs.mjs 同一口径：只统计「已过 R7」的 requirements.md
    if (!VERIFIABLE_RE.test(heads)) continue;
    const miss = Object.keys(SOFT_SECTION).filter((k) => !SOFT_SECTION[k].test(heads));
    if (miss.length) out.push({ feature: r.name, miss });
  }
  return out.sort((a, b) => a.feature.localeCompare(b.feature));
}

function build() {
  const rows = readFeatures();
  const dates = lastCommitDates(new Set(rows.map((r) => r.name)));

  const count = (fn) => rows.filter(fn).length;
  const hasReq = count((r) => r.mdFiles.some((f) => path.basename(f) === 'requirements.md'));
  const hasDesign = count((r) => r.mdFiles.some((f) => path.basename(f) === 'design.md'));
  const empty = count((r) => r.empty);
  const mdTotal = rows.reduce((n, r) => n + r.mdFiles.length, 0);

  const groups = new Map(GROUP_ORDER.map((k) => [k, []]));
  for (const r of rows) {
    if (r.empty) continue;
    (groups.get(r.shape) ?? groups.get('other')).push(r);
  }

  const L = [];
  L.push('# web_system 规格索引（specs/）');
  L.push('');
  L.push('> 本文件由 `node scripts/gen-specs-index.mjs` 生成，**请勿手工编辑**。');
  L.push('> 改完后跑 `npm run specs:index` 重新生成；CI/本地校验用 `npm run specs:index:check`。');
  L.push('> 规范见《规格驱动开发 SDD SOP》；新增 feature 用 `npm run new:spec -- <slug> [--design]`。');
  L.push('');
  L.push('## 一图看规模');
  L.push('');
  L.push('| 指标 | 数量 |');
  L.push('|---|---|');
  L.push(`| feature 总数 | ${rows.length} |`);
  L.push(`| 有 requirements.md | ${hasReq} |`);
  L.push(`| 有 design.md | ${hasDesign} |`);
  for (const k of ['api', 'page', 'proto', 'inventory']) {
    L.push(`| ${SHAPE_LABEL[k].replace(/^纯/, '仅')} | ${count((r) => !r.empty && r.shape === k)} |`);
  }
  L.push(`| 空目录 | ${empty} |`);
  L.push(`| 文件总数 | ${mdTotal} |`);
  L.push('');
  L.push('> 「文件总数」口径：`specs/<feature>/` 下递归的 `.md` 文件数（不含 `.sdd-baseline.json`、`prototype.html`、`.sql` 等非 md 产物）。');
  L.push('');
  L.push('## 按形态分组');
  L.push('');
  L.push('> 形态判定与 `scripts/audit-specs.mjs` 同源（`scripts/lib/spec-rules.mjs`），不另立口径。');
  L.push('');

  for (const k of GROUP_ORDER) {
    const list = groups.get(k) ?? [];
    if (k !== 'design' && list.length === 0) continue;
    L.push(`### ${SHAPE_LABEL[k]}（${list.length}）`);
    L.push('');
    if (list.length === 0) {
      L.push('（无）');
      L.push('');
      continue;
    }
    L.push('| Feature | 状态 | 文件 | 最后更新 |');
    L.push('|---|---|---|---|');
    for (const r of list) {
      const status = statusCell(r.status);
      L.push(`| [\`${r.name}\`](./${r.name}/) | ${status} | ${fileCell(r.mdFiles)} | ${dates.get(r.name) ?? '—'} |`);
    }
    L.push('');
  }

  // 空目录单列（git 不跟踪，出现即为本地残留）
  L.push(`### 空目录（${empty}）`);
  L.push('');
  const emptyRows = rows.filter((r) => r.empty);
  if (emptyRows.length === 0) {
    L.push('（无）');
  } else {
    L.push('| Feature | 状态 | 文件 | 最后更新 |');
    L.push('|---|---|---|---|');
    for (const r of emptyRows) {
      L.push(`| [\`${r.name}\`](./${r.name}/) | 空目录 | — | ${dates.get(r.name) ?? '—'} |`);
    }
  }
  L.push('');

  const debt = r8Debt(rows);
  L.push('## R8 章节欠账（notice，不阻断）');
  L.push('');
  L.push('| Feature | 缺什么 |');
  L.push('|---|---|');
  if (debt.length === 0) {
    L.push('| （无欠账） | — |');
  } else {
    for (const d of debt) L.push(`| \`${d.feature}\` | ${d.miss.join('、')} |`);
  }
  L.push('');
  L.push('> 判定与 `npm run check:specs` 同源：只统计已具备可验判据章节的 requirements.md；缺「边界与反例」「变更日志」不阻断提交。');
  L.push('');

  return L.join('\n');
}

/** --check：逐行比对，只报差异行（最多 20 行），避免刷屏 */
function diffSummary(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const max = Math.max(a.length, b.length);
  const lines = [];
  let diffCount = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    diffCount++;
    if (lines.length < 20) {
      lines.push(`  行 ${i + 1}`);
      lines.push(`    期望：${a[i] ?? '（无此行）'}`);
      lines.push(`    实际：${b[i] ?? '（无此行）'}`);
    }
  }
  return { diffCount, lines, extra: diffCount > 20 ? diffCount - 20 : 0 };
}

const expected = build();

if (CHECK) {
  if (!fs.existsSync(OUT)) {
    console.error('🔴 specs/README.md 不存在，请先跑：npm run specs:index');
    process.exit(1);
  }
  const actual = fs.readFileSync(OUT, 'utf8');
  if (actual === expected) {
    console.log('✅ specs/README.md 与脚本生成结果一致');
    process.exit(0);
  }
  const { diffCount, lines, extra } = diffSummary(expected, actual);
  console.error(`🔴 specs/README.md 已过期（${diffCount} 行不一致，前 20 行差异如下）`);
  for (const l of lines) console.error(l);
  if (extra) console.error(`  … 另有 ${extra} 行差异未显示`);
  console.error('\n修复：npm run specs:index');
  process.exit(1);
}

fs.writeFileSync(OUT, expected);
const rows = readFeatures();
const total = rows.length;
const mdTotal = rows.reduce((n, r) => n + r.mdFiles.length, 0);
console.log(`✅ 已生成 ${path.relative(ROOT, OUT)}：${total} 个 feature / ${mdTotal} 份 md`);
