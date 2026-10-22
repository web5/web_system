#!/usr/bin/env node
/**
 * 一次性修复：把两份定稿顶栏里**重复注入**的 home 前缀 / 主题+用户块收敛成一份。
 *
 * 背景：scripts/sync-prototype-shell.mjs 的第 2 步（顶栏包一层）没有幂等标记，
 *   每跑一次就再包一层 —— 跑两次后顶栏出现两组 home 图标 + 两组「主题/用户」，
 *   面包屑也被包在嵌套的 .ad-hl 里（2026-10-22 实测：admin-agents.html 出现 4 个 .ad-hl）。
 *   本脚本只做「去掉多余层」这一件事，注入逻辑改在 sync 脚本里（已同步修好幂等）。
 */
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shellIcon, shellHeaderRight } from './lib/proto-shell.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['docs/ui/prototypes/admin-agents.html', 'docs/ui/prototypes/admin-agent-def-detail.html'];

const home = shellIcon('home', 'ad-home-ic');
/** 上一次注入留下的左前缀（可重复 N 次） */
const LEFT_INJ = /<div class="ad-hl"><span class="ad-home">[\s\S]*?<\/span>\s*/g;
/** 上一次注入留下的右侧块 + 它前面那个收尾 </div>（可重复 N 次） */
const RIGHT_INJ = /\s*<\/div>\s*<div class="ad-hr">[\s\S]*?<\/div>\s*/g;

for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  let t = fs.readFileSync(p, 'utf8');
  const before = (t.match(/class="ad-hl"/g) || []).length;
  const heads = (t.match(/<header class="ad-header">/g) || []).length;

  let out = t.replace(/<header class="ad-header">[\s\S]*?<\/header>/g, (block) => {
    let inner = block
      .replace(/^<header class="ad-header">/, '')
      .replace(/<\/header>$/, '');
    inner = inner.replace(LEFT_INJ, '').replace(RIGHT_INJ, '');
    return `<header class="ad-header">\n      <div class="ad-hl"><span class="ad-home">${home}</span>`
      + `${inner.trimEnd()}\n</div>\n      ${shellHeaderRight()}\n    </header>`;
  });

  fs.writeFileSync(p, out);
  const after = (out.match(/class="ad-hl"/g) || []).length;
  const afterHr = (out.match(/class="ad-hr"/g) || []).length;
  console.log(`✓ ${rel}：header ×${heads} · .ad-hl ${before} → ${after} · .ad-hr → ${afterHr}`);
  if (after !== heads || afterHr !== heads) {
    console.error(`✗ ${rel}：修复后仍不成对（应各 = header 数 ${heads}）`);
    process.exit(1);
  }
}
