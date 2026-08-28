#!/usr/bin/env node
/**
 * 自建 CDN 公共依赖 externals → servers/gateway/public/static/cdn/。
 *
 * 用途：把 shell 依赖的 vue/vue-router/pinia/antd/axios/dayjs(+插件)/vue-demi
 *       从外部 CDN 收口到自家服务器，dev 与 prod 统一从 /static/cdn/ 加载，
 *       不再依赖 cdn.staticfile.org / unpkg.com。
 *
 * 策略:
 *   - vue / vue-router / pinia / antd / axios / dayjs / dayjs 插件 / vue-demi:
 *     全部 copy 官方 UMD 发行版（官方构建能完整暴露 message/Modal 等静态方法及各组件）
 *   - 依赖顺序由 index.html 的 script 标签保证：
 *     vue → vue-demi → vue-router → pinia → dayjs → dayjs 插件 → antd → axios
 *   - 不再用 vite 重打包（避免只导出 install 而缺 message/Modal 的问题）
 *
 * 输出结构（平铺，文件名固定，配合 nginx 强缓存 immutable）：
 *   static/cdn/vue.js
 *   static/cdn/vue-router.js
 *   static/cdn/vue-demi.js
 *   static/cdn/pinia.js
 *   static/cdn/antd.js
 *   static/cdn/axios.js
 *   static/cdn/dayjs.js
 *   static/cdn/dayjs-advancedFormat.js   … （8 个 dayjs 插件）
 *   static/cdn/manifest.json
 *
 * 每个文件末尾追加 wrapper: window.__SHARED__[key] = window[globalVar]
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(process.cwd());
const require = createRequire(resolve(REPO_ROOT, 'package.json'));
const OUT_DIR = resolve(REPO_ROOT, 'servers/gateway/public/static/cdn');

function log(msg) { console.log(`[build-externals] ${msg}`); }
function die(msg) { console.error(`[build-externals] ERROR: ${msg}`); process.exit(1); }

// 直接 copy 的库（官方 UMD 可直接用，挂 window 全局）
// antd / pinia 也用官方 UMD：能完整暴露 message/Modal 等静态方法及各组件，
// 且依赖全局 Vue / dayjs / dayjs_plugin_* / VueDemi（由 vue.js / vue-demi.js / dayjs-*.js 先行加载）。
const COPY_LIBS = [
  { file: 'vue.js',        pkg: 'vue',            dist: 'dist/vue.global.prod.js',         globalVar: 'Vue',       sharedKey: 'vue' },
  { file: 'vue-router.js', pkg: 'vue-router',     dist: 'dist/vue-router.global.prod.js',  globalVar: 'VueRouter', sharedKey: 'vue-router' },
  { file: 'pinia.js',      pkg: 'pinia',          dist: 'dist/pinia.iife.prod.js',         globalVar: 'Pinia',     sharedKey: 'pinia' },
  { file: 'antd.js',       pkg: 'ant-design-vue', dist: 'dist/antd.min.js',                globalVar: 'antd',      sharedKey: 'ant-design-vue' },
  { file: 'axios.js',      pkg: 'axios',          dist: 'dist/axios.min.js',              globalVar: 'axios',     sharedKey: 'axios' },
  { file: 'dayjs.js',      pkg: 'dayjs',          dist: 'dayjs.min.js',                   globalVar: 'dayjs',     sharedKey: 'dayjs' },
];

// vue-demi iife：copy（挂全局，wrapper 不额外挂 __SHARED__，仅保证全局存在）
const VUE_DEMI = { file: 'vue-demi.js', pkg: 'vue-demi', dist: 'lib/index.iife.js' };

// dayjs 插件：copy 到 dayjs-<name>.js（挂 dayjs 全局的 _plugin_<name>），
// 依赖 dayjs.js 已先加载。文件名与 index.html 引用一致。
const DAYJS_PLUGINS = [
  'advancedFormat', 'customParseFormat', 'localeData',
  'weekday', 'weekOfYear', 'weekYear', 'quarterOfYear',
];

function readPkgVersion(pkgRoot) {
  try { return JSON.parse(readFileSync(resolve(pkgRoot, 'package.json'), 'utf-8')).version || ''; }
  catch { return ''; }
}

function findPkgRoot(pkg) {
  const entry = require.resolve(pkg);
  const m = entry.match(/^(.*?node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@[^/]+\/[^/]+|[^/]+))/);
  return m ? m[1] : entry;
}

function appendWrapper(file, globalVar, sharedKey) {
  const wrapper = `
;(function(){
  window.__SHARED__ = window.__SHARED__ || {};
  window.__SHARED__[${JSON.stringify(sharedKey)}] = window[${JSON.stringify(globalVar)}];
  if (!window[${JSON.stringify(globalVar)}]) console.warn('[externals] ${sharedKey} 未正确挂载 window.${globalVar}');
})();
`;
  let content = readFileSync(file, 'utf-8');
  writeFileSync(file, content + '\n' + wrapper);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];

  // 1. copy 官方 UMD（vue / vue-router / axios / dayjs）
  for (const lib of COPY_LIBS) {
    const pkgRoot = findPkgRoot(lib.pkg);
    const srcFile = resolve(pkgRoot, lib.dist);
    if (!existsSync(srcFile)) die(`${lib.pkg} UMD 不存在: ${srcFile}`);
    const outFile = resolve(OUT_DIR, lib.file);
    writeFileSync(outFile, readFileSync(srcFile, 'utf-8'));
    appendWrapper(outFile, lib.globalVar, lib.sharedKey);
    manifest.push({ file: lib.file, pkg: lib.pkg, version: readPkgVersion(pkgRoot), globalVar: lib.globalVar, sharedKey: lib.sharedKey });
    log(`${lib.file} ← copy ${lib.pkg}@${readPkgVersion(pkgRoot)}`);
  }

  // 1.5 vue-demi iife（保证全局存在；pinia/antd 重新打包时已内联，此文件兜底）
  {
    const pkgRoot = findPkgRoot(VUE_DEMI.pkg);
    const srcFile = resolve(pkgRoot, VUE_DEMI.dist);
    if (!existsSync(srcFile)) die(`${VUE_DEMI.pkg} iife 不存在: ${srcFile}`);
    const outFile = resolve(OUT_DIR, VUE_DEMI.file);
    copyFileSync(srcFile, outFile);
    manifest.push({ file: VUE_DEMI.file, pkg: VUE_DEMI.pkg, version: readPkgVersion(pkgRoot), globalVar: null, sharedKey: null });
    log(`${VUE_DEMI.file} ← copy ${VUE_DEMI.pkg}@${readPkgVersion(pkgRoot)}`);
  }

  // 1.6 dayjs 插件（copy，依赖 dayjs.js 先加载；挂 dayjs._plugin_<name>）
  for (const name of DAYJS_PLUGINS) {
    const pkgRoot = findPkgRoot('dayjs');
    const srcFile = resolve(pkgRoot, 'plugin', `${name}.js`);
    if (!existsSync(srcFile)) die(`dayjs 插件不存在: ${srcFile}`);
    const outFile = resolve(OUT_DIR, `dayjs-${name}.js`);
    copyFileSync(srcFile, outFile);
    manifest.push({ file: `dayjs-${name}.js`, pkg: 'dayjs', version: readPkgVersion(pkgRoot), plugin: name, globalVar: null, sharedKey: null });
    log(`dayjs-${name}.js ← copy dayjs@${readPkgVersion(pkgRoot)} plugin/${name}`);
  }

  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify({ externals: manifest }, null, 2) + '\n');
  log(`产出目录: ${OUT_DIR}（共 ${manifest.length} 个文件）`);
}

main();
