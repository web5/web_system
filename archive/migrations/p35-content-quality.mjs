#!/usr/bin/env node
/**
 * p35：内容质量工程（项目代号 CQO）· 数据底座（2026-10-14）。
 *
 * 背景：三条内容链路（arXiv / 新浪+东财快讯 / 龙虎榜）已跑通，但「跑得好不好没法证明」——
 *  出了问题只能翻服务器日志。本迁移把「可归因」的地基建起来：
 *
 *  1) `content_items` 补 6 个列：5 个质量字段 + `meta`（源私有字段）
 *     ⚠️ `meta` 必须一并补：`ContentItemEntity.meta`（json）随本工程新增，
 *        而它在旧库上**并不存在** —— 只加 5 个质量列会在运行时报 Unknown column，
 *        详情页「原始 payload」与 Phase 2 的 prompt_version 抽样也无从落地。
 *  2) `lhb_records`       龙虎榜原始快照（结构化数值 + 席位明细）
 *  3) `hotmoney_seats`游资营业部名单（规则表，不硬编码——席位会迁址）
 *  4) `collect_runs`      采集批次日志（`content_items` 记条目，这里记批次）
 *
 * 全部为**新增 / 加可空列**，不删不改任何既有数据，回滚 = DROP 新表 + DROP 新列（见文件末尾）。
 *
 * ⚠️ v1.0 方案文档曾把本脚本写成 `scripts/migrations/pNN-*`，该目录**不存在**：
 *    仓库迁移真相源是 `archive/migrations/`（本脚本前序为 p34）。照 v1.0 写会造出第二真相源。
 *
 * ── 枚举定稿（v1.0 两处文档口径不一致，此处为准） ────────────────────────
 *   quality_status: ok | partial | fail | skip
 *     skip 有真实语义 —— SimHash 去重命中时不是「失败」也不是「成功」，是「跳过」。
 *   quality_stage:  collect | dedup | llm | fallback | publish
 *     fallback 为 v2.0 新增。降级脚本（scripts/mcp-fallback/paper-fallback-publish.sh）
 *     产出的摘要是**模板化**的，若不单独标记，会被 Phase 1.4 的成功率统计算成「正常」，
 *     并在 Phase 2 评测中拉低幻觉率（模板没内容，自然没幻觉）。
 *
 * ── 规范性约束（项目红线） ──────────────────────────────────────────────
 *   · information_schema 幂等守卫，重复执行不报错
 *   · EMIT_SQL=1 可导出 SQL（本机连不上内网库时 scp 到服务器执行）
 *   · 时间列统一 datetime(3)，显式 precision，避免 TypeORM 高精度冲突
 *   · **不写 COLLATE**（utf8mb4_0900_ai_ci 仅 MySQL 8，5.7 环境建表会失败）
 *   · 全部新列 nullable + 新表 IF NOT EXISTS，不触碰既有数据
 *
 * 用法：
 *   # 直连（推荐，走 information_schema 守卫）
 *   DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... \
 *     node archive/migrations/p35-content-quality.mjs
 *
 *   # 本机连不到目标库 → 导出 SQL 后在目标库执行
 *   EMIT_SQL=1 node archive/migrations/p35-content-quality.mjs > p35.sql
 *
 *   DRY_RUN=1   只打印将执行的 SQL，不落库
 *   EMIT_SQL=1  只打印 SQL（本机连不上内网库时 scp 到服务器执行）
 *
 * 回滚（DDL 不支持事务，须逐条执行；均为纯新增，删除不影响任何既有功能）：
 *   ALTER TABLE `content_items`
 *     DROP COLUMN `quality_status`, DROP COLUMN `quality_stage`,
 *     DROP COLUMN `quality_issue`, DROP COLUMN `collect_duration_ms`,
 *     DROP COLUMN `raw_hash`, DROP COLUMN `meta`;
 *   DROP TABLE IF EXISTS `collect_runs`;
 *   DROP TABLE IF EXISTS `hotmoney_seats`;
 *   DROP TABLE IF EXISTS `lhb_records`;
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';
const OFFLINE = DRY_RUN || EMIT_SQL;

/** 未显式给 env 时，退回 servers/deploy-console/.env（与 p28/p29/p34 同口径） */
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

