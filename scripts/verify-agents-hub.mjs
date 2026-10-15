import fs from 'node:fs';
import { createRequire } from 'node:module';
import { REGISTRY } from './lib/proto-registry.mjs';
import { cssBlocks, selOf } from './lib/html-utils.mjs';
const require = createRequire('/Users/geekwen/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

// 用法：node scripts/verify-agents-hub.mjs [原型 html 绝对路径]
// 目的：菜单级整合稿（admin-agents-hub.html）的「整合层」断言：
//       ① 壳与起始态（起始屏 = Agent 概览 / #/agents）
//       ② 菜单**全部可达**：逐项点击 → 仅本屏可见 + crumb 含菜单名 + active 唯一 + URL 同步
//       ③ 无 .nolink 死项、屏数 = 菜单数 + 1（detail 无菜单项）、路由唯一
//       ④ 真实屏内容特征（对话调试两个示例轮）
//       ⑤ 占位屏带「范围说明」（Agents 组内带示意数据；非 Agents 模块只登记位置/路由，不伪造数据）
//       ⑥ 组件复用地图四件套 + 表单复用件 + 门禁命令
//       ⑦ 整合稿内闭环：列表 → 编辑 → 详情 → 返回 + 调试台可跑（一问一答组）
//       ⑧ 与真实 admin 对账：菜单文案/顺序 vs apps/admin/src/layouts/BasicLayout.vue、路由 vs router/index.ts
//          （读源码对账——「红框菜单还没合入」的根因就是菜单与真实 admin 脱钩，必须机检守住）
//       ⑨ 壳与菜单的结构 + 样式（antd Sider/SubMenu/折叠/选中态 computed）
//       ⑩ 注册表整合：每屏内容来源可追溯（登记了 = 真合进去了）+ 作用域隔离不泄漏其它屏
//          + 占位屏批次与 specs/admin-prototype-coverage/tasks.md 对账
// 消息结构 parity（与 Playground / 原两份文件对拍）由 verify-playground-parity.mjs 守，此处不重复。
const ROOT = '/Users/geekwen/workspace/web_system-llm-tuning';
const FILE = 'file://' + (process.argv[2] || ROOT + '/docs/ui/prototypes/admin-agents-hub.html');
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--no-proxy-server'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1400 });
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e)));
await page.goto(FILE, { waitUntil: 'load' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const out = [];
const rec = (name, actual, expect, ok) => {
  const r = { name, actual, expect, ok: ok ?? actual === expect };
  process.stderr.write((r.ok ? '  ok  ' : ' FAIL ') + name + '\n');
  out.push(r);
  return r;
};
// 真实可见性：computed display/visibility + 盒子高度（只查 class 会漏 .hidden 被压掉的 bug）
const vis = (sel) => page.$eval(sel, (e) => {
  const s = getComputedStyle(e);
  return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().height > 0;
}).catch(() => false);
const txt = (sel) => page.$eval(sel, (e) => e.textContent.trim());
// 当前真实可见的屏（列表；用于「只有本屏可见」这类断言）
const visibleScreens = () => page.$$eval('.screen', (ns) => ns
  .filter((n) => {
    const s = getComputedStyle(n);
    return s.display !== 'none' && s.visibility !== 'hidden' && n.getBoundingClientRect().height > 0;
  })
  .map((n) => n.dataset.screen));
const clickEl = async (sel, opts) => {
  const el = await page.$(sel);
  if (!el) throw new Error('找不到元素：' + sel);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await wait(80);
  try { await el.click(opts); }
  catch (err) {
    process.stderr.write('  warn  ' + sel + ' 被遮挡，改用元素自身派发点击\n');
    await el.evaluate((e) => e.click());
  }
};

// —— ① 壳与起始态 ——
rec('1a 页面无 JS 报错', jsErrors.length, 0);
// 弹窗：整合稿自身不用弹窗（进新页面）；但合入的模块稿允许自带（dict-module.html 的删除确认）
// → 断言收敛为「弹窗只出现在合入稿的屏内，不散落到其它屏」
rec('1b 弹窗结构只出现在合入的模块稿屏内（不散落其它屏）',
  await page.$$eval('.mask, .modal', (ns) => ns.every((n) => !!n.closest('.screen[data-screen="dicts"]'))), true);
rec('1c 起始屏 = Agent 概览', await vis('.screen[data-screen="overview"]'), true);
rec('1d 起始 crumb', await txt('#crumb'), 'Agents / Agent 概览');
rec('1e 起始菜单 active = Agent 概览',
  await page.$eval('.ad-item[data-screen="overview"]', (e) => e.classList.contains('active')), true);
rec('1f body .hidden 规则在位（防 .screen 压掉隐藏）',
  await page.evaluate(() => {
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (r.selectorText === 'body .hidden' && /display:\s*none/.test(r.style.cssText)) return true;
      }
    }
    return false;
  }), true);

