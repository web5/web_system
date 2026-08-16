#!/usr/bin/env node
/**
 * 微前端模块打包脚本。
 * 用法: node scripts/build-module.mjs <module-key> [--branch <branch>]
 *
 * 流程:
 *   1. 查模块定义（scripts/modules.json）
 *   2. git 取 commit short 作为版本号
 *   3. cd apps/<dir> && npx vite build --mode mf  （注入 RELEASE_TAG 环境变量）
 *   4. 产物 dist/index.js + dist/index.css + dist/manifest.json
 *
 * 由 deploy-console DeployService.publishModule 调用，或本地手动执行验证。
 */
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();

function log(msg) { console.log(`[build-module] ${msg}`); }
function die(msg) { console.error(`[build-module] ERROR: ${msg}`); process.exit(1); }

async function main() {
  const moduleKey = process.argv[2];
  if (!moduleKey) die('用法: node scripts/build-module.mjs <module-key> [--branch <branch>]');

  // --branch 参数
  let branch;
  const branchIdx = process.argv.indexOf('--branch');
  if (branchIdx > 0) branch = process.argv[branchIdx + 1];

  // 1. 查模块定义
  const moduleDef = resolveModuleDef(moduleKey);
  if (!moduleDef) die(`模块未注册: ${moduleKey}（检查 scripts/modules.json）`);
  log(`模块: ${moduleDef.key} → dir=${moduleDef.dir}`);

  // 2. git 版本号
  if (!branch) {
    branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  }
  const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
  const version = commit;
  const buildTime = new Date().toISOString();
  log(`版本: ${version} (branch=${branch})`);

  // 3. 构建
  const appDir = join(REPO_ROOT, 'apps', moduleDef.dir);
  if (!existsSync(appDir)) die(`应用目录不存在: ${appDir}`);
  const buildCmd = moduleDef.buildCmd || `npx vite build --mode mf`;
  log(`执行构建: cd apps/${moduleDef.dir} && ${buildCmd}`);
  execSync(buildCmd, {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, RELEASE_TAG: version },
  });

  // 4. 写 manifest.json
  const distDir = join(appDir, 'dist');
  const cssExists = existsSync(join(distDir, 'index.css'));
  const manifest = {
    name: moduleKey,
    version,
    branch,
    commit,
    buildTime,
    entry: 'index.js',
    css: cssExists ? 'index.css' : null,
    assetsBase: '',
  };
  writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  log(`产物: ${distDir}/ (index.js${cssExists ? ' + index.css' : ''} + manifest.json)`);
  console.log(JSON.stringify(manifest, null, 2));
}

function resolveModuleDef(key) {
  const file = join(REPO_ROOT, 'scripts', 'modules.json');
  if (!existsSync(file)) return null;
  const modules = JSON.parse(readFileSync(file, 'utf-8'));
  return modules.find((m) => m.key === key);
}

main().catch((e) => { console.error(e); process.exit(1); });