/** content_items 待新增的列：列名 → DDL 片段（5 个质量字段 + 采集器 meta） */
const CONTENT_ITEM_COLUMNS = {
  meta: {
    ddl: "json NULL COMMENT '源私有字段（采集器 meta）'",
    desc: '采集器塞入的源私有字段（论文四字段 / 龙虎榜数值 / prompt_version…）',
  },
  quality_status: {
    ddl: "varchar(16) NULL COMMENT 'ok/partial/fail/skip'",
    desc: '质量结论：ok 完整 / partial 部分成功 / fail 失败 / skip 去重跳过',
  },
  quality_stage: {
    ddl: "varchar(16) NULL COMMENT 'collect/dedup/llm/fallback/publish'",
    desc: '归因阶段：卡在哪一步（fallback = 走降级通道产出，v2.0 新增）',
  },
  quality_issue: {
    ddl: "varchar(255) NULL COMMENT '归因标签式描述（如 LLM 超时）'",
    desc: '归因标签（非错误原文；错误原文写 content_items.error）',
  },
  collect_duration_ms: {
    ddl: 'int NULL COMMENT \'采集耗时（毫秒）\'',
    desc: '单条采集耗时，慢源诊断',
  },
  raw_hash: {
    ddl: "varchar(64) NULL COMMENT '原始正文指纹，供内容变更检测'",
    desc: '原文指纹，检测源侧内容是否变更过',
  },
};

/** 新建表 DDL（均为纯新增，可重复执行） */
const TABLES = {
  lhb_records: `CREATE TABLE IF NOT EXISTS \`lhb_records\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`trade_date\` date NOT NULL COMMENT '交易日',
  \`stock_code\` varchar(16) NOT NULL COMMENT '股票代码',
  \`stock_name\` varchar(64) NOT NULL COMMENT '股票名称',
  \`reason\` varchar(255) NULL COMMENT '上榜原因',
  \`buy_amount\` decimal(18,2) NULL COMMENT '买入额',
  \`sell_amount\` decimal(18,2) NULL COMMENT '卖出额',
  \`net_amount\` decimal(18,2) NULL COMMENT '净额',
  \`turnover_rate\` decimal(8,4) NULL COMMENT '换手率',
  \`is_st\` tinyint NOT NULL DEFAULT 0 COMMENT '是否 ST',
  \`limit_up\` tinyint NOT NULL DEFAULT 0 COMMENT '是否涨停',
  \`seats\` json NULL COMMENT '席位明细数组 [{name,buy,sell,type}]',
  \`tags\` json NULL COMMENT 'hotmoney/institution/retail 资金性质标记',
  \`source_id\` bigint NULL COMMENT '关联 content_sources.id',
  \`item_id\` bigint NULL COMMENT '关联 content_items.id（原始快照与统一条目）',
  \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_lhb_date_code\` (\`trade_date\`, \`stock_code\`, \`reason\`),
  KEY \`idx_lhb_date\` (\`trade_date\`),
  KEY \`idx_lhb_item\` (\`item_id\`)
) ENGINE=InnoDB COMMENT='龙虎榜原始快照（结构化数值 + 席位明细）'`,

  hotmoney_seats: `CREATE TABLE IF NOT EXISTS \`hotmoney_seats\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`seat_name\` varchar(128) NOT NULL COMMENT '营业部全称',
  \`alias\` varchar(64) NULL COMMENT '常用简称，如章盟主',
  \`tag\` varchar(32) NOT NULL DEFAULT 'hotmoney' COMMENT '资金性质标记',
  \`is_active\` tinyint NOT NULL DEFAULT 1 COMMENT '是否启用（席位迁址后可下线）',
  \`note\` varchar(255) NULL COMMENT '备注',
  \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_seat_name\` (\`seat_name\`),
  KEY \`idx_seat_active\` (\`is_active\`)
) ENGINE=InnoDB COMMENT='游资营业部名单（规则表，不硬编码——席位归属会随迁址变化）'`,

  collect_runs: `CREATE TABLE IF NOT EXISTS \`collect_runs\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`source_code\` varchar(32) NOT NULL COMMENT '采集器 code（ICollector.code）',
  \`source_name\` varchar(64) NULL COMMENT '来源展示名',
  \`trigger_type\` varchar(16) NOT NULL DEFAULT 'schedule' COMMENT 'schedule/manual',
  \`status\` varchar(16) NOT NULL COMMENT 'ok/failed',
  \`item_count\` int NOT NULL DEFAULT 0 COMMENT '采集条数',
  \`dedup_count\` int NOT NULL DEFAULT 0 COMMENT '去重跳过条数',
  \`fail_count\` int NOT NULL DEFAULT 0 COMMENT '失败条数',
  \`duration_ms\` int NULL COMMENT '本批次总耗时',
  \`error_message\` text NULL COMMENT '错误原文（技术错误，非归因标签）',
  \`started_at\` datetime(3) NOT NULL COMMENT '批次开始时间',
  \`finished_at\` datetime(3) NOT NULL COMMENT '批次结束时间',
  \`created_at\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  KEY \`idx_runs_source_time\` (\`source_code\`, \`started_at\`),
  KEY \`idx_runs_status_time\` (\`status\`, \`started_at\`)
) ENGINE=InnoDB COMMENT='采集批次日志（与 content_items 的条目级归因互补：这里记批次成败）'`,
};

