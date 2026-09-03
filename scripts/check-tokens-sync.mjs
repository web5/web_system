#!/usr/bin/env node
/**
 * tokens.ts ↔ tokens.css 同步校验（Backlog F 的安全替代：diff 校验而非自动生成）
 *
 * 背景（docs/ui/color-reference.md §1）：tokens.ts 是数值唯一源，tokens.css 为 CSS 变量镜像，
 * 两者人工同步易漏（如 bgActive 曾漏补）。自动生成器会覆盖 alias/例外段（风险高），
 * 故先做只读校验：ts 中每个色值字面量必须出现在 tokens.css（缺 = 忘同步，报错）。
 *
 * 用法：node scripts/check-tokens-sync.mjs   （退出码 1 = 有缺失）
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsPath = resolve(root, 'packages/ui/src/tokens.ts');
const cssPath = resolve(root, 'packages/ui/src/tokens.css');

/** 提取所有色值字面量（#hex 与 rgb/rgba()，仅 tokens.ts / tokens.css 自身） */
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

function collect(file, path) {
  // 先剥离注释（// 与 /* */），避免注释里提到的色值被误判为"取值"
  const text = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const set = new Set();
  for (const m of text.matchAll(COLOR_RE)) set.add(m[0]);
  return { file, set };
}

const ts = collect('tokens.ts', tsPath);
const css = collect('tokens.css', cssPath);

// tokens.ts 有而 tokens.css 缺失的值（防"ts 改了 css 忘同步"）
const missing = [...ts.set].filter((v) => !css.set.has(v));

if (missing.length) {
  console.error(`❌ [check-tokens-sync] tokens.css 缺失 ${missing.length} 个 tokens.ts 色值：`);
  for (const v of missing) console.error(`   - ${v}`);
  console.error('   请同步补充到 tokens.css 的 :root 与 [data-theme="dark"] 两处（如适用）。');
  process.exit(1);
}

console.log(`✅ [check-tokens-sync] tokens.ts (${ts.set.size} 色值) 全部存在于 tokens.css (${css.set.size} 色值)。`);
