#!/usr/bin/env node
/**
 * Playground ⇄ 定义详情调试台 **结构 parity 机检**
 *
 *   node scripts/verify-playground-parity.mjs
 *
 * 背景：产品问「对话界面是不是跟对话调试 Playground 一致、能不能复用」。
 * 肉眼截图回答不了「复用」——本脚本把两边**实际渲染出的消息 DOM** 抽成结构树，
 * 逐层 diff，输出机器结论：
 *
 *   A. 整轮骨架 diff（.turn = 一问一答组：用户气泡 + 过程卡片 + AI 气泡；.ans 视为叶子）
 *   B. block 内部结构 diff（proc / codeblk / law / ol / h4 / pre / bubble-meta / lead / think）
 *   C. CSS 规则块对账（只对账消息结构相关选择器）
 *   D. 类名并集差（仅一边出现的结构类）
 *
 * 判定：A / B 必须零差异；C / D 的差异必须**逐条有理由**（AA 修正 / 演示控件等），
 * 未登记的差异一律 FAIL —— 防止「看起来一致」悄悄漂移。
 *
 * 口径说明（为什么这么比）：
 *   · 行内元素（strong/em/code/br）与 svg 图标不算结构 —— 前者是内容级差异，后者是装饰；
 *   · .ans 内部不参与整轮比对 —— 回答内容因问题而异，块内结构由 B 段按类型逐个比；
 *   · 壳样式（侧栏/顶栏/工具条/表单）两边是不同页面，天然不同，C 段只对账消息结构规则。
 */
'use strict';

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/Users/geekwen/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PG_FILE = path.join(ROOT, 'docs/ui/prototypes/admin-agents.html');
const DT_FILE = path.join(ROOT, 'docs/ui/prototypes/admin-agent-def-detail.html');
const HUB_FILE = path.join(ROOT, 'docs/ui/prototypes/admin-agents-hub.html');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 结构类白名单：只比「消息结构」，不比文本 / id / 内联样式 / 图标 */
const STRUCT_CLASSES = [
  'turn', 'bubble-wrap', 'me', 'avatar', 'user', 'ai', 'bubble', 'bubble-meta', 'src-tag', 'gray',
  'ans', 'lead', 'think', 'codeblk', 'hd', 'lang', 'cp', 'pre', 'law', 'h4', 'ol', 'n',
  'proc', 'ph', 'pb', 'cursor', 'typing',
  /* 对话面板外围（H 段）：工具栏 / 输入区 —— 上一版只比了聊天记录，运行按钮差异漏网 */
  'chatpanel', 'pg-toolbar', 'pg-agent', 'caret', 'pg-spacer', 'pg-run', 'pg-dbg', 'composer', 'ctrl', 'btn', 'run',
];

/** 页面内结构树工厂（行内元素 / svg / 脚本不算结构） */
const MAKE_WALK = `(wlArr) => {
  const wl = new Set(wlArr);
  const SKIP = new Set(['svg','script','style','path','circle','rect','strong','em','code','b','i','u','s','br']);
  return function walk(node){
    if (node.nodeType !== 1) return null;
    const tag = node.tagName.toLowerCase();
    if (SKIP.has(tag)) return null;
    const cls = [...node.classList].filter((c) => wl.has(c)).sort().join(' ');
    const kids = [...node.children].map(walk).filter(Boolean);
    return { t: tag, c: cls, k: kids };
  };
}`;

