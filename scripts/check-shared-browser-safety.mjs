#!/usr/bin/env node
/**
 * 前端产物「不可拖入 node-only 模块」守卫。
 *
 * ## 为什么要这条检查（2026-11-06 微前端白屏 P0）
 *
 * admin / portal 两个微前端模块**启动即崩**、整站白屏。根因不是业务代码，而是
 * `packages/shared` 的后端 barrel 被前端误引：
 *
 *   apps/admin/src/api/request.ts
 *     → import { API_TIMEOUT } from '@web-system/shared'
 *     → vite alias → packages/shared/src/index.ts（后端 barrel）
 *     → export { DEFAULT_STORAGE_BASE } from './storage-dir'
 *     → storage-dir.ts **顶层**执行 nodePath.join(os.homedir(), 'web_system')
 *     → 浏览器里 os/path 被换成空的 __viteBrowserExternal 对象
 *     → 模块 execute 期 TypeError: (void 0) is not a function
 *
 * 这次事故的关键特征是：**`vite build` 退出码 0、产物看着正常、运行时 init 期才炸**。
 * 所以只靠「构建通过」不足以防回归，必须有一道**同时看源码模块图和真实产物**的机器检查。
 *
 * ## 两道口子
 *
 * 1. **静态**（默认，毫秒级）：从 `packages/shared/src/browser.ts`（前端唯一合法入口）
 *    出发遍历相对导入图，命中下列任一即红：
 *      - node 内置模块（fs / os / path / child_process / …）
 *      - 服务端框架（typeorm / @nestjs/* / reflect-metadata / mysql2 / ioredis / …）
 *      - `process.env` / `require(` / `__dirname` / `__filename`（浏览器无此全局）
 *      - 未登记的裸包导入（fail-closed：新增依赖必须显式登记）
 * 2. **产物**（给了 dist 目录时）：扫描产物 js 里是否出现 `__viteBrowserExternal`
 *    —— 这是 Vite 把 node 内置模块替换成空对象时留下的标记。出现即说明有 node-only
 *    模块进了前端产物，无论它今天是否已经在 init 期炸。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-shared-browser-safety.mjs                       # 静态图 + 默认产物目录（存在则查）
 * node scripts/check-shared-browser-safety.mjs --graph-only          # 只跑静态图
 * node scripts/check-shared-browser-safety.mjs --artifacts apps/admin/dist apps/portal/dist
 * node scripts/check-shared-browser-safety.mjs --require-artifacts   # 产物目录缺失也算红（CI 用）
 * ```
 *
 * 已接入：根 `package.json` 的 `check:shared-browser`；
 * `scripts/build-module.mjs` 在**构建前**跑静态图、**构建后**扫本次产物 ——
 * 即任何一次 `node scripts/build-module.mjs admin|portal` 都会在出错时直接失败。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER_ENTRY = join(REPO_ROOT, 'packages/shared/src/browser.ts');
const DEFAULT_ARTIFACT_DIRS = [
  'apps/admin/dist',
  'apps/portal/dist',
  'apps/shell/dist',
  'apps/deploy-console/dist',
];

/** node 内置模块（含 `node:` 前缀写法）——浏览器里一律不可用 */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);

/** 服务端专用框架/驱动：出现在前端模块图里必然是把后端代码拖进来了 */
const SERVER_ONLY_PKGS = [
  'typeorm', '@nestjs', 'reflect-metadata', 'mysql', 'mysql2', 'ioredis', 'redis',
  'pg', 'sqlite3', 'better-sqlite3', 'fastify', '@grpc', '@opentelemetry',
];

/**
 * 浏览器入口允许出现的裸包导入**白名单**。
 * fail-closed：新增裸依赖必须在这里登记，否则检查报红 —— 刻意的摩擦，
 * 目的是逼人想清楚「这个包在浏览器里真的能跑吗」。
 */
const ALLOWED_BARE_IMPORTS = new Set(['dayjs']);