/** 游资名单初始种子（幂等插入：靠 uk_seat_name 去重，INSERT IGNORE） */
const SEAT_SEED = [
  ['华鑫证券有限责任公司上海分公司', '章盟主系', 'hotmoney'],
  ['国泰君安证券股份有限公司上海江苏路', '炒股养家', 'hotmoney'],
  ['银河证券股份有限公司绍兴证券营业部', '绍兴帮', 'hotmoney'],
  ['中国银河证券股份有限公司北京金融街', '北京帮', 'hotmoney'],
  ['东方财富证券股份有限公司拉萨团结路第二', '拉萨天团', 'hotmoney'],
  ['东方财富证券股份有限公司拉萨东环路第二', '拉萨天团', 'hotmoney'],
  ['东方财富证券股份有限公司拉萨团结路第一', '拉萨天团', 'hotmoney'],
  ['中信证券股份有限公司上海溧阳路', '溧阳路传奇', 'hotmoney'],
  ['华泰证券股份有限公司深圳益田路荣超商务中心', '深圳帮', 'hotmoney'],
  ['招商证券股份有限公司深圳蛇口工业七路', '深圳帮', 'hotmoney'],
  ['国信证券股份有限公司深圳泰然九路', '深圳帮', 'hotmoney'],
  ['广发证券股份有限公司佛山平湖大道', '佛山无影脚', 'hotmoney'],
  ['国盛证券有限责任公司宁波桑田路', '宁波桑田路', 'hotmoney'],
  ['方正证券股份有限公司杭州萧山市心中路', '杭州系', 'hotmoney'],
  ['财通证券股份有限公司杭州体育场路', '杭州系', 'hotmoney'],
  ['机构专用', null, 'institution'],
  ['沪股通专用', null, 'institution'],
  ['深股通专用', null, 'institution'],
];

function buildSeedSql() {
  // is_active 必须显式给值：一旦写进 INSERT 的列清单，MySQL 就**不再套用 DDL 默认值**
  // —— earlier 只给 3 个值而列清单有 4 列，执行时报 ERROR 1136（导出 SQL 时看不出来）。
  const values = SEAT_SEED.map(
    ([name, alias, tag]) =>
      `(${sqlStr(name)}, ${alias ? sqlStr(alias) : 'NULL'}, ${sqlStr(tag)}, 1)`,
  ).join(',\n  ');
  return (
    'INSERT IGNORE INTO `hotmoney_seats` (`seat_name`, `alias`, `tag`, `is_active`) VALUES\n  ' +
    values +
    ';'
  );
}