// —— ② 菜单全量可达（逐项点击；菜单 = BasicLayout 8 个模块 + Agents 9 页） ——
const NAV = await page.$$eval('.ad-item[data-screen]', (ns) => ns.map((n) => ({
  screen: n.dataset.screen, route: n.dataset.route,
  label: (n.querySelector('.ad-t') || n).textContent.trim(),   // 文案在 .ad-t（图标是 svg，不混进文案）
})));
rec('2a 菜单项数', NAV.length, 17);
rec('2b 无 .nolink 死项（每一项都必须可点）', await page.$$eval('.ad-item.nolink', (n) => n.length), 0);
rec('2c 屏数 = 菜单数 + 1（detail 无菜单项）',
  await page.$$eval('.screen', (n) => n.length), NAV.length + 1);
rec('2d 菜单路由唯一', new Set(NAV.map((m) => m.route)).size, NAV.length);
for (const m of NAV) {
  await clickEl(`.ad-item[data-screen="${m.screen}"]`);
  await wait(180);
  rec(`2-${m.screen} 仅本屏可见`, (await visibleScreens()).join(','), m.screen);
  rec(`2-${m.screen} crumb 含菜单名`, (await txt('#crumb')).includes(m.label), true);
  rec(`2-${m.screen} active 唯一且落本项`,
    await page.$$eval('.ad-item[data-screen]', (ns, want) => ns
      .filter((n) => n.classList.contains('active')).length === 1
      && !!ns.find((n) => n.dataset.screen === want && n.classList.contains('active')), m.screen), true);
  rec(`2-${m.screen} URL 同步`, await page.evaluate(() => location.hash), m.route);
}
// 回列表（后续段落要在列表屏上操作）
await clickEl('.ad-item[data-screen="list"]');
await wait(180);

// —— ③ 真实屏内容特征（对话调试，同源抽取） ——
await clickEl('.ad-item[data-screen="pg"]');
await wait(180);
rec('3a 对话调试两个示例轮', await page.$$eval('[data-screen="pg"] .pg-chat .turn', (n) => n.length), 2);
rec('3b 代码块轮（codeblk）', await page.$$eval('[data-screen="pg"] .turn:first-child .codeblk', (n) => n.length), 1);
rec('3c 法条轮（law）', await page.$$eval('[data-screen="pg"] .turn:last-child .law', (n) => n.length), 1);
rec('3d 对话调试过程卡片（proc）', await page.$$eval('[data-screen="pg"] .proc', (n) => n.length), 1);
await clickEl('.ad-item[data-screen="list"]');
await wait(180);

