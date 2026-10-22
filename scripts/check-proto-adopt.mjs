#!/usr/bin/env node
/**
 * 原型稿「可并入性」体检
 *
 *   node scripts/check-proto-adopt.mjs                      # 扫 docs/ui/prototypes 下所有**未登记**的稿
 *   node scripts/check-proto-adopt.mjs <file.html>          # 体检单稿
 *   node scripts/check-proto-adopt.mjs <file.html> --json   # 机器可读
 *
 * ── 这个脚本解决什么问题 ────────────────────────────────────────────────
 * 2026-10-22 把「自媒体运营」并入 admin 整合稿，实际耗时远超预期。复盘发现时间不是花在
 * 写代码上，而是花在**改造前不知道有哪些坑**：源稿自带壳、自带 hash 路由、评审台与 hub
 * 路由互斥、图标 sprite 在 body 顶层、类名与 hub 大面积重叠、二级页之间有跨根键跳转……
 * 每一条都是「改完才发现」，发现一次就要重跑一轮构建 + 四条机检。
 *
 * 这些坑**全部是静态可判的**。所以把「踩出来」改成「扫出来」：
 *   写完一份新稿 → 立刻跑本脚本 → 得到「能不能直接并 / 要改哪几处 / registry 该写哪些字段」
 *
 * ── 判定口径（关键）────────────────────────────────────────────────────
 * 本脚本**不会因为「你有壳」就判 FAIL** —— 稿自带壳是正常的（独立打开要能看）。
 * FAIL 的判定是「有坑 **且 registry 没声明怎么处理**」。
 * 因为真正会出事的是「有坑 + 没声明」：并进整合稿后壳变第二真相源、hash 路由互相踢、
 * 图标全空、样式互相污染。声明过的（cssDrop / jsDrop / sprite / scope）就是已处理。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTO_DIR, SOURCE_DEFS, REGISTRY, ARCHIVED_PROTOS, OUT_OF_SCOPE_PROTOS } from './lib/proto-registry.mjs';
import { SHELL_TOP, SHELL_SUBS } from './lib/proto-shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALL_SCREENS = new Set([
  ...SHELL_TOP.map((m) => m.screen),
  ...SHELL_SUBS.flatMap((s) => s.screens),
]);

/** 不走 source 抽取、而是 `importFrom` 特例引入的稿（build 里有独立装配逻辑）。
 *  这两份是**壳稿 / 定稿**：它们自带完整壳，本身就是要被同步的目标，不是待并入的模块稿。 */
const IMPORTED = new Set(REGISTRY.map((r) => r.importFrom).filter(Boolean));

/** 已明确存档的稿（清单在 proto-registry.mjs，单一真相源） */
const ARCHIVED = new Set(ARCHIVED_PROTOS);

/** 明确不并入 admin 整合稿的稿（宿主是别的端 / 已定性历史）—— 有理由，不算散落 */
const OUT_OF_SCOPE = OUT_OF_SCOPE_PROTOS;

/** 不参与「未登记」判定的文件：整合稿自身（生成物，不是模块稿） */
const NOT_A_MODULE = new Set([
  'admin-agents-hub.html',
]);

