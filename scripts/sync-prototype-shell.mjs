#!/usr/bin/env node
/**
 * 把「框架壳（sider 菜单 + 顶栏 + 折叠交互 + 壳 CSS）」从单源注入到两份定稿。
 *
 *   node scripts/sync-prototype-shell.mjs
 *
 * 背景（2026-10-11，产品意见「菜单的结构最好跟 admin 的样式保持一致」）：
 *   三份原型稿各写一套壳（两份定稿是「分组小标题 + 平铺项、无图标、无折叠、logo 写科豆管理」，
 *   整合稿是另一套，真实 admin 是第三套）→ 三处漂移。现把「壳与菜单」收口到
 *   `scripts/lib/proto-shell.mjs` 单一真相源：整合稿由 build-agents-hub.mjs 内联，
 *   两份定稿由本脚本注入（静态生成），三者由 verify-proto-shell.mjs 对拍守。
 *
 * 注入策略（不碰定稿的「内容 / 面包屑 JS」）：
 *   · 每个 `<aside class="ad-sider">` → shellSider({interactive:false, active})（静态菜单，不跳转）
 *   · 顶栏包一层：home 图标 + 右侧（主题 / 用户）；**保留**原面包屑内容（含 #crumb-main/#crumb-sub，
 *     定稿 JS 依赖）
 *   · 壳 CSS 作为**第二个 <style>** 注入（紧跟主 <style> 后，靠后序覆写旧壳规则；
 *     独立成块 → build 的 between('<style>','</style>') 仍只取主块，不造成整合稿双份壳 CSS）
 *   · 壳 JS（折叠/展开 + 子菜单收起）在 </body> 前独立 <script> 注入
 *   · 页脚不在定稿注入（定稿是屏级稿，画布 overflow:hidden；页脚属整合稿专属，见 build 脚本）
 *
 * 幂等：带 MARK 注释的注入块不重复写入。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellSider, shellHeaderRight, shellIcon, shellCss, shellJs } from './lib/proto-shell.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/** 每份定稿的桌面对应 active 菜单屏（PG 有两屏：对话调试 + 定义管理；DT 一屏：定义管理） */
const FILES = [
  { file: 'docs/ui/prototypes/admin-agents.html', actives: ['pg', 'list'] },
  { file: 'docs/ui/prototypes/admin-agent-def-detail.html', actives: ['list'] },
];

const MARK_CSS = '/* ===== PROTO-SHELL-CSS (auto, single source) ===== */';
const MARK_JS = '/* PROTO-SHELL-JS (auto, single source) */';

let failed = false;
for (const { file, actives } of FILES) {
  const p = path.join(ROOT, file);
  const s = fs.readFileSync(p, 'utf8');
  let out = s;
  const problems = [];

  /* 1. 每个旧 <aside class="ad-sider">…</aside> → 新 antd 结构（静态菜单，active 指定） */
  const asideRe = /<aside class="ad-sider">[\s\S]*?<\/aside>/g;
  let ai = 0;
  out = out.replace(asideRe, () => shellSider({ interactive: false, active: actives[ai++] ?? actives[actives.length - 1] }));
  if (ai === 0) problems.push('未找到 <aside class="ad-sider">（可能已同步或结构变更）');
  if (ai !== actives.length) problems.push(`sider 数 ${ai} ≠ 预期 ${actives.length}`);

  /* 2. 顶栏：home 图标 + 右侧（保留原面包屑内容） */
  const home = shellIcon('home', 'ad-home-ic');
  out = out.replace(/<header class="ad-header">/g, `<header class="ad-header">\n      <div class="ad-hl"><span class="ad-home">${home}</span>`);
  out = out.replace(/<\/header>/g, `</div>\n      ${shellHeaderRight()}\n    </header>`);

  /* 3. 壳 CSS：第二个 <style> 独立块（幂等） */
  if (!out.includes(MARK_CSS)) {
    out = out.replace('</style>', `</style>\n<style>\n${MARK_CSS}\n${shellCss()}\n</style>`);
  }

  /* 4. 壳 JS：</body> 前独立 <script>（幂等） */
  if (!out.includes(MARK_JS)) {
    out = out.replace('</body>', `<script>\n${MARK_JS}\n${shellJs()}\n</script>\n</body>`);
  }

  if (problems.length) {
    console.error(`✗ ${file}：${problems.join('；')}`);
    failed = true;
    continue;
  }
  fs.writeFileSync(p, out);
  const heads = (out.match(/<header class="ad-header">/g) || []).length;
  console.log(`✓ ${file}：sider ×${ai} / header ×${heads} / 壳 CSS+JS 已注入`);
}

if (failed) process.exit(1);
