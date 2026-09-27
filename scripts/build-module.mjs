#!/usr/bin/env node
/**
 * 微前端模块打包脚本。
 * 用法: node scripts/build-module.mjs <module-key> [--branch <branch>]
 *
 * 流程:
 *   1. 查模块定义（scripts/modules.json）
 *   2. git 取 commit short 作为版本号
 *   3. 预构建 workspace 依赖（见 ensureWorkspaceDeps 说明）
 *   4. cd apps/<dir> && npx vite build --mode mf  （注入 RELEASE_TAG 环境变量）
 *   5. 产物 dist/index.js + dist/index.css + dist/manifest.json
 *
 * 由 deploy-console DeployService.publishModule 调用，或本地手动执行验证。
 */
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from 'fs';
import { resolve, join, dirname } from 'path';

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
  // 产物 base 必须含产品线段（平台默认模板 key = default）：/static/modules/<key>/<产品线>/<版本>/
  // 契约与校验见 scripts/vite-micro-frontend.mjs resolveMfBase：
  // 只传纯 commit 会让 base 少一层，产物内 public 资源（logo.svg / favicon.svg / avatars 等）静默 404。
  const releaseTag = `default/${commit}`;
  const buildTime = new Date().toISOString();
  log(`版本: ${version} (branch=${branch})`);

  // 3. 预构建 workspace 依赖（缺失 dist 才构建，带并发锁）
  const appDir = join(REPO_ROOT, 'apps', moduleDef.dir);
  if (!existsSync(appDir)) die(`应用目录不存在: ${appDir}`);
  ensureWorkspaceDeps(appDir);

  // 4. 构建
  const buildCmd = moduleDef.buildCmd || `npx vite build --mode mf`;
  log(`执行构建: cd apps/${moduleDef.dir} && ${buildCmd}`);
  execSync(buildCmd, {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, RELEASE_TAG: releaseTag },
  });

  // 5. 写 manifest.json
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

/* ------------------------------------------------------------------ *
 * workspace 依赖预构建
 *
 * 为什么需要：workspace 包（@web-system/*）的 `package.json: main` 指向
 * `dist/`，而 dist 是构建产物、不入 git。发布端是完整 monorepo clone，
 * 首次（或换目录）必须先把依赖包构建出来，否则 vite 报：
 *   [commonjs--resolver] Failed to resolve entry for package "@web-system/ui".
 *   The package may have incorrect main/module/exports specified
 * 表象是「包配置错了」，真因是**从没构建过**，极易误诊。
 *
 * 为什么放在这里而不是流水线 PREBUILD_SHARED_PACKAGES：
 * 2026-09-21 用户定：模块级依赖（如 @web-system/ui）不进工厂内置清单，
 * 「依赖谁、要不要先构建，是模块自己的事」。本脚本正是模块构建入口，
 * 由它按自身 package.json 的依赖声明按需构建，符合该约定。
 *
 * 幂等：入口文件已存在则跳过（换目录/首次才真正构建）。
 * 并发：同一包加目录锁，避免 admin/portal 并行发布时两个 tsc 写同一 dist。
 * ------------------------------------------------------------------ */

/** 解析 pnpm 可执行文件：与 deploy-console CommandService.pnpmBin() 同策略 */
function resolvePnpmBin() {
  if (process.env.RELEASE_PNPM_BIN) return process.env.RELEASE_PNPM_BIN;
  const sibling = join(dirname(process.execPath), 'pnpm');
  if (existsSync(sibling)) return sibling;
  return 'pnpm';
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/** 扫描 packages/* 建立 name → {dir, pkg} 映射 */
function discoverWorkspacePackages() {
  const map = new Map();
  const pkgRoot = join(REPO_ROOT, 'packages');
  if (!existsSync(pkgRoot)) return map;
  for (const entry of readdirSync(pkgRoot)) {
    const manifest = join(pkgRoot, entry, 'package.json');
    if (!existsSync(manifest)) continue;
    try {
      const pkg = readJson(manifest);
      if (pkg.name) map.set(pkg.name, { dir: join(pkgRoot, entry), pkg });
    } catch { /* 坏 package.json 跳过 */ }
  }
  return map;
}

/** 收集该包的 workspace 依赖名（deps + devDeps，值以 workspace: 开头） */
function workspaceDepsOf(pkg) {
  const names = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const bag = pkg[field] || {};
    for (const [name, spec] of Object.entries(bag)) {
      if (typeof spec === 'string' && spec.startsWith('workspace:')) names.push(name);
    }
  }
  return names;
}

