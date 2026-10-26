#!/usr/bin/env node
/**
 * workspace 包预构建脚本（流水线 prebuild 步骤 / pull.afterSync 共用）。
 *
 * 用法：
 *   node scripts/prebuild-workspace-deps.mjs [--force] [--only <pkg-name>]
 *
 * 解决的问题（2026-10-26 故障）：
 *   后端打包 `executeBackendRuntime` 的 `copyWorkspaceOutputs` 直接 cpSync
 *   `packages/<pkg>/dist`，不判陈旧。源码（pull 新代码）比 dist 新时静默吃旧产物 ——
 *   典型症状：改了 @kedouai/agent-core 的字段（如 runId）发布后仍不生效。
 *
 * 与 `scripts/build-module.mjs` 的 ensureWorkspaceDeps 同源逻辑（isStale + 目录锁），
 * 但独立成脚本，供流水线 prebuild 步骤与 pull.afterSync 共用；支持全部 packages 下所有包，
 * 不维护硬编码清单（此前 PREBUILD_SHARED_PACKAGES 漏 agent-core 即为教训）。
 *
 * 幂等：dist 新于源码即跳过；二次执行（步骤 + afterSync 兜底）开销可忽略。
 * 环境变量：
 *   SKIP_WORKSPACE_PREBUILD=1   跳过（兼容历史开关）
 *   WORKSPACE_PREBUILD_FORCE=1  强制重建（等价 --force）
 */
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.argv[1] ? join(process.argv[1], '..', '..') : process.cwd());

function log(msg) {
  console.log(`[prebuild-workspace-deps] ${msg}`);
}
function die(msg) {
  console.error(`[prebuild-workspace-deps] ERROR: ${msg}`);
  process.exit(1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** 候选入口文件相对路径（main 优先，回退 exports['.']） */
function entryCandidates(pkg) {
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
function entryExists(dir, pkg) {
  const cands = entryCandidates(pkg);
  if (cands.length === 0) return true;
  return cands.some((rel) => existsSync(join(dir, rel)));
}

/** 第一个存在的入口文件 mtime；都没有则 null */
function entryMtime(dir, pkg) {
  for (const rel of entryCandidates(pkg)) {
    const p = join(dir, rel);
    if (existsSync(p)) {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** 包源码（含 src/ 与 package.json / tsconfig*.json）的最新修改时间 */
function latestSourceMtime(dir) {
  let latest = 0;
  const bump = (file) => {
    try {
      const m = statSync(file).mtimeMs;
      if (m > latest) latest = m;
    } catch {
      /* 忽略不可读 */
    }
  };
  const srcDir = join(dir, 'src');
  if (existsSync(srcDir)) {
    const walk = (d) => {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === 'dist') continue;
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else bump(p);
      }
    };
    walk(srcDir);
  }
  // 构建配置变化同样需要重建（换 tsconfig 而 src 没动的情况下）
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      if (e.name === 'package.json' || /^tsconfig.*\.json$/.test(e.name)) bump(join(dir, e.name));
    }
  } catch {
    /* 忽略 */
  }
  return latest;
}

/**
 * 产物是否陈旧：入口存在，但源码/构建配置比它更新。
 * 只看「入口存在」会漏掉 pull 新代码后 src 变了而 dist 仍是旧的 —— 静默用旧代码。
 */
function isStale(dir, pkg) {
  const em = entryMtime(dir, pkg);
  if (em === null) return true;
  return latestSourceMtime(dir) > em + 1000; // 1s 容差，避开同一秒内的抖动
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
        if (age > 600000) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* 锁刚好被释放 */
      }
      if (Date.now() > deadline) die(`等待构建锁超时: ${lockDir}`);
      execSync('sleep 1');
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

/** 扫 packages/* 建立 name → {dir, pkg} 映射 */
function discoverWorkspacePackages() {
  const map = new Map();
  const pkgRoot = join(ROOT, 'packages');
  if (!existsSync(pkgRoot)) return map;
  for (const entry of readdirSync(pkgRoot)) {
    const manifest = join(pkgRoot, entry, 'package.json');
    if (!existsSync(manifest)) continue;
    try {
      const pkg = readJson(manifest);
      if (pkg.name) map.set(pkg.name, { dir: join(pkgRoot, entry), pkg });
    } catch {
      /* 忽略坏 manifest */
    }
  }
  return map;
}

function main() {
  if (process.env.SKIP_WORKSPACE_PREBUILD === '1') {
    log('跳过 workspace 预构建（SKIP_WORKSPACE_PREBUILD=1）');
    return;
  }
  const force = process.argv.includes('--force') || process.env.WORKSPACE_PREBUILD_FORCE === '1';
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;

  const wsMap = discoverWorkspacePackages();
  if (wsMap.size === 0) {
    log('packages/ 下无 workspace 包，跳过');
    return;
  }

  let built = 0;
  let skipped = 0;
  for (const [name, entry] of wsMap) {
    if (only && name !== only) continue;
    const { dir, pkg } = entry;
    if (!pkg.scripts?.build) {
      log(`${name}：无 build 脚本，跳过`);
      skipped += 1;
      continue;
    }
    if (force) {
      log(`${name}：强制重建`);
    } else if (entryExists(dir, pkg)) {
      if (!isStale(dir, pkg)) {
        log(`${name}：产物已存在且新于源码，跳过`);
        skipped += 1;
        continue;
      }
      log(`${name}：源码/构建配置比产物新，重建`);
    } else {
      log(`${name}：产物缺失，预构建`);
    }
    const t0 = Date.now();
    withBuildLock(dir, () => {
      // 拿到锁后再查一次：等待期间可能已被别的进程构建好
      if (!force && entryExists(dir, pkg) && !isStale(dir, pkg)) {
        log(`${name}：等待期间已构建完成`);
        return;
      }
      execSync('npm run build', {
        cwd: dir,
        stdio: 'inherit',
        env: { ...process.env },
      });
    });
    if (!entryExists(dir, pkg)) {
      die(
        `${name} 预构建后仍无产物入口（期望 ${pkg.main || 'exports'}）。` +
          `请检查该包 build 脚本是否成功产出 dist`,
      );
    }
    log(`${name}：构建完成（${Date.now() - t0}ms）`);
    built += 1;
  }
  log(`预构建完成：重建 ${built} 个，跳过 ${skipped} 个`);
}

main();