/** 对话面板外围（toolbar + composer）采集：把「运行按钮在不在、长得一不一样」变成可比对的结构树 */
const PANEL_SRC = `(rootSel, wlArr, makeSrc) => {
  const walk = eval(makeSrc)(wlArr);
  const root = rootSel ? document.querySelector(rootSel)
    : (document.querySelector('#chatbox')
        ? document.querySelector('#chatbox').closest('.chatpanel')
        : document.querySelector('.chatpanel'));
  if (!root) return null;
  // 调试台多出的「对比运行」按钮是**已登记槽位差异**：比对前剪掉，另做单独断言
  const cp = root.querySelector('.composer').cloneNode(true);
  const extra = [...cp.querySelectorAll('.btn')].filter((b) => !b.classList.contains('run')).map((b) => b.textContent.trim());
  cp.querySelectorAll('.btn').forEach((b) => { if (!b.classList.contains('run')) b.remove(); });
  const rb = root.querySelector('.composer .btn.run');
  const rbs = rb ? getComputedStyle(rb) : null;
  return {
    toolbar: walk(root.querySelector('.pg-toolbar')),
    composer: walk(cp),
    extra,
    runBtn: rb ? { cls: rb.className.trim(), text: rb.textContent.trim(),
      style: [rbs.backgroundColor, rbs.color, rbs.borderColor, rbs.height, rbs.fontSize, rbs.fontWeight].join(' | ') } : null,
  };
}`;

/** 已登记差异（C / D 段允许存在，但必须写在这里并给理由） */
const KNOWN = [
  { where: 'C', sel: '.pg-chat', why: 'Playground 整页 padding:20px/min-height:560px，调试台并排限高用 .pg-chat.compact 的 16px —— 同一组件、尺寸修饰不同（规格已登记）。' },
  { where: 'C', sel: '.turn', why: '轮间距 22px（整页）vs 18px（compact 限高）—— 尺寸修饰，非结构差异。' },
  { where: 'C', sel: '.ans', why: '块间距 16px（整页）vs 12px（compact 限高）—— 尺寸修饰，非结构差异。' },
  { where: 'C', sel: 'transition', why: 'Playground 把 .proc .ph/.hd .cp 的 transition 与侧栏项合并写在一条规则里，调试台拆开写在各自规则中 —— 等效，仅组织方式不同。' },
  { where: 'D', cls: 'cursor', why: 'Playground 演示流式输出光标；调试台运行完即完整呈现，不模拟流式光标。不影响组件复用。' },
  { where: 'D', cls: 'think', why: '「思考 开/关」状态提示块是**调参场景特有**（让调参的人直接看到思考开关的效果）；Playground 是纯对话演示，无此块。AnswerBlocks 需支持该块类型。' },
  { where: 'C', sel: '.typing', why: '调试台有「运行中」等待态（三点动画）；Playground 是静态演示，无运行态。AnswerBlocks 的 loading 槽位由调试台独有。' },
  { where: 'C', sel: '.bubble.err', why: '调试台有失败态样式（注入后端失败演示）；Playground 静态演示无失败态。' },
  { where: 'H', sel: 'hidden', why: '调试台的 Agent 胶囊不可切换（当前编辑的定义即对象），caret 由 props 关闭：DOM 节点保留、仅加 .hidden —— 结构与 Playground 一致，视觉由 props 控制。' },
  { where: 'H', sel: '对比运行', why: '调试台多一个「用线上参数对比运行」按钮（调参场景专属槽位）；Playground 本身跑的就是线上参数，不需要对比槽位。落地为 composer 的可选 slot。' },
];

const out = [];
const rec = (name, ok, detail) => out.push({ name, ok, detail: detail || '' });

function diffTree(a, b, p, diffs) {
  const here = p || '$';
  if (!a || !b) { diffs.push(`${here}：一侧缺失`); return; }
  if (a.t !== b.t) { diffs.push(`${here}：标签不同 ${a.t} ≠ ${b.t}`); return; }
  if (a.c !== b.c) { diffs.push(`${here} <${a.t}>：类名不同 "${a.c}" ≠ "${b.c}"`); }
  if (a.k.length !== b.k.length) {
    diffs.push(`${here} <${a.t}${a.c ? '.' + a.c.replace(/ /g, '.') : ''}>：子元素数 ${a.k.length} ≠ ${b.k.length}`);
  }
  const n = Math.max(a.k.length, b.k.length);
  for (let i = 0; i < n; i++) diffTree(a.k[i], b.k[i], `${here} > ${a.t}[${i}]`, diffs);
}

