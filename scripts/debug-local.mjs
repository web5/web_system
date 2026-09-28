#!/usr/bin/env node
/**
 * debug-local.mjs —— 本地微前端联调（一次命令：构建 → 投递 → 改指针 → 可访问）
 *
 * 为什么需要它：
 *   前端 UI 问题（尤其 :where([data-module]) 样式作用域、loader 挂载时序这类
 *   **只在微前端构建下出现**的缺陷）在 `pnpm dev` 的独立 SPA 模式下**复现不了**——
 *   独立模式没有 cssScope 前缀、不走 loader。此前只能构建完 scp 到 dev 才能看，
 *   一轮反馈好几分钟。本脚本把产物投给**本地 gateway(6000)**，改完刷新即可见。
 *
 * 前提：
 *   1. 本地 gateway 在跑（pm2: web-gateway，端口 6000，DEPLOY_ENV_ID=local）
 *   2. 本地 MySQL 可达（默认 127.0.0.1:3306 / web_system_deploy / root / <LOCAL_MYSQL_PASSWORD>）
 *      —— 与线上不同：线上在云 DB，改指针要 EMIT_SQL 再 scp，本地直接连。
 *
 * 用法：
 *   node scripts/debug-local.mjs portal          # 构建 + 投递 portal
 *   node scripts/debug-local.mjs portal admin    # 多个模块
 *   node scripts/debug-local.mjs portal --no-build   # 只重投已有 apps/portal/dist
 *   node scripts/debug-local.mjs shell           # 基座（投 public/shell，合并覆盖）
 *
 * 访问：
 *   http://localhost:6000/portal/     http://localhost:6000/admin/
 *
 * 注意：
 *   - gateway 的模块清单有 **10s TTL 缓存**，改完指针等 10 秒再刷新（脚本会提示）。
 *   - 版本目录 = `<module>-dev/<commit>[-dirty]`；同一 commit 重复构建会**覆盖**同目录（幂等）。
 *   - 旧版本目录自动保留最近 3 个，其余删除，避免磁盘膨胀。
 *   - ⚠️ 只改 env_id='local' 的行，不会碰 dev/prod（那是云库，本地连的也不是同一份）。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(import.meta.dirname, '..');
const RELEASE = path.join(process.env.HOME || '/Users/geekwen', 'web_system_release');
const WORKSPACE_PUBLIC = path.join(ROOT, 'servers/gateway/public');
const RELEASE_PUBLIC = path.join(RELEASE, 'servers/gateway/public');

/**
 * 静态根候选。⚠️ 关键坑（2026-09-28 实测）：
 * 本机 pm2 的 web-gateway 常是 **从 ~/web_system_release 启动的**，此时
 * `PUBLIC_ROOT`（servers/gateway/src/static/public-root.ts）解析到 release 副本，
 * 投到 workspace 的 public **完全不生效**（表现为模块 404 / 页面白屏，极难定位）。
 * 因此两份都投（成本就是一次 cp），谁在跑都能命中。
 */
const PUBLIC_TARGETS = [WORKSPACE_PUBLIC];
if (fs.existsSync(RELEASE_PUBLIC)) PUBLIC_TARGETS.push(RELEASE_PUBLIC);

const DB = {
  host: process.env.LOCAL_DB_HOST || '127.0.0.1',
  port: Number(process.env.LOCAL_DB_PORT || 3306),
  user: process.env.LOCAL_DB_USER || 'root',
  password: process.env.LOCAL_DB_PASSWORD || '<LOCAL_MYSQL_PASSWORD>',
  database: process.env.LOCAL_DB_NAME || 'web_system_deploy',
};

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noBuild = process.argv.includes('--no-build');
const modules = args.length ? args : ['portal'];

const log = (s) => console.log(s);

function currentVersion() {
  // ⚠️ 必须与 build-module 注入的 RELEASE_TAG（纯 commit）一致 —— shell html 的
  // 资源 base 是 /static/modules/shell/<RELEASE_TAG>/，目录名对不上就 404。
  // 本地重复构建同 commit 直接覆盖目录（幂等），无需 dirty 后缀区分。
  return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
}

