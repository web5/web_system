#!/usr/bin/env node
/**
 * p11：旧版本指针 + 产物 → 新「按环境目录」布局（**幂等，可重跑**）。
 *
 * 双域重构迁移 **M5 + M7**（specs/deploy-console-domain-split/design.md §7）：
 *
 *   旧：`<static>/modules/<key>/<versionRef>/`            + deploy_deployments(envId, moduleKey)
 *   新：`<static>/modules/<key>/<envId>/<commit>/`         + deploy_app_env_versions(appKey, envId)
 *       `<static>/modules/<key>/<envId>/index.js`  ← 入口指针（A′ 两行，指向当前版本）
 *
 * 幂等口径（重跑零差异）：
 *   - `deploy_app_env_versions` 已有 (appKey, envId) → **跳过**（绝不覆盖人工/真实发布写入的指针）
 *   - 目标版本目录已存在 → **不重复复制**
 *   - 指针每次都按当前版本重写（发布语义：指针必须指向该 env 的当前版本）
 *
 * 只处理 `deployMode='env-dir'` 的应用：基座（shell）与小程序走 site-version，
 * **不纳入 envId 目录**（Q107）。
 *
 * 用法：
 *   node scripts/migrations/p11-app-env-artifacts.mjs
 *   DRY_RUN=1 node scripts/migrations/p11-app-env-artifacts.mjs      # 只打印计划，不落盘
 *   MYSQL_DB=web_system_deploy_shadow node scripts/migrations/p11-…   # 影子库演练
 */
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

const WORKSPACE = env.RELEASE_WORKSPACE || path.join(os.homedir(), 'web_system_release');
const MODULES_ROOT = path.join(WORKSPACE, STATIC_MODULES_REL);
const DRY_RUN = process.env.DRY_RUN === '1';

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB || env.MYSQL_DB,
  connectTimeout: 10000,
});

/** 版本引用 → 纯 commit（`default/1a2b3c4` → `1a2b3c4`；与 release-paths.toCommitId 同语义） */
function toCommitId(ref) {
  const v = String(ref ?? '').trim();
  if (!v) return undefined;
  const i = v.indexOf('/');
  return i < 0 ? v : v.slice(i + 1) || v;
}

/** 入口指针（T1 定稿 A′：命名导出 + default 双透传 —— `export *` 不透传 default） */
const pointerJs = (version) =>
  `export * from './${version}/index.js';\nexport { default } from './${version}/index.js';\n`;
const pointerCss = (version) => `@import url('./${version}/index.css');\n`;

try {
  // ① 只处理按环境目录部署的应用
  const [apps] = await conn.query(
    `SELECT \`key\`, deploy_mode FROM deploy_apps WHERE deploy_mode = 'env-dir' AND deleted_at IS NULL`,
  );
  if (!apps.length) {
    out('没有 env-dir 应用，退出');
    process.exit(0);
  }
  const appByKey = new Map(apps.map((a) => [a.key, a]));

  // ② 旧版本指针
  const [rows] = await conn.query(
    `SELECT env_id, module_key, current_version FROM deploy_deployments WHERE current_version IS NOT NULL`,
  );

  // ③ 已迁移的行（幂等跳过）
  const [done] = await conn.query(
    `SELECT app_key, env_id FROM deploy_app_env_versions`,
  );
  const doneSet = new Set(done.map((r) => `${r.app_key}@${r.env_id}`));

  const stats = { migrated: 0, skipped: 0, noSource: 0, notApp: 0 };
  const details = [];

  for (const r of rows) {
    const appKey = r.module_key;
    const envId = r.env_id;
    const versionRef = r.current_version;
    if (!appByKey.has(appKey)) {
      stats.notApp++;
      continue;
    }
    if (doneSet.has(`${appKey}@${envId}`)) {
      stats.skipped++;
      continue;
    }
    const version = toCommitId(versionRef);
    if (!version) {
      stats.noSource++;
      continue;
    }

    // 旧产物目录：引用可能带流水线命名空间（`<templateKey>/<commit>`）
    const srcDir = path.join(MODULES_ROOT, appKey, versionRef);
    const envDir = path.join(MODULES_ROOT, appKey, envId);
    const destDir = path.join(envDir, version);
    const hasSrc = fs.existsSync(path.join(srcDir, 'index.js'));

    if (!hasSrc && !fs.existsSync(path.join(destDir, 'index.js'))) {
      stats.noSource++;
      details.push(`缺少产物：${appKey}@${envId}（源 ${srcDir} 不存在，未迁移）`);
      continue;
    }

    if (!DRY_RUN) {
      // 产物目录：目标不存在才复制（幂等）
      if (hasSrc && !fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.cpSync(srcDir, destDir, { recursive: true });
      }
      // 入口指针（每次重写，保证指向当前版本）
      if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, { recursive: true });
      fs.writeFileSync(path.join(envDir, 'index.js'), pointerJs(version), 'utf-8');
      if (fs.existsSync(path.join(destDir, 'index.css'))) {
        fs.writeFileSync(path.join(envDir, 'index.css'), pointerCss(version), 'utf-8');
      }
      // 版本指针表
      await conn.query(
        `INSERT INTO deploy_app_env_versions
           (id, app_key, env_id, current_version, previous_version, status, deployed_at, deployed_by)
         VALUES (UUID(), ?, ?, ?, NULL, 'deployed', NOW(), 'migration-p11')`,
        [appKey, envId, version],
      );
    }

    stats.migrated++;
    details.push(
      `${appKey}@${envId} → ${version}${hasSrc ? '' : '（源缺失，仅写指针）'} · /static/modules/${appKey}/${envId}/index.js`,
    );
  }

  out(`p11 迁移${DRY_RUN ? '（DRY_RUN，未落盘）' : ''}：`);
  out(`  迁移 ${stats.migrated} / 已存在跳过 ${stats.skipped} / 缺产物 ${stats.noSource} / 非 env-dir 应用 ${stats.notApp}`);
  for (const d of details) out(`  - ${d}`);
  out(`  产物根：${MODULES_ROOT}`);
} finally {
  await conn.end();
}