/**
 * 按依赖拓扑展开（依赖在前）。cycle-safe：已访问过就不再深入。
 */
function collectTopo(manifestPath, wsMap, ordered, visiting) {
  if (!existsSync(manifestPath)) return;
  const pkg = readJson(manifestPath);
  for (const depName of workspaceDepsOf(pkg)) {
    if (visiting.has(depName) || ordered.includes(depName)) continue;
    const hit = wsMap.get(depName);
    if (!hit) continue; // 非 workspace 包（或已发布到 npm）不处理
    visiting.add(depName);
    collectTopo(join(hit.dir, 'package.json'), wsMap, ordered, visiting);
    ordered.push(depName);
  }
}

/** 包的构建产物入口是否已存在（main 优先，回退 exports['.']） */
function entryExists(entry) {
  const { dir, pkg } = entry;
  const candidates = [];
  if (typeof pkg.main === 'string') candidates.push(pkg.main);
  const exp = pkg.exports;
  if (typeof exp === 'string') candidates.push(exp);
  else if (exp && typeof exp === 'object') {
    const dot = exp['.'];
    if (typeof dot === 'string') candidates.push(dot);
    else if (dot && typeof dot === 'object') {
      for (const v of Object.values(dot)) if (typeof v === 'string') candidates.push(v);
    }
  }
  if (candidates.length === 0) return true; // 无 main/exports：源码直引包，无需构建
  return candidates.some((rel) => existsSync(join(dir, rel)));
}

/** 目录锁：mkdir 原子性。拿不到则等待，超时抛错 */
function withBuildLock(dir, fn, timeoutMs = 180000) {
  const lockDir = join(dir, '.build.lock');
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // 陈旧锁（>10min）视为上次构建崩溃残留，清理后重试
      try {
        const age = Date.now() - statSync(lockDir).mtimeMs;
        if (age > 600000) { rmSync(lockDir, { recursive: true, force: true }); continue; }
      } catch { /* 锁刚好被释放 */ }
      if (Date.now() > deadline) die(`等待构建锁超时: ${lockDir}`);
      execSync('sleep 1');
    }
  }
  try { return fn(); } finally { rmSync(lockDir, { recursive: true, force: true }); }
}

/** 入口：确保 app 依赖的所有 workspace 包都有可解析的构建产物 */
function ensureWorkspaceDeps(appDir) {
  if (process.env.SKIP_WORKSPACE_PREBUILD === '1') {
    log('跳过 workspace 依赖预构建（SKIP_WORKSPACE_PREBUILD=1）');
    return;
  }
  const wsMap = discoverWorkspacePackages();
  const ordered = [];
  collectTopo(join(appDir, 'package.json'), wsMap, ordered, new Set());
  if (ordered.length === 0) return;

  const pnpmBin = resolvePnpmBin();
  for (const name of ordered) {
    const entry = wsMap.get(name);
    if (!entry) continue;
    if (!entry.pkg.scripts?.build) {
      log(`workspace 依赖 ${name}：无 build 脚本，跳过`);
      continue;
    }
    if (entryExists(entry)) {
      log(`workspace 依赖 ${name}：产物已存在，跳过`);
      continue;
    }
    log(`workspace 依赖 ${name}：产物缺失，预构建（${entry.dir}）`);
    const t0 = Date.now();
    withBuildLock(entry.dir, () => {
      // 拿到锁后再查一次：等待期间可能已被别的进程构建好
      if (entryExists(entry)) { log(`workspace 依赖 ${name}：等待期间已构建完成`); return; }
      execSync(`"${pnpmBin}" --filter ${name} build`, {
        cwd: REPO_ROOT,
        stdio: 'inherit',
        env: { ...process.env },
      });
    });
    if (!entryExists(entry)) {
      die(
        `workspace 依赖 ${name} 预构建后仍无产物入口（期望 ${entry.pkg.main || 'exports'}）。` +
        `请检查该包 build 脚本是否成功产出 dist；常见原因是 tsc 因 *.spec.ts 缺少测试类型定义报错`,
      );
    }
    log(`workspace 依赖 ${name}：构建完成（${Date.now() - t0}ms）`);
  }
}

function resolveModuleDef(key) {
  const file = join(REPO_ROOT, 'scripts', 'modules.json');
  if (!existsSync(file)) return null;
  const modules = JSON.parse(readFileSync(file, 'utf-8'));
  return modules.find((m) => m.key === key);
}

main().catch((e) => { console.error(e); process.exit(1); });
