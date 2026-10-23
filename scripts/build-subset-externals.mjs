#!/usr/bin/env node
/**
 * 按需子集 externals 构建器 —— 产出 static/cdn/antd.js 与 static/cdn/icons.js。
 *
 * 背景（2026-09-28 实测）：
 *   - 官方 antd UMD 全量 421KB gz（58 个组件），而全仓实际只用到 38 个 → 354KB gz
 *   - @ant-design/icons-vue 由 shell 全量打包：vendor-icons chunk **186KB gz**（~800 个图标），
 *     实际只用到 42 个 → **19.5KB gz**
 *   两者合计能从首屏砍掉约 233KB gzip（在 ~1Mbps 出口下约等于 1.7 秒）。
 *
 * 设计：
 *   - **清单自动扫描**：从源码里收集 `from 'ant-design-vue'` 的具名导入 + 模板里的
 *     `<a-xxx-yyy>` 标签（按 es 目录做最长前缀匹配还原顶层组件），新增组件/图标会自动纳入，
 *     不需要手工维护白名单。
 *   - **消费端零改动**：产物仍是 UMD，挂全局 antd / antdIcons（再由 shell 挂进
 *     window.__SHARED__），externals 映射与 index.html 的引用方式都不变。
 *   - **可回退**：`ANTA_FULL=1` / `ICONS_FULL=1` 退回到官方全量（antd 走 copy UMD，
 *     icons 走全量打包），出问题一键切回。
 *
 * 用法：
 *   node scripts/build-subset-externals.mjs            # 构建两个子集
 *   ANTA_FULL=1 node scripts/build-subset-externals.mjs
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { gzipSync } from 'zlib';
import { build } from 'vite';
// 扫描实现与 scripts/verify-cdn-subsets.cjs 共用同一份，防止「构建口径」与「校验口径」漂移
import scanLib from './lib/scan-pkg-imports.cjs';
const { SCAN_DIRS, SCAN_EXCLUDE_FILES, collectSources, collectNamedImports, collectTemplateTags } = scanLib;

const REPO_ROOT = resolve(process.cwd());
const OUT_DIR = resolve(REPO_ROOT, 'servers/gateway/public/static/cdn');

/** 参与扫描的源码目录 / 排除文件：定义在 scripts/lib/scan-pkg-imports.cjs，
 *  与 verify-cdn-subsets.cjs 共用，避免构建口径与校验口径漂移 */

function log(msg) { console.log(`[subset] ${msg}`); }
function die(msg) { console.error(`[subset] ERROR: ${msg}`); process.exit(1); }

/**
 * 用某个 app 的依赖解析能力定位包真实路径（pnpm 只在声明方下软链）。
 * 注意：部分包的 exports 不暴露 package.json，改为从入口文件向上找包根。
 */
function pkgRealPath(viaApp, pkg) {
  const req = createRequire(resolve(REPO_ROOT, viaApp, 'package.json'));
  let dir = dirname(req.resolve(pkg));
  for (let i = 0; i < 3; i++) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  die(`无法定位包根目录: ${pkg}`);
}

// ---------------------------------------------------------------------------
// 1. 源码扫描（实现见 scripts/lib/scan-pkg-imports.cjs，与 verify-cdn-subsets 共用）
// ---------------------------------------------------------------------------

/** 收集模板里的 `<a-xxx-yyy>` 标签名（kebab） */

// ---------------------------------------------------------------------------
// 2. antd：组件名 → es 子路径映射（从官方 es/index.js 解析，避免手写清单漂移）
// ---------------------------------------------------------------------------

/** 从 ant-design-vue/es/components.js 解析 `export { default as X } from './y'` */
function readAntdExportMap(antdRoot) {
  const indexPath = resolve(antdRoot, 'es/components.js');
  if (!existsSync(indexPath)) die(`未找到 ${indexPath}`);
  const code = readFileSync(indexPath, 'utf-8');
  const map = new Map(); // PascalName -> es 子目录
  // ⚠️ 同一行可能有多个导出：`export { default as Avatar, AvatarGroup } from './avatar';`
  //    只取 `default as X`（顶层组件），其余是子组件（由父组件 install 时注册）。
  const re = /export\s*\{([^}]*)\}\s*from\s*['"]\.\/([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) {
    const dir = m[2];
    const def = m[1].match(/default\s+as\s+([A-Za-z0-9_]+)/);
    if (def) map.set(def[1], dir);
  }
  // 少数非 default 导出（theme / message 等）手工补齐
  for (const [name, dir] of [['theme', 'theme'], ['message', 'message'], ['notification', 'notification']]) {
    if (!map.has(name)) map.set(name, dir);
  }
  return map;
}