/** 源码文本层面的禁用特征 */
const FORBIDDEN_PATTERNS = [
  { re: /\bprocess\s*\.\s*env\b/, why: '浏览器无 process 全局（微前端 define 只会替换字面量，运行时读键值仍会炸）' },
  { re: /\brequire\s*\(/, why: '浏览器无 CommonJS require' },
  { re: /\b__dirname\b/, why: '浏览器无 __dirname' },
  { re: /\b__filename\b/, why: '浏览器无 __filename' },
];

/** 产物里的「node 模块被替换成空对象」标记 */
const ARTIFACT_BAD_MARKERS = ['__viteBrowserExternal', '__vite-browser-external'];

const problems = [];
function fail(file, msg) {
  problems.push(`${rel(file)}: ${msg}`);
}
function rel(p) {
  return relative(REPO_ROOT, p).split('\\').join('/');
}

/**
 * 去掉注释（保留字符串与换行，行号不变）。
 *
 * 为什么必须去注释：`browser.ts` 顶部的事故说明里就有
 * `export { DEFAULT_STORAGE_BASE } from './storage-dir'` 和 `process.env` 这两段**文字**，
 * 不剥注释会把「解释事故的文档」当成「又犯了事故」，检查自己先红。
 */
function stripComments(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out.push('  '); i += 2; continue; }
      if (c === '/' && d === '*') { state = 'block'; out.push('  '); i += 2; continue; }
      if (c === "'") { state = 'single'; out.push(c); i += 1; continue; }
      if (c === '"') { state = 'double'; out.push(c); i += 1; continue; }
      if (c === '`') { state = 'template'; out.push(c); i += 1; continue; }
      out.push(c); i += 1; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out.push('\n'); i += 1; continue; }
      out.push(' '); i += 1; continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out.push('  '); i += 2; continue; }
      out.push(c === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }
    // 字符串内部：原样保留，只处理转义与闭合引号
    if (c === '\\') { out.push(c, d); i += 2; continue; }
    if (state === 'single' && c === "'") { state = 'code'; out.push(c); i += 1; continue; }
    if (state === 'double' && c === '"') { state = 'code'; out.push(c); i += 1; continue; }
    if (state === 'template' && c === '`') { state = 'code'; out.push(c); i += 1; continue; }
    out.push(c); i += 1;
  }
  return out.join('');
}

/** 抽取一个模块的所有导入说明符（import / export-from / 动态 import / 副作用 import） */
function extractSpecifiers(source) {
  const specs = [];
  // import ... from 'x' / export ... from 'x'（多行安全：只看 from 结尾）
  for (const m of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  // import 'x' / import('x') —— 注意排除 `from 'x'` 已匹配的那类
  for (const m of source.matchAll(/\bimport\s*\(?\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  return [...new Set(specs)];
}

/** 相对说明符 → 磁盘文件（补扩展名 / 目录 index） */
function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** 是否 node 内置（含 node: 前缀） */
function asNodeBuiltin(spec) {
  const bare = spec.replace(/^node:/, '');
  if (spec.startsWith('node:')) return bare;
  // `fs/promises` 这类子路径
  const head = bare.split('/')[0];
  return NODE_BUILTINS.has(head) ? head : null;
}

/** 静态图遍历：从 browser.ts 出发 */
function checkGraph() {
  if (!existsSync(BROWSER_ENTRY)) {
    console.error(`[shared-browser-safety] 找不到浏览器入口: ${rel(BROWSER_ENTRY)}`);
    process.exit(1);
  }

  const visited = new Set();
  const queue = [BROWSER_ENTRY];

  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);

    // 只看代码、不看注释（注释里会引用反面例子，见 stripComments 说明）
    const source = stripComments(readFileSync(file, 'utf-8'));

    // 1) 文本级禁用特征（逐行定位，便于报错）
    const lines = source.split('\n');
    lines.forEach((line, i) => {
      for (const { re, why } of FORBIDDEN_PATTERNS) {
        if (re.test(line)) fail(file, `第 ${i + 1} 行命中 ${re} —— ${why}`);
      }
    });

    // 2) 导入说明符
    for (const spec of extractSpecifiers(source)) {
      if (spec.startsWith('.') || isAbsolute(spec)) {
        const target = resolveRelative(file, spec);
        if (!target) {
          fail(file, `导入 "${spec}" 解析不到文件（检查拼写 / 是否漏扩展名）`);
          continue;
        }
        if (extname(target) !== '.ts' && extname(target) !== '.tsx') {
          fail(file, `导入 "${spec}" 落到非 TS 文件 ${rel(target)}，前端入口不允许（可能是未构建产物）`);
          continue;
        }
        if (/\.(spec|test)\.tsx?$/.test(target)) {
          fail(file, `浏览器入口图里出现测试文件 ${rel(target)}`);
          continue;
        }
        queue.push(target);
        continue;
      }

      // 裸包 / 别名
      const builtin = asNodeBuiltin(spec);
      if (builtin) {
        fail(file, `导入了 node 内置模块 "${spec}" —— 浏览器里它会被替换成空对象，init 期必炸`);
        continue;
      }
      if (SERVER_ONLY_PKGS.some((p) => spec === p || spec.startsWith(`${p}/`))) {
        fail(file, `导入了服务端专用包 "${spec}" —— 这是把后端代码拖进浏览器产物`);
        continue;
      }
      if (!ALLOWED_BARE_IMPORTS.has(spec)) {
        fail(
          file,
          `未登记的裸包导入 "${spec}"。若确认浏览器可跑，请在 scripts/check-shared-browser-safety.mjs ` +
            `的 ALLOWED_BARE_IMPORTS 里登记（刻意 fail-closed，避免又拖进一个 node-only 包）`,
        );
      }
    }
  }

  return visited;
}

/** 产物扫描：找 __viteBrowserExternal 标记 */
function checkArtifacts(dirs, { requireArtifacts = false } = {}) {
  const scanned = [];
  let missing = 0;

  for (const dir of dirs) {
    const abs = isAbsolute(dir) ? dir : join(REPO_ROOT, dir);
    if (!existsSync(abs)) {
      missing += 1;
      if (requireArtifacts) {
        problems.push(`${rel(abs)}: 产物目录不存在（--require-artifacts 下视为失败）`);
      }
      continue;
    }
    scanned.push(abs);
    for (const file of walkJs(abs)) {
      const source = readFileSync(file, 'utf-8');
      for (const marker of ARTIFACT_BAD_MARKERS) {
        if (source.includes(marker)) {
          const at = source.indexOf(marker);
          const snippet = source.slice(Math.max(0, at - 120), at + 120).replace(/\s+/g, ' ');
          problems.push(
            `${rel(file)}: 产物里出现 "${marker}"（Vite 对 node 内置模块的空替身）\n` +
              `      上下文: …${snippet}…\n` +
              `      含义: 有 node-only 模块被打进了浏览器产物。检查是否有人把前端 import 指回了 ` +
              `packages/shared/src/index.ts（必须指 browser.ts）。`,
          );
          break; // 一个文件报一次就够
        }
      }
    }
  }

  return { scanned, missing };
}

function walkJs(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.mjs'))) out.push(p);
    }
  }
  return out;
}

