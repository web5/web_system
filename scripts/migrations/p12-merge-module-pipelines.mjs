#!/usr/bin/env node
/**
 * p12：同一模块的多条流水线**合并为一条**（环境无关）—— 幂等，可重跑。
 *
 * 背景（specs/deploy-console-domain-split/tech-design.md「流水线的环境语义」）：
 * 环境已改为**运行期参数**（用户在「环境管理」自建 envId，1/2/3…），
 * 为每个环境各建一条流水线既不可维护、也让列表出现「同模块 3 条」的噪声。
 *
 * 本脚本把 `deploy_pipelines`（= 流水线模板）按模块收敛：
 *   · 主模板：`env` 置为 **NULL**（环境无关）+ 名称去掉环境后缀 + 启用
 *   · 冗余模板：删除（含其 `deploy_pipeline_step_commands` / `deploy_pipeline_vars` 配置）
 *
 * 为什么可以删：历史执行记录在 `deploy_pipeline_runs` 里已落**模板快照**
 * （name / steps / templateKey 都是字符串），删除模板不影响历史可追溯性。
 *
 * 幂等口径：某模块只剩 1 条且 env 已为 NULL 且名称无环境后缀 → 跳过（重跑零差异）。
 *
 * 用法：
 *   DRY_RUN=1 node scripts/migrations/p12-merge-module-pipelines.mjs   # 只看计划
 *   node scripts/migrations/p12-merge-module-pipelines.mjs
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

const out = (s) => process.stdout.write(s + '\n');
const DRY_RUN = process.env.DRY_RUN === '1';

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

/** 名称里的环境后缀（如 "gateway dev 发布" → "gateway 发布"） */
const ENV_SUFFIX_RE = /\s+(local|dev|staging|prod|test)\s+发布\s*$/;
const stripEnvSuffix = (name) => String(name || '').replace(ENV_SUFFIX_RE, ' 发布');

const conn = await mysql.createConnection({
  host: env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB || env.MYSQL_DB,
  connectTimeout: 10000,
});

try {
  const [rows] = await conn.query(
    `SELECT id, module_key, env, \`key\`, name, builtin, enabled, created_at
       FROM deploy_pipelines ORDER BY module_key, created_at`,
  );

  const byModule = new Map();
  for (const r of rows) {
    const list = byModule.get(r.module_key) || [];
    list.push(r);
    byModule.set(r.module_key, list);
  }

  const stats = { kept: 0, removed: 0, skipped: 0, cleanedCommands: 0, cleanedVars: 0 };
  const details = [];

  for (const [moduleKey, list] of byModule) {
    // 主模板：优先 dev（主开发环境）→ builtin → 最早创建
    const primary =
      list.find((t) => t.env === 'dev') || list.find((t) => t.builtin) || list[0];
    const duplicates = list.filter((t) => t.id !== primary.id);

    const newName = stripEnvSuffix(primary.name);
    const needUpdate = primary.env !== null || primary.name !== newName || !primary.enabled;

    if (!needUpdate && duplicates.length === 0) {
      stats.skipped++;
      continue;
    }

    if (!DRY_RUN) {
      if (needUpdate) {
        await conn.query(
          `UPDATE deploy_pipelines SET env = NULL, name = ?, enabled = 1 WHERE id = ?`,
          [newName, primary.id],
        );
      }
      for (const dup of duplicates) {
        const [c] = await conn.query(
          `DELETE FROM deploy_pipeline_step_commands WHERE template_id = ?`,
          [dup.id],
        );
        stats.cleanedCommands += c.affectedRows || 0;
        const [v] = await conn.query(`DELETE FROM deploy_pipeline_vars WHERE pipeline_id = ?`, [
          dup.id,
        ]);
        stats.cleanedVars += v.affectedRows || 0;
        await conn.query(`DELETE FROM deploy_pipelines WHERE id = ?`, [dup.id]);
        stats.removed++;
      }
    } else {
      stats.removed += duplicates.length;
    }
    stats.kept++;
    details.push(
      `${moduleKey}：保留 ${primary.id}（env ${primary.env ?? '-'} → NULL，名「${primary.name}」→「${newName}」）` +
        (duplicates.length ? `；删除 ${duplicates.map((d) => d.id).join('、')}` : ''),
    );
  }

  out(`p12 流水线合并${DRY_RUN ? '（DRY_RUN，未落库）' : ''}：`);
  out(
    `  收敛模块 ${stats.kept} / 待删冗余 ${stats.removed} / 已合规跳过 ${stats.skipped}` +
      (DRY_RUN ? '' : `（同时清理节点命令 ${stats.cleanedCommands} 行、变量 ${stats.cleanedVars} 行）`),
  );
  for (const d of details) out(`  - ${d}`);
} finally {
  await conn.end();
}
