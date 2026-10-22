#!/usr/bin/env node
/**
 * 原型目录审计（防止「零散稿」再次出现）
 *
 *   node scripts/audit-proto-registry.mjs                  # 审计（CI 用这个）
 *   node scripts/audit-proto-registry.mjs --update-baseline # 把当前散落稿记为「已知」
 *   node scripts/audit-proto-registry.mjs --verbose        # 输出屏覆盖明细
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 「统一融合」只解决了当时那一个模块。真正的病是**每次做原型都新开一份 html**：
 * 2026-10-22 实测 docs/ui/prototypes 下 24 份稿，只有 3 份被注册表引用 —— 其中
 * release-platform 一个模块就堆了 14 个版本（v5 ~ v14 + 一份「原型_v5」）。
 * 这些稿都是真做完的设计，但没人知道哪份是当前的，评审只能靠文件名猜。
 *
 * 机制：**基线（baseline）**。
 *   第一次跑 --update-baseline 把已有散落稿登记为「已知」，之后：
 *     · 基线内的稿 → KNOWN（打出来，不阻断）
 *     · 基线外的新散落稿 → FAIL（CI 红，强制你「并入 or 归档」，不许再随手扔一份）
 *   → 缺口可以分批发，但**不许继续扩大**。这是唯一能长期守住的口径。
 *
 * 与 check-proto-adopt.mjs 的分工：
 *   check-proto-adopt  = 单份稿「能不能并、要改哪几处」（12 项技术体检）
 *   audit-proto-registry = 整个目录「有没有散落、登记是否自洽、哪个版本该活」（本文件）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTO_DIR, REGISTRY, SOURCE_DEFS, ARCHIVED_PROTOS, OUT_OF_SCOPE_PROTOS } from './lib/proto-registry.mjs';
import { SHELL_TOP, SHELL_SUBS } from './lib/proto-shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts/proto-audit-baseline.json');
const README = path.join(PROTO_DIR, 'README.md');
const GEN = 'admin-agents-hub.html';            // 生成物，不是模块稿
const ARCHIVED = new Set(ARCHIVED_PROTOS);
const OUT_OF_SCOPE = OUT_OF_SCOPE_PROTOS;

const ALL_SCREENS = new Set([
  ...SHELL_TOP.map((m) => m.screen),
  ...SHELL_SUBS.flatMap((s) => s.screens),
]);
const IMPORTED = new Set(REGISTRY.map((r) => r.importFrom).filter(Boolean));

const problems = [];
const notes = [];
const rec = (ok, label, detail) => {
  if (!ok) problems.push(`${label}${detail ? ' —— ' + detail : ''}`);
  return ok;
};

/* ── ① 目录清点 ───────────────────────────────────────────────────────── */
const files = fs.readdirSync(PROTO_DIR).filter((f) => f.endsWith('.html') && f !== GEN).sort();
const byFile = new Map(SOURCE_DEFS.map((s) => [s.file, s]));

const loose = [];      // 有稿、但既没 source 也没 importFrom
const archived = [];   // 明确存档
const outOfScope = []; // 明确不并入 admin 整合稿（宿主是别的端 / 已定性历史），非「散落」
const linked = [];     // 已并入（source 或 importFrom）
for (const f of files) {
  if (byFile.has(f)) linked.push({ file: f, how: byFile.get(f).mount ? 'mount' : byFile.get(f).shared ? 'shared' : 'source' });
  else if (IMPORTED.has(f)) linked.push({ file: f, how: 'importFrom' });
  else if (ARCHIVED.has(f)) archived.push(f);
  else if (OUT_OF_SCOPE[f]) outOfScope.push(f);
  else loose.push(f);
}