// —— ④ 占位屏：范围说明 + 复用件标注（每条都须有出处，不许无出处的空屏） ——
for (const [s, kw] of [
  ['overview', ['P4 后续批次', 'KPI']],
  ['observe', ['P4 后续批次', 'Echarts']],
  ['records', ['P4 后续批次', 'ProcCard', 'AnswerBlocks']],
  ['capabilities', ['P4 后续批次', 'contracts.md']],
  ['knowledge', ['P4 后续批次', '上传']],
  ['retrieval', ['P4 后续批次', 'ProcCard']],
  ['skills', ['P4 后续批次', 'AnswerBlocks']],
  ['dashboard', ['P5', 'KPI']],
  ['bianbian', ['P3', '隐私']],
  ['users', ['P1', '详情页']],
  ['roles', ['P2', '二次确认']],
  ['mcp', ['P4', '脱敏']],
  /* settings / dicts 已由注册表合入真实内容 → 不在占位清单；其内容断言见 ⑩ 段 */
  ['database', ['P3', '只读']],
]) {
  const t = await page.$eval(`.screen[data-screen="${s}"]`, (e) => e.textContent);
  rec(`4-${s} 范围说明与复用标注`, kw.every((k) => t.includes(k)), true);
}

// —— ⑤ 组件复用地图 ——
rec('5a 四件套齐全',
  await page.$$eval('.rm-card .nm', (ns) => ns.map((e) => e.textContent.replace(/\d/g, '').trim()).join('|'),
  ).then((v) => v === 'Turn|Bubble|AnswerBlocks|ProcCard'), true);
rec('5b 表单复用件（frow/badge/变更条）',
  await page.$eval('.rm-form', (e) => e.textContent.includes('frow')
    && e.textContent.includes('diff badge') && e.textContent.includes('变更条')), true);
rec('5c 门禁命令登记',
  await page.$eval('.rm-gate', (e) => e.textContent.includes('verify-playground-parity.mjs')), true);
rec('5d 每组件卡两个使用点',
  await page.$$eval('.rm-card', (ns) => ns.every((e) => e.querySelectorAll('.use .u').length === 2)), true);

// —— ⑥ 整合稿内闭环：列表 → 编辑 → 详情 → 返回 ——
await clickEl('[data-act="edit"][data-id="report-helper"]');
await wait(250);
rec('6a 详情屏可见', await vis('.screen[data-screen="detail"]'), true);
rec('6b 列表屏隐藏', await vis('.screen[data-screen="list"]'), false);
rec('6c crumb 带定义 id', await txt('#crumb'), 'Agents / 定义管理 / report-helper');
rec('6d 菜单 active 落在定义管理',
  await page.$eval('.ad-item[data-screen="list"]', (e) => e.classList.contains('active')), true);
rec('6e 详情 URL 同步', await page.evaluate(() => location.hash), '#/agents/definitions/report-helper');
rec('6f 标题载入', await txt('#dt-title'), '财报解读助手');
// 未保存改动时返回 → 内联二次确认（不是弹窗）
await clickEl('#seg-sampler [data-sampler="topP"]');
await wait(150);
rec('6g diff 条出现', await vis('#diffbar'), true);
await clickEl('#btn-back');
await wait(200);
rec('6h 内联确认出现（非弹窗）', await page.$$eval('.cfm', (n) => n.length) > 0, true);
await clickEl('.cfm [data-y]');
await wait(250);
rec('6i 确认后回列表', await vis('.screen[data-screen="list"]'), true);
rec('6j 返回后 URL = 定义管理', await page.evaluate(() => location.hash), '#/agents/definitions');

// —— ⑦ 整合稿内调试台可跑：一问一答组（用户气泡 + AI 气泡同 .turn） ——
await clickEl('[data-act="edit"][data-id="report-helper"]');
await wait(250);
const advOpen = await page.$eval('#card-adv', (e) => e.classList.contains('open'));
if (!advOpen) await clickEl('#card-adv .card-hd');
await wait(200);
await clickEl('.bench-tabs .tb[data-tab="chat"]');
await wait(150);
await page.$eval('#chat-input', (e) => { e.value = '营业总收入是多少'; });
await clickEl('#btn-send');
let ansOk = false;
for (let i = 0; i < 40; i++) {
  await wait(150);
  ansOk = await page.$eval('#chatbox .turn:last-child', (e) => !!e.querySelector('.ans p')).catch(() => false);
  if (ansOk) break;
}
rec('7a 调试台跑出回答', ansOk, true);
rec('7b 一问一答同组（.turn 内用户+AI 气泡）',
  await page.$eval('#chatbox .turn:last-child',
    (e) => !!e.querySelector('.bubble-wrap.me .bubble.user') && !!e.querySelector('.bubble-wrap:not(.me) .bubble.ai .ans')), true);