function build(name) {
  log(`🔨 构建 ${name} (mf 模式)…`);
  execSync(`node scripts/build-module.mjs ${name}`, { cwd: ROOT, stdio: 'inherit' });
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  execSync(`cp -R ${JSON.stringify(src)}/. ${JSON.stringify(dest)}/`);
}

function copyInto(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  execSync(`cp -R ${JSON.stringify(src)}/. ${JSON.stringify(dest)}/`);
}

/** 只保留最近 3 个版本目录 */
function prune(envDir, keep = 3) {
  const dirs = fs
    .readdirSync(envDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, m: fs.statSync(path.join(envDir, d.name)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const d of dirs.slice(keep)) {
    fs.rmSync(path.join(envDir, d.name), { recursive: true, force: true });
    log(`   🧹 清理旧版本 ${d.name}`);
  }
}

function writePointer(envDir, commit) {
  fs.writeFileSync(
    path.join(envDir, 'index.js'),
    `System.register(['./${commit}/index.js'], function (_export) {\n` +
      `  'use strict';\n  return {\n    setters: [function (m) { _export(m); }],\n` +
      `    execute: function () {}\n  };\n});\n`,
  );
  fs.writeFileSync(path.join(envDir, 'index.css'), `@import url('./${commit}/index.css');\n`);
}

(async () => {
  const version = currentVersion();
  // NEW 域 env 段：与 gateway DEPLOY_ENV_ID 一致（本地=local）。html 里 byEnv
  // 指针是 /static/modules/<key>/<envId>/index.js，目录段必须是 envId 本身。
  const envId = process.env.DEBUG_ENV_ID || 'local';
  const conn = await mysql.createConnection(DB);
  log(`📦 版本 ${version}（env=${envId}）\n`);

  for (const name of modules) {
    if (name === 'shell') {
      if (!noBuild) build('shell');
      const dist = path.join(ROOT, 'apps/shell/dist');
      if (!fs.existsSync(dist)) throw new Error('apps/shell/dist 不存在，先构建');
      for (const pub of PUBLIC_TARGETS) {
        // ① 兜底固定目录（resolveShellDir 取不到版本时回落到这里）
        fs.mkdirSync(path.join(pub, 'shell'), { recursive: true });
        execSync(`cp -R ${JSON.stringify(dist)}/. ${JSON.stringify(path.join(pub, 'shell'))}/`);
        // ② build-module 给 shell 注入了 RELEASE_TAG=<commit>，html 资源 base 是
        //    /static/modules/shell/<version>/ 绝对路径 —— 必须投到同形目录才能命中
        //    （NEW 域指针表无 shell@local 行，resolveShellDir 不会带 envId 段）。
        const versioned = path.join(pub, 'static/modules/shell', version);
        fs.rmSync(versioned, { recursive: true, force: true });
        fs.mkdirSync(versioned, { recursive: true });
        execSync(`cp -R ${JSON.stringify(dist)}/. ${JSON.stringify(versioned)}/`);
        log(`✅ shell → ${pub}/shell + ${pub}/static/modules/shell/${version}/`);
      }
      continue;
    }

    if (!noBuild) build(name);
    const dist = path.join(ROOT, `apps/${name}/dist`);
    if (!fs.existsSync(dist)) throw new Error(`apps/${name}/dist 不存在，先构建`);

    const full = `${envId}/${version}`;
    for (const pub of PUBLIC_TARGETS) {
      const envDir = path.join(pub, 'static/modules', name, envId);
      copyInto(dist, path.join(envDir, version));
      writePointer(envDir, version);
      prune(envDir);
      log(`✅ ${name} → ${pub}/static/modules/${name}/${full}/`);
    }
    const [res] = await conn.query(
      'update deploy_deployments set current_version=? where env_id=? and module_key=?',
      [full, envId, name],
    );
    log(`✅ ${name} DB 指针 → ${full} (affected=${res.affectedRows})`);
  }

  await conn.end();
  log(
    `\n🌐 等 10 秒（gateway 清单缓存 TTL）后访问（⚠️ Chrome 拦 6000 端口，用 debug gateway 6600）：\n` +
      modules
        .filter((m) => m !== 'shell')
        .map((m) => `   http://localhost:6600/${m}/`)
        .join('\n'),
  );
})().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