function sqlStr(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** 检查列是否已存在（幂等守卫核心） */
async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM `information_schema`.`COLUMNS` ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [cfg.database, table, column],
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** 检查表是否已存在 */
async function tableExists(conn, table) {
  const [rows] = await conn.query(
    'SELECT TABLE_NAME FROM `information_schema`.`TABLES` WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [cfg.database, table],
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** 事务内不执行 DDL（MySQL DDL 隐式提交），故 DDL 分批、每批独立校验 */
async function runOnline() {
  if (!process.env.DB_HOST || !process.env.DB_NAME) {
    process.stderr.write(
      '✗ 拒绝执行：直连模式必须显式传入 DB_HOST 与 DB_NAME\n' +
        '  示例：DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... node p35...\n' +
        '  本机连不到目标库时改用 EMIT_SQL=1 导出 SQL。\n',
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

  let created = 0;
  let skipped = 0;

  // 1) 建三张新表
  for (const [name, ddl] of Object.entries(TABLES)) {
    if (await tableExists(conn, name)) {
      process.stderr.write(`跳过（表已存在）：${name}\n`);
      skipped++;
      continue;
    }
    await conn.query(ddl);
    process.stderr.write(`✓ 建表 ${name}\n`);
    created++;
  }

  // 2) content_items 加列（逐列独立守卫，任一列已存在不影响其余）
  for (const [col, spec] of Object.entries(CONTENT_ITEM_COLUMNS)) {
    if (await columnExists(conn, 'content_items', col)) {
      process.stderr.write(`跳过（列已存在）：content_items.${col}\n`);
      skipped++;
      continue;
    }
    await conn.query(`ALTER TABLE \`content_items\` ADD COLUMN \`${col}\` ${spec.ddl}`);
    process.stderr.write(`✓ 加列 content_items.${col}\n`);
    created++;
  }

  // 3) 游资名单种子（INSERT IGNORE，靠 uk_seat_name 去重）
  const [seedRes] = await conn.query(buildSeedSql());
  const seeded = typeof seedRes?.affectedRows === 'number' ? seedRes.affectedRows : 0;
  process.stderr.write(
    seeded > 0
      ? `✓ 游资名单种子写入 ${seeded} 条（已存在的自动跳过）\n`
      : '跳过（游资名单已齐备）\n',
  );

  // 4) 校验
  process.stderr.write('\n-- 校验：content_items 质量列 --\n');
  const [cols] = await conn.query(
    "SELECT COLUMN_NAME, COLUMN_TYPE FROM `information_schema`.`COLUMNS` " +
      "WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'content_items' " +
      "AND COLUMN_NAME IN ('quality_status','quality_stage','quality_issue','collect_duration_ms','raw_hash','meta')",
    [cfg.database],
  );
  for (const c of cols) process.stderr.write(`${c.COLUMN_NAME}\t${c.COLUMN_TYPE}\n`);
  if (cols.length !== Object.keys(CONTENT_ITEM_COLUMNS).length) {
    process.stderr.write(
      `✗ 校验失败：应有 ${Object.keys(CONTENT_ITEM_COLUMNS).length} 列，实有 ${cols.length} 列\n`,
    );
    await conn.end();
    process.exit(1);
  }

  process.stderr.write('\n-- 校验：新表 --\n');
  for (const name of Object.keys(TABLES)) {
    const exists = await tableExists(conn, name);
    process.stderr.write(`${name}\t${exists ? 'OK' : 'MISSING'}\n`);
    if (!exists) {
      await conn.end();
      process.exit(1);
    }
  }

  await conn.end();
  process.stderr.write(`\np35 完成：新增 ${created} 项，跳过 ${skipped} 项\n`);
}

function runOffline() {
  process.stderr.write('-- p35 内容质量工程·数据底座（目标库请在执行端显式指定）\n');

  for (const [name, ddl] of Object.entries(TABLES)) {
    process.stdout.write(`${ddl};\n`);
    process.stderr.write(`-- 步骤：建表 ${name}\n`);
  }

  // content_items 逐列加列 —— information_schema 守卫 + PREPARE 动态执行。
  //
  // 为什么不用一条 ALTER 带 6 个 ADD COLUMN：MySQL 的 ALTER **没有** IF NOT EXISTS，
  // 多列合一条时只要有一列已存在就整条报 duplicate column，
  // 也就是导出 SQL 没法重复执行、必须预先知道库处在哪个版本。
  // 在线模式本来就逐列守卫，导出路径这里补齐同样的语义。
  for (const [col, spec] of Object.entries(CONTENT_ITEM_COLUMNS)) {
    const addSql = `ALTER TABLE \`content_items\` ADD COLUMN \`${col}\` ${spec.ddl}`.replace(/'/g, "''");
    process.stdout.write(
      `SET @p35_ddl := (SELECT IF(\n` +
        `  EXISTS(\n` +
        `    SELECT 1 FROM information_schema.COLUMNS\n` +
        `    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_items' AND COLUMN_NAME = '${col}'\n` +
        `  ),\n` +
        `  'SELECT ''skip content_items.${col}（已存在）'' AS p35',\n` +
        `  '${addSql}'\n` +
        `));\n` +
        `PREPARE p35_stmt FROM @p35_ddl; EXECUTE p35_stmt; DEALLOCATE PREPARE p35_stmt;\n`,
    );
  }
  process.stderr.write('-- 步骤：content_items 加 6 个列（5 质量列 + meta，逐列守卫可重复执行）\n');

  process.stdout.write(`${buildSeedSql()}\n`);
  process.stderr.write('-- 步骤：游资名单种子（INSERT IGNORE，重复执行安全）\n');

  process.stderr.write(
    '-- 校验：SELECT source_name, quality_status, quality_stage, COUNT(*) FROM content_items GROUP BY 1,2,3;\n' +
      '-- 校验：SHOW TABLES LIKE \'lhb_records\'; SHOW TABLES LIKE \'hotmoney_seats\'; SHOW TABLES LIKE \'collect_runs\';\n',
  );
  process.stderr.write(
    '-- 回滚：ALTER TABLE content_items DROP COLUMN quality_status, DROP COLUMN quality_stage,\n' +
      '--        DROP COLUMN quality_issue, DROP COLUMN collect_duration_ms, DROP COLUMN raw_hash,\n' +
      '--        DROP COLUMN meta;\n' +
      '--        DROP TABLE IF EXISTS collect_runs; DROP TABLE IF EXISTS hotmoney_seats; DROP TABLE IF EXISTS lhb_records;\n',
  );
  if (DRY_RUN) process.stderr.write('-- DRY_RUN：以上 SQL 未执行\n');
}

if (OFFLINE) runOffline();
else runOnline().catch((e) => {
  process.stderr.write(`p35 失败: ${e.message}\n`);
  process.exit(1);
});
