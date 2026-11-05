#!/usr/bin/env node
/**
 * p41：给所有走「apply-runtime」远程生效的 backend 发布流水线，在 apply-runtime 之前
 *     插入「下发配置」service action（dispatch-config），弥补 #8493 缺口。
 *
 * 背景（2026-11-05 实测）：发布流水线的 release 阶段走 `shell 工具 apply-runtime`（activate），
 * 绕过了「部署生效」路径 deployVersion → applyBackendRemote，而配置下发（写远端 `.env.generated`）
 * 原先只挂在 applyBackendRemote 里 —— 于是经发布流水线发版的场景，配置中心的下发内容
 * 永远到不了目标机（prod gateway 发版后 `.env.generated` 不存在）。
 *
 * 修法：新增内置 service action `dispatch-config`（代码侧 DispatchConfigExecutor），
 * 本迁移把它插到每条含 apply-runtime 的 release 节点的 apply-runtime 之前。
 * 对无 config_items 记录的模块，executor 内部天然 no-op（204 语义），不改变现状。
 *
 * 幂等：已含 dispatch-config 的节点跳过，可重跑。
 */
import mysql from 'mysql2/promise';

/** 迁移脚本的输出通道（R1 红线不允许直接用 console 打印，统一走 stdout） */
const out = (s) => process.stdout.write(s + '\n');

const TARGET_NODE = 'release';
const BEFORE_TOOL = 'apply-runtime';
const INSERT_TOOL = 'dispatch-config';

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DB,
  connectTimeout: 10000,
});

// 只处理「release 节点且 actions 含 apply-runtime」的发布单（= 走远程生效的 backend 模块）
const [rows] = await conn.query(
  `SELECT id, template_id, actions FROM deploy_pipeline_step_commands
   WHERE node_key = ? AND actions LIKE ?`,
  [TARGET_NODE, `%${BEFORE_TOOL}%`],
);

let patched = 0;
let already = 0;

for (const row of rows) {
  let actions = row.actions;
  if (typeof actions === 'string') {
    try {
      actions = JSON.parse(actions);
    } catch {
      actions = null;
    }
  }
  if (!Array.isArray(actions)) {
    out(`⚠️  ${row.template_id}/${TARGET_NODE}: actions 非数组，跳过`);
    continue;
  }

  // 幂等：已插入过 dispatch-config 就跳过
  if (actions.some((a) => a?.type === 'service' && a?.tool === INSERT_TOOL)) {
    already += 1;
    continue;
  }

  const applyIdx = actions.findIndex((a) => a?.type === 'service' && a?.tool === BEFORE_TOOL);
  if (applyIdx === -1) {
    out(`⚠️  ${row.template_id}/${TARGET_NODE}: 未定位到 ${BEFORE_TOOL}，跳过`);
    continue;
  }

  actions.splice(applyIdx, 0, {
    id: `act-release-dispatch-config`,
    code: '',
    name: '下发配置（渲染配置中心 → 目标机 .env.generated）',
    tool: INSERT_TOOL,
    type: 'service',
  });

  await conn.query('UPDATE deploy_pipeline_step_commands SET actions = ? WHERE id = ?', [
    JSON.stringify(actions),
    row.id,
  ]);
  out(`✅ ${row.template_id}/${TARGET_NODE}: 在 ${BEFORE_TOOL} 前插入 ${INSERT_TOOL}（actions ${actions.length - 1} → ${actions.length}）`);
  patched += 1;
}

await conn.end();
out(`\np41 完成：补挂 ${patched} 条，已存在 ${already} 条（幂等，可重跑）`);
