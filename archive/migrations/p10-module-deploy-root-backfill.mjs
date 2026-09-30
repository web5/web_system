#!/usr/bin/env node
/**
 * p10：回填 `deploy_modules.deploy_root` / `default_artifact_path`（幂等，可重跑）。
 *
 * M1（specs/deploy-console/artifact-path-and-deploy-model.md，2026-09-17）：
 * 部署位置成为**模块的自有属性** ——
 *   · 后台：`servers/<dir>`，默认产物 `dist/`（部署 = 落地到 <deployRoot>/dist + 重启）
 *   · 前端类：`<gateway 静态根>/<publicPath>`，无需默认产物（部署 = 切指针）
 *
 * 列的创建由 TypeORM synchronize 完成（本机开发/运维工具 `synchronize: true`），
 * 本脚本**只做数据回填**；已填过的行不覆盖（`WHERE deploy_root IS NULL`）。
 *
 * 用法：
 *   node scripts/migrations/p10-module-deploy-root-backfill.mjs
 *   MYSQL_DB=web_system_deploy_shadow node scripts/migrations/p10-…   # 影子库演练
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

/** 输出通道（R1 红线不允许直接用 console 打印，统一走 stdout） */
const out = (s) => process.stdout.write(s + '\n');

/** gateway 静态产物根（与 release-paths.ts 的 STATIC_MODULES_REL 一致） */
const STATIC_MODULES_REL = 'servers/gateway/public/static/modules';

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
  database: process.env.MYSQL_DB || env.MYSQL_DB,
  connectTimeout: 10000,
});

/** 推导部署根：后台 = servers/<dir>；前端类 = gateway 静态根/<publicPath||key> */
function deployRootOf(row) {
  if (row.type === 'backend') {
    return { root: `servers/${row.dir || row.key}`, artifact: 'dist/' };
  }
  return { root: `${STATIC_MODULES_REL}/${row.publicPath || row.key}`, artifact: null };
}

/**
 * 保证列存在。
 *
 * 不能依赖 TypeORM synchronize：① 生产环境通常关闭它；② 迁移应当能**先于应用启动**独立执行。
 * 这里按实体定义补齐两列（与 deploy-module.entity.ts 保持一致）。
 */
async function ensureColumns() {
  const [cols] = await conn.query(
    'SELECT column_name AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
    ['deploy_modules'],
  );
  const has = new Set(cols.map((c) => c.n));
  if (!has.has('deploy_root')) {
    await conn.query(
      "ALTER TABLE deploy_modules ADD COLUMN deploy_root VARCHAR(255) NULL COMMENT '部署根路径（相对发布目录根）'",
    );
    out('➕ 已加列 deploy_root');
  }
  if (!has.has('default_artifact_path')) {
    await conn.query(
      "ALTER TABLE deploy_modules ADD COLUMN default_artifact_path VARCHAR(255) NULL COMMENT '默认产物路径（相对版本目录）'",
    );
    out('➕ 已加列 default_artifact_path');
  }
}
await ensureColumns();

const [rows] = await conn.query(
  'SELECT `key`, type, dir, public_path AS publicPath, deploy_root AS deployRoot FROM deploy_modules',
);

let filled = 0;
let skipped = 0;
for (const r of rows) {
  if (r.deployRoot) {
    skipped += 1;
    continue;
  }
  const { root, artifact } = deployRootOf(r);
  await conn.query(
    'UPDATE deploy_modules SET deploy_root = ?, default_artifact_path = ? WHERE `key` = ?',
    [root, artifact, r.key],
  );
  out(`✅ ${r.key.padEnd(18)} ${root}${artifact ? `  (默认产物 ${artifact})` : ''}`);
  filled += 1;
}

await conn.end();
out(`\np10 完成：回填 ${filled} 行，已有值跳过 ${skipped} 行（幂等，可重跑）`);
