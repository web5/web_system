#!/usr/bin/env node
/**
 * p9：流水线两张表改名 + 备份（可回滚）。
 *
 * 语义（用户 2026-09-17 定调，详见 specs/deploy-console/pipeline-naming.md）：
 *
 *   deploy_pipeline_templates（旧·流水线定义） → deploy_pipelines        「流水线」
 *   deploy_pipelines        （旧·执行记录）     → deploy_pipeline_runs    「发布单」
 *
 * 改名后 `deploy_pipeline_templates` 这个名字**释放出来**，留给将来的「用户模板」：
 * 模板与流水线解耦 —— 从模板**复制一份**成为新的流水线，此后互不影响（见文档 §未来模板）。
 *
 * 为什么用 RENAME 而不靠 TypeORM synchronize：
 *   实体只改了 @Entity 表名，synchronize 会认为旧表"多余"并新建空表，数据留在旧表里 ——
 *   必须自己 RENAME 把数据带过去。
 *
 * 用法：
 *   node scripts/migrations/p9-rename-pipeline-tables.mjs           # 执行（先备份再改）
 *   node scripts/migrations/p9-rename-pipeline-tables.mjs --rollback # 回滚（从备份恢复）
 *
 * 前置：改名期间**停掉 deploy-console**（否则旧代码还在写旧表），改完再发布新代码并启动。
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

/** 迁移脚本的输出通道（R1 红线不允许直接用 console 打印，统一走 stdout） */
const out = (s) => process.stdout.write(s + '\n');

const ROLLBACK = process.argv.includes('--rollback');
const STAMP = fs.existsSync('/tmp/ws-p9-stamp') ? fs.readFileSync('/tmp/ws-p9-stamp', 'utf8').trim() : '';
/** 备份表后缀（回滚时用同一批备份表） */
const BAK = STAMP || '';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../../servers/deploy-console/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DB,
  connectTimeout: 10000,
});

const tableExists = async (name) => {
  const [r] = await conn.query(
    "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [name],
  );
  return r[0].n > 0;
};
const countOf = async (name) => {
  const [r] = await conn.query(`SELECT COUNT(*) n FROM \`${name}\``);
  return r[0].n;
};

// ── 回滚：把备份表换回来 ────────────────────────────────────────────
if (ROLLBACK) {
  if (!BAK) {
    out('⚠️  找不到备份标记 /tmp/ws-p9-stamp，无法回滚');
    await conn.end();
    process.exit(1);
  }
  const srcDef = `deploy_pipelines_bak_${BAK}`;
  const srcRun = `deploy_pipeline_runs_bak_${BAK}`;
  for (const [src, dst] of [
    [srcDef, 'deploy_pipelines'],
    [srcRun, 'deploy_pipeline_runs'],
  ]) {
    if (!(await tableExists(src))) {
      out(`⚠️  备份表 ${src} 不存在，跳过`);
      continue;
    }
    if (await tableExists(dst)) await conn.query(`DROP TABLE \`${dst}\``);
    await conn.query(`RENAME TABLE \`${src}\` TO \`${dst}\``);
    out(`↩️  已回滚 ${src} → ${dst}（${await countOf(dst)} 行）`);
  }
  await conn.end();
  out('\n回滚完成（记得把代码也回滚到改名之前）');
  process.exit(0);
}

// ── 正向：备份 → 改名 ───────────────────────────────────────────────
if (await tableExists('deploy_pipeline_templates')) {
  const n = await countOf('deploy_pipeline_templates');
  out(`✅ deploy_pipeline_templates：${n} 行（流水线定义）`);
} else {
  out('⚠️  deploy_pipeline_templates 不存在 —— 已改名过了？本次跳过');
  await conn.end();
  process.exit(0);
}

const stamp = String(Date.now());
fs.writeFileSync('/tmp/ws-p9-stamp', stamp);

// 1) 备份（结构 + 数据）
for (const [src, bak] of [
  ['deploy_pipeline_templates', `deploy_pipelines_bak_${stamp}`],
  ['deploy_pipelines', `deploy_pipeline_runs_bak_${stamp}`],
]) {
  await conn.query(`DROP TABLE IF EXISTS \`${bak}\``);
  await conn.query(`CREATE TABLE \`${bak}\` AS SELECT * FROM \`${src}\``);
  out(`📦 已备份 ${src} → ${bak}（${await countOf(bak)} 行）`);
}

// 2) 改名：先挪走"执行记录"，再把"定义"改名为 deploy_pipelines
await conn.query('RENAME TABLE `deploy_pipelines` TO `deploy_pipeline_runs`');
out('✅ deploy_pipelines → deploy_pipeline_runs（发布单）');
await conn.query('RENAME TABLE `deploy_pipeline_templates` TO `deploy_pipelines`');
out('✅ deploy_pipeline_templates → deploy_pipelines（流水线）');

// 3) 校验
const defN = await countOf('deploy_pipelines');
const runN = await countOf('deploy_pipeline_runs');
out(`\n校验：deploy_pipelines=${defN} 行，deploy_pipeline_runs=${runN} 行`);
out(`备份后缀：${stamp}（回滚：node scripts/migrations/p9-rename-pipeline-tables.mjs --rollback）`);

await conn.end();