/* ── ② 基线：允许存量散落，拦住新增 ──────────────────────────────────── */
let baseline = { known: {} };
if (fs.existsSync(BASELINE)) {
  try { baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch { baseline = { known: {} }; }
}
const knownMap = baseline.known || {};
const newLoose = loose.filter((f) => !(f in knownMap));
const staleKnown = Object.keys(knownMap).filter((f) => !loose.includes(f) && fs.existsSync(path.join(PROTO_DIR, f)));

if (process.argv.includes('--update-baseline')) {
  const next = { updatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '), known: {} };
  for (const f of loose) next.known[f] = knownMap[f] || '待并入 / 待归档（见 check-proto-adopt 体检结论）';
  fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  console.log(`已写入基线 ${path.relative(ROOT, BASELINE)}：${loose.length} 份已知散落稿`);
  console.log('→ 之后新出现的散落稿会被判 FAIL（这就是「不许再随手扔一份」的闸门）');
  process.exit(0);
}

/* ── ③ 登记自洽 ───────────────────────────────────────────────────────── */
/* 3a 登记了但文件不存在（改名/删除后忘了改注册表 —— build 会直接崩） */
const missing = [...byFile.keys(), ...IMPORTED].filter((f) => !fs.existsSync(path.join(PROTO_DIR, f)));
rec(!missing.length, '登记的文件都存在', missing.join(', '));

/* 3b REGISTRY 屏名必须在壳里（否则菜单点过去是不存在的屏） */
const badScreens = REGISTRY.filter((r) => !ALL_SCREENS.has(r.screen)).map((r) => r.screen);
rec(!badScreens.length, 'REGISTRY 屏名都在 proto-shell 的菜单里', badScreens.join(', '));

/* 3c mount / shared 的屏名也必须在壳里 */
const badMounted = [];
for (const s of SOURCE_DEFS) {
  for (const k of Object.keys((s.mount && s.mount.screens) || {})) if (!ALL_SCREENS.has(k)) badMounted.push(`${s.file}:${k}`);
  for (const k of (s.shared && s.shared.screens) || []) if (!ALL_SCREENS.has(k)) badMounted.push(`${s.file}:${k}`);
}
rec(!badMounted.length, 'mount / shared 引用的屏名都在壳里', badMounted.join(', '));

/* 3d 一个文件被多屏以「非 shared/mount」引用 → 大概率是想共享却漏声明（会注入 N 份状态机） */
const dupRef = {};
for (const r of REGISTRY) {
  if (!r.source || r.source.shared || r.source.mount) continue;
  dupRef[r.source.file] = (dupRef[r.source.file] || 0) + 1;
}
const dupBad = Object.entries(dupRef).filter(([, n]) => n > 1).map(([f, n]) => `${f}×${n}`);
rec(!dupBad.length, '单屏源没有被多屏重复引用', dupBad.join(', '));

/* 3e README 索引是否列了每份已并入的稿（查原型的人靠它找入口） */
let readmeMiss = [];
if (fs.existsSync(README)) {
  const md = fs.readFileSync(README, 'utf8');
  readmeMiss = linked.map((l) => l.file).filter((f) => !md.includes(f));
  rec(!readmeMiss.length, 'README 里列了每份已并入的稿', readmeMiss.join(', '));
} else {
  notes.push('docs/ui/prototypes/README.md 不存在（索引缺失）');
}

/* ── ④ 版本族：同模块多版本稿，指出哪份该活 ───────────────────────────── */
/* 判定只看**含 vN 的稿**：`release-platform-v9-…` 与 `release-platform_原型_v5_…`
   去掉版本段与「原型/整合/框架」这类噪声词后同为 `release-platform` → 一族。
   同一族的旧版本是「设计过程」，不是「待并入的稿」，该进 _archive/ 而不是留在目录里跟当前版平级。 */
const famOf = (f) => {
  const stem = f.replace(/\.html$/, '');
  /* 噪声词先剔掉，否则 `release-platform_原型_v5_…` 会算成 `release-platform_原型` 单独一族，
     跟 `release-platform-v5-…` 分家 —— 那正是「同一模块的稿互不相认」的复现。 */
  const clean = stem.replace(/原型稿?|整合|框架|终稿|final/gi, '');
  const m = clean.match(/v(\d+)/i);
  if (!m) return null;
  return { key: clean.slice(0, m.index).replace(/[-_\s]+$/, ''), ver: Number(m[1]) };
};
const fams = {};
/* 扫**全部稿**而不是只扫散落稿：2026-10-22 存量收敛后，目录里每个模块只剩一份，
   版本族检查就永远不会触发 —— 但「下次又新开一份 v15」正是要拦的场景，
   必须和已定性的 v14 放在一起比，才能看出「这是重复迭代」。 */
for (const f of files) {
  const x = famOf(f);
  if (!x) continue;
  (fams[x.key] ||= []).push({ file: f, ver: x.ver });
}
const isSettled = (f) => linked.some((l) => l.file === f) || !!OUT_OF_SCOPE[f] || ARCHIVED.has(f);
const famLines = [];
for (const [k, arr] of Object.entries(fams)) {
  if (arr.length < 2) continue;
  /* 保留顺序：已定性的那份优先（它可能是当前版，也可能是「仅留一份」的历史终稿），
     同一定性内取版本号大的。新加的稿子永远排在待删一侧 —— 想替换旧版就删旧版并改登记。 */
  arr.sort((a, b) => (Number(isSettled(b.file)) - Number(isSettled(a.file))) || (b.ver - a.ver));
  const [head, ...rest] = arr;
  famLines.push({ key: k, keep: head.file, others: rest.map((r) => r.file) });
}

/* ── ⑤ 屏覆盖：哪些屏有真实稿、哪些还是占位 ───────────────────────────── */
const covered = REGISTRY.filter((r) => r.source || r.importFrom).map((r) => r.screen);
const placeholders = REGISTRY.filter((r) => !r.source && !r.importFrom && r.batch);

/* ── 输出 ─────────────────────────────────────────────────────────────── */
const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', x: '\x1b[0m' };
const verbose = process.argv.includes('--verbose');

console.log(`\n── 原型目录审计  ${path.relative(ROOT, PROTO_DIR)}/`);
console.log(`   共 ${files.length} 份稿：并入 ${linked.length} · 范围外 ${outOfScope.length} · 存档 ${archived.length} · 散落 ${loose.length}\n`);

console.log(`① 散落（有稿、未登记）`);
if (!loose.length) console.log(`   ${C.g}✓${C.x} 无`);
for (const f of loose) {
  const isNew = !(f in knownMap);
  const tag = isNew ? `${C.r}FAIL${C.x} 新增` : `${C.y}KNOWN${C.x}`;
  console.log(`   ${tag}  ${f}`);
}
if (newLoose.length) {
  console.log(`\n   ${C.r}✗ ${newLoose.length} 份是基线之外的新散落稿 —— 必须处理其一：${C.x}`);
  console.log(`      · 并入整合稿：node scripts/check-proto-adopt.mjs "docs/ui/prototypes/${newLoose[0]}" 看要改哪几处，然后在 proto-registry.mjs 登记`);
  console.log(`      · 或者归档：git mv 到 docs/ui/prototypes/_archive/（历史设计过程，不进整合稿）`);
  console.log(`   确实要暂缓：node scripts/audit-proto-registry.mjs --update-baseline（会记进基线，但别再增长）`);
}
problems.push(...newLoose.map((f) => `新增散落稿：${f}`));
if (staleKnown.length) {
  console.log(`   ${C.d}（基线快照里有 ${staleKnown.length} 份已不再是散落态，可跑 --update-baseline 收敛）${C.x}`);
}

console.log(`\n①·b 范围外（不并入 admin 整合稿，已在注册表登记理由）`);
if (!outOfScope.length) console.log(`   ${C.g}✓${C.x} 无`);
for (const f of outOfScope) console.log(`   ${C.d}·${C.x} ${f}\n     ${C.d}${OUT_OF_SCOPE[f]}${C.x}`);

console.log(`\n② 版本族（同模块多版本 → 只留当前版，其余直接删除）`);
if (!famLines.length) console.log(`   ${C.g}✓${C.x} 无多版本堆叠`);
for (const g of famLines) {
  console.log(`   ${C.y}!${C.x} ${g.key}：${g.others.length + 1} 份`);
  console.log(`      ${C.g}保留${C.x} ${g.keep}`);
  for (const o of g.others) console.log(`      ${C.r}删除${C.x} ${o}`);
  /* 直接给可复制命令：收敛动作越省力，越容易被真正执行（只打印「建议归档」通常没人动手）。
     2026-10-22 起不再进 _archive/ —— 旧版留在目录里仍会被当成「可参考的稿」，
     git 历史本身就是归档，需要追溯时 git show <sha>:<path> 即可。 */
  console.log(`      ${C.d}一条命令删掉旧版（git 历史即归档，可 git checkout 恢复）：${C.x}`);
  console.log(`      ${C.d}${g.others.map((o) => `git rm "docs/ui/prototypes/${o}"`).join(' && ')}${C.x}`);
}

/* 同模块多稿但无版本号（deploy-console-domain / deploy-console-version-deploy 这种）：
   不一定是版本关系（可能是同一模块的两张不同页面），所以只提示、不判 FAIL ——
   但必须点出来，否则它们会以「散落」形式长期挂在目录里。 */
const preOf = (f) => f.split(/[-_]/).slice(0, 2).join('-');
const groups = {};
for (const f of loose) if (!famOf(f)) (groups[preOf(f)] ||= []).push(f);
const multi = Object.entries(groups).filter(([, a]) => a.length > 1);
if (multi.length) {
  console.log(`\n②·b 同模块多稿（无版本号，可能是同模块的不同页面，也可能是并行方案）`);
  for (const [k, a] of multi) console.log(`   ${C.y}!${C.x} ${k}：${a.length} 份 —— ${a.join(' / ')}`);
}

console.log(`\n③ 登记自洽`);
for (const p of problems.filter((x) => !x.startsWith('新增散落稿'))) console.log(`   ${C.r}✗${C.x} ${p}`);
if (!problems.filter((x) => !x.startsWith('新增散落稿')).length) console.log(`   ${C.g}✓${C.x} 全部通过`);

console.log(`\n④ 屏覆盖：真实稿 ${covered.length} / 占位 ${placeholders.length}（共 ${REGISTRY.length} 屏）`);
if (verbose) {
  console.log(`   真实：${covered.join(', ')}`);
  console.log(`   占位：${placeholders.map((r) => `${r.screen}(${r.batch})`).join(', ')}`);
}
for (const n of notes) console.log(`   ${C.y}!${C.x} ${n}`);

const fail = problems.length;
console.log(`\n${fail ? C.r + '✗ FAIL' + C.x : C.g + '✓ PASS' + C.x}  ${fail} 项问题`
  + `（散落 ${loose.length}：已知 ${loose.length - newLoose.length} / 新增 ${newLoose.length}）`);
process.exit(fail ? 1 : 0);
