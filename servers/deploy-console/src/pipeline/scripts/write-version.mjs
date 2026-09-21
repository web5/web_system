#!/usr/bin/env node
/**
 * 写版本记录（平台动作工具，随 console 分发）。
 *
 * 新编排模型的 write-version 动作脚本（bash）委托本工具直连部署库写
 * `deploy_versions` —— 与 ReleaseRegistryService.registerVersion 同一字段集。
 *
 * ⚠️ 同步义务：改 registerVersion / deploy_versions 结构时必须同步本文件
 *    （两者随同一 console 构建分发，漂移会在发布时第一时间暴露）。
 *
 * 用法：node write-version.mjs <moduleKey> <envId> <versionTag> [gitBranch] [operator] [taskId] [note]
 * 连接：读同目录向上定位的 deploy-console 运行目录 .env（MYSQL_*）。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

function fail(msg) {
  console.error(`[write-version] ${msg}`);
  process.exit(1);
}

const [moduleKey, envId, versionTag, gitBranch, operator, taskId, note] = process.argv.slice(2);
if (!moduleKey || !envId || !versionTag) {
  fail('用法: write-version.mjs <moduleKey> <envId> <versionTag> [gitBranch] [operator] [taskId] [note]');
}

// 定位 deploy-console 运行目录的 .env（dist/pipeline/scripts/ → dist → 服务根）
function findEnvFile() {
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

const envFile = findEnvFile();
if (!envFile) fail('找不到 deploy-console 的 .env（向上 6 级未命中）');
const env = Object.fromEntries(
  fs
    .readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  fail('无法加载 mysql2（应从 deploy-console 的 node_modules 解析）');
}

const conn = await mysql
  .createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DB,
    connectTimeout: 8000,
  })
  .catch((e) => fail(`连接部署库失败: ${e.message}`));

try {
  await conn.execute(
    `INSERT INTO deploy_versions (id, env, component, version_tag, git_commit, git_branch,
       released_by, released_at, status, task_id, note)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, NOW(), 'active', ?, ?)`,
    [
      envId,
      moduleKey,
      versionTag,
      versionTag,
      gitBranch || null,
      operator || 'pipeline',
      taskId || null,
      note || '流水线发布',
    ],
  );
  console.log(`[write-version] 版本记录已写入: ${envId}/${moduleKey}@${versionTag}`);
  process.exit(0);
} catch (e) {
  fail(`写版本失败: ${e.message}`);
} finally {
  await conn.end().catch(() => undefined);
}