/** :root token 对账：两稿 token 集合与值必须一致（声明一致但变量缺失会让 var() 静默回退） */
function rootTokens(file) {
  const s = fs.readFileSync(file, 'utf8');
  const out = {};
  const re = /:root\{([\s\S]*?)\}/g;
  let m;
  while ((m = re.exec(s))) {
    for (const part of m[1].split(';')) {
      const kv = part.match(/^\s*(--[\w-]+)\s*:\s*(.+)$/);
      if (kv) out[kv[1]] = kv[2].trim();
    }
  }
  return out;
}

/** 从两份原型里提取 CSS 规则块（选择器 → 声明），用于对账 */
function cssRules(file) {
  const s = fs.readFileSync(file, 'utf8');
  const style = s.match(/<style>([\s\S]*?)<\/style>/)[1];
  const map = new Map();
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(style))) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
    if (!sel || sel.startsWith('@')) continue;
    const decl = m[2].replace(/\s+/g, '').trim();   // 归一化：纯声明串比，空白不参与
    if (!map.has(sel)) map.set(sel, decl);
  }
  return map;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));

  /* ---------- 左：Playground 屏①（静态 DOM） ---------- */
  await page.goto('file://' + PG_FILE, { waitUntil: 'networkidle0' });
  const pg = await page.evaluate((wlArr, makeSrc, panelSrc) => {
    const walk = eval(makeSrc)(wlArr);
    const turns = [...document.querySelectorAll('.pg-chat .turn')];
    return {
      codeTurn: walk(turns[0]),   // 轮一：用户问 + proc + AI（p.lead / codeblk / h4 / ol）
      lawTurn: walk(turns[1]),    // 轮二：用户问 + AI（p.lead / law / h4 / ol / p.cursor）
      classes: [...new Set([...document.querySelectorAll('.pg-chat *')].flatMap((e) => [...e.classList])
        .filter((c) => wlArr.includes(c)))].sort(),
      panel: eval(panelSrc)(null, wlArr, makeSrc),
    };
  }, STRUCT_CLASSES, MAKE_WALK, PANEL_SRC);

  /* ---------- 右：定义详情调试台（动态渲染） ---------- */
  await page.goto('file://' + DT_FILE, { waitUntil: 'networkidle0' });
  // 初始渲染树（欢迎语轮）—— 供 F 段与整合稿对拍（点编辑会清空重渲染，必须先抽）
  const dtInit = await page.evaluate((wlArr, makeSrc) => {
    const walk = eval(makeSrc)(wlArr);
    const turns = [...document.querySelectorAll('#chatbox .turn')];
    return { chat: turns.length ? walk(turns[0]) : null };
  }, STRUCT_CLASSES, MAKE_WALK);
  await page.click('[data-act="edit"][data-id="report-helper"]');
  await wait(300);
  const advOpen = await page.$eval('#card-adv', (e) => e.classList.contains('open'));
  if (!advOpen) await page.click('#card-adv .card-hd');
  await wait(150);
  await page.click('.bench-tabs .tb[data-tab="chat"]');
  await wait(120);

  const ask = async (q) => {
    await page.$eval('#chat-input', (e, qq) => { e.value = qq; }, q);
    await page.click('#btn-send');
    for (let i = 0; i < 40; i++) {
      await wait(150);
      const ok = await page.$eval('#chatbox .turn:last-child', (e) => !!e.querySelector('.ans p'));
      if (ok) break;
    }
    await wait(250);
    return page.evaluate((wlArr, makeSrc) => {
      const walk = eval(makeSrc)(wlArr);
      const turns = [...document.querySelectorAll('#chatbox .turn')];
      return {
        last: walk(turns[turns.length - 1]),
        classes: [...new Set([...document.querySelectorAll('#chatbox *')].flatMap((e) => [...e.classList])
          .filter((c) => wlArr.includes(c)))].sort(),
      };
    }, STRUCT_CLASSES, MAKE_WALK);
  };

  const codeTurn = await ask('算一下两年复合增速');            // proc + p.lead + codeblk + p
  const listTurn = await ask('营业总收入是多少');              // proc + p.lead + h4 + ol + p

  // 切到合同定义问「原文」→ law 块
  await page.click('#btn-back');
  await wait(250);
  if (await page.$('.cfm')) await page.click('.cfm [data-y]');
  await wait(200);
  await page.click('[data-act="edit"][data-id="contract-extract"]');
  await wait(300);
  const advOpen2 = await page.$eval('#card-adv', (e) => e.classList.contains('open'));
  if (!advOpen2) await page.click('#card-adv .card-hd');
  await wait(120);
  await page.click('.bench-tabs .tb[data-tab="chat"]');
  await wait(120);
  const lawTurn = await ask('§7.2 违约金条款原文是什么？');     // proc + p.lead + law
  await page.mouse.move(4, 4);
  await wait(120);
  const dtPanel = await page.evaluate(`(${PANEL_SRC})(null, ${JSON.stringify(STRUCT_CLASSES)}, ${MAKE_WALK})`);

  /* ---------- 整合稿（hub）：同源性证明 + 稿内两处对拍 ----------
     E：hub 的 Playground 屏 / 详情屏必须与两份定稿**逐节点一致**——hub 由
        scripts/build-agents-hub.mjs 同源抽取生成，此段守「不许手改漂移」；
     G：hub 稿内 Playground 屏 ⇄ hub 调试台（动态渲染）——产品问的「复用的组件模块
        是否一样」在整合稿内的直接证据。 */
  const jsErrBeforeHub = jsErrors.length;
  await page.goto('file://' + HUB_FILE, { waitUntil: 'networkidle0' });
  const hubInit = await page.evaluate((wlArr, makeSrc, panelSrc) => {
    const walk = eval(makeSrc)(wlArr);
    const pgTurns = document.querySelectorAll('.screen[data-screen="pg"] .pg-chat .turn');
    const dtTurns = document.querySelectorAll('#chatbox .turn');
    return {
      pg: { codeTurn: walk(pgTurns[0]), lawTurn: walk(pgTurns[1]) },
      chat: dtTurns.length ? walk(dtTurns[0]) : null,
      pgPanel: eval(panelSrc)('.screen[data-screen="pg"] .chatpanel', wlArr, makeSrc),
    };
  }, STRUCT_CLASSES, MAKE_WALK, PANEL_SRC);
  /* hub 起始屏 = Agent 概览（#/agents），进定义详情要先把「定义管理」屏切出来 */
  await page.evaluate(() => { location.hash = '#/agents/definitions'; });
  await wait(250);
  await page.click('[data-act="edit"][data-id="report-helper"]');
  await wait(300);
  const hubAdvOpen = await page.$eval('#card-adv', (e) => e.classList.contains('open'));
  if (!hubAdvOpen) await page.click('#card-adv .card-hd');
  await wait(150);
  await page.click('.bench-tabs .tb[data-tab="chat"]');
  await wait(120);
  const hubBench = await ask('算一下两年复合增速');
  await page.mouse.move(4, 4);
  await wait(120);
  const hubDtPanel = await page.evaluate(`(${PANEL_SRC})(null, ${JSON.stringify(STRUCT_CLASSES)}, ${MAKE_WALK})`);

  rec('页面无 JS 报错', jsErrors.length === 0, jsErrors.join('; '));
  rec('E0 整合稿无 JS 报错', jsErrors.length - jsErrBeforeHub === 0,
    jsErrors.slice(jsErrBeforeHub).join('; '));

  /* ---------- A. 整轮骨架（.ans 视为叶子：回答内容因问题而异，块内结构由 B 段比） ---------- */
  const leafAns = (tree) => {
    const strip = (n) => {
      if (n.t === 'div' && n.c.split(' ').includes('ans')) return { t: 'div', c: 'ans', k: [] };
      return { t: n.t, c: n.c, k: n.k.map(strip) };
    };
    return strip(tree);
  };
  const d1 = [];
  diffTree(leafAns(pg.codeTurn), leafAns(codeTurn.last), 'turn(代码块轮)', d1);
  rec('A1 整轮骨架一致（代码块轮）', d1.length === 0, d1.join(' | '));

  const d2 = [];
  diffTree(leafAns(pg.lawTurn), leafAns(lawTurn.last), 'turn(法条轮)', d2);
  const d2Unknown = d2.filter((x) => !/cursor/.test(x));   // cursor 为已登记差异
  rec('A2 整轮骨架一致（法条轮，除已登记 cursor）', d2Unknown.length === 0, d2Unknown.join(' | '));
  const cursorKnown = d2.filter((x) => /cursor/.test(x));
  rec('A2-known cursor 差异已登记', KNOWN.some((k) => k.where === 'D' && k.cls === 'cursor'),
    cursorKnown.length ? cursorKnown.join(' | ') : '（本轮未复现，登记仍保留）');

  /* ---------- B. block 内部结构 ---------- */
  // key 传 '.x' 按类名找，传 'tag:x' 按标签名找（<ol>/<h4>/<pre> 无 class）
  const pick = (tree, key) => {
    const byTag = key.startsWith('tag:');
    const want = byTag ? key.slice(4) : key.replace(/^\./, '');
    const find = (n) => {
      const hit = byTag ? n.t === want : n.c.split(' ').includes(want);
      if (hit) return n;
      for (const k of n.k) { const r = find(k); if (r) return r; }
      return null;
    };
    return find(tree);
  };
  const BLOCKS = ['.proc', '.codeblk', '.law', 'tag:ol', 'tag:h4', 'tag:pre', '.bubble-meta', '.bubble-wrap', '.lead', '.think'];
  for (const key of BLOCKS) {
    const a = pick(pg.codeTurn, key) || pick(pg.lawTurn, key);
    const b = pick(codeTurn.last, key) || pick(listTurn.last, key) || pick(lawTurn.last, key);
    const knownOne = KNOWN.find((k) => k.where === 'D' && ('.' + k.cls) === key);
    if (!a || !b) {
      if (knownOne) { rec(`B ${key} 仅一侧有（已登记）`, true, knownOne.why); continue; }
      rec(`B ${key} 两边都取到`, false, `左=${!!a} 右=${!!b}`); continue;
    }
    const d = [];
    diffTree(a, b, key, d);
    rec(`B ${key} 内部结构一致`, d.length === 0, d.join(' | '));
  }

  /* ---------- C. CSS 规则块对账（只对账消息结构相关选择器） ---------- */
  const MSG_SEL = /(^|[\s.,])(turn|bubble-wrap|bubble|bubble-meta|src-tag|ans|proc|codeblk|law|cursor|typing|think|lead|pg-chat|chatpanel|pg-toolbar|pg-agent|pg-spacer|pg-run|pg-dbg|composer|caret)\b/;
  const cssA = cssRules(PG_FILE);
  const cssB = cssRules(DT_FILE);
  const cssDiffs = [];
  for (const [sel, decl] of cssA) {
    if (!MSG_SEL.test(sel)) continue;
    if (!cssB.has(sel)) { cssDiffs.push(`仅 Playground 有：${sel} { ${decl} }`); continue; }
    if (cssB.get(sel) !== decl) cssDiffs.push(`声明不同：${sel}\n    PG: ${decl}\n    DT: ${cssB.get(sel)}`);
  }
  for (const [sel, decl] of cssB) {
    if (!MSG_SEL.test(sel) || cssA.has(sel)) continue;
    cssDiffs.push(`仅调试台有：${sel} { ${decl} }`);
  }
  const cssUnknown = cssDiffs.filter((x) => !KNOWN.some((k) => k.where === 'C' && x.includes(k.sel)));
  rec('C CSS 规则差异均已登记', cssUnknown.length === 0,
    `共 ${cssDiffs.length} 处差异，未登记 ${cssUnknown.length} 处` + (cssUnknown.length ? '\n    ' + cssUnknown.join('\n    ') : ''));

  /* ---------- D. 类名并集差 ---------- */
  const dtClasses = [...new Set([...codeTurn.classes, ...listTurn.classes, ...lawTurn.classes])];
  const onlyA = pg.classes.filter((c) => !dtClasses.includes(c));
  const onlyB = dtClasses.filter((c) => !pg.classes.includes(c));
  const clsUnknown = [...onlyA, ...onlyB].filter((c) => !KNOWN.some((k) => k.where === 'D' && k.cls === c));
  rec('D 类名并集差均已登记', clsUnknown.length === 0,
    `仅 PG：${onlyA.join(',') || '无'}；仅 DT：${onlyB.join(',') || '无'}` + (clsUnknown.length ? `；未登记：${clsUnknown.join(',')}` : ''));

  /* ---------- E. 同源性：整合稿与两份定稿逐节点一致（构建脚本同源抽取，禁手改漂移） ---------- */
  const e1 = [];
  diffTree(pg.codeTurn, hubInit.pg.codeTurn, 'hub-PG(代码块轮)', e1);
  rec('E1 整合稿 Playground 屏与定稿同源（代码块轮）', e1.length === 0, e1.join(' | '));
  const e2 = [];
  diffTree(pg.lawTurn, hubInit.pg.lawTurn, 'hub-PG(法条轮)', e2);
  rec('E2 整合稿 Playground 屏与定稿同源（法条轮）', e2.length === 0, e2.join(' | '));
  const f1 = [];
  if (!dtInit.chat || !hubInit.chat) f1.push(`一侧无初始轮（DT=${!!dtInit.chat} hub=${!!hubInit.chat}）`);
  else diffTree(dtInit.chat, hubInit.chat, 'hub-DT(欢迎语轮)', f1);
  rec('F1 整合稿详情屏初始渲染与定稿同源（欢迎语轮）', f1.length === 0, f1.join(' | '));

  /* ---------- G. 稿内两处：整合稿 Playground 屏 ⇄ 整合稿调试台（动态渲染） ---------- */
  const g1 = [];
  diffTree(leafAns(hubInit.pg.codeTurn), leafAns(hubBench.last), 'hub 稿内(代码块轮)', g1);
  rec('G1 整合稿内 Playground ⇄ 调试台骨架一致（代码块轮）', g1.length === 0, g1.join(' | '));

  /* ---------- H. 对话面板外围：工具栏 + 输入区（含运行按钮）是否同构 ----------
     背景：产品反馈「Playground 对话区和参数调测的对话区不一样，只有聊天记录勉强一样，
     运行按钮不一致」——上一版只比了聊天轮子树，外围差异是漏网 apoptosis 的漏网点。 */
  const H_KNOWN = KNOWN.filter((k) => k.where === 'H');
  const hFilter = (diffs) => diffs.filter((x) => !H_KNOWN.some((k) => x.includes(k.sel)));
  const panelDiff = (a, b, label) => {
    const d = [];
    if (!a || !b) return [`${label}：一侧无对话面板（左=${!!a} 右=${!!b}）`];
    const dt = [];
    diffTree(a.toolbar, b.toolbar, label + ' .pg-toolbar', dt);
    d.push(...hFilter(dt).map((x) => '[工具栏] ' + x));
    const dc = [];
    diffTree(a.composer, b.composer, label + ' .composer', dc);
    d.push(...hFilter(dc).map((x) => '[输入区] ' + x));
    return d;
  };

  const h1 = panelDiff(pg.panel, dtPanel, 'PG⇄DT');
  rec('H1 对话面板外围同构（工具栏 + 输入区，除已登记差异）', h1.length === 0, h1.join('\n         '));

  const runA = pg.panel && pg.panel.runBtn, runB = dtPanel && dtPanel.runBtn;
  const dtExtra = (dtPanel && dtPanel.extra) || [], pgExtra = (pg.panel && pg.panel.extra) || [];
  rec('H2 运行按钮存在且类名一致（.btn.run）',
    !!runA && !!runB && runA.cls === runB.cls,
    `Playground：${runA ? runA.cls : '缺失'} ／ 调试台：${runB ? runB.cls : '缺失'}`);
  rec('H3 运行按钮文案一致', !!runA && !!runB && runA.text === runB.text,
    `Playground：${runA ? runA.text : '缺失'} ／ 调试台：${runB ? runB.text : '缺失'}`);
  // 类名一致不等于长得一样：computed 也一致才算（防「声明相同、被更高特异性规则覆盖」）
  rec('H3b 运行按钮 computed 样式一致（背景/文字/边框/高度/字重）',
    !!runA && !!runB && runA.style === runB.style,
    `Playground：${runA ? runA.style : '缺失'} ／ 调试台：${runB ? runB.style : '缺失'}`);
  const exA = pg.panel && pg.panel.toolbar, exB = dtPanel && dtPanel.toolbar;
  const txtA = JSON.stringify(exA) === JSON.stringify(exB);
  rec('H3c 工具栏结构逐节点一致（含 Agent 胶囊 / 运行状态 / Debugger）', txtA,
    txtA ? '' : 'Playground：' + JSON.stringify(exA) + '\n         调试台：' + JSON.stringify(exB));

  const extraKnown = H_KNOWN.find((k) => k.sel === '对比运行');
  rec('H4 调试台多出的按钮恰为已登记槽位（用线上参数对比运行）',
    !!extraKnown && dtExtra.length === 1 && /对比运行/.test(dtExtra[0]) && pgExtra.length === 0,
    `调试台多出：${JSON.stringify(dtExtra)}；Playground 多出：${JSON.stringify(pgExtra)}`);

  const h5 = panelDiff(hubInit.pgPanel, hubDtPanel, 'hub 稿内');
  rec('H5 整合稿内两处对话面板外围同构', h5.length === 0, h5.join('\n         '));
  const h6 = panelDiff(pg.panel, hubInit.pgPanel, 'PG⇄hub-PG');
  rec('H6 整合稿 Playground 屏外围与定稿同源', h6.length === 0, h6.join('\n         '));
  const h7 = panelDiff(dtPanel, hubDtPanel, 'DT⇄hub-DT');
  rec('H7 整合稿调试台外围与定稿同源', h7.length === 0, h7.join('\n         '));

  /* ---------- T. :root token 对账（两稿 token 集合 / 值） ---------- */
  const tokA = rootTokens(PG_FILE), tokB = rootTokens(DT_FILE);
  const tokMiss = Object.keys(tokB).filter((k) => !(k in tokA));
  const tokExtra = Object.keys(tokA).filter((k) => !(k in tokB));
  const tokDiff = Object.keys(tokA).filter((k) => k in tokB && tokA[k] !== tokB[k]);
  rec('T1 两稿 :root token 集合与值一致（防 var() 静默回退）',
    tokMiss.length === 0 && tokExtra.length === 0 && tokDiff.length === 0,
    `PG ${Object.keys(tokA).length} / DT ${Object.keys(tokB).length}` +
    (tokMiss.length ? `；Playground 缺 ${tokMiss.join(',')}` : '') +
    (tokExtra.length ? `；调试台缺 ${tokExtra.join(',')}` : '') +
    (tokDiff.length ? `；值不同 ${tokDiff.map((k) => k + '(' + tokA[k] + ' vs ' + tokB[k] + ')').join(' ')}` : ''));

  await browser.close();

  /* ---------- 报告 ---------- */
  const pass = out.filter((r) => r.ok).length;
  process.stderr.write('\n===== Playground ⇄ 调试台 parity 报告 =====\n');
  for (const r of out) {
    process.stderr.write(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${r.detail ? '\n         ' + r.detail.replace(/\n/g, '\n         ') : ''}\n`);
  }
  process.stderr.write(`\n合计 ${pass}/${out.length} 通过\n`);
  process.stdout.write(JSON.stringify(out, null, 1));
  process.exit(pass === out.length ? 0 : 1);
})().catch((e) => { process.stderr.write('parity 脚本异常：' + e.message + '\n' + e.stack + '\n'); process.exit(2); });
