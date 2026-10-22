#!/usr/bin/env node
/**
 * 原型演示控件 · 静态机检（ux-prototype-designer）
 *
 * 用途：交人确认前，检查一份原型 HTML 的「原型演示控件」是否真的可用——
 *       重点抓三类事故：控件缺失、屏清单与实际屏不同步、开关点了不生效（假开关）。
 *
 * 用法：
 *   node skills/ux-prototype-designer/scripts/check-demo-panel.mjs <稿.html> [更多稿.html…]
 *   node skills/ux-prototype-designer/scripts/check-demo-panel.mjs --minimal <稿.html>   # L0 低保真稿只过前两项
 *
 * 退出码：0 = 通过；1 = 有未过项（逐条打印 ::error 行，便于 CI 注解）
 * 规格：skills/ux-prototype-designer/references/demo-control-panel.md
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const minimal = args.includes('--minimal');
const files = args.filter((a) => !a.startsWith('--'));

if (files.length === 0) {
  console.error('用法: node check-demo-panel.mjs [--minimal] <稿.html> [更多稿.html…]');
  process.exit(1);
}

/** 收集所有标签的属性（够用的轻量解析，不引依赖） */
function tags(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      attrs[a[1].toLowerCase()] = a[2] ? a[2].replace(/^["']|["']$/g, '') : '';
    }
    out.push({ name: m[1].toLowerCase(), attrs });
  }
  return out;
}

let failed = 0;
const fail = (file, msg) => { console.log(`::error file=${file}::${msg}`); failed++; };

for (const file of files) {
  const html = readFileSync(file, 'utf8');
  const all = tags(html);
  const has = (attr) => all.some((t) => attr in t.attrs);

  // ── 1. 控件存在 ──
  if (!has('data-demo-ctl')) {
    fail(file, '缺少原型演示控件（data-demo-ctl）——每份稿必须带，见 references/demo-control-panel.md');
    continue;
  }
  if (!has('data-dc-toggle')) fail(file, '控件缺少收起按钮（data-dc-toggle）——必须能隐没，否则遮挡与污染截图');

  // ── 2. 屏清单对账：DOM 的 .screen 与注册表必须一一对应 ──
  const domScreens = new Set(
    all.filter((t) => t.attrs.id && /(^|\s)screen(\s|$)/.test(t.attrs.class || '')).map((t) => t.attrs.id),
  );
  // 兼容两种写法：`screens: {...}`（对象字段）与 `const SCREENS = {...}`（独立常量）
  const regBlock = (html.match(/screens\s*[:=]\s*\{([\s\S]*?)\n\s*\}/i) || [])[1] || '';
  const regScreens = new Set();
  for (const m of regBlock.matchAll(/el\s*:\s*['"]([\w-]+)['"]/g)) regScreens.add(m[1]);

  if (domScreens.size === 0) fail(file, '稿内没有任何 .screen 元素——多屏稿请给每屏加 class="screen" 与 id="screen-<key>"');
  for (const id of domScreens) {
    if (!regScreens.has(id)) fail(file, `屏 #${id} 未登记进控件屏注册表 → 评审走不到这一屏（漏项）`);
  }
  for (const el of regScreens) {
    if (!domScreens.has(el)) fail(file, `注册表登记了 ${el} 但稿内没有该屏 → 点进去空白（幽灵项）`);
  }

  // ── 3. 场景包 ──
  if (!minimal) {
    const preBlock = (html.match(/presets\s*:\s*\[([\s\S]*?)\n\s*\]/) || [])[1] || '';
    const entries = preBlock.split('{').slice(1);
    if (entries.length < 3) fail(file, `场景包只有 ${entries.length} 个（要求 ≥3）——分支没想清，评审只能看主路径`);
    entries.forEach((e, i) => {
      for (const k of ['role', 'screen', 'state']) {
        if (!new RegExp(`${k}\\s*:`).test(e)) fail(file, `第 ${i + 1} 个场景包缺少 ${k}`);
      }
    });
    const presetBtns = [...html.matchAll(/data-dc-preset\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
    const ids = [...preBlock.matchAll(/id\s*:\s*['"]([\w-]+)['"]/g)].map((m) => m[1]);
    if (presetBtns.length === 0) {
      fail(file, '场景包没有渲染入口（缺 data-dc-preset 按钮）——点不到等于没有');
    } else if (presetBtns.every((v) => /^[\w-]+$/.test(v))) {
      // 静态渲染：逐个对账；模板字符串 / 字符串拼接的动态渲染无法静态核对，只要求入口存在
      for (const id of ids) if (!presetBtns.includes(id)) fail(file, `场景包 ${id} 没有渲染入口（data-dc-preset）——点不到等于没有`);
    }

    // ── 4. 假开关检测：用到的每个数据态都要有对应 CSS 分支 ──
    const stateBlock = (html.match(/states\s*:\s*\{([\s\S]*?)\}/) || [])[1] || '';
    const usedStates = new Set([
      ...[...html.matchAll(/data-dc-state\s*=\s*["']([\w-]+)["']/g)].map((m) => m[1]),
      ...[...html.matchAll(/\bstate\s*:\s*['"]([\w-]+)['"]/g)].map((m) => m[1]),
      ...[...stateBlock.matchAll(/(\w+)\s*:\s*['"]/g)].map((m) => m[1]),
    ]);
    for (const st of usedStates) {
      const hasClass = new RegExp(`\\.only-${st}\\b`).test(html);
      const hasRule = new RegExp(`\\[data-demo-state=["']?${st}["']?\\]`).test(html);
      if (!hasClass || !hasRule) {
        fail(file, `数据态 "${st}" 没有对应分支（需 .only-${st} + [data-demo-state="${st}"] .only-${st}）→ 假开关，点了界面不变`);
      }
    }

    // ── 5. 复位 ──
    if (!has('data-dc-reset')) fail(file, '控件缺少复位（data-dc-reset）——演示完回不到默认态');

    // ── 6. 角色可见性（≥2 角色时） ──
    const roleBlock = (html.match(/roles\s*:\s*\{([\s\S]*?)\}/) || [])[1] || '';
    const roles = [...roleBlock.matchAll(/(\w+)\s*:\s*['"]/g)].map((m) => m[1]);
    if (roles.length >= 2 && !/data-need-role/.test(html)) {
      fail(file, `声明了 ${roles.length} 个角色但没有任何 data-need-role 断言——切角色前后界面一样，等于没演示`);
    }
  }

  // ── 打印隐藏（两档都必须） ──
  const printBlock = (html.match(/@media\s+print\s*\{([\s\S]*?)\n\s*\}/) || [])[1] || '';
  if (!printBlock) fail(file, '缺少 @media print 隐藏控件——打印/导出会带上控件');
  else if (!/demo-ctl|data-demo-ctl/.test(printBlock)) fail(file, '@media print 里没有隐藏控件（[data-demo-ctl] { display: none }）');

  if (failed === 0) console.log(`✔ ${file} 演示控件机检通过`);
}

process.exit(failed === 0 ? 0 : 1);
