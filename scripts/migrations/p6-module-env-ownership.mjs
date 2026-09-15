const out = (...a) => process.stdout.write(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
/**
 * P6 迁移：deploy_environments 从「全局字典（多对多）」改为「归属模块（1:N）」。
 *
 * ⚠️ 原名 p5-module-env-ownership.mjs，与已合入的 `p5-pipeline-shell-approval-3env.mjs`
 *    撞了 P5 序号 → 改名 P6（2026-09-15）。
 * ⚠️ 2026-09-15 事故：本脚本会 DROP PRIMARY KEY 再重建复合主键；若中途失败，
 *    TypeORM synchronize 会起不来（6200 挂）。已做两处加固：
 *      ① 回填前跳过已存在的 (module_key, id)，使脚本可重复执行；
 *      ② M4 建复合主键失败时给出明确报错与手工修复提示（见文件末尾「回滚」注释）。
 *
 * 步骤（对齐 specs/module-env-ownership/design.md §4）：
 *   M1 加列 module_key / address / server_name / port（全部 nullable，可回滚）
 *   M2 回填：每个模块 × 每个旧环境 生成一行（address = ports[moduleKey]，server_name 取 routes）
 *   M3 旧全局行保留，module_key = '__legacy__'
 *   M4 重建主键为 (module_key, id)
 *
 * 用法：
 *   DRY_RUN=1 node scripts/migrations/p5-module-env-ownership.mjs   # 只打印 SQL，不执行
 *   node scripts/migrations/p5-module-env-ownership.mjs             # 执行
 *
 * 回滚：见设计文档 §4（删回填行 + 主键改回 id + 删列）。
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

/**
 * ⚠️ 2026-09-15 改造：原脚本用 `mysql` 命令行客户端（execSync），但本机没有装 mysql
 * （status 127：command not found）—— 脚本会直接崩在第一步，上一次就是这么留下
 * 「主键已 DROP、回填未完成」的烂摊子。改为 mysql2 直连（与 p5 迁移脚本一致），
 * 连接信息优先读 servers/deploy-console/.env。
 */
const envFile = '/Users/geekwen/workspace/web_system/servers/deploy-console/.env';
const fileEnv = fs.existsSync(envFile)
  ? Object.fromEntries(
      fs
        .readFileSync(envFile, 'utf8')
        .split('\n')
        .filter((l) => l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    )
  : {};
const DB_HOST = process.env.DB_HOST || fileEnv.MYSQL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || fileEnv.MYSQL_PORT || 3306);
const DB_USER = process.env.DB_USERNAME || fileEnv.MYSQL_USER || 'root';
const DB_PASS = process.env.DB_PASSWORD || fileEnv.MYSQL_PASSWORD || '';
const DB = process.env.DB_DATABASE || fileEnv.MYSQL_DB || 'web_system_deploy';
const DRY_RUN = process.env.DRY_RUN === '1';
const LEGACY_KEY = '__legacy__';

const conn = await mysql.createConnection({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASS,
  database: DB,
  multipleStatements: false,
});

/** 查询：返回「按行切分、每行按列切分」的二维数组（与原来 -N -B 的输出同构） */
async function q(sql) {
  const [rows] = await conn.query(sql);
  return (rows || []).map((r) => {
    const vals = Array.isArray(r) ? r : Object.values(r);
    return vals.map((c) => (c === null || c === undefined ? null : String(c)));
  });
}

async function exec(sql) {
  if (DRY_RUN) {
    out(`  [dry-run] ${sql}`);
    return;
  }
  await conn.query(sql);
}

function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// ---------- M0 前置检查 ----------
const cols = (await q(
  `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='deploy_environments'`,
)).map((r) => r[0]);
const alreadyMigrated = cols.includes('module_key') && cols.includes('address');
// 列还没加时（首次迁移 / dry-run）不能按 module_key 过滤，退化为全表计数
const legacyRows = await q(
  cols.includes('module_key')
    ? `SELECT COUNT(*) FROM deploy_environments WHERE module_key IS NULL OR module_key=''`
    : `SELECT COUNT(*) FROM deploy_environments`,
);
const legacyCount = Number(legacyRows[0]?.[0] ?? 0);

out(`库：${DB} ｜ module_key 列：${cols.includes('module_key')} ｜ 旧全局环境行：${legacyCount}`);

// ---------- M1 加列 ----------
if (!cols.includes('module_key')) {
  await exec(
    `ALTER TABLE deploy_environments ADD COLUMN module_key VARCHAR(64) NULL COMMENT '所属模块 key' AFTER id`,
  );
}
if (!cols.includes('address')) {
  await exec(
    `ALTER TABLE deploy_environments ADD COLUMN address VARCHAR(255) NULL COMMENT '服务地址（host:port 或域名）' AFTER public_url`,
  );
}
if (!cols.includes('server_name')) {
  await exec(`ALTER TABLE deploy_environments ADD COLUMN server_name VARCHAR(64) NULL COMMENT '服务器组'`);
}
if (!cols.includes('port')) {
  await exec(`ALTER TABLE deploy_environments ADD COLUMN port INT NULL COMMENT '覆盖端口'`);
}

// ---------- M2 读源数据 ----------
const modules = (await q('SELECT `key`, type FROM deploy_modules')).map((r) => ({ key: r[0], type: r[1] }));
// 同上：列不存在时（首次 / dry-run）取全表；已迁移时只取 module_key 为空的旧全局行
const legacyEnvs = (await q(
  cols.includes('module_key')
    ? `SELECT id, name, public_url, ports, builtin FROM deploy_environments WHERE module_key IS NULL OR module_key=''`
    : `SELECT id, name, public_url, ports, builtin FROM deploy_environments`,
)).map((r) => ({ id: r[0], name: r[1], publicUrl: r[2], ports: r[3], builtin: r[4] === '1' }));
const routeRows = await q('SELECT env_id, service_name, server_name, port FROM deploy_env_service_routes');
const routeMap = new Map();
for (const [envId, serviceName, serverName, port] of routeRows) {
  routeMap.set(`${envId}:${serviceName}`, { serverName, port });
}

out(`模块 ${modules.length} 个 ｜ 旧环境 ${legacyEnvs.length} 个 ｜ 路由 ${routeRows.length} 条`);

if (modules.length === 0 || legacyEnvs.length === 0) {
  out('无可回填数据（模块或旧环境为空），跳过 M2。');
} else {
  // ---------- M2 回填（需先去掉旧主键，否则同 id 多行插不进去） ----------
  const pk = (await q(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='deploy_environments' AND INDEX_NAME='PRIMARY'`,
  )).map((r) => r[0]);
  if (pk.length === 1 && pk[0] === 'id') {
    await exec('ALTER TABLE deploy_environments DROP PRIMARY KEY');
  }

  const inserts = [];
  let skipped = 0;
  for (const m of modules) {
    for (const e of legacyEnvs) {
      // 幂等：已存在该 (module_key, id) 就跳过（重跑时不会撞复合主键）
      let exists = 0;
      if (cols.includes('module_key')) {
        const dup = await q(
          `SELECT COUNT(*) c FROM deploy_environments WHERE module_key=${esc(m.key)} AND id=${esc(e.id)}`,
        );
        exists = Number(dup[0]?.[0] ?? dup[0]?.c ?? 0);
      }
      if (exists > 0) {
        skipped++;
        continue;
      }
      let address = null;
      try {
        const ports = e.ports ? JSON.parse(e.ports) : {};
        address = ports[m.key] || null;
      } catch {
        address = null;
      }
      const route = routeMap.get(`${e.id}:${m.key}`);
      inserts.push(
        `INSERT INTO deploy_environments (module_key, id, name, public_url, address, server_name, port, builtin, created_at, updated_at) ` +
          `VALUES (${esc(m.key)}, ${esc(e.id)}, ${esc(e.name)}, ${esc(e.publicUrl)}, ${esc(address)}, ` +
          `${esc(route?.serverName ?? null)}, ${esc(route?.port ?? null)}, ${e.builtin ? 1 : 0}, NOW(6), NOW(6))`,
      );
    }
  }
  out(
    `将回填 ${inserts.length} 行环境（${modules.length} 模块 × ${legacyEnvs.length} 环境）` +
      (skipped ? `，跳过已存在 ${skipped} 行（幂等）` : ''),
  );
  for (const sql of inserts) await exec(sql);

  // ---------- M3 旧行标记 legacy ----------
  await exec(
    `UPDATE deploy_environments SET module_key='${LEGACY_KEY}' WHERE module_key IS NULL OR module_key=''`,
  );
}

// ---------- M4 重建复合主键 ----------
const pk2 = (await q(
  `SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME='deploy_environments' AND INDEX_NAME='PRIMARY'`,
)).map((r) => r[0]);
if (!(pk2.length === 2 && pk2.includes('module_key') && pk2.includes('id'))) {
  if (pk2.length > 0) await exec('ALTER TABLE deploy_environments DROP PRIMARY KEY');
  try {
    await exec('ALTER TABLE deploy_environments ADD PRIMARY KEY (module_key, id)');
  } catch (e) {
    // 2026-09-15 事故：主键建不起来时表处于「无主键」状态，服务会起不来 —— 必须给出可执行的修复步骤
    const [dups] = await q(
      `SELECT module_key, id, COUNT(*) c FROM deploy_environments GROUP BY module_key, id HAVING c > 1 LIMIT 20`,
    ).length
      ? await q(`SELECT module_key, id, COUNT(*) c FROM deploy_environments GROUP BY module_key, id HAVING c > 1 LIMIT 20`)
      : [[]];
    console.error('\n[ERROR] 复合主键建立失败：', e?.sqlMessage || e?.message);
    if (dups?.length) {
      console.error('存在重复的 (module_key, id)：');
      for (const d of dups) console.error(`  module_key=${d[0]} id=${d[1]} ×${d[2]}`);
    }
    console.error(
      '修复：先删除上列重复行（保留一行），再重跑本脚本；' +
        '如需紧急恢复服务：ALTER TABLE deploy_environments ADD PRIMARY KEY (id);' +
        '（回滚数据见 /tmp/env-backup-*.json）',
    );
    await conn.end();
    process.exit(1);
  }
}

// ---------- 验证 ----------
if (DRY_RUN) {
  out('\n[dry-run] 未执行任何写操作');
  await conn.end();
  process.exit(0);
}

const verify = await q(
  'SELECT module_key, COUNT(*) FROM deploy_environments GROUP BY module_key ORDER BY module_key',
);
out('\n迁移后（模块 → 环境数）：');
for (const [mk, cnt] of verify) out(`  ${mk}: ${cnt}`);
const dup = await q(
  'SELECT module_key, id, COUNT(*) c FROM deploy_environments GROUP BY module_key, id HAVING c > 1',
);
if (dup.length > 0) {
  console.error(`\n[warn] 存在 (module_key,id) 重复：${JSON.stringify(dup)}`);
  process.exit(1);
}
out('\n完成：deploy_environments 已是 (module_key, id) 复合主键。');
