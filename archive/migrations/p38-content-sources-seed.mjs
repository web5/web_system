#!/usr/bin/env node
/**
 * p38：内容采集源 seed · 对齐私域清单（2026-10-21）。
 *
 * 背景：content_sources / content_pipelines 表早已存在（TypeORM synchronize 建），
 *   但三处事实从未对齐，导致采集链路空转：
 *
 *   1) 唯一键缺失 —— migrations/0003_content_hub.sql 里定义的 `uk_content_sources_code`
 *      与 `uk_content_pipelines_code` 在 synchronize 建表时被漏掉，code 可重复，
 *      无法用 INSERT IGNORE / ON DUPLICATE KEY 做幂等 seed。
 *   2) 本地库残留 8 月旧 seed —— 10 个「纯 AI 资讯」源（hn/qbitai/wechat_* 等），
 *      零财经源，code 命名旧（hn 而非 hackernews），与私域清单不一致。
 *   3) dev 机库为空 —— 实际运行环境从没 seed 过，SchedulerService 读空表空转，
 *      采集从没真正跑起来。
 *
 * 本迁移把 content_sources / content_pipelines 对齐到私域清单
 *   （~/AiWorkspace/20-私域资产/内容运营链路-数据源与工具链.md）：
 *
 *   财经快讯  sina_news + eastmoney_news（私域 §1 财经资讯链路）
 *   每日论文  arxiv（私域 §1 每日论文链路）
 *   龙虎榜    eastmoney_lhb（content-hub p35 CQO 采集器，游资识别原料）
 *   AI 资讯   hackernews + rss（机器之心/量子位/MIT TR，rss collector 注释明示的主力源）
 *
 * ⚠️ 华尔街见闻**不进**本清单：它在私域清单 §1.1 是「WebSearch 兜底」的财经热点源，
 *   属热点看板链路，非内容采集管道。如需用 rss 采它，走 admin 加一条 rss 源即可。
 *
 * ── 幂等与安全 ──────────────────────────────────────────────────────────
 *   · 补唯一键：information_schema 守卫，重复执行不报错
 *   · 旧源硬删：仅 DELETE 硬编码的 8 月旧 code 清单（用户拍板「硬删旧源」），
 *     删除前先把被删行打印到 stderr 留痕（可据此人工恢复）
 *   · 新源 seed：INSERT ... ON DUPLICATE KEY UPDATE（同 code 覆盖为私域清单值）
 *   · 不触碰 content_items / content_publications 等既有数据
 *
 * 用法：
 *   DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... \
 *     node archive/migrations/p38-content-sources-seed.mjs
 *
 *   DRY_RUN=1  只打印将执行的 SQL，不落库
 *   EMIT_SQL=1  只打印 SQL（本机连不上目标库时 scp 到服务器执行）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';
const OFFLINE = DRY_RUN || EMIT_SQL;

/** 未显式给 env 时，退回 servers/content-hub/.env（键名 DB_HOST/DB_USERNAME/DB_PASSWORD/DB_DATABASE） */
function loadContentHubEnv() {
  const p = path.join(root, 'servers/content-hub/.env');
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

const env = loadContentHubEnv();
const cfg = {
  host: process.env.DB_HOST || env.DB_HOST,
  port: Number(process.env.DB_PORT || env.DB_PORT || 3306),
  user: process.env.DB_USER || env.DB_USERNAME,
  password: process.env.DB_PASSWORD || env.DB_PASSWORD,
  database: process.env.DB_NAME || env.DB_DATABASE,
};

/** 唯一键定义：表 → [索引名, 列] */
const UNIQUE_KEYS = {
  content_sources: ['uk_content_sources_code', 'code'],
  content_pipelines: ['uk_content_pipelines_code', 'code'],
};

/** 8 月旧 seed 的 code 清单（硬删；arxiv 不在内——私域清单同 code，走覆盖） */
const LEGACY_SOURCE_CODES = [
  'hn',
  'qbitai',
  'leiphone',
  'wechat_jiqizhixin',
  'wechat_qbitai',
  'wechat_xinzhiyuan',
  'wechat_paperweekly',
  'hnrss',
  'ahead_of_ai',
];

/** 采集源 seed：对齐私域清单。config 为 JSON 字符串。 */
const SOURCE_SEED = [
  // ── 论文（私域 §1 每日论文链路）──────────────────────────────
  ['arxiv', 'arXiv 论文', 'arxiv', '论文',
    '{"categories":"cs.AI OR cs.CL OR cs.CV OR cs.LG","max_results":10}'],
  // ── 财经快讯（私域 §1 财经资讯链路，finnews）─────────────────
  ['sina_news', '新浪财经快讯', 'sina_news', '财经', '{}'],
  ['eastmoney_news', '东方财富快讯', 'eastmoney_news', '财经', '{}'],
  // ── 龙虎榜（p35 CQO 采集器，游资识别原料）────────────────────
  ['eastmoney_lhb', '东方财富龙虎榜', 'eastmoney_lhb', '财经', '{"window_days":2}'],
  // ── AI 资讯（ai-news 管线，rss collector 注释明示的主力源）──
  ['hackernews', 'Hacker News', 'hackernews', 'AI',
    '{"query":"AI","tags":"story","hits":20}'],
  ['rss-jiqizhixin', '机器之心', 'rss', 'AI',
    '{"url":"https://www.jiqizhixin.com/rss"}'],
  ['rss-qbitai', '量子位', 'rss', 'AI',
    '{"url":"https://www.qbitai.com/feed"}'],
  ['rss-mit-tr', 'MIT Technology Review', 'rss', 'AI',
    '{"url":"https://www.technologyreview.com/feed/"}'],
];

/** 管线 seed：paper + ai-news 各一条（与本地旧 code 一致，覆盖式更新） */
const PIPELINE_SEED = [
  // code, type, title_template, cron, publish_targets(JSON), tencent_folder
  ['daily_paper', 'paper', '每日论文速览 ｜ {{date}}', '0 9 * * *',
    '["tencent_docs","wechat_mp"]', '每日论文学习'],
  ['ai_news', 'ai-news', 'AI 资讯日报 ｜ {{date}}', '0 8 * * *',
    '["wechat_mp"]', null],
];

function sqlStr(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function sqlNull(v) {
  return v === null || v === undefined ? 'NULL' : sqlStr(v);
}

function buildSql() {
  const lines = [];

  // 1) 补唯一键（information_schema 守卫，导出模式下用预处理/判断语句）
  for (const [table, [idxName, col]] of Object.entries(UNIQUE_KEYS)) {
    lines.push(
      `-- 补唯一键 ${table}.${idxName}(${col})`,
      `ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${idxName}\` (\`${col}\`);`,
    );
  }

  // 2) 硬删旧源（先打印留痕）
  lines.push(
    `-- 硬删 8 月旧 seed（留痕：删除前先 SELECT）`,
    `SELECT \`id\`, \`code\`, \`name\`, \`type\` FROM \`content_sources\` WHERE \`code\` IN (${LEGACY_SOURCE_CODES.map(sqlStr).join(', ')});`,
    `DELETE FROM \`content_sources\` WHERE \`code\` IN (${LEGACY_SOURCE_CODES.map(sqlStr).join(', ')});`,
  );

  // 3) seed 采集源（ON DUPLICATE KEY UPDATE 覆盖为私域清单值）
  const sourceValues = SOURCE_SEED.map(
    ([code, name, type, category, config]) =>
      `(${sqlStr(code)}, ${sqlStr(name)}, ${sqlStr(type)}, ${sqlNull(category)}, ${sqlNull(config)}, 1)`,
  ).join(',\n  ');
  lines.push(
    `-- seed 采集源（8 源，对齐私域清单）`,
    `INSERT INTO \`content_sources\` (\`code\`, \`name\`, \`type\`, \`category\`, \`config\`, \`enabled\`) VALUES\n  ${sourceValues}`,
    `ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`), \`type\` = VALUES(\`type\`), \`category\` = VALUES(\`category\`), \`config\` = VALUES(\`config\`), \`enabled\` = VALUES(\`enabled\`), \`deleted_at\` = NULL;`,
  );

  // 4) seed 管线
  const pipelineValues = PIPELINE_SEED.map(
    ([code, type, title, cron, targets, folder]) =>
      `(${sqlStr(code)}, ${sqlStr(type)}, ${sqlNull(title)}, ${sqlStr(cron)}, ${sqlNull(targets)}, ${sqlNull(folder)}, 1)`,
  ).join(',\n  ');
  lines.push(
    `-- seed 管线（paper + ai-news）`,
    `INSERT INTO \`content_pipelines\` (\`code\`, \`type\`, \`title_template\`, \`cron\`, \`publish_targets\`, \`tencent_folder\`, \`enabled\`) VALUES\n  ${pipelineValues}`,
    `ON DUPLICATE KEY UPDATE \`type\` = VALUES(\`type\`), \`title_template\` = VALUES(\`title_template\`), \`cron\` = VALUES(\`cron\`), \`publish_targets\` = VALUES(\`publish_targets\`), \`tencent_folder\` = VALUES(\`tencent_folder\`), \`enabled\` = VALUES(\`enabled\`), \`deleted_at\` = NULL;`,
  );

  return lines.join('\n');
}

/** 检查唯一索引是否已存在 */
async function indexExists(conn, table, idxName) {
  const [rows] = await conn.query(
    'SELECT INDEX_NAME FROM `information_schema`.`STATISTICS` ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [cfg.database, table, idxName],
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function runOnline() {
  if (!process.env.DB_HOST || !process.env.DB_NAME) {
    process.stderr.write(
      '✗ 拒绝执行：直连模式必须显式传入 DB_HOST 与 DB_NAME\n' +
        '  示例：DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... node p38...\n',
    );
    process.exit(2);
  }

  let mysql2;
  try {
    mysql2 = require('mysql2/promise');
  } catch {
    mysql2 = require(path.join(root, 'node_modules/mysql2/promise'));
  }

  const conn = await mysql2.createConnection(cfg);
  process.stderr.write(`→ 目标库 ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}\n`);

  // 1) 补唯一键
  for (const [table, [idxName]] of Object.entries(UNIQUE_KEYS)) {
    if (await indexExists(conn, table, idxName)) {
      process.stderr.write(`跳过（唯一键已存在）：${table}.${idxName}\n`);
      continue;
    }
    await conn.query(`ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${idxName}\` (\`${UNIQUE_KEYS[table][1]}\`)`);
    process.stderr.write(`✓ 补唯一键 ${table}.${idxName}\n`);
  }

  // 2) 硬删旧源（先 SELECT 留痕）
  const placeholders = LEGACY_SOURCE_CODES.map(() => '?').join(', ');
  const [legacy] = await conn.query(
    `SELECT \`id\`, \`code\`, \`name\`, \`type\` FROM \`content_sources\` WHERE \`code\` IN (${placeholders})`,
    LEGACY_SOURCE_CODES,
  );
  if (legacy.length > 0) {
    process.stderr.write('\n-- 将硬删的旧源（留痕，可据此人工恢复）--\n');
    for (const r of legacy) {
      process.stderr.write(`  id=${r.id} code=${r.code} name=${r.name} type=${r.type}\n`);
    }
    const [del] = await conn.query(
      `DELETE FROM \`content_sources\` WHERE \`code\` IN (${placeholders})`,
      LEGACY_SOURCE_CODES,
    );
    process.stderr.write(`✓ 硬删旧源 ${del.affectedRows} 条\n`);
  } else {
    process.stderr.write('跳过（无旧源需删）\n');
  }

  // 3) seed 采集源
  for (const [code, name, type, category, config] of SOURCE_SEED) {
    await conn.query(
      'INSERT INTO `content_sources` (`code`,`name`,`type`,`category`,`config`,`enabled`) VALUES (?,?,?,?,?,1) ' +
        'ON DUPLICATE KEY UPDATE `name`=VALUES(`name`),`type`=VALUES(`type`),`category`=VALUES(`category`),`config`=VALUES(`config`),`enabled`=VALUES(`enabled`),`deleted_at`=NULL',
      [code, name, type, category ?? null, config ?? null],
    );
  }
  process.stderr.write(`✓ seed 采集源 ${SOURCE_SEED.length} 条（幂等覆盖）\n`);

  // 4) seed 管线
  for (const [code, type, title, cron, targets, folder] of PIPELINE_SEED) {
    await conn.query(
      'INSERT INTO `content_pipelines` (`code`,`type`,`title_template`,`cron`,`publish_targets`,`tencent_folder`,`enabled`) VALUES (?,?,?,?,?,?,1) ' +
        'ON DUPLICATE KEY UPDATE `type`=VALUES(`type`),`title_template`=VALUES(`title_template`),`cron`=VALUES(`cron`),`publish_targets`=VALUES(`publish_targets`),`tencent_folder`=VALUES(`tencent_folder`),`enabled`=VALUES(`enabled`),`deleted_at`=NULL',
      [code, type, title ?? null, cron, targets ?? null, folder ?? null],
    );
  }
  process.stderr.write(`✓ seed 管线 ${PIPELINE_SEED.length} 条（幂等覆盖）\n`);

  // 5) 校验
  const [srcRows] = await conn.query(
    'SELECT `code`,`name`,`type`,`category`,`enabled` FROM `content_sources` WHERE `deleted_at` IS NULL ORDER BY `id`',
  );
  process.stderr.write('\n-- 校验：content_sources（非软删）--\n');
  for (const r of srcRows) {
    process.stderr.write(`  ${r.code}\t${r.name}\t${r.type}\t${r.category ?? '-'}\tenabled=${r.enabled}\n`);
  }
  const [plRows] = await conn.query(
    'SELECT `code`,`type`,`cron`,`enabled` FROM `content_pipelines` WHERE `deleted_at` IS NULL ORDER BY `id`',
  );
  process.stderr.write('\n-- 校验：content_pipelines（非软删）--\n');
  for (const r of plRows) {
    process.stderr.write(`  ${r.code}\t${r.type}\t${r.cron}\tenabled=${r.enabled}\n`);
  }

  await conn.end();
  process.stderr.write('\np38 完成：采集源与管线已对齐私域清单\n');
}

function runOffline() {
  process.stdout.write('-- p38 内容采集源 seed（对齐私域清单；目标库请在执行端显式指定）\n');
  process.stdout.write(buildSql());
  process.stdout.write('\n');
}

if (OFFLINE) {
  runOffline();
} else {
  runOnline().catch((e) => {
    process.stderr.write(`✗ p38 执行失败：${e.message}\n`);
    process.exit(1);
  });
}