/** kebab 标签 → 顶层组件（按 es 目录做最长前缀匹配：radio-group → radio） */
function tagToComponent(tag, dirs) {
  let best = null;
  for (const d of dirs) {
    if (tag === d || tag.startsWith(`${d}-`)) {
      if (!best || d.length > best.length) best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 3. vite 构建（虚拟入口，不落临时文件）
// ---------------------------------------------------------------------------

/**
 * 把生成的入口代码落到临时文件再构建。
 * 为什么不用 virtual module：vite 的 lib.entry 在 rollup 之前就会做路径存在性校验，
 * 虚拟模块会直接报 UNRESOLVED_ENTRY（实测）。落盘在 node_modules/.cache 下（root 内、
 * 不进 git、每次覆盖），构建完即删。
 */
async function buildUmd({ entryFile, entryCode, globalName, outFile, externals, alias }) {
  mkdirSync(dirname(entryFile), { recursive: true });
  writeFileSync(entryFile, entryCode, 'utf-8');
  try {
    await build({
      root: REPO_ROOT,
      logLevel: 'warn',
      configFile: false,
      resolve: { alias },
      // ⚠️ define 是 vite 顶层配置（放 build 下不生效）：es 源码里散布 `process.env.NODE_ENV`
      //    （官方 UMD 已预替换，我们直接从 es 构建则不会）——不替换运行时抛
      //    `ReferenceError: process is not defined`，window.antd 变 undefined，整个基座跟着挂。
      define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'process.env.VUE_ENV': JSON.stringify('client') },
      build: {
        write: true,
        outDir: OUT_DIR,
        emptyOutDir: false,
        minify: 'esbuild',
        target: 'es2020',
        cssCodeSplit: false,
        lib: { entry: entryFile, name: globalName, formats: ['umd'], fileName: () => outFile },
        rollupOptions: {
          external: Object.keys(externals),
          output: { globals: externals },
        },
      },
    });
  } finally {
    try { rmSync(entryFile, { force: true }); } catch { /* 清理失败不影响产物 */ }
  }
}

/** 追尾 wrapper：挂 window.__SHARED__[sharedKey]（与 build-externals.mjs 口径一致） */
function appendWrapper(file, globalVar, sharedKey) {
  const wrapper = `
;(function(){
  window.__SHARED__ = window.__SHARED__ || {};
  window.__SHARED__[${JSON.stringify(sharedKey)}] = window[${JSON.stringify(globalVar)}];
  if (!window[${JSON.stringify(globalVar)}]) console.warn('[externals] ${sharedKey} 未正确挂载 window.${globalVar}');
})();
`;
  const content = readFileSync(file, 'utf-8');
  writeFileSync(file, content + '\n' + wrapper);
}

function gzSize(file) {
  return gzipSync(readFileSync(file)).length;
}

// ---------------------------------------------------------------------------
// 4. main
// ---------------------------------------------------------------------------

async function main() {
  // ANTA_FULL=1：跳过 antd 子集（由 build-externals.mjs 直接 copy 官方 UMD 兜底）
  const antdFull = process.env.ANTA_FULL === '1';
  const sources = collectSources(
    SCAN_DIRS.map((d) => resolve(REPO_ROOT, d)),
    { exclude: SCAN_EXCLUDE_FILES },
  );
  log(`扫描源码 ${sources.length} 个文件`);

  // ---- antd ----
  if (antdFull) {
    log('ANTA_FULL=1 → 跳过 antd 子集构建（交由 build-externals.mjs copy 官方 UMD）');
  } else {
  const antdRoot = pkgRealPath('apps/admin', 'ant-design-vue');
  const exportMap = readAntdExportMap(antdRoot);
  const esDirs = [...new Set([...exportMap.values()])];

  const antdFromImports = new Set();
  for (const s of sources) for (const n of collectNamedImports(s.code, 'ant-design-vue')) antdFromImports.add(n);

  const antdFromTags = new Set();
  for (const s of sources) {
    for (const tag of collectTemplateTags(s.code)) {
      const dir = tagToComponent(tag, esDirs);
      if (!dir) continue;
      for (const [name, d] of exportMap) if (d === dir) antdFromTags.add(name);
    }
  }

  const antdNames = [...new Set([...antdFromImports, ...antdFromTags])]
    .filter((n) => exportMap.has(n))
    .sort();
  const skipped = [...antdFromImports].filter((n) => !exportMap.has(n));
  if (skipped.length) log(`⚠️ 以下符号在 es/index.js 无映射，已跳过：${skipped.join(', ')}`);
  log(`antd 清单 ${antdNames.length} 个：${antdNames.join(', ')}`);

  const antdEntry = [
    '// 自动生成（scripts/build-subset-externals.mjs）：只 re-export 源码实际用到的 antd 组件',
    ...antdNames.map((n) => `export { default as ${n} } from 'ant-design-vue/es/${exportMap.get(n)}';`),
  ].join('\n');

  await buildUmd({
    entryFile: resolve(REPO_ROOT, 'node_modules/.cache/antd-subset-entry.js'),
    entryCode: antdEntry,
    globalName: 'antd',
    outFile: 'antd.js',
    externals: { vue: 'Vue', dayjs: 'dayjs' },
    alias: [
      { find: /^ant-design-vue\/es\/(.*)$/, replacement: `${antdRoot}/es/$1` },
      { find: /^ant-design-vue$/, replacement: `${antdRoot}/es/index.js` },
    ],
  });
  const antdOut = resolve(OUT_DIR, 'antd.js');
  appendWrapper(antdOut, 'antd', 'ant-design-vue');
  log(`antd.js  raw=${(readFileSync(antdOut).length / 1024).toFixed(0)}KB gzip=${(gzSize(antdOut) / 1024).toFixed(0)}KB`);
  } // end: !ANTA_FULL

  // ---- icons ----
  const iconsRoot = pkgRealPath('apps/shell', '@ant-design/icons-vue');
  const iconNames = new Set();
  for (const s of sources) for (const n of collectNamedImports(s.code, '@ant-design/icons-vue')) iconNames.add(n);
  const sortedIcons = [...iconNames].sort();
  log(`icons 清单 ${sortedIcons.length} 个`);

  // ICONS_FULL=1：回退到全量图标（出问题时的逃生舱）
  const iconsFull = process.env.ICONS_FULL === '1';
  const iconsEntry = iconsFull
    ? "// 自动生成（ICONS_FULL=1 回退）：全量 re-export 图标\nexport * from '@ant-design/icons-vue';\n"
    : [
        '// 自动生成（scripts/build-subset-externals.mjs）：只 re-export 源码实际用到的图标',
        ...sortedIcons.map((n) => `export { ${n} } from '@ant-design/icons-vue';`),
      ].join('\n');
  if (iconsFull) log('ICONS_FULL=1 → 构建全量图标（回退模式）');

  await buildUmd({
    entryFile: resolve(REPO_ROOT, 'node_modules/.cache/icons-subset-entry.js'),
    entryCode: iconsEntry,
    globalName: 'antdIcons',
    outFile: 'icons.js',
    externals: { vue: 'Vue' },
    alias: [{ find: /^@ant-design\/icons-vue$/, replacement: `${iconsRoot}/es/index.js` }],
  });
  const iconsOut = resolve(OUT_DIR, 'icons.js');
  appendWrapper(iconsOut, 'antdIcons', 'antDesignIconsVue');
  log(`icons.js raw=${(readFileSync(iconsOut).length / 1024).toFixed(0)}KB gzip=${(gzSize(iconsOut) / 1024).toFixed(0)}KB`);

  /**
   * 构建即自检（**独立口径**，不能拿扫描结果当基准）。
   *
   * 为什么不能简单比「扫描结果 vs 产物」：漏图标恰恰是扫描结果自己少了一个，
   * 拿它去比产物，两边一样缺 → 永远对得上，属于循环论证（实测 47 vs 47 全绿，
   * 而实际少了 CloudServerOutlined）。
   *
   * 这里换一个更笨但独立的口径：
   *   ① 从 icons 包 `es/icons/` 目录列出**真实存在的全部图标名**（约 800 个）；
   *   ② 在源码全文里找出现过的这些名字（不局限于 import 块，注释里也算）；
   *   ③ 这些名字必须全部能在产物 icons.js 里取到。
   *
   * 方向是「宁多勿漏」：注释里提到的图标会被要求纳入子集，代价是几 KB，
   * 但绝不会再出现「源码在用、产物没有」的空白图标。
   */
  const iconsCode = readFileSync(iconsOut, 'utf-8');
  const allIconNames = new Set(
    readdirSync(resolve(iconsRoot, 'es/icons'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.replace(/\.js$/, '')),
  );
  const mentioned = new Set();
  for (const s of sources) {
    for (const m of s.code.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)) {
      if (allIconNames.has(m[1])) mentioned.add(m[1]);
    }
  }
  const missingIcons = [...mentioned].filter((n) => !iconsCode.includes(n)).sort();
  if (missingIcons.length) {
    die(
      `icons 子集漏了 ${missingIcons.length} 个图标（源码里出现、产物里没有）：${missingIcons.join(', ')}`,
    );
  }
  log(
    `icons 自检通过：源码提到的 ${mentioned.size} 个图标全部在产物中（图标库共 ${allIconNames.size} 个）`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
