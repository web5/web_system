import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/geekwen/.workbuddy/binaries/node/workspace/');
const puppeteer = require('puppeteer-core');

// 用法：node scripts/verify-proto-shell.mjs
// 目的：「框架壳 = 单一真相源」三稿对拍 —— 两份定稿（admin-agents.html / admin-agent-def-detail.html）
//       与整合稿（admin-agents-hub.html）的壳（sider 菜单结构 / logo / 折叠 / 子菜单）必须一致，
//       且每份都对齐真实 admin（BasicLayout.vue + antd Menu）。
//       背景：三份稿此前各写一套壳 → 漂移；现在壳由 scripts/lib/proto-shell.mjs 单源生成，
//       定稿由 sync-prototype-shell.mjs 注入、整合稿由 build-agents-hub.mjs 内联。
// 消息结构 parity 由 verify-playground-parity.mjs 守，菜单文案 vs BasicLayout 由 verify-agents-hub.mjs ⑧ 守，此处不重复。
const ROOT = '/Users/geekwen/workspace/web_system-llm-tuning';
const FILES = [
  ROOT + '/docs/ui/prototypes/admin-agents.html',
  ROOT + '/docs/ui/prototypes/admin-agent-def-detail.html',
  ROOT + '/docs/ui/prototypes/admin-agents-hub.html',
];
const LOGO = '科豆 AI';
const SIDER_W = 220;
const SIDER_W_COLLAPSED = 80;
/** 各稿首屏的选中菜单项（active 必须**落在 class 里**且样式真生效——曾把 active 拼成裸属性溜过机检） */
const ACTIVE_EXPECT = {
  'admin-agents.html': 'pg',
  'admin-agent-def-detail.html': 'list',
  'admin-agents-hub.html': 'overview',
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--no-proxy-server'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
const rec = (name, actual, expect) => {
  const r = { name, actual, expect, ok: actual === expect };
  process.stderr.write((r.ok ? '  ok  ' : ' FAIL ') + name + '\n');
  out.push(r);
  return r;
};

const snapshots = [];
for (const file of FILES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1400 });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  await page.goto('file://' + file, { waitUntil: 'load' });
  await wait(150);

  const snap = await page.evaluate(() => {
    const sider = document.getElementById('sider');   // 首屏侧栏（PG 定稿含两屏，只采第一屏）
    const labels = [...sider.querySelectorAll('.ad-item[data-screen]')]
      .map((n) => (n.querySelector('.ad-t') || n).textContent.trim());
    return {
      siderW: sider ? Math.round(sider.getBoundingClientRect().width) : 0,
      logo: sider.querySelector('.ad-logo-t').textContent.trim(),
      labels,
      subTitle: sider.querySelector('.ad-sub-t .ad-t').textContent.trim(),
      subCount: sider.querySelectorAll('.ad-sub-bd .ad-item-sub').length,
      hasCollapse: !!sider.querySelector('#btn-collapse'),
      hasHeaderRight: !!document.querySelector('.ad-hr'),
      hasHome: !!document.querySelector('.ad-home'),
      activeScreens: [...sider.querySelectorAll('.ad-item.active')].map((e) => e.dataset.screen),
      activeStyle: (() => {
        const el = sider.querySelector('.ad-item.active');
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
          bg: s.backgroundImage.includes('linear-gradient'),
          bar: getComputedStyle(el, '::after').width,
          color: s.color,
        };
      })(),
      subSelected: sider.querySelector('.ad-sub').classList.contains('selected'),
    };
  });
  snapshots.push(snap);

  const name = file.split('/').pop();
  rec(`${name} · sider 宽 = 220`, snap.siderW, SIDER_W);
  rec(`${name} · logo = 科豆 AI`, snap.logo, LOGO);
  rec(`${name} · 菜单 17 项`, snap.labels.length, 17);
  rec(`${name} · 子菜单标题 Agents + 9 子项`, [snap.subTitle, snap.subCount].join('/'), 'Agents/9');
  rec(`${name} · 有折叠按钮 / 顶栏右侧 / home 图标`, [snap.hasCollapse, snap.hasHeaderRight, snap.hasHome].join('/'), 'true/true/true');
  /* 选中项：class 里恰好一个 active，且样式真生效（渐变底 + 3px 竖条 + 橙字——computed 级，防「声明一致≠生效」） */
  rec(`${name} · 选中项 = ${ACTIVE_EXPECT[name.split('/').pop()]}`,
    snap.activeScreens.join(','), ACTIVE_EXPECT[name.split('/').pop()]);
  rec(`${name} · 选中样式生效（渐变底/3px 竖条/子菜单标题高亮）`,
    [snap.activeStyle && snap.activeStyle.bg, snap.activeStyle && snap.activeStyle.bar, snap.subSelected].join('/'),
    'true/3px/true');
  rec(`${name} · 无 JS 报错`, jsErrors.join('; '), '');

  // 折叠交互：点 #btn-collapse → 80 → 再点 → 220（transition ~150ms，等 350ms 读终值）
  await page.click('#btn-collapse');
  await wait(350);
  const collapsedW = await page.$eval('#sider', (e) => Math.round(e.getBoundingClientRect().width));
  rec(`${name} · 折叠后 sider = 80`, collapsedW, SIDER_W_COLLAPSED);
  await page.click('#btn-collapse');
  await wait(350);
  const expandedW = await page.$eval('#sider', (e) => Math.round(e.getBoundingClientRect().width));
  rec(`${name} · 再展开 sider = 220`, expandedW, SIDER_W);

  // 子菜单收起：点 Agents 标题 → .ad-sub 不再 open → 再点恢复
  await page.click('.ad-sub-t');
  await wait(100);
  rec(`${name} · 点 Agents 标题收起子菜单`, await page.$eval('.ad-sub', (e) => e.classList.contains('open')), false);
  await page.click('.ad-sub-t');
  await wait(100);
  rec(`${name} · 再点恢复展开`, await page.$eval('.ad-sub', (e) => e.classList.contains('open')), true);

  await page.close();
}

/* 跨稿一致：三份壳的菜单文案序列 / logo / sider 宽必须逐项一致（单一真相源证明） */
const labelsSet = snapshots.map((s) => s.labels.join('|'));
rec('三稿菜单文案序列一致', new Set(labelsSet).size, 1);
rec('三稿 logo 一致', new Set(snapshots.map((s) => s.logo)).size, 1);
rec('三稿 sider 宽一致', new Set(snapshots.map((s) => s.siderW)).size, 1);

await browser.close();
const fail = out.filter((r) => !r.ok).length;
process.stderr.write(`合计 ${out.length - fail}/${out.length} 通过\n`);
process.exit(fail ? 1 : 0);
