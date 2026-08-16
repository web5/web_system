#!/usr/bin/env node
/**
 * 预打包公共依赖 externals 到 servers/gateway/public/static/externals/。
 *
 * 策略:
 *   - vue / vue-router / axios / dayjs: 直接 copy 官方 UMD 发行版（无内部依赖问题）
 *   - pinia / ant-design-vue: 用 vite 重新打包（内联 vue-demi 等内部依赖，只 external vue）
 *     —— 因为官方 UMD 期望 window.VueDemi / Vue.extend 等不存在或不对的全局变量
 *
 * 每个文件末尾追加 wrapper: window.__SHARED__[key] = window[globalVar]
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const SHELL_DIR = resolve(process.cwd(), 'apps/shell');
const require = createRequire(resolve(SHELL_DIR, 'package.json'));
const { build } = require('vite');

const REPO_ROOT = resolve(process.cwd());
const OUT_DIR = resolve(REPO_ROOT, 'servers/gateway/public/static/externals');

function log(msg) { console.log(`[build-externals] ${msg}`); }
function die(msg) { console.error(`[build-externals] ERROR: ${msg}`); process.exit(1); }

// 直接 copy 的库（官方 UMD 可直接用）
const COPY_LIBS = [
  { file: 'vue.js',        pkg: 'vue',            dist: 'dist/vue.global.prod.js',         globalVar: 'Vue',       sharedKey: 'vue' },
  { file: 'vue-router.js', pkg: 'vue-router',     dist: 'dist/vue-router.global.prod.js',  globalVar: 'VueRouter', sharedKey: 'vue-router' },
  { file: 'axios.js',      pkg: 'axios',          dist: 'dist/axios.min.js',              globalVar: 'axios',     sharedKey: 'axios' },
  { file: 'dayjs.js',      pkg: 'dayjs',          dist: 'dayjs.min.js',                   globalVar: 'dayjs',     sharedKey: 'dayjs' },
];

// 用 vite 重新打包的库（内部依赖需内联，只 external vue）
const BUILD_LIBS = [
  { file: 'pinia.js', pkg: 'pinia',            globalVar: 'Pinia', sharedKey: 'pinia' },
  { file: 'antd.js',  pkg: 'ant-design-vue',   globalVar: 'antd',  sharedKey: 'ant-design-vue' },
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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];

  // 1. copy 官方 UMD
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

  // 2. vite 重新打包 pinia / antd
  for (const lib of BUILD_LIBS) {
    const pkgRoot = findPkgRoot(lib.pkg);
    const entry = require.resolve(lib.pkg);
    log(`vite 打包 ${lib.pkg}@${readPkgVersion(pkgRoot)} → ${lib.file}...`);
    await build({
      configFile: false,
      mode: 'production',
      logLevel: 'warn',
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env': JSON.stringify({ NODE_ENV: 'production' }),
      },
      build: {
        lib: {
          entry,
          name: lib.globalVar,
          formats: ['umd'],
          fileName: () => lib.file,
        },
        rollupOptions: {
          external: ['vue'],
          output: {
            globals: { vue: 'window.__SHARED__.vue' },
          },
        },
        outDir: OUT_DIR,
        emptyOutDir: false,
        minify: 'terser',
        sourcemap: false,
      },
    });
    const outFile = resolve(OUT_DIR, lib.file);
    appendWrapper(outFile, lib.globalVar, lib.sharedKey);
    manifest.push({ file: lib.file, pkg: lib.pkg, version: readPkgVersion(pkgRoot), globalVar: lib.globalVar, sharedKey: lib.sharedKey });
    log(`${lib.file} ← build ${lib.pkg}@${readPkgVersion(pkgRoot)} ✓`);
  }

  writeFileSync(resolve(OUT_DIR, 'manifest.json'), JSON.stringify({ externals: manifest }, null, 2) + '\n');
  log(`产出目录: ${OUT_DIR}（共 ${manifest.length} 个 externals）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
