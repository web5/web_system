#!/usr/bin/env node
/**
 * p8：给 gateway 三条流水线的 release 节点补「部署生效」action（幂等，可重跑）。
 *
 * 方案 A（2026-09-17；规划见 specs/deploy-console/gateway-and-shell-versioned-release.md §3）：
 *
 * gateway 此前是「就地发布」—— 流水线的 release 节点只有两个 action：
 *   ① shell：上传产物（版本目录落盘）
 *   ② service：写版本记录（deploy_versions）
 * 跑完之后**产物只是躺在版本目录里，服务并没换**：要么人工去控制台点「部署」，
 * 要么依赖 build 阶段直接编译到 `servers/gateway/dist` 的就地副作用。
 * 后者没有版本可言 → **不可回滚**。
 *
 * 本迁移追加第三个 action：
 *   ③ service：apply-version → 平台内置 apply 步骤（版本目录 → dist + pm2 重启 + 改指针）
 * 之后 gateway 的流水线跑完即生效，且可用控制台「回滚到此版本」回退。
 *
 * 为什么只改 gateway：其他后台模块仍走就地构建 + restart（现状可用），
 * 本次按用户指定的范围先收口 gateway，验证后再推广。
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

/** 迁移脚本的输出通道（R1 红线不允许直接用 console 打印，统一走 stdout） */
const out = (s) => process.stdout.write(s + '\n');

/** 需要补 action 的模板（= gateway × 三环境） */
const TARGET_TEMPLATES = ['tpl-gateway-local', 'tpl-gateway-dev', 'tpl-gateway-prod'];
const TARGET_NODE = 'release';
const TOOL = 'apply-version';

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
  // MYSQL_DB 可被环境变量覆盖：影子库演练时走 scripts/db-shadow.mjs run（真库不受影响）
  database: process.env.MYSQL_DB || env.MYSQL_DB,
  connectTimeout: 10000,
});

let patched = 0;
let already = 0;
const missing = [];

for (const tplId of TARGET_TEMPLATES) {
  const [rows] = await conn.query(
    'SELECT id, actions FROM deploy_pipeline_step_commands WHERE template_id = ? AND node_key = ?',
    [tplId, TARGET_NODE],
  );
  if (!rows.length) {
    missing.push(`${tplId}/${TARGET_NODE}`);
    continue;
  }

  const row = rows[0];
  let actions = row.actions;
  if (typeof actions === 'string') {
    try {
      actions = JSON.parse(actions);
    } catch {
      actions = null;
    }
  }
  if (!Array.isArray(actions)) actions = [];

  if (actions.some((a) => a?.type === 'service' && a?.tool === TOOL)) {
    already += 1;
    continue;
  }

  actions.push({
    id: `a${actions.length + 1}`,
    type: 'service',
    name: '部署生效（版本目录 → dist + 重启 + 切指针）',
    tool: TOOL,
  });

  await conn.query('UPDATE deploy_pipeline_step_commands SET actions = ? WHERE id = ?', [
    JSON.stringify(actions),
    row.id,
  ]);
  out(`✅ ${tplId}/${TARGET_NODE}: actions ${actions.length - 1} → ${actions.length}（+ ${TOOL}）`);
  patched += 1;
}

await conn.end();
if (missing.length) out(`⚠️  未找到节点：${missing.join(', ')}（模板还没生成？先跑 p5 迁移）`);
out(`\np8 完成：补挂 ${patched} 条，已存在 ${already} 条（幂等，可重跑）`);
