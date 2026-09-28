#!/usr/bin/env node
/**
 * p32：给 agent 定义加**意图路由线索**列（`description` / `keywords`）。
 *
 * 背景（2026-09-28）：
 *   ai-agent 的 IntentService 做意图路由时，只能拿到 agent 的 id / name —— 定义里
 *   没有「这个 agent 负责什么」的可读描述，也没有规则路由用的关键词。于是分类器的
 *   规则表与 LLM 提示词只能写死一套旧 taxonomy（translate/horoscope/tool/baike/emotion），
 *   与线上注册表（bianbian/contract-risk/deploy/study-assistant/web-system-dev）不重叠
 *   ⇒ 规则永不命中、LLM 结果被白名单丢弃、**100% 兜底**。
 *
 *   本脚本把这两个字段补进 `agent_definitions`（当前定义）+ `agent_definition_versions`
 *   （历史快照，回滚时不丢线索），并把已存在的 5 个内置 agent 回填默认线索。
 *   缺失的 `translate` / `general` 两条定义由 ai-service 启动 seed 自动补录
 *   （`agent-def.service.ts` 的 `builtinSeeds()`），本脚本不负责插入。
 *
 * 幂等性：information_schema 守卫加列；回填只在 `description IS NULL OR description=''`
 * 时进行（运营在 admin 改过的值不会被覆盖）。可重复执行，重复跑全部跳过。
 *
 * 用法：
 *   DB_HOST=... DB_PORT=3306 DB_USER=root DB_PASSWORD=... DB_NAME=web_system \
 *     node scripts/migrations/p32-agent-def-routing-hints.mjs
 *
 *   DRY_RUN=1    只打印将执行的 SQL
 *   EMIT_SQL=1   只打印 SQL（本机连不上内网库时 scp 到服务器执行）
 *
 * 回滚（无破坏需求时不必执行）：
 *   ALTER TABLE agent_definitions DROP COLUMN description, DROP COLUMN keywords;
 *   ALTER TABLE agent_definition_versions DROP COLUMN description, DROP COLUMN keywords;
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

function loadConsoleEnv() {
  const p = path.join(root, 'servers/deploy-console/.env');
  if (!fs.existsSync(p)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
}

const consoleEnv = loadConsoleEnv();
const cfg = {
  host: process.env.DB_HOST || consoleEnv.DB_HOST,
  port: Number(process.env.DB_PORT || consoleEnv.DB_PORT || 3306),
  user: process.env.DB_USER || consoleEnv.DB_USER,
  password: process.env.DB_PASSWORD || consoleEnv.DB_PASSWORD,
  database: process.env.DB_NAME || consoleEnv.DB_NAME,
};

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';

/** 内置 agent 的默认路由线索（与 ai-service builtinSeeds() 保持一致） */
const DEFAULTS = [
  {
    id: 'contract-risk',
    description: '识别合同条款里的风险与可主张权益，输出带真实数字的体检报告',
    keywords: ['合同', '协议', '条款', '风险', '违约', '违约金', '分期', '贷款利率', '签字', '体检'],
  },
  {
    id: 'study-assistant',
    description: '面向少儿的知识答疑与学习辅导，可以用画图辅助讲解',
    keywords: ['学习', '作业', '辅导', '小朋友', '为什么', '怎么算'],
  },
  {
    id: 'bianbian',
    description: '把脑海里的角色、场景、变身效果画成图片（AI 绘画 / 生图）',
    keywords: ['画画', '画一张', '画个', '生图', '生成图片', '配图', '插画', '变变', '变身'],
  },
  {
    id: 'deploy',
    description: '把微前端模块/后端服务发布到指定环境，支持灰度、回滚、流水线状态查询',
    keywords: ['发布', '上线', '灰度', '回滚', '流水线', '部署', 'deploy', 'rollback'],
  },
  {
    id: 'web-system-dev',
    description: '检索 web_system 仓库工程知识（架构/服务/路由/表/Agent 平台/研发规范）回答研发问题',
    keywords: ['web_system', '仓库', '架构', '接口', '这张表', '服务怎么', '研发规范', '源码'],
  },
  {
    id: 'translate',
    description: '多语种互译与润色，输出推荐译文 / 直译对照 / 委婉版 / 语气要点四段',
    keywords: ['翻译', '译成', '翻成', '英文怎么说', '用英语', '润色', 'translation'],
  },
  {
    id: 'general',
    description: '日常提问、闲聊与通用知识问答的兜底助手；需要实时信息时用联网搜索',
    keywords: [],
  },
];

const COLUMNS = [
  { name: 'description', ddl: "ADD COLUMN `description` varchar(500) DEFAULT NULL COMMENT '用途说明（意图路由线索）'" },
  { name: 'keywords', ddl: "ADD COLUMN `keywords` json DEFAULT NULL COMMENT '路由关键词数组'" },
];

const TABLES = ['agent_definitions', 'agent_definition_versions'];

function q(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [cfg.database, table, column],
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [cfg.database, table],
  );
  return rows.length > 0;
}

async function main() {
  const steps = [];

  for (const table of TABLES) {
    for (const col of COLUMNS) {
      steps.push({
        kind: 'add-column',
        table,
        name: col.name,
        sql: `ALTER TABLE \`${table}\` ${col.ddl}`,
      });
    }
  }

  for (const d of DEFAULTS) {
    steps.push({
      kind: 'backfill',
      table: 'agent_definitions',
      name: `${d.id}.description`,
      sql:
        `UPDATE \`agent_definitions\` SET \`description\` = ${q(d.description)}, ` +
        `\`keywords\` = ${q(JSON.stringify(d.keywords))} ` +
        `WHERE \`id\` = ${q(d.id)} AND (\`description\` IS NULL OR \`description\` = '')`,
    });
  }

  if (EMIT_SQL || DRY_RUN) {
    process.stderr.write(`-- p32 agent 定义路由线索：${steps.length} 步\n`);
    for (const s of steps) process.stdout.write(`${s.sql};\n`);
    if (DRY_RUN) process.stderr.write('-- DRY_RUN：以上 SQL 未执行\n');
    return;
  }

  let mysql2;
  try {
    mysql2 = require('mysql2/promise');
  } catch {
    try {
      mysql2 = require(path.join(root, 'node_modules/mysql2/promise'));
    } catch {
      throw new Error('缺少 mysql2 依赖：请先 npm i mysql2，或用 EMIT_SQL=1 导出 SQL 到服务器执行');
    }
  }

  const conn = await mysql2.createConnection(cfg);
  let executed = 0;
  let skipped = 0;

  for (const step of steps) {
    if (step.kind === 'add-column') {
      if (!(await tableExists(conn, step.table))) {
        process.stderr.write(`跳过：表 ${step.table} 不存在\n`);
        skipped++;
        continue;
      }
      if (await columnExists(conn, step.table, step.name)) {
        process.stderr.write(`跳过：${step.table}.${step.name} 已存在\n`);
        skipped++;
        continue;
      }
    }
    const [res] = await conn.query(step.sql);
    const affected = typeof res?.affectedRows === 'number' ? ` rows=${res.affectedRows}` : '';
    process.stderr.write(`执行：${step.table} ${step.name}${affected}\n`);
    executed++;
  }

  await conn.end();
  process.stderr.write(`\np32 完成：执行 ${executed} 步，跳过 ${skipped} 步\n`);
}

main().catch((e) => {
  process.stderr.write(`p32 失败: ${e.message}\n`);
  process.exit(1);
});
