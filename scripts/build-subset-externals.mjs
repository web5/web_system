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
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { gzipSync } from 'zlib';
import { build } from 'vite';

const REPO_ROOT = resolve(process.cwd());
const OUT_DIR = resolve(REPO_ROOT, 'servers/gateway/public/static/cdn');

/** 参与扫描的源码目录（微前端链路：基座 + 两个模块 + 共享 UI） */
const SCAN_DIRS = [
  'apps/shell/src',
  'apps/admin/src',
  'apps/portal/src',
  'packages/ui/src',
];

/**
 * 扫描时排除的文件。
 *
 * `apps/shell/src/antd-all.ts` 是为「保留 cssinjs 样式模板」而**全量 import + 全量注册**
 * antd 的历史 workaround（文件内有详细说明）。它不是真实使用面，纳入会让子集退化成
 * 接近全量（58 个组件），按需就白做了。
 *
 * 排除后该文件里缺失的组件会拿到 undefined —— 其注册循环有
 * `typeof install === 'function'` 运行时判断，缺失项静默跳过，不会崩；而且将来真的
 * 用到某个组件时，模板 `<a-xxx>` 扫描会把它自动补回子集，属于自愈。
 */
const SCAN_EXCLUDE_FILES = ['antd-all.ts'];

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
// 1. 源码扫描
// ---------------------------------------------------------------------------

/** 递归收集 .vue/.ts/.tsx/.js 源码文本 */
function collectSources() {
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.(vue|ts|tsx|js)$/.test(e) && !SCAN_EXCLUDE_FILES.includes(e)) files.push(p);
    }
  };
  for (const d of SCAN_DIRS) walk(resolve(REPO_ROOT, d));
  return files;
}

/**
 * 收集 `import { A, B as C } from '<pkg>'` 的**原始导出名**（别名取原名）。
 * 不收集 `import * as X`（那是全量，会被子集破坏，扫描到时应告警）。
 */
function collectNamedImports(code, pkg) {
  const names = new Set();
  const re = new RegExp(`(?:import|export)\\s*\\{([^}]*)\\}\\s*from\\s*['"\`]${pkg.replace(/[/@]/g, '\\$&')}['"\`]`, 'g');
  let m;
  while ((m = re.exec(code))) {
    for (const raw of m[1].split(',')) {
      const s = raw.trim();
      if (!s) continue;
      const asIdx = s.toLowerCase().indexOf(' as ');
      const name = (asIdx >= 0 ? s.slice(0, asIdx) : s).trim();
      if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** 收集模板里的 `<a-xxx-yyy>` 标签名（kebab） */
function collectTemplateTags(code) {
  const tags = new Set();
  const re = /<a-([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(code))) tags.add(m[1]);
  return tags;
}

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
  const sources = collectSources().map((p) => ({ path: p, code: readFileSync(p, 'utf-8') }));
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
}

main().catch((e) => { console.error(e); process.exit(1); });
