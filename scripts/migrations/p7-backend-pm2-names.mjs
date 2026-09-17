#!/usr/bin/env node
/**
 * p7：修正后台模块的 pm2 进程名（幂等，可重跑）。
 *
 * 背景（2026-09-17 巡检发现）：`deploy_modules.pm2` 与 pm2 里的**真实进程名**普遍不一致 ——
 * 注册表写 `gateway` / `user-service` / `auth-service`，而 pm2 里实际是
 * `web-gateway` / `web-user` / `web-auth`。
 *
 * 影响：`restartPm2()` 的候选链是 `[mod.pm2, web-<moduleKey>, moduleKey]`，
 *   · gateway → 第一个候选 `gateway` 失败，**第二个** `web-gateway` 命中（侥幸可用，但日志有噪音）
 *   · user-service → 候选是 `user-service` / `web-user-service` / `user-service`，
 *     而真实进程叫 `web-user` → **三个都落空**，重启静默失败（只 warn），发布"成功"但服务没起来
 *
 * 本迁移按「pm2 实际进程名」对齐注册表；映射来源：`pm2 jlist`。
 */
import mysql from 'mysql2/promise';
import fs from 'fs';

/** 模块 key → pm2 真实进程名（只列需要修正的 backend 模块） */
const PM2_NAMES = {
  gateway: 'web-gateway',
  'auth-service': 'web-auth',
  'system-service': 'web-system',
  'user-service': 'web-user',
  'ai-service': 'web-ai',
  'todo-service': 'web-todo',
  'upload-service': 'web-upload',
  'mcp-gateway': 'web-mcp-gateway',
  'content-hub': 'web-content-hub',
  'knowledge-service': 'web-knowledge',
  'ai-agent': 'web-ai-agent',
  'deploy-console': 'web-deploy-console',
};

/** 迁移脚本的输出通道（R1 红线不允许直接用 console 打印，统一走 stdout） */
const out = (s) => process.stdout.write(s + '\n');

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

let changed = 0;
let skipped = 0;
for (const [key, pm2] of Object.entries(PM2_NAMES)) {
  const [rows] = await conn.query('SELECT pm2 FROM deploy_modules WHERE `key` = ?', [key]);
  if (!rows.length) {
    out(`⚠️  跳过 ${key}：模块不存在`);
    continue;
  }
  if (rows[0].pm2 === pm2) {
    skipped += 1;
    continue;
  }
  const before = rows[0].pm2 || '(空)';
  await conn.query('UPDATE deploy_modules SET pm2 = ? WHERE `key` = ?', [pm2, key]);
  out(`✅ ${key}: ${before} → ${pm2}`);
  changed += 1;
}

await conn.end();
out(`\np7 完成：修正 ${changed} 项，已正确 ${skipped} 项（幂等，可重跑）`);