/* ── CLI ─────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const graphOnly = argv.includes('--graph-only');
const requireArtifacts = argv.includes('--require-artifacts');
const artIdx = argv.indexOf('--artifacts');
let artifactDirs = DEFAULT_ARTIFACT_DIRS;
if (artIdx !== -1) {
  artifactDirs = argv.slice(artIdx + 1).filter((a) => !a.startsWith('--'));
  if (artifactDirs.length === 0) {
    console.error('[shared-browser-safety] --artifacts 后需要至少一个目录');
    process.exit(1);
  }
}

console.log(`[shared-browser-safety] 静态图: ${rel(BROWSER_ENTRY)}`);
const graph = checkGraph();
console.log(`[shared-browser-safety] 遍历模块 ${graph.size} 个:`);
for (const f of [...graph].sort()) console.log(`  - ${rel(f)}`);

if (!graphOnly) {
  const { scanned } = checkArtifacts(artifactDirs, { requireArtifacts });
  if (scanned.length === 0) {
    console.log('[shared-browser-safety] 产物扫描: 跳过（没有可扫的 dist 目录）');
  } else {
    for (const d of scanned) {
      const n = walkJs(d).length;
      console.log(`[shared-browser-safety] 产物扫描: ${rel(d)} (${n} 个 js)`);
    }
  }
}

if (problems.length > 0) {
  console.error(`\n[shared-browser-safety] ✗ 发现 ${problems.length} 处问题：\n`);
  for (const p of problems) console.error(`  • ${p}\n`);
  console.error(
    '[shared-browser-safety] 为什么必须挡：2026-11-06 admin/portal 双双启动即崩、整站白屏，' +
      '根因就是后端 barrel 里的 storage-dir（顶层 os.homedir()）被前端拖入。\n',
  );
  process.exit(1);
}

console.log('[shared-browser-safety] ✓ 通过：浏览器入口模块图不含 node-only 依赖，产物无 node shim');