/* ── 体检 ─────────────────────────────────────────────────────────────── */
export function inspect(file) {
  const base = path.basename(file);
  const dir = path.dirname(file);
  const src = fs.readFileSync(file, 'utf8');
  const SRC = SOURCE_DEFS.find((s) => s.file === base) || null;

  const out = [];   // { id, level, msg, fix }
  const add = (id, level, msg, fix) => out.push({ id, level, msg, fix });

  /* P1 位置：PROTO_DIR 是唯一抽取源，在别处的稿抽不到 —— 这是 2026-10-22 的根因之一
     （稿原本在 apps/admin/prototype/，注册表压根看不见它） */
  if (path.resolve(dir) !== path.resolve(PROTO_DIR)) {
    add('P1', 'FAIL', `不在统一原型目录（当前 ${path.relative(ROOT, dir) || '.'}）`,
      `git mv 到 docs/ui/prototypes/${base} —— 注册表只从这一个目录抽取`);
  } else {
    add('P1', 'PASS', '位置合规（docs/ui/prototypes/）');
  }

  /* P2 登记状态：没登记的、又不是 importFrom 特例的，就是「零散稿」。
     ⚠️ 两种登记方式都要认：source.file（注册表渲染）+ importFrom（build 特例装配）。
     只认前者会把 admin-agents.html / admin-agent-def-detail.html 误判成未登记 —— 它们
     恰恰是**壳稿**（定稿，不该被当成待并入的模块稿）。 */
  const kind = SRC ? (SRC.mount ? 'mount' : SRC.shared ? 'shared' : '单屏')
    : IMPORTED.has(base) ? 'importFrom 引用'
      : ARCHIVED.has(base) ? '存档'
        : OUT_OF_SCOPE[base] ? '范围外' : null;
  if (kind === 'importFrom 引用') {
    add('P2', 'PASS', '登记为 importFrom 特例引用（壳稿/定稿）');
  } else if (kind === '存档') {
    add('P2', 'PASS', '已标记存档（真实路由已无对应页面，追溯用）');
  } else if (kind === '范围外') {
    /* 登记在 OUT_OF_SCOPE_PROTOS：宿主不是 admin / 已定性历史，本来就不该进整合稿。
       它们仍可单稿体检（查位置、壳、hash 路由这些通病），只是不参与「是否并入」判定。 */
    add('P2', 'PASS', `范围外，不并入 admin 整合稿 —— ${OUT_OF_SCOPE[base]}`);
  } else if (!kind) {
    add('P2', 'FAIL', '未登记进 scripts/lib/proto-registry.mjs（既无 source 也无 importFrom）',
      '在 REGISTRY 里为该模块每屏写一行 source（或加 mount 源），否则整合稿里永远是占位');
  } else {
    add('P2', 'PASS', `已登记（${kind} 源）`);
  }

  /* P3 自带整页壳：壳的唯一真相源是 proto-shell.mjs（对齐 BasicLayout.vue）。
     两种合法处理，任满足其一即 PASS ——
       ① from 起点就在内容区内（壳根本没被抽进区间，如 admin-settings 的 '<div class="ad-content">'）
       ② cssDrop 明确声明丢弃壳相关选择器（如 admin-media-ops）
     光看「有没有壳」会误报：几乎每份自成一体的稿都有壳，那不是缺陷。 */
  const fromTxt = (SRC && SRC.from) || '';
  const ownShell = (src.match(/class="[^"]*\b(ad-sider|ad-menu|ad-topbar|ad-header|sider|topbar)\b/g) || []).length;
  const shellOutside = !!SRC && /\b(ad-content|content|main|page-body|app-main)\b/.test(fromTxt)
    && !/\b(sider|sidebar|ad-menu|topbar|header)\b/.test(fromTxt);
  const shellDeclaredDrop = !!SRC && (SRC.cssDrop || []).some((d) => /sider|side|menu|topbar|header|\.app\b|body/.test(d));
  if (ownShell === 0) {
    add('P3', 'PASS', '无自带壳（天然可嵌入）');
  } else if (shellOutside) {
    add('P3', 'PASS', `自带壳 ${ownShell} 处，但抽取区间从内容区起（壳未被抽到）`);
  } else if (shellDeclaredDrop) {
    add('P3', 'PASS', `自带壳 ${ownShell} 处，cssDrop 已声明丢弃`);
  } else {
    add('P3', 'FAIL', `自带壳 ${ownShell} 处，且 from 区间含壳、cssDrop 又未声明`,
      "把 from 起点移到内容区（推荐），或 source.cssDrop 加 '.sider' '.topbar' '.menu-' '.crumb' —— 否则并进去是第二份壳");
  }

  /* P4 自带 hash 路由：与整合稿的 hash 路由**互斥**。2026-10-22 的实际事故是
     评审台写 location.hash='#s=<key>'，切一次场景包整合稿就被踢回默认屏。 */
  const hashRe = /location\.hash\s*=|addEventListener\(\s*['"]hashchange/g;
  const hashHits = (src.match(hashRe) || []).length;
  /* 「声明了 jsDrop」≠「声明的那段真的盖住了 hash 路由」——
     这里**自己去核**，不把确认工作推回给人：取 jsDrop 各区间原文，看里面有没有 hash 赋值。 */
  const hashInDropped = (SRC && (SRC.jsDrop || []).some(([a, b]) => {
    const i = src.indexOf(a); const j = b ? src.indexOf(b, i + 1) : -1;
    if (i < 0) return false;
    const seg = src.slice(i, j > i ? j : undefined);
    hashRe.lastIndex = 0;
    return hashRe.test(seg);
  })) || false;
  const hasDrop = SRC && (SRC.jsDrop || []).length > 0;
  if (hashHits === 0) {
    add('P4', 'PASS', '无自带 hash 路由');
  } else if (hashInDropped) {
    add('P4', 'PASS', `自带 hash 路由 ${hashHits} 处，已核实落在 jsDrop 丢弃区间内`);
  } else if (hasDrop) {
    add('P4', 'FAIL', `自带 hash 路由 ${hashHits} 处，jsDrop 已声明但**没盖住**它们`,
      '把 hash 赋值语句移进 jsDrop 标记区间（或断言失败处），否则并入后切一次场景包就把整合稿踢回默认屏');
  } else {
    add('P4', 'FAIL', `自带 hash 路由 ${hashHits} 处，且无 jsDrop`,
      '把这些语句裹进 // DEMO-PANEL-START/END 之类的标记段并在 source.jsDrop 声明，或改成可注入回调');
  }

  /* P5 评审台：演示控件是「独立打开用」的，并进整合稿必须整段丢弃（不只是藏 DOM ——
     它的 JS 还在跑就会改 location.hash / 改 body 属性） */
  const hasPanel = /data-demo-ctl|data-dc-toggle|DEMO-PANEL-START/.test(src);
  const panelDropped = SRC && (SRC.jsDrop || []).some(([a]) => /DEMO|PANEL/i.test(String(a)));
  if (!hasPanel) {
    add('P5', 'PASS', '无评审台');
  } else if (panelDropped) {
    add('P5', 'PASS', '有评审台，jsDrop 已整段丢弃');
  } else {
    // 有评审台但没声明丢弃 → 看调用点有没有守卫，决定是 WARN 还是 FAIL
    const guarded = /typeof\s+DEMO\s*!==\s*['"]undefined['"]/.test(src);
    add('P5', guarded ? 'WARN' : 'FAIL',
      `有评审台，未在 jsDrop 声明${guarded ? '（调用点已有 typeof 守卫）' : '（且调用点无 typeof 守卫）'}`,
      '把评审台 JS 裹进标记段 + source.jsDrop 声明；所有对它的调用改 typeof 守卫，否则独立打开可用、并进去报 ReferenceError');
  }

  /* P6 图标 sprite：`<svg><symbol id="i-*">` 通常挂在 body 顶层（内容区之外）。
     按 from/to 切内容区会连它一起丢掉 → 整稿图标全空，而 DOM 里 <use href="#i-x"> 还在。 */
  const hasSprite = /<symbol id="/.test(src);
  if (!hasSprite) {
    add('P6', 'PASS', '无 sprite（图标不依赖 symbol）');
  } else if (SRC && SRC.sprite) {
    add('P6', 'PASS', '有 sprite，source.sprite 已声明抽取');
  } else {
    add('P6', 'FAIL', '有 sprite（<symbol id>），未声明抽取',
      'source.sprite = { from: \'<svg style="display:none"\', to: \'</svg>\' } —— 不抽就整稿图标全空');
  }

  /* P7 屏容器类名：`.screen` 与整合稿**同名**。整块 mount 时安全（hub 已收紧成
     `.screen[data-screen]`），按屏拆 DOM 时必须改成按 id 精确切换。 */
  const screenCount = (src.match(/class="[^"]*\bscreen\b/g) || []).length;
  if (screenCount === 0) {
    add('P7', 'PASS', '无 .screen 容器（不会与整合稿撞名）');
  } else if (SRC && SRC.mount) {
    add('P7', 'PASS', `有 .screen 容器 ${screenCount} 个，走 mount（整块搬，不按屏拆）`);
  } else {
    add('P7', 'WARN', `有 .screen 容器 ${screenCount} 个，且不是 mount`,
      '整合稿的屏容器也叫 .screen：切屏必须按 id 操作（SCREENS[k].el），不能用类选择器');
  }

  /* P8 裸通用类名：CSS 隔离是**唯一**防线。合法做法有两种 ——
       scope   给每条规则加作用域前缀（裸类名的稿用这个）
       cssKeep 白名单，只取带私有前缀的规则（如 .st-* ）—— 类名本来就低冲突时用
     只认 scope 会把「用 cssKeep 已经隔离好的稿」误判成漏隔离。 */
  const GENERIC = ['btn', 'card', 'table', 'mask', 'drawer', 'modal', 'tag', 'chip', 'empty', 'seg', 'page-head', 'tbl', 'badge'];
  const hit = GENERIC.filter((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(src));
  const isolated = SRC ? (SRC.scope ? `scope ${SRC.scope}` : SRC.cssKeep ? 'cssKeep 白名单' : null) : null;
  if (hit.length < 3) {
    add('P8', 'PASS', `通用类名命中少（${hit.length} 种）`);
  } else if (isolated) {
    add('P8', 'PASS', `裸通用类名 ${hit.length} 种，已隔离（${isolated}）`);
  } else {
    add('P8', 'FAIL', `裸通用类名 ${hit.length} 种（${hit.slice(0, 6).join('/')}…），未做作用域隔离`,
      `source.scope = '.<前缀>-scope'（或改用 cssKeep 白名单）—— 不隔离会污染整合稿其它屏的 .btn/.card/.table`);
  }

  /* P9 跨根键跳转：**这一条决定 mount 还是 shared**，也是最贵的返工点。
     模块内二级页跳转到「另一个菜单页」时，按屏拆 DOM 会把目标 section 藏进别的屏，
     点了什么也不会发生（2026-10-22 实测：明细详情→「去公众号成文」走不通，整轮返工）。 */
  const targets = new Set();
  for (const m of src.matchAll(/\bgo\(\s*['"]([\w-]+)['"]\s*\)/g)) targets.add(m[1]);
  const sections = [...src.matchAll(/<section[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  const crossKey = targets.size > 1 && sections.length > 1;
  if (!crossKey) {
    add('P9', 'PASS', '无跨屏跳转（可安全按屏拆）');
  } else if (SRC && SRC.mount) {
    add('P9', 'PASS', `有跨屏跳转（${targets.size} 个目标），已走 mount`);
  } else if (SRC && SRC.shared) {
    add('P9', 'FAIL', `有跨屏跳转（${[...targets].slice(0, 4).join('/')}…）却用 shared 拆 DOM`,
      '改成 mount：DOM 整块不拆，切屏时由整合稿运行时把整块搬过去，否则跳转点了没反应');
  } else {
    add('P9', 'WARN', `有跨屏跳转（${targets.size} 个目标：${[...targets].slice(0, 4).join('/')}…）`,
      'source 必须用 mount（不能用 shared）—— 拆 DOM 会让跳转目标被隐藏');
  }

  /* P10 内容区外的弹层：按 from/to 切内容区会把 drawer / mask / toast 一起丢掉，
      症状是「点新增 → 找不到抽屉」。 */
  const hasOverlay = /class="[^"]*\b(mask|drawer|modal)\b|id="toast"/.test(src);
  if (!hasOverlay) {
    add('P10', 'PASS', '无弹层（不涉及 trails）');
  } else if (SRC && (SRC.trails || SRC.trail)) {
    /* 两个字段都认：trail = 单段（旧写法，dict-module 用），trails = 多段数组 */
    const n = SRC.trails ? SRC.trails.length : 1;
    add('P10', 'PASS', `有弹层，trail${SRC.trails ? 's' : ''} 已声明 ${n} 段`);
  } else if (SRC) {
    // 有 from/to 才能判「在区外」；没声明区间时只能提示
    add('P10', 'WARN', '有弹层，未声明 trails',
      '若弹层挂在内容区之外（常见：抽屉/mask 在 .content 之后），source.trails 必须补上，否则并入后找不到弹层');
  } else {
    add('P10', 'WARN', '有弹层，未登记（无法判定是否在内容区外）',
      '登记时确认 source.trails 是否必需');
  }

  /* P11 屏名对账：稿里的 section id 与壳的 screen key 是两套命名，靠 mount/shared 映射。
      映射缺失的症状是「菜单点了停在原地」。 */
  if (SRC && SRC.mount) {
    const bad = Object.keys(SRC.mount.screens || {}).filter((k) => !ALL_SCREENS.has(k));
    if (bad.length) {
      add('P11', 'FAIL', `mount.screens 里有不在壳里的屏名：${bad.join(', ')}`,
        '改成 proto-shell.mjs 里的 screen key（否则菜单点过去是不存在的屏）');
    } else {
      add('P11', 'PASS', `mount 映射 ${Object.keys(SRC.mount.screens || {}).length} 屏全部在壳内`);
    }
  } else if (SRC) {
    const unknown = sections.filter((s) => !ALL_SCREENS.has(s) && !/demo|toast|mask/i.test(s));
    add('P11', unknown.length ? 'WARN' : 'PASS',
      unknown.length ? `稿内 section id 与壳屏名不同：${unknown.slice(0, 4).join(', ')}` : '屏名与壳一致',
      unknown.length ? '若按屏拆，需在 shared.screens 里写壳的 screen key，不是 section id' : '');
  } else {
    add('P11', 'PASS', '（未登记，跳过屏名对账）');
  }

  /* P12 设计决策记录：不阻断，但每份并入的稿都该有（评审要能查到「为什么这么定」） */
  const dr = path.join(dir, base.replace(/\.html$/, '-设计决策记录.md'));
  if (fs.existsSync(dr)) add('P12', 'PASS', `决策记录存在（${path.basename(dr)}）`);
  else add('P12', 'WARN', '缺同名设计决策记录', `补 ${path.basename(dr)}（决策 + 遗留项，评审要对账）`);

  return {
    file, base, registered: !!kind, kind, src: SRC, findings: out,
    meta: { targets: [...targets], sections, hit, ownShell, screenCount },
  };
}

/* ── 输出 ─────────────────────────────────────────────────────────────── */
const LEVEL_ORDER = { FAIL: 0, WARN: 1, PASS: 2 };
const ICON = { FAIL: '✗ FAIL', WARN: '! WARN', PASS: '✓ PASS' };

function report(r, verbose) {
  const fails = r.findings.filter((f) => f.level === 'FAIL');
  const warns = r.findings.filter((f) => f.level === 'WARN');
  const passes = r.findings.filter((f) => f.level === 'PASS');

  console.log(`\n── 体检 ${r.base}`);
  for (const f of [...r.findings].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])) {
    if (!verbose && f.level === 'PASS') continue;
    console.log(`   ${ICON[f.level]}  ${f.id}  ${f.msg}`);
    if (f.fix && f.level !== 'PASS') console.log(`           → ${f.fix}`);
  }
  if (!verbose && passes.length) console.log(`   ✓ PASS ${passes.length} 项（--verbose 看全部）`);

  const verdict = fails.length ? '需改造' : warns.length ? '可并入（有提示项）' : '可直接并入';
  console.log(`   → 结论：${verdict}（FAIL ${fails.length} / WARN ${warns.length} / PASS ${passes.length}）`);

  /* 未登记稿：直接给「registry 该写什么」的骨架 —— 让人从「读 400 行脚本猜字段」
     变成「照着填」。from/to 必须人定（取决于内容区边界），其余按体检结果预填。
     前缀取文件名前两个词首字母 + 版本号（media-ops → mo / release-platform-v9 → rp9），
     避免同模块多份稿在注册表里撞同名常量。 */
  if (!r.registered) {
    const stem = r.base.replace(/\.html$/, '').replace(/^admin-/, '');
    const words = stem.split(/[-_\s]+/).filter((w) => /^[a-z]/i.test(w));
    const pre = (words.slice(0, 3).map((w) => w[0]).join('') || stem.slice(0, 2)).toLowerCase();
    const tag = pre + ((stem.match(/v(\d+)/i) || [, ''])[1]);
    const need = [];
    if (r.findings.find((f) => f.id === 'P8' && f.level !== 'PASS')) need.push(`     scope: '.${tag}-scope',`);
    if (r.findings.find((f) => f.id === 'P6' && f.level !== 'PASS')) need.push(`     sprite: { from: '<svg style="display:none"', to: '</svg>' },`);
    if (r.findings.find((f) => f.id === 'P3' && f.level !== 'PASS')) need.push(`     cssDrop: ['.sider', '.topbar', '.menu-', '.crumb', 'body', 'html'],`);
    if (r.findings.find((f) => f.id === 'P5' && f.level !== 'PASS')) need.push(`     jsDrop: [['DEMO-PANEL-START', 'DEMO-PANEL-END']],  // 需先在源稿补标记`);
    if (r.meta.targets.length > 1) {
      need.push(`     mount: { screens: { /* '菜单屏 key': '${r.meta.targets[0]}', … */ } },  // 有跨屏跳转，必须 mount`);
    }
    console.log(`\n   ── registry 建议骨架（补完 from/to 再贴进 proto-registry.mjs）`);
    console.log(`   const SRC_${tag.toUpperCase()} = {`);
    console.log(`     file: '${r.base}',`);
    console.log(`     from: '<div class="……">',   // ← 内容区起点（含）`);
    console.log(`     to: '<……>',                  // ← 内容区终点（不含，通常是弹层/脚本之前）`);
    if (need.length) console.log(need.join('\n'));
    console.log(`     trace: ['……'],   // 抽取后必须出现的特征串（build 自检用）`);
    console.log(`   };`);
  }
}

/* ── 汇总表（无参模式的默认视图：先给全貌，再展开问题最多的几份） ───────── */
function table(rows) {
  const w = Math.min(54, Math.max(...rows.map((r) => r.base.length), 8) + 1);
  const pad = (s, n) => (s.length >= n ? s.slice(0, n - 3) + '...' : s + ' '.repeat(n - s.length));
  console.log(`   ${pad('文件', w)} FAIL  WARN  关键问题`);
  console.log(`   ${'-'.repeat(w + 26)}`);
  for (const r of rows) {
    const fails = r.findings.filter((f) => f.level === 'FAIL');
    const warns = r.findings.filter((f) => f.level === 'WARN');
    const key = fails.filter((f) => f.id !== 'P2').map((f) => `P${f.id.slice(1)}`).join(' ') || (warns.length ? '仅提示项' : '—');
    console.log(`   ${pad(r.base, w)}${String(fails.length).padStart(4)}  ${String(warns.length).padStart(4)}  ${key}`);
  }
}

/* ── 入口 ─────────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const verbose = args.includes('--verbose');
const showAll = args.includes('--all');
const target = args.find((a) => !a.startsWith('--'));

let results = [];
let mode = 'file';
if (target) {
  const f = path.isAbsolute(target) ? target : path.join(ROOT, target);
  if (!fs.existsSync(f)) { console.error(`找不到文件：${f}`); process.exit(2); }
  results = [inspect(f)];
} else if (args.includes('--registered')) {
  /* --registered：只体检「已经并入整合稿」的稿（CI 用）。
     它们本该全 PASS —— 红了说明登记与源稿脱节（改了稿没改声明），是最该早发现的一类退化。 */
  mode = 'registered';
  results = SOURCE_DEFS.map((s) => inspect(path.join(PROTO_DIR, s.file)));
  console.log(`\n── 已并入整合稿的源稿体检（${results.length} 份）`);
} else {
  mode = 'scan';
  /* 无参数：只体检「有稿、但既没登记也没被特例引用」的那批 —— 这就是「散落」的机检口径。
     壳稿（importFrom）/ 范围外（OUT_OF_SCOPE）/ 存档（ARCHIVED）在 P2 就判 PASS，会被 filter 排除：
     它们不是「漏了登记」，而是**本来就不该按模块稿规则体检**。 */
  const files = fs.readdirSync(PROTO_DIR).filter((f) => f.endsWith('.html') && !NOT_A_MODULE.has(f));
  results = files.map((f) => inspect(path.join(PROTO_DIR, f))).filter((r) => !r.registered);
  if (!results.length) {
    console.log(`✓ 没有零散原型稿（${files.length} 份全部已登记 / 特例引用 / 范围外 / 存档）`);
    process.exit(0);
  }
}

if (asJson) {
  console.log(JSON.stringify(results.map((r) => ({
    file: r.base, kind: r.kind,
    fail: r.findings.filter((f) => f.level === 'FAIL').map((f) => ({ id: f.id, msg: f.msg, fix: f.fix })),
    warn: r.findings.filter((f) => f.level === 'WARN').map((f) => ({ id: f.id, msg: f.msg })),
    meta: r.meta,
  })), null, 2));
} else if (mode === 'scan') {
  /* 先给全貌（一份稿一行），再展开问题最多的几份详情 —— 19 份全展开反而看不出重点 */
  console.log(`\n── 零散原型稿（有稿、未登记进整合注册表）${results.length} 份`);
  table(results);
  const nf = results.reduce((n, r) => n + r.findings.filter((f) => f.level === 'FAIL').length, 0);
  console.log(`   ${'-'.repeat(78)}`);
  console.log(`   合计 ${results.length} 份 / FAIL ${nf} 项`);

  const worst = [...results].sort((a, b) =>
    b.findings.filter((f) => f.level === 'FAIL').length - a.findings.filter((f) => f.level === 'FAIL').length);
  const show = showAll ? worst : worst.slice(0, 3);
  for (const r of show) report(r, verbose);
  if (!showAll && worst.length > show.length) {
    console.log(`\n   （其余 ${worst.length - show.length} 份详情用 --all 展开，或单独体检：`);
    console.log(`     node scripts/check-proto-adopt.mjs "docs/ui/prototypes/<文件名>"）`);
  }
} else {
  for (const r of results) report(r, verbose);
}
process.exit(results.some((r) => r.findings.some((f) => f.level === 'FAIL')) ? 1 : 0);
