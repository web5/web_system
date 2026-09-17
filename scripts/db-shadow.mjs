#!/usr/bin/env node
/**
 * 影子库工具：给**数据库改动**做演练环境。
 *
 * 背景（2026-09-17 用户指出流程问题）：此前像 p9 改表名这类改动是**直接在真库上跑**的，
 * 虽然有备份可回滚，但没有"先演练一遍"的环节。本工具提供隔离的影子库：
 *
 *   create  从真库复制「结构（含索引/主键）+ 数据」到影子库
 *   run     在影子库上跑指定迁移脚本（脚本需支持 MYSQL_DB 环境变量覆盖）
 *   status  对比两库的表与行数
 *   drop    删除影子库
 *
 * 为什么不用 mysqldump：本机没有该命令；改用 SHOW CREATE TABLE + INSERT ... SELECT，
 * 同样能拿到完整结构（索引/主键/默认值）与数据，足以验证迁移是否跑得通。
 *
 * 用法：
 *   node scripts/db-shadow.mjs create
 *   node scripts/db-shadow.mjs run migrations/p9-rename-pipeline-tables.mjs
 *   node scripts/db-shadow.mjs status
 *   node scripts/db-shadow.mjs drop
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import { spawnSync } from 'child_process';

/** 输出通道（R1 红线不允许直接用 console 打印，统一走 stdout） */
const out = (s) => process.stdout.write(s + '\n');

const SHADOW = process.env.SHADOW_DB || 'web_system_deploy_shadow';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../servers/deploy-console/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const connect = (database) =>
  mysql.createConnection({
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database,
    connectTimeout: 10000,
    multipleStatements: true,
  });

const [cmd, ...rest] = process.argv.slice(2);

const listTables = async (c) => {
  const [r] = await c.query(
    "SELECT table_name AS n FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY n",
  );
  return r.map((x) => x.n);
};

const ensureShadowDb = async (admin) => {
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${SHADOW}\``);
};

async function create() {
  const real = await connect(env.MYSQL_DB);
  const names = await listTables(real);
  // 影子库本身不复制
  const tables = names.filter((n) => n !== SHADOW);
  const admin = await connect(env.MYSQL_DB);
  await admin.query(`DROP DATABASE IF EXISTS \`${SHADOW}\``);
  await ensureShadowDb(admin);
  await admin.end();

  const sh = await connect(SHADOW);
  let ok = 0;
  for (const t of tables) {
    const [ddl] = await real.query(`SHOW CREATE TABLE \`${t}\``);
    await sh.query(ddl[0]['Create Table']);
    const [cnt] = await real.query(`SELECT COUNT(*) n FROM \`${t}\``);
    if (cnt[0].n > 0) {
      await sh.query(`INSERT INTO \`${SHADOW}\`.\`${t}\` SELECT * FROM \`${env.MYSQL_DB}\`.\`${t}\``);
    }
    ok += 1;
  }
  out(`✅ 影子库 ${SHADOW} 已建：${ok} 张表（结构与数据均复制自 ${env.MYSQL_DB}）`);
  await sh.end();
  await real.end();
}

async function run() {
  const script = rest[0];
  if (!script) {
    out('用法: node scripts/db-shadow.mjs run <migration-script>');
    process.exit(1);
  }
  // 相对本脚本所在目录（scripts/）解析：migrations/xxx.mjs
  const path = script.startsWith('/') ? script : new URL(script, import.meta.url).pathname;
  out(`▶ 在影子库 ${SHADOW} 上演练：${script}`);
  const r = spawnSync('node', [path], {
    stdio: 'inherit',
    env: { ...process.env, MYSQL_DB: SHADOW },
  });
  if (r.status !== 0) {
    out(`\n❌ 迁移在影子库上失败（退出码 ${r.status}）—— 别上真库`);
    process.exit(r.status ?? 1);
  }
  out('\n✅ 影子库演练通过（真库未受影响）');
}

async function status() {
  const real = await connect(env.MYSQL_DB);
  const sh = await connect(SHADOW);
  const rt = await listTables(real);
  const st = await listTables(sh);
  out(`真库 ${env.MYSQL_DB}: ${rt.length} 表 / 影子库 ${SHADOW}: ${st.length} 表`);
  for (const t of ['deploy_pipelines', 'deploy_pipeline_runs', 'deploy_pipeline_vars', 'deploy_pipeline_step_commands']) {
    const row = async (c) => {
      try {
        const [r] = await c.query(`SELECT COUNT(*) n FROM \`${t}\``);
        return r[0].n;
      } catch {
        return '(不存在)';
      }
    };
    out(`  ${t.padEnd(34)} 真库=${await row(real)}  影子库=${await row(sh)}`);
  }
  await sh.end();
  await real.end();
}

async function drop() {
  const admin = await connect(env.MYSQL_DB);
  await admin.query(`DROP DATABASE IF EXISTS \`${SHADOW}\``);
  out(`🗑  已删除影子库 ${SHADOW}`);
  await admin.end();
}

const main = { create, run, status, drop }[cmd];
if (!main) {
  out('用法: node scripts/db-shadow.mjs <create|run <script>|status|drop>');
  process.exit(1);
}
main().catch((e) => {
  out('异常: ' + (e?.message || e));
  process.exit(1);
});
