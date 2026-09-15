#!/usr/bin/env node
/**
 * 回填 `users.systems`（IAM 一期 · T1 的一部分）。
 *
 * 为什么单独成脚本而不是靠服务启动 seed：`systems` 是**存量数据的归属判定**，
 * 只跑一次；判定规则统一取自 `@web-system/shared` 的 `resolveUserSystems`
 * （唯一真相源），脚本里不复制任何规则，避免两端漂移。
 *
 * 特性：
 *  - 幂等：已归类（systems 非空）的用户**不动**，可重复跑；
 *  - 安全：默认 `DRY_RUN=1` 只打印不写库，确认无误后 `DRY_RUN=0` 才落库；
 *  - 先建列：列不存在时用 information_schema 判断后 ADD（MySQL 无 ADD COLUMN IF NOT EXISTS）。
 *
 * 用法（在 servers/user-service 下）：
 *   DRY_RUN=1 node scripts/migrate-user-systems.mjs          # 预演
 *   DRY_RUN=0 node scripts/migrate-user-systems.mjs          # 落库
 * 环境变量：MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB
 */
import mysql from 'mysql2/promise';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveUserSystems, normalizeSystems } = require('@web-system/shared');

const DRY = (process.env.DRY_RUN ?? '1') !== '0';

/** 脚本输出：红线禁用 console.log，统一走 stdout/stderr */
const out = (m = '') => process.stdout.write(`${m}\n`);
const errOut = (m = '') => process.stderr.write(`${m}\n`);
const cfg = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DB || 'web_system',
};

const c = await mysql.createConnection(cfg);
out(`[migrate] 目标库 ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}  DRY_RUN=${DRY ? 1 : 0}`);

// ① 列不存在则加（幂等）
const [cols] = await c.query(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='users' AND COLUMN_NAME='systems'",
  [cfg.database],
);
if (!cols.length) {
  if (DRY) {
    out('[migrate] （预演）将新增列 users.systems JSON NULL');
  } else {
    await c.query('ALTER TABLE users ADD COLUMN systems JSON NULL COMMENT "归属系统：portal/admin/deploy"');
    out('[migrate] 已新增列 users.systems');
  }
} else {
  out('[migrate] 列 users.systems 已存在，跳过建列');
}

// ② 回填：只处理 systems 为空的行（预演下列还不存在，按空值处理）
const hasColumn = cols.length > 0;
const [rows] = await c.query(
  `SELECT id, username, roles, mp_openid, oa_openid${hasColumn ? ', systems' : ''} FROM users`,
);
const plan = [];
for (const r of rows) {
  const systems = resolveUserSystems({
    systems: r.systems,
    mpOpenid: r.mp_openid,
    oaOpenid: r.oa_openid,
    username: r.username,
    roles: typeof r.roles === 'string' ? safeJson(r.roles) : r.roles,
  });
  const before = normalizeSystems(r.systems);
  const changed = JSON.stringify(before) !== JSON.stringify(systems);
  plan.push({ id: r.id, username: r.username, before, after: systems, changed });
}

const pending = plan.filter((p) => p.changed);
out(`[migrate] 用户总数 ${plan.length}，需回填 ${pending.length}`);
for (const p of pending.slice(0, 20)) {
  out(`  #${p.id} ${p.username}: ${JSON.stringify(p.before)} → ${JSON.stringify(p.after)}`);
}
if (pending.length > 20) out(`  … 其余 ${pending.length - 20} 条省略`);

if (!DRY && pending.length) {
  for (const p of pending) {
    await c.query('UPDATE users SET systems=? WHERE id=?', [JSON.stringify(p.after), p.id]);
  }
  out(`[migrate] 已回填 ${pending.length} 条`);
} else if (DRY) {
  out('[migrate] 预演结束，未写库（DRY_RUN=0 才落库）');
}

// ③ 校验（V7）：C 端（有 openid）必须只含 portal
const [bad] = await c.query(
  `SELECT id, username${hasColumn ? ', systems' : ''} FROM users WHERE (mp_openid IS NOT NULL OR oa_openid IS NOT NULL)`,
);
const leaked = bad.filter(
  (r) => !normalizeSystems(safeJson(r.systems)).every((s) => s === 'portal'),
);
out(`[migrate] 校验：C 端用户 ${bad.length} 个，越权 ${leaked.length} 个`);
if (leaked.length) {
  errOut('[migrate] ❌ 存在 C 端用户被归入非 portal 系统:', JSON.stringify(leaked));
  await c.end();
  process.exit(1);
}
out('[migrate] ✅ 校验通过');
await c.end();

function safeJson(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