rec('7c 过程卡片在 AI 气泡之前',
  await page.$eval('#chatbox .turn:last-child', (e) => {
    const kids = [...e.children];
    const pi = kids.findIndex((k) => k.classList.contains('proc'));
    const ai = kids.findIndex((k) => k.classList.contains('bubble-wrap') && !k.classList.contains('me'));
    return pi >= 0 && ai >= 0 && pi < ai;
  }), true);
rec('7d 运行后仍无 JS 报错', jsErrors.length, 0);

// —— ⑧ 与真实 admin 对账（读源码；防「菜单与真实 admin 脱钩」重演） ——
const vueSrc = fs.readFileSync(ROOT + '/apps/admin/src/layouts/BasicLayout.vue', 'utf8');
const routerSrc = fs.readFileSync(ROOT + '/apps/admin/src/router/index.ts', 'utf8');
const realLabels = [...vueSrc.matchAll(/<a-menu-item[^>]*key="[^"]*"[^>]*>([\s\S]*?)<\/a-menu-item>/g)]
  .map((m) => (m[1].match(/<span>([^<]+)<\/span>/) || [])[1])
  .map((s) => (s || '').trim())
  .filter(Boolean);
const hubLabels = NAV.map((m) => m.label);
// 已知增量：Agent 概览 —— router 的 /agents index 页（AgentOverview.vue），BasicLayout 未挂菜单项
const KNOWN_EXTRA = ['Agent 概览'];
rec('8a 真实菜单项数（BasicLayout 读取成功）', realLabels.length > 10, true);
rec('8b 菜单文案与顺序 = BasicLayout.vue（剔除已知增量）',
  hubLabels.filter((l) => !KNOWN_EXTRA.includes(l)).join('|'), realLabels.join('|'));
rec('8c 已知增量有且仅有 1 项（Agent 概览，router /agents index）',
  hubLabels.filter((l) => !realLabels.includes(l)).join('|'), KNOWN_EXTRA.join('|'));
rec('8d 每项菜单路由的末段在 router/index.ts 里存在',
  NAV.filter((m) => !new RegExp(`path: '(?:[a-z-]+/)*${m.route.split('/').pop()}(?:[/':]|$)`).test(routerSrc))
    .map((m) => m.label).join('|'), '');
rec('8e BasicLayout 里没有本稿缺掉的菜单项',
  realLabels.filter((l) => !hubLabels.includes(l)).join('|'), '');

// —— ⑨ 壳与菜单「结构 + 样式」= 真实 admin（BasicLayout.vue + antd Menu） ——
// 背景：产品意见「菜单的结构最好跟 admin 的样式保持一致」——此前是「分组小标题 + 平铺项」，
//       与真实 admin 的 Sider（logo + 折叠）+ a-menu（一级带 icon / Agents 为 a-sub-menu）
//       + 顶栏（Home 图标 + 面包屑 + 主题 + 用户）+ 页脚 不是一回事。
await page.evaluate(() => { location.hash = '#/agents/definitions'; });
await wait(280);
const siderW = () => page.$eval('#sider', (e) => Math.round(e.getBoundingClientRect().width));

rec('9a sider 宽 = 220（BasicLayout width="220"）', await siderW(), 220);
rec('9a2 当前屏属二级模块 → 父级 sub-menu 标题高亮（submenu-selected）',
  await page.evaluate(() => {
    const s = document.querySelector('.ad-sub');
    return s.classList.contains('selected') + '|' + getComputedStyle(s.querySelector('.ad-sub-t')).color;
  }), 'true|rgb(255, 140, 66)');
rec('9b 一级菜单 8 项且每项带图标',
  await page.$$eval('.ad-item:not(.ad-item-sub)', (ns) => ns.filter((n) => n.querySelector('svg')).length), 8);
rec('9c Agents 子菜单 9 项且不带图标（对齐 a-menu-item 无 icon）',
  await page.$$eval('.ad-item-sub', (ns) => ns.length + '|' + ns.filter((n) => n.querySelector('svg')).length), '9|0');
rec('9d 菜单项高 40（antd itemHeight）',
  await page.$eval('.ad-item', (e) => Math.round(e.getBoundingClientRect().height)), 40);
rec('9d2 子项左缩进 46px（a-sub-menu 内缩进，明显大于一级的 12px）',
  await page.evaluate(() => {
    const t = document.querySelector('.ad-item:not(.ad-item-sub)');
    const s = document.querySelector('.ad-item-sub');
    return getComputedStyle(s).paddingLeft + '|' + getComputedStyle(t).paddingLeft;
  }), '46px|12px');
rec('9e 菜单图标 16×16（不撑爆布局）',
  await page.$eval('.ad-item .ad-ic svg', (e) => {
    const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height);
  }), '16x16');

