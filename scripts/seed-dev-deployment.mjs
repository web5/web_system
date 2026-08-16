#!/usr/bin/env node
/**
 * 本地端到端验证用：往 web_system_deploy 插入模块种子数据。
 *   - deploy_modules: portal / admin / shell
 *   - deploy_deployments: dev 环境各模块当前版本指针
 *   - deploy_versions: 版本记录
 *
 * 用法: node scripts/seed-dev-deployment.mjs
 * 可重复执行（ON DUPLICATE KEY UPDATE）。
 */
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();

// 从 deploy-console 解析 mysql2（该服务依赖它）
const require = createRequire(resolve(REPO_ROOT, 'servers/deploy-console/package.json'));
const mysql = require('mysql2/promise');

const DB = {
  host: '127.0.0.1', port: 3306, user: 'root', password: 'KedouLocal@2026', database: 'web_system_deploy',
};

const modulesJson = JSON.parse(readFileSync(resolve(REPO_ROOT, 'scripts/modules.json'), 'utf-8'));
const mfModules = modulesJson.filter((m) => m.type === 'micro-frontend');

function log(msg) { console.log(`[seed] ${msg}`); }
function warn(msg) { console.warn(`[seed] WARN: ${msg}`); }

async function main() {
  log(`git commit = ${commit}`);
  const conn = await mysql.createConnection(DB);

  // 检查表是否存在（不存在说明 deploy-console/gateway 还没启动过 synchronize 建表）
  const [rows] = await conn.query(`SHOW TABLES LIKE 'deploy_modules'`);
  if (rows.length === 0) {
    console.error('[seed] ERROR: deploy_modules 表不存在。请先启动一次 deploy-console（synchronize=true 自动建表）再跑本脚本。');
    console.error('[seed]   命令: cd servers/deploy-console && node dist/main.js  （启动后 Ctrl+C 即可）');
    process.exit(1);
  }

  // 1. deploy_modules
  for (const m of mfModules) {
    await conn.execute(
      `INSERT INTO deploy_modules (id, \`key\`, name, type, dir, public_path, enabled, builtin)
       VALUES (UUID(), ?, ?, ?, ?, ?, 1, 1)
       ON DUPLICATE KEY UPDATE name=VALUES(name), type=VALUES(type), dir=VALUES(dir), public_path=VALUES(public_path)`,
      [m.key, m.name, m.type, m.dir, m.publicPath || m.key],
    ).catch((e) => warn(`${m.key}: ${e.message}`));
    log(`deploy_modules: ${m.key} ✓`);
  }
  await conn.execute(
    `INSERT INTO deploy_modules (id, \`key\`, name, type, dir, public_path, is_shell, enabled, builtin)
     VALUES (UUID(), 'shell', '微前端基座 Shell', 'frontend', 'shell', 'shell', 1, 1, 1)
     ON DUPLICATE KEY UPDATE is_shell=1`,
  ).catch((e) => warn(`shell: ${e.message}`));
  log('deploy_modules: shell ✓');

  // 2. deploy_deployments
  for (const m of mfModules) {
    await conn.execute(
      `INSERT INTO deploy_deployments (id, env_id, module_key, current_version, status, deployed_at, deployed_by)
       VALUES (UUID(), 'dev', ?, ?, 'deployed', NOW(), 'seed')
       ON DUPLICATE KEY UPDATE current_version=?, status='deployed', deployed_at=NOW()`,
      [m.key, commit, commit],
    ).catch((e) => warn(`deployments ${m.key}: ${e.message}`));
    log(`deploy_deployments: dev/${m.key} → ${commit} ✓`);
  }

  // 3. deploy_versions
  for (const m of mfModules) {
    await conn.execute(
      `INSERT INTO deploy_versions (id, env, component, version_tag, git_commit, git_branch, released_by, released_at, status, note)
       VALUES (UUID(), 'dev', ?, ?, ?, 'master', 'seed', NOW(), 'active', '本地 seed')
       ON DUPLICATE KEY UPDATE status='active'`,
      [`mf:${m.key}`, commit, commit],
    ).catch(() => {});
  }

  await conn.end();
  log('seed 完成。gateway 启动后访问 http://localhost:6000/');
}

main().catch((e) => { console.error(e); process.exit(1); });
