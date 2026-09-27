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
 *
 * ⚠️ 产物里的静态资源（logo/avatars/materials）必须走 __PUBLIC_ASSET_BASE__（/static/cdn/pub/），
 *    不要放进 app 的 public/ 目录（否则每个版本目录重复 4~5MB，且双段目录错一段就静默 404）。
 *    详见 assets/shared-public/README.md。
 */
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from 'fs';
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
  // 产物 base 必须含产品线段（平台默认模板 key = default）：/static/modules/<key>/<产品线>/<版本>/
  // 契约与校验见 scripts/vite-micro-frontend.mjs resolveMfBase。
  // 注：产物里的静态资源已于 2026-09-27 全部迁到 /static/cdn/pub/（见 assets/shared-public/README.md），
  //     base 段此时只影响 index.js / index.css 的自身 URL；确需历史扁平布局时仍可用 MF_ALLOW_FLAT_BASE=1。
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
 * 幂等：入口文件存在且新于源码/构建配置则跳过；换目录、首次、源码变更才真正构建。
 * 开关：`SKIP_WORKSPACE_PREBUILD=1` 跳过；`WORKSPACE_PREBUILD_FORCE=1` 强制全量重建。
 * 并发：同一包加目录锁，避免 admin/portal 并行发布时两个 tsc 写同一 dist。
 *
 * ⚠️ 用 `npm run build`（包目录内）而不是 `pnpm --filter <pkg> build`：
 * pnpm 11 的 `--filter` 会先跑 `runDepsStatusCheck`，依赖状态不一致时**隐式执行 pnpm install**，
 * 在发布端表现为联网/构建脚本被忽略而失败（2026-09-27 prod 实测：ERR_PNPM_IGNORED_BUILDS → exit 1），
 * 且把「构建」牵连成「装依赖」，失败面变大。`npm run build` 直击 package.json 的完整 build 脚本，
 * 同时满足发布门 A3（workspace 包必须走完整 build 脚本，不能只跑裸 tsc——
 * types/agent-message 的 build 还负责产出 cjs 与 dist/cjs/package.json）。
 * ------------------------------------------------------------------ */

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

/** 候选入口文件相对路径（main 优先，回退 exports['.']） */
function entryCandidates(entry) {
  const { pkg } = entry;
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
  return candidates;
}

/** 包的构建产物入口是否已存在（无 main/exports 视为源码直引，无需构建） */
function entryExists(entry) {
  const cands = entryCandidates(entry);
  if (cands.length === 0) return true;
  return cands.some((rel) => existsSync(join(entry.dir, rel)));
}

/** 第一个存在的入口文件 mtime；都没有则 null */
function entryMtime(entry) {
  for (const rel of entryCandidates(entry)) {
    const p = join(entry.dir, rel);
    if (existsSync(p)) { try { return statSync(p).mtimeMs; } catch { return null; } }
  }
  return null;
}

/** 包源码（含 src/ 与 package.json / tsconfig*.json）的最新修改时间 */
function latestSourceMtime(entry) {
  let latest = 0;
  const bump = (file) => {
    try { const m = statSync(file).mtimeMs; if (m > latest) latest = m; } catch { /* 忽略不可读 */ }
  };
  const srcDir = join(entry.dir, 'src');
  if (existsSync(srcDir)) {
    const walk = (dir) => {
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p); else bump(p);
      }
    };
    walk(srcDir);
  }
  // 构建配置变化同样需要重建（换 tsconfig 而 src 没动的情况下）
  try {
    for (const e of readdirSync(entry.dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (e.name === 'package.json' || /^tsconfig.*\.json$/.test(e.name)) bump(join(entry.dir, e.name));
    }
  } catch { /* 忽略 */ }
  return latest;
}

/**
 * 产物是否陈旧：入口存在，但源码/构建配置比它更新。
 * 只看「入口存在」会漏掉发布端 pull 新代码后 src 变了而 dist 仍是旧的 —— 静默用旧代码、无任何报错。
 */
function isStale(entry) {
  const em = entryMtime(entry);
  if (em === null) return true;
  return latestSourceMtime(entry) > em + 1000; // 1s 容差，避开同一秒内的抖动
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

  for (const name of ordered) {
    const entry = wsMap.get(name);
    if (!entry) continue;
    if (!entry.pkg.scripts?.build) {
      log(`workspace 依赖 ${name}：无 build 脚本，跳过`);
      continue;
    }
    const force = process.env.WORKSPACE_PREBUILD_FORCE === '1';
    if (force) {
      log(`workspace 依赖 ${name}：WORKSPACE_PREBUILD_FORCE=1，强制重建`);
    } else if (entryExists(entry)) {
      if (!isStale(entry)) {
        log(`workspace 依赖 ${name}：产物已存在且新于源码，跳过`);
        continue;
      }
      log(`workspace 依赖 ${name}：源码/构建配置比产物新，重建（${entry.dir}）`);
    } else {
      log(`workspace 依赖 ${name}：产物缺失，预构建（${entry.dir}）`);
    }
    const t0 = Date.now();
    withBuildLock(entry.dir, () => {
      // 拿到锁后再查一次：等待期间可能已被别的进程构建好
      if (!force && entryExists(entry) && !isStale(entry)) {
        log(`workspace 依赖 ${name}：等待期间已构建完成`);
        return;
      }
      execSync('npm run build', {
        cwd: entry.dir,
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