const act = await page.evaluate(() => {
  const e = document.querySelector('.ad-item.active');
  if (!e) return null;
  const s = getComputedStyle(e), a = getComputedStyle(e, '::after');
  return { color: s.color, bg: s.backgroundImage, afterW: a.width, afterBg: a.backgroundColor };
});
rec('9f 选中态文字 = 橙 #FF8C42', act && act.color, 'rgb(255, 140, 66)');
rec('9g 选中态背景 = 橙渐变（ant-menu-item-selected）',
  !!act && /linear-gradient/.test(act.bg) && /255, 140, 66/.test(act.bg), true);
rec('9h 选中态右侧 3px 竖条且为橙色（::after）',
  act && act.afterW + '|' + act.afterBg, '3px|rgb(255, 140, 66)');

// hover 采样：先把鼠标移开，避免残留 :hover 造成伪差异（2026-10-11 教训）
await page.mouse.move(4, 4); await wait(120);
const hv = await page.$eval('.ad-item[data-screen="skills"]', (e) => {
  const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const bgBefore = await page.$eval('.ad-item[data-screen="skills"]', (e) => getComputedStyle(e).backgroundColor);
await page.mouse.move(hv.x, hv.y); await wait(200);
const bgHover = await page.$eval('.ad-item[data-screen="skills"]', (e) => getComputedStyle(e).backgroundColor);
await page.mouse.move(4, 4); await wait(120);
rec('9i hover 背景 = rgba(255,140,66,.06)（且非 hover 态不是该色）',
  bgHover + '|' + (bgBefore !== bgHover), 'rgba(255, 140, 66, 0.06)|true');

await clickEl('.ad-sub-t'); await wait(220);
rec('9j 子菜单可收起（收起后子项不可见）', await vis('.ad-item[data-screen="skills"]'), false);
await clickEl('.ad-sub-t'); await wait(220);
rec('9k 子菜单可展开', await vis('.ad-item[data-screen="skills"]'), true);

await clickEl('#btn-collapse'); await wait(320);
rec('9l 折叠后 sider 宽 = 80（collapsedWidth）', await siderW(), 80);
rec('9m 折叠后只留图标（一级文案隐藏）', await vis('.ad-item[data-screen="skills"] .ad-t'), false);
rec('9m2 折叠后子菜单标题文案也隐藏（.ad-sub-t .ad-t）', await vis('.ad-sub-t .ad-t'), false);
rec('9m3 折叠后子项容器隐藏（.ad-sub-bd 不得漏出）', await vis('.ad-sub-bd'), false);
rec('9m4 折叠态菜单无横向溢出（scrollWidth ≤ clientWidth）',
  await page.$eval('.ad-menu', (e) => Math.round(e.scrollWidth - e.clientWidth)), 0);
// 折叠态头部：logo 色块不得被 flex 压扁（曾挤成 11px 细条），且头部内无溢出
rec('9m5 折叠态 logo 色块仍为 22×22（不被压缩）',
  await page.$eval('.ad-sider-head .ad-logo-dot', (e) => {
    const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height);
  }), '22x22');
rec('9m6 折叠态头部无横向溢出',
  await page.$eval('.ad-sider-head', (e) => Math.round(e.scrollWidth - e.clientWidth)), 0);
await clickEl('#btn-collapse'); await wait(320);
rec('9n 再点恢复 220', await siderW(), 220);

rec('9o 顶栏 56 高 + Home 图标 + 面包屑',
  (await page.$eval('.ad-header', (e) => Math.round(e.getBoundingClientRect().height)))
  + '|' + (await page.$$eval('.ad-home svg', (n) => n.length)), '56|1');
rec('9p 顶栏右侧：主题切换 + 用户', await page.$$eval('.ad-theme, .ad-user', (n) => n.length), 2);
rec('9q 页脚（品牌 + ©2026，对齐 BasicLayout footer）',
  await page.$eval('.ad-footer', (e) => e.textContent.includes('科豆 AI') && e.textContent.includes('©2026')), true);
// BasicLayout 的 #icon 槽位只取 sider 的 <a-menu>…</a-menu> 区间（顶栏头像那个 #icon 不算菜单图标）
const menuBlock = (vueSrc.match(/<a-menu[\s\S]*?<\/a-menu>/) || [''])[0];
rec('9r 菜单图标数 = BasicLayout 侧栏 a-menu 的 #icon 槽位数',
  await page.$$eval('.ad-menu .ad-ic', (n) => n.length), (menuBlock.match(/<template #icon>/g) || []).length);
rec('9s 菜单结构与 BasicLayout 同构（有 a-sub-menu / 无平铺分组标题）',
  await page.evaluate(() => !!document.querySelector('.ad-sub .ad-sub-t') && !document.querySelector('.ad-group')), true);
rec('9t 折叠/展开子菜单后无 JS 报错', jsErrors.length, 0);

// —— ⑩ 注册表整合（新机制）：来源可追溯 + 隔离不泄漏 + 批次有出处 ——
// 背景：产品意见「把菜单占位的原型稿也整合进来吧，后续就不用整合了，迭代也会更精准」。
// 机制：scripts/lib/proto-registry.mjs 每屏一行 —— 写了 source 的屏由 build 从原型稿同源抽取。
// 这一段证明三件事：① 登记了 = 真的合进去了；② 合进去没把别的屏弄坏；③ 占位屏的批次不是编的。
const hubHtml = fs.readFileSync(ROOT + '/docs/ui/prototypes/admin-agents-hub.html', 'utf8');
const regScreens = REGISTRY.map((r) => r.screen);
const navScreens = NAV.map((m) => m.screen);

rec('10a 注册表屏集合 = 菜单屏集合（无孤儿 / 无遗漏）',
  regScreens.slice().sort().join('|'), navScreens.slice().sort().join('|'));

// 10b 源稿指纹必须出现在生成稿（防「注册表登记了、build 没抽进去」这类静默失配）
const srcEntries = REGISTRY.filter((r) => r.source);
rec('10b-0 注册表里有稿的屏数量 ≥ 2', srcEntries.length >= 2, true);
for (const r of srcEntries) {
  const missing = r.source.trace.filter((t) => !hubHtml.includes(t));
  rec(`10b-${r.screen} 源稿指纹在生成稿里（${r.source.file}）`, missing.join('|'), '');
}
// 有稿的屏不得残留占位块（否则等于「合了一半」）
for (const r of srcEntries) {
  rec(`10b-${r.screen}2 有稿的屏不留占位块（ph-note/ph-skel）`,
    await page.$$eval(`.screen[data-screen="${r.screen}"] .ph-note, .screen[data-screen="${r.screen}"] .ph-skel`,
      (n) => n.length), 0);
}

// 10c 作用域隔离：合入稿的 CSS 规则必须条条带作用域（裸规则会污染全站 —— v2 事故同型）
const SEC = '/* ===== 来自 ';
const from = hubHtml.indexOf(SEC + 'dict-module.html');
const next = hubHtml.indexOf(SEC, from + SEC.length);
const nextComment = hubHtml.indexOf('/* =====', from + SEC.length);   // 壳 CSS 的段头，别把壳规则算进来
const dictCss = hubHtml.slice(hubHtml.indexOf('\n', from),
  nextComment > 0 ? nextComment : (next < 0 ? hubHtml.indexOf('</style>', from) : next));
const unscoped = cssBlocks(dictCss).map(selOf)
  .filter((sel) => !sel.startsWith('.screen[data-screen="dicts"]') && !/^@/.test(sel));
rec('10c-1 dict 稿 CSS 逐条作用域隔离（无全局裸规则）', unscoped.slice(0, 3).join(' | '), '');
rec('10c-2 dict 私有变量已作用域化（--primary 落在 .screen[data-screen="dicts"] 下）',
  /\.screen\[data-screen="dicts"\]\{[^}]*--primary:/.test(hubHtml), true);
const rootBlock = (hubHtml.match(/:root\{([\s\S]*?)\}/) || ['', ''])[1];
rec('10c-3 源稿私有变量未污染全局 :root',
  ['--primary:', '--card:', '--radius:'].filter((v) => rootBlock.includes(v)).join('|'), '');
// 运行时复核：dict 的 .btn 样式只在 dicts 屏生效，别的屏按钮不受影响
// 用 padding 做判据（font-size 两屏都是 13px，没有区分力）：dict 源稿 .btn = 7px 14px，
// 整合稿其它屏 = 0px 16px —— 两值不同即证明「dict 的 .btn 规则没泄到别的屏」
await page.evaluate(() => { location.hash = '#/settings/dicts'; });
await wait(320);
const dictBtnPad = await page.$eval('.screen[data-screen="dicts"] .btn', (e) => getComputedStyle(e).padding);
await page.evaluate(() => { location.hash = '#/agents/playground'; });
await wait(320);
const otherBtnPad = await page.$eval('.screen[data-screen="pg"] .btn', (e) => getComputedStyle(e).padding);
rec('10c-4 隔离生效：dict 的 .btn 只作用于 dicts 屏（7px 14px vs 0px 16px）',
  `${dictBtnPad}|${dictBtnPad !== otherBtnPad}|${otherBtnPad}`, '7px 14px|true|0px 16px');

// 10d 合入屏的交互真的可跑（不是静态贴图）
// ⚠️ 必须先把屏切回来：隐藏屏（display:none）里 getComputedStyle 一律返回 none/0，
//    直接断言会得到「抽屉关不掉」这类假 FAIL（上一版就在这栽了一次）
await page.evaluate(() => { location.hash = '#/settings/dicts'; });
await wait(360);
rec('10d-0 字典屏处于可见状态（后续 computed 断言的前提）',
  [await vis('.screen[data-screen="dicts"]'),
    await page.$eval('.screen[data-screen="dicts"] .drawer', (e) => getComputedStyle(e).display)]
    .join('|'), 'true|flex');
rec('10d-1 字典屏渲染出真实内容（字典项 ≥ 3）',
  await page.$$eval('.screen[data-screen="dicts"] .dict-item', (n) => n.length) >= 3, true);
// ⚠️ 抽屉用 transform 滑入滑出（.drawer{translateX(100%)} / .drawer.show{transform:none}）——
// 关掉后盒子仍在文档流里，只查 display/height 会一律判「可见」，必须查 show class + computed transform
const drawerState = () => page.$eval('.screen[data-screen="dicts"] .drawer', (e) => {
  const t = getComputedStyle(e).transform;
  const out = t === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t);
  return (e.classList.contains('show') ? 'show' : 'hidden') + '|' + out;
});
await clickEl('.screen[data-screen="dicts"] [onclick^="DM.openItemDrawer"]');
await wait(320);
rec('10d-2 点「新增记录」抽屉能打开（源稿交互被继承）', await drawerState(), 'show|true');
// 用元素自身派发点击（inline handler 写在属性上）：比坐标点击稳 —— 抽屉是 absolute 定位，
// scrollIntoView + 坐标点击在窄视口下容易落到遮罩/边界外，会产生假 FAIL
await page.$eval('.screen[data-screen="dicts"] .drawer-head .x', (e) => e.click());
await wait(320);
rec('10d-3 抽屉可关闭（点 ✕）', await drawerState(), 'hidden|false');
await clickEl('.screen[data-screen="dicts"] [onclick^="DM.openItemDrawer"]');
await wait(300);
await page.$eval('.screen[data-screen="dicts"] .drawer-mask', (e) => e.click());
await wait(320);
rec('10d-3b 抽屉可关闭（点遮罩）', await drawerState(), 'hidden|false');
await page.evaluate(() => { location.hash = '#/settings'; });
await wait(320);
rec('10d-4 系统设置屏渲染真实内容（tab 行 + 站点信息）',
  await page.$eval('.screen[data-screen="settings"]', (e) => e.textContent.includes('站点名称') && e.textContent.includes('功能开关')), true);
await clickEl('.screen[data-screen="settings"] .st-tabs .t2:nth-child(3)');
await wait(260);
rec('10d-5 系统设置 tab 可切换（安全策略）',
  await page.$eval('.screen[data-screen="settings"] #stBody', (e) => /安全|密码|登录/.test(e.textContent)), true);
rec('10d-6 合入稿交互后仍无 JS 报错', jsErrors.length, 0);

// 10e 占位屏批次必须能在 specs/admin-prototype-coverage/tasks.md 里找到出处（不许编批次）
const tasksSrc = fs.readFileSync(ROOT + '/specs/admin-prototype-coverage/tasks.md', 'utf8');
const taskRows = [...tasksSrc.matchAll(/^\|\s*\d+\s*\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|/gm)]
  .map((m) => ({ mod: m[1].replace(/\*\*/g, '').trim(), batch: m[5].replace(/\*\*/g, '').trim() }));
const labelOf = (sc) => (NAV.find((m) => m.screen === sc) || {}).label || '';
const batchMismatch = REGISTRY.filter((r) => r.batch).map((r) => {
  const lab = labelOf(r.screen);
  const hit = taskRows.find((t) => t.mod.includes(lab) || lab.includes(t.mod));
  if (!hit) return `${r.screen}(${lab}) 未在 tasks.md 找到模块行`;
  if (!hit.batch.includes(r.batch)) return `${r.screen}(${lab}) 批次 ${r.batch} ≠ tasks.md ${hit.batch}`;
  return null;
}).filter(Boolean);
rec('10e 占位屏批次与 specs/admin-prototype-coverage/tasks.md 逐项一致',
  batchMismatch.slice(0, 3).join(' | '), '');

// 10f 页面头部说明必须写明「注册表机制」，否则新人还是按老办法手工整合
rec('10f 页头写明整合机制（注册表 + 重跑 build）',
  await page.$eval('.proto-head', (e) => /proto-registry|注册表/.test(e.textContent)), true);

await browser.close();

const pass = out.filter((r) => r.ok).length;
process.stderr.write('\n===== 整合稿（hub）断言报告 =====\n');
for (const r of out) {
  if (!r.ok) process.stderr.write(` FAIL ${r.name}：actual=${JSON.stringify(r.actual)} expect=${JSON.stringify(r.expect)}\n`);
}
process.stderr.write(`合计 ${pass}/${out.length} 通过\n`);
process.stdout.write(JSON.stringify(out, null, 1));
process.exit(pass === out.length ? 0 : 1);
