#!/usr/bin/env node
/**
 * p29：给**目标库**补齐双域（NEW 域）四张表并灌入 prod 站点数据。
 *
 * 背景（2026-09-28）：
 *   prod 的 MySQL 只有 legacy 的 `deploy_deployments` / `deploy_modules`，
 *   **没有** deploy_sites / deploy_envs / deploy_apps / deploy_app_env_versions，
 *   于是 gateway 组装 manifest 时 `resolveSite()` 查表抛错 → 回落 `source: 'new:error'`，
 *   `byEnv` 恒为空 ⇒ prod 只能靠 legacy `current_version` 原样拼路径（值必须逐字等于磁盘目录名）。
 *   dev 早就是 NEW 域，两端机制不对等。
 *
 * 本脚本做两件事（均幂等，可重复执行）：
 *   1. `CREATE TABLE IF NOT EXISTS` 四张表（DDL 与 dev 库实测结构一致，information_schema 守卫）
 *   2. 灌入 prod 的种子数据（site / env / apps / 版本指针），已存在则跳过或按需更新指针
 *
 * 用法：
 *   DB_HOST=... DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=web_system \
 *     node scripts/migrations/p29-prod-new-deploy-tables.mjs
 *
 *   DRY_RUN=1          只打印将执行的 SQL，不落库
 *   SEED_VERSION=<sha> 覆盖版本指针（默认 d9889ff，当前 prod 线上产物）
 *   SKIP_SEED=1        只建表不灌数据
 *
 * ⚠️ 只建表 + 灌数据，**不删任何东西**；回滚 = DROP 这四张表（gateway 会自动回落 legacy）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

/** 未显式给 env 时，退回 servers/deploy-console/.env（与 p28 同口径） */
function loadConsoleEnv() {
  const p = path.join(root, 'servers/deploy-console/.env');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const consoleEnv = loadConsoleEnv();
const cfg = {
  host: process.env.DB_HOST || consoleEnv.DB_HOST,
  port: Number(process.env.DB_PORT || consoleEnv.DB_PORT || 3306),
  user: process.env.DB_USER || consoleEnv.DB_USER,
  password: process.env.DB_PASSWORD || consoleEnv.DB_PASSWORD,
  database: process.env.DB_NAME || consoleEnv.DB_NAME,
};

const DRY_RUN = !!process.env.DRY_RUN;
const SKIP_SEED = !!process.env.SKIP_SEED;
const SEED_VERSION = process.env.SEED_VERSION || 'd9889ff';

/** `EMIT_SQL=1` 的开关（真正执行在文件末尾，需在 TABLES/SEED_SQL 定义之后） */
const EMIT_SQL = !!process.env.EMIT_SQL;

if (!EMIT_SQL) {
  for (const [k, v] of Object.entries(cfg)) {
    if (v === undefined || v === '') {
      console.error(`[p29] 缺少配置 ${k}（用 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 传入）`);
      process.exit(1);
    }
  }
}

const mysql = require(path.join(root, 'node_modules/.pnpm/node_modules/mysql2/promise.js'));

const TABLES = {
  deploy_sites: `CREATE TABLE IF NOT EXISTS \`deploy_sites\` (
  \`key\` varchar(32) NOT NULL COMMENT '站点 key',
  \`host\` varchar(128) NOT NULL COMMENT '入口域名',
  \`name\` varchar(64) NOT NULL COMMENT '展示名',
  \`default_env_id\` varchar(64) NOT NULL DEFAULT 'dev' COMMENT '默认环境 envId',
  \`switchable\` tinyint NOT NULL DEFAULT '0' COMMENT '是否可切换环境',
  \`enabled\` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (\`key\`),
  UNIQUE KEY \`IDX_deploy_sites_host\` (\`host\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  deploy_envs: `CREATE TABLE IF NOT EXISTS \`deploy_envs\` (
  \`env_id\` varchar(64) NOT NULL COMMENT '环境 ID（目录名）',
  \`name\` varchar(64) NOT NULL COMMENT '环境名称',
  \`site_key\` varchar(32) NOT NULL COMMENT '归属站点 key',
  \`is_prod\` tinyint NOT NULL DEFAULT '0' COMMENT '是否生产环境',
  \`builtin\` tinyint NOT NULL DEFAULT '0' COMMENT '是否内置',
  \`sort\` int NOT NULL DEFAULT '0' COMMENT '排序',
  \`enabled\` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (\`env_id\`),
  KEY \`IDX_deploy_envs_site_key\` (\`site_key\`),
  KEY \`IDX_deploy_envs_is_prod\` (\`is_prod\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  deploy_apps: `CREATE TABLE IF NOT EXISTS \`deploy_apps\` (
  \`key\` varchar(64) NOT NULL COMMENT '应用 key',
  \`name\` varchar(128) NOT NULL COMMENT '名称',
  \`kind\` varchar(24) NOT NULL DEFAULT 'micro-frontend' COMMENT '类型 shell/micro-frontend/spa/mini-app',
  \`parent_key\` varchar(64) DEFAULT NULL COMMENT '父应用 key',
  \`repo_dir\` varchar(128) NOT NULL COMMENT '仓库目录',
  \`entry\` varchar(64) DEFAULT NULL COMMENT '入口文件',
  \`public_path\` varchar(255) DEFAULT NULL COMMENT 'publicPath',
  \`deploy_root\` varchar(255) DEFAULT NULL COMMENT '部署根（相对发布目录）',
  \`default_artifact_path\` varchar(255) DEFAULT NULL COMMENT '默认产物路径（相对部署根）',
  \`externals\` json DEFAULT NULL COMMENT 'externals',
  \`deploy_mode\` varchar(16) NOT NULL DEFAULT 'env-dir' COMMENT '部署模式 env-dir/site-version',
  \`description\` varchar(255) DEFAULT NULL COMMENT '描述',
  \`builtin\` tinyint NOT NULL DEFAULT '0' COMMENT '是否内置',
  \`enabled\` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  \`deleted_at\` datetime(6) DEFAULT NULL COMMENT '软删除时间',
  \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (\`key\`),
  KEY \`IDX_deploy_apps_kind\` (\`kind\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  deploy_app_env_versions: `CREATE TABLE IF NOT EXISTS \`deploy_app_env_versions\` (
  \`id\` varchar(36) NOT NULL,
  \`app_key\` varchar(64) NOT NULL COMMENT '应用 key',
  \`env_id\` varchar(64) NOT NULL COMMENT '环境 envId',
  \`current_version\` varchar(128) DEFAULT NULL COMMENT '当前版本',
  \`previous_version\` varchar(128) DEFAULT NULL COMMENT '上一版本',
  \`status\` varchar(16) NOT NULL DEFAULT 'unknown' COMMENT '状态 deployed/unknown/failed',
  \`deployed_at\` datetime(6) DEFAULT NULL COMMENT '发布时间',
  \`deployed_by\` varchar(64) DEFAULT NULL COMMENT '发布人',
  \`task_id\` varchar(64) DEFAULT NULL COMMENT '流水线运行 ID',
  \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`IDX_app_env_versions_unique\` (\`app_key\`,\`env_id\`),
  KEY \`IDX_app_env_versions_app\` (\`app_key\`),
  KEY \`IDX_app_env_versions_env\` (\`env_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
};

/** 种子数据：与 dev 库的取值口径保持一致（shell 走 site-version，不纳入 env 切换） */
const SEED_SQL = [
  `INSERT IGNORE INTO deploy_sites (\`key\`, host, name, default_env_id, switchable, enabled)
     VALUES ('prod', 'kedouai.com', '生产站点', 'prod', 0, 1)`,
  `INSERT IGNORE INTO deploy_envs (env_id, name, site_key, is_prod, builtin, sort, enabled)
     VALUES ('prod', '生产环境', 'prod', 1, 1, 0, 1)`,
  `INSERT IGNORE INTO deploy_apps (\`key\`, name, kind, repo_dir, entry, deploy_mode, builtin, enabled)
     VALUES
       ('admin',  '管理后台', 'micro-frontend', 'apps/admin',  'index.js', 'env-dir', 1, 1),
       ('portal', '科豆门户', 'micro-frontend', 'apps/portal', 'index.js', 'env-dir', 1, 1),
       ('shell',  '基座',     'shell',          'apps/shell',  'index.js', 'site-version', 1, 1)`,
  // 版本指针：幂等覆盖（prod 当前线上产物即 SEED_VERSION）
  `INSERT INTO deploy_app_env_versions (id, app_key, env_id, current_version, status, deployed_at, deployed_by)
     VALUES (UUID(), 'admin',  'prod', '${SEED_VERSION}', 'deployed', NOW(6), 'p29-migration'),
            (UUID(), 'portal', 'prod', '${SEED_VERSION}', 'deployed', NOW(6), 'p29-migration')
     ON DUPLICATE KEY UPDATE current_version = VALUES(current_version), status = 'deployed'`,
];

/**
 * `EMIT_SQL=1`：不连库，直接把建表 + 种子 SQL 打到 stdout。
 * 用于云数据库**只能从跳板机访问**的场景（本机连不上内网 10.0.16.x，需 scp 到跳板机再执行）：
 *   EMIT_SQL=1 node scripts/migrations/p29-prod-new-deploy-tables.mjs > /tmp/p29.sql
 *   scp /tmp/p29.sql <prod>:/tmp/ && ssh <prod> 'mysql web_system < /tmp/p29.sql'
 */
if (EMIT_SQL) {
  process.stdout.write(`-- p29 建表 + prod 种子数据（由脚本生成，勿手改）\n`);
  process.stdout.write(`-- 生成时间：${new Date().toISOString()}\n\n`);
  for (const ddl of Object.values(TABLES)) process.stdout.write(`${ddl};\n\n`);
  if (!SKIP_SEED) for (const sql of SEED_SQL) process.stdout.write(`${sql};\n\n`);
  process.stdout.write(
    `SELECT \`key\`, host, default_env_id FROM deploy_sites;\n` +
      `SELECT env_id, site_key, is_prod FROM deploy_envs;\n` +
      `SELECT \`key\`, kind, deploy_mode FROM deploy_apps;\n` +
      `SELECT app_key, env_id, current_version, status FROM deploy_app_env_versions;\n`,
  );
  process.exit(0);
}

async function main() {
  const conn = await mysql.createConnection(cfg);
  console.log(`[p29] 目标库 ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}${DRY_RUN ? '（DRY_RUN）' : ''}`);

  for (const [table, ddl] of Object.entries(TABLES)) {
    const [rows] = await conn.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
      [cfg.database, table],
    );
    if (rows.length > 0) {
      console.log(`  = ${table} 已存在，跳过`);
      continue;
    }
    console.log(`  + CREATE TABLE ${table}`);
    if (!DRY_RUN) await conn.query(ddl);
  }

  if (!SKIP_SEED) {
    for (const sql of SEED_SQL) {
      const oneLine = sql.replace(/\s+/g, ' ').slice(0, 90);
      console.log(`  · ${oneLine}…`);
      if (!DRY_RUN) await conn.query(sql);
    }
  }

  if (!DRY_RUN) {
    const [sites] = await conn.query('SELECT `key`, host, default_env_id FROM deploy_sites');
    const [envs] = await conn.query('SELECT env_id, site_key, is_prod FROM deploy_envs');
    const [apps] = await conn.query('SELECT `key`, kind, deploy_mode FROM deploy_apps');
    const [vers] = await conn.query('SELECT app_key, env_id, current_version FROM deploy_app_env_versions');
    console.log('\n[p29] 结果：');
    console.table(sites);
    console.table(envs);
    console.table(apps);
    console.table(vers);
  }

  await conn.end();
  console.log('\n[p29] 完成。下一步：在静态根写 env-dir 入口指针（见文档），再验证 /__manifest__ 的 source=new。');
}

main().catch((e) => {
  console.error('[p29] 失败:', e.message);
  process.exit(1);
});
