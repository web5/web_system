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
 *   R5 feature 目录内无任何核心产物（requirements.md / design.md / tech-design-*.md）
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
  R5: '缺核心产物',
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

function walkMd(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith('.md')) acc.push(p);
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
let mdTotal = 0;

for (const feature of features) {
  const dir = path.join(SPECS, feature);
  const files = walkMd(dir);
  mdTotal += files.length;
  if (files.length === 0) { emptyDirs.push(feature); continue; }

  const hasCore = files.some((f) => {
    const b = path.basename(f);
    return b === 'requirements.md' || b === 'design.md' || /^tech-design-.+\.md$/.test(b);
  });
  if (!hasCore) add('R5', feature, '(dir)', '无 requirements.md / design.md / tech-design-*.md');

  for (const abs of files) {
    const rel = path.relative(SPECS, abs);
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
for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5']) {
  const list = byRule[rule] ?? [];
  if (!list.length) continue;
  const freshN = list.filter((f) => !knownKeys.has(f.key)).length;
  console.log(`  ${rule} ${BY_RULE_NAME[rule]}：${list.length} 处（新增 ${freshN}）`);
}
if (emptyDirs.length) {
  console.log(`  提示 · 空目录 ${emptyDirs.length} 个（git 不跟踪，建议清理）：${emptyDirs.join(', ')}`);
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
