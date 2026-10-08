#!/usr/bin/env node
/**
 * p34：修意图路由的两个「静默失效」配置（2026-10-08）。
 *
 * 起因：小程序主对话「先完成，再完美 英语怎么说」被判成 `general`。
 * 排查链（dev 实测，20:55:42）：
 *   `意图路由: auto → general (via=fallback conf=0.3)` + stderr
 *   `ClientRegistry 模型 deepseek-v4-flash 未注册，回退到默认模型（hy3）`
 *
 * 两个配置层面的根因（代码层面的 maxTokens / 超时在 p34 之外单独修）：
 *
 *  1) **模型 id 前缀缺失**（deploy / web-system-dev / general）
 *     ai-service 的内置模板 seed 用的是 TokenHub **短名** `deepseek-v4-flash`，
 *     而 ai-agent 侧 ClientRegistry 的注册键是 **带前缀** 的 `deepseek/deepseek-v4-flash`
 *     （来源 `model-catalog.service.ts` 的 BUILTIN_TOKENHUB_MODELS）。
 *     两者不匹配时 ai-agent **不报错**，只静默把该 agent 回退到 hy3 —— 更慢更贵，
 *     且线上只表现为「偶尔兜底」，极难定位。
 *
 *  2) **路由关键词覆盖不全**（translate）
 *     关键词是字面量子串，「英文怎么说」覆盖不了「英语怎么说」，
 *     于是本该 0ms 命中规则的请求被推给 LLM，而 LLM 路径当时必然失败 → 兜底。
 *
 * ⚠️ 只改「当前定义」（agent_definitions）。`agent_definition_versions` 是**历史快照**，
 *    刻意不回写（历史应保持原样）；为防止「恢复旧版本把短名带回来」，另有
 *    ai-agent 侧的注册表校验告警兜底（agent-def-sync 会对未注册的 model 打 error）。
 *
 * ── 数据安全性（2026-10-08 契约评审 / 发布评审整改） ──────────────────────
 *   · keywords 走 **合并语义**：只追加缺失词，运营自定义过的词一律保留。
 *     直连模式自动读当前值合并；EMIT_SQL 模式请传 CURRENT_KEYWORDS 走同一语义，
 *     不传则退化为整列覆盖并**强制先建备份表** + stderr 红色警告。
 *   · 变更前自动 dump 当前定义到 /tmp/p34-agent-defs-backup-<ts>.json。
 *   · 直连模式**必须显式给 DB_HOST + DB_NAME**（否则 exit 2），避免误连本机库。
 *
 * 回滚（两种模式通用，执行前先建备份表；下面 SQL 直接可用）：
 *   CREATE TABLE agent_definitions_bak_p34_20261008 AS SELECT * FROM agent_definitions;
 *   -- 回滚 model（prod 基线为短名）
 *   UPDATE agent_definitions SET model='deepseek-v4-flash'
 *     WHERE id IN ('deploy','general','web-system-dev');
 *   -- 回滚 keywords：用备份表里的原始值回写（勿硬编码，否则会丢运营自定义词）
 *   UPDATE agent_definitions t
 *     JOIN agent_definitions_bak_p34_20261008 b ON b.id = t.id
 *     SET t.keywords = b.keywords, t.model = b.model;
 *
 * 用法：
 *   # 直连（推荐：走合并语义，自动备份）
 *   DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... \
 *     node archive/migrations/p34-agent-routing-fix.mjs
 *
 *   # prod（本机连不到内网库 → 先 SELECT 当前值，再导出 SQL 到服务器执行）
 *   CURRENT_KEYWORDS=$(mysql -N -e "SELECT keywords FROM agent_definitions WHERE id='translate'") \
 *     EMIT_SQL=1 node archive/migrations/p34-agent-routing-fix.mjs > p34.sql
 *   mysql < p34.sql
 *
 *   DRY_RUN=1    只打印将执行的 SQL（走合并语义需配合 CURRENT_KEYWORDS）
 *   EMIT_SQL=1   只打印 SQL（本机连不上内网库时 scp 到服务器执行）
 *
 * 幂等性：model 只在确实是短名时改写；keywords 只在缺词时改写。可重复执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const DRY_RUN = process.env.DRY_RUN === '1';
const EMIT_SQL = process.env.EMIT_SQL === '1';
const OFFLINE = DRY_RUN || EMIT_SQL;

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

/** 正确 id = ai-agent ClientRegistry 注册键（带前缀），见 BUILTIN_TOKENHUB_MODELS */
const CORRECT_MODEL = 'deepseek/deepseek-v4-flash';
const WRONG_MODEL = 'deepseek-v4-flash';
const MODEL_FIX_IDS = ['deploy', 'general', 'web-system-dev'];

/** 期望具备的词（用于生成幂等 WHERE 条件）；实际写入值 = 现有值 ∪ 缺失词 */
const REQUIRED_WORDS = [
  '翻译',
  '译成',
  '翻成',
  '英文怎么说',
  '英语怎么说',
  '英文怎么讲',
  '英语怎么讲',
  '中文怎么说',
  '日语怎么说',
  '韩语怎么说',
  '用英语',
  '用英文',
  '润色',
  'translation',
];

function q(v) {
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** 合并语义：保留现有顺序与运营自定义词，只把缺失词追加到末尾 */
function mergeKeywords(current) {
  let arr = [];
  if (Array.isArray(current)) arr = current;
  else if (typeof current === 'string') {
    try {
      const parsed = JSON.parse(current);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      arr = [];
    }
  }
  const merged = arr.slice();
  for (const w of REQUIRED_WORDS) {
    if (!merged.includes(w)) merged.push(w);
  }
  return { merged, added: merged.length - arr.length, hadCustom: arr.length > 0 };
}

const missingWordCond = (words) =>
  words.map((w) => `JSON_SEARCH(\`keywords\`, 'one', ${q(w)}) IS NULL`).join(' OR ');

/** 备份表语句：必须排在**所有 UPDATE 之前**，否则离线模式下备份到的是改后数据（R2） */
const BACKUP_TABLE_SQL =
  'CREATE TABLE IF NOT EXISTS `agent_definitions_bak_p34_20261008` ' +
  'AS SELECT * FROM `agent_definitions`';

function buildModelSteps() {
  return MODEL_FIX_IDS.map((id) => ({
    kind: 'model',
    name: `${id}.model → ${CORRECT_MODEL}`,
    sql:
      `UPDATE \`agent_definitions\` SET \`model\` = ${q(CORRECT_MODEL)} ` +
      `WHERE \`id\` = ${q(id)} AND \`model\` = ${q(WRONG_MODEL)}`,
  }));
}

/**
 * 列存在性前置校验（R1）：keywords 列由 p32 的 ADD COLUMN 引入。
 * 目标库若未跑过 p32，直接 UPDATE 会报 1054 中断 —— 且 3 条 model 可能已先行改写 → 部分生效。
 */
async function assertKeywordsColumn(conn) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM `information_schema`.`COLUMNS` ' +
      'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = \'agent_definitions\' AND COLUMN_NAME = \'keywords\'',
    [cfg.database],
  );
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * keywords 步骤：
 *  - 已知当前值（直连读取 / CURRENT_KEYWORDS 传入）→ 精确合并值，零丢失
 *  - 未知（EMIT_SQL 且未传）→ 退化为整列覆盖，前置备份表 + 显式警告
 */
function buildKeywordStep(currentRaw) {
  // 备份表由调用方统一前置输出/执行，这里不再内联（保证排在首条 UPDATE 之前）
  const backupSql = BACKUP_TABLE_SQL;

  if (currentRaw === undefined || currentRaw === null || currentRaw === '') {
    const merged = mergeKeywords([]).merged;
    return {
      kind: 'keywords',
      name: 'translate.keywords（整列覆盖·未知当前值）',
      risky: true,
      backupSql,
      sql:
        `UPDATE \`agent_definitions\` SET \`keywords\` = ${q(JSON.stringify(merged))} ` +
        `WHERE \`id\` = 'translate' AND (` +
        `\`keywords\` IS NULL OR JSON_VALID(\`keywords\`) = 0 OR ${missingWordCond(['英语怎么说'])})`,
    };
  }

  const { merged, added, hadCustom } = mergeKeywords(currentRaw);
  const missing = REQUIRED_WORDS.filter((w) => !merged.slice(0, merged.length - added).includes(w));
  if (added === 0) {
    return { kind: 'keywords', name: 'translate.keywords', noop: true, added, hadCustom };
  }
  return {
    kind: 'keywords',
    name: `translate.keywords（合并：新增 ${added} 词，保留原 ${merged.length - added} 词）`,
    risky: false,
    backupSql,
    sql:
      `UPDATE \`agent_definitions\` SET \`keywords\` = ${q(JSON.stringify(merged))} ` +
      `WHERE \`id\` = 'translate' AND (${missingWordCond(missing)})`,
  };
}

function dumpBackup(rows) {
  const dest = `/tmp/p34-agent-defs-backup-${Date.now()}.json`;
  try {
    fs.writeFileSync(dest, JSON.stringify(rows, null, 2));
    process.stderr.write(`✓ 变更前快照已写入 ${dest}（回滚依据）\n`);
  } catch (e) {
    process.stderr.write(`⚠️ 快照写入失败：${e.message}（请手动备份后再继续）\n`);
  }
}

async function runOnline() {
  // 守卫：直连模式必须显式指定目标库，避免误连本机 / 误写错库
  if (!process.env.DB_HOST || !process.env.DB_NAME) {
    process.stderr.write(
      '✗ 拒绝执行：直连模式必须显式传入 DB_HOST 与 DB_NAME\n' +
        '  示例：DB_HOST=127.0.0.1 DB_NAME=web_system DB_USER=root DB_PASSWORD=... node p34...\n' +
        '  本机无法直连内网库时改用 EMIT_SQL=1 导出 SQL。\n',
    );
    process.exit(2);
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
  process.stderr.write(`→ 目标库 ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}\n`);

  // 1) 变更前快照
  const [before] = await conn.query(
    "SELECT id, model, keywords FROM `agent_definitions` WHERE id IN ('translate','deploy','general','web-system-dev')",
  );
  dumpBackup(before);

  const steps = buildModelSteps();
  const translateRow = before.find((r) => r.id === 'translate');
  steps.push(buildKeywordStep(translateRow ? translateRow.keywords : null));

  // 2) 建备份表（DDL 会隐式提交，必须排在事务之外、且在所有 UPDATE 之前）
  await conn.query(BACKUP_TABLE_SQL);
  process.stderr.write('✓ 库内备份表 agent_definitions_bak_p34_20261008 就绪（改前快照）\n');

  // 3) 前置校验：keywords 列不存在（未跑 p32）→ 只做 model，避免半途报错导致部分生效
  const hasKeywords = await assertKeywordsColumn(conn);
  if (!hasKeywords) {
    process.stderr.write(
      '⚠️ agent_definitions 无 keywords 列（疑似未跑 p32）→ 跳过 keywords 步骤，仅修 model\n',
    );
    steps.length = buildModelSteps().length;
  }

  // 4) 事务执行：任一步失败整体回滚，杜绝「model 改了 keywords 没改」的部分生效
  let executed = 0;
  let skipped = 0;
  await conn.beginTransaction();
  try {
    for (const s of steps) {
      if (s.noop) {
        process.stderr.write(`跳过（关键词已齐备，保留现有值）：${s.name}\n`);
        skipped++;
        continue;
      }
      const [res] = await conn.query(s.sql);
      const rows = typeof res?.affectedRows === 'number' ? res.affectedRows : -1;
      if (rows === 0) {
        process.stderr.write(`跳过（无需改动）：${s.name}\n`);
        skipped++;
      } else {
        process.stderr.write(`执行：${s.name} rows=${rows}\n`);
        executed++;
      }
    }
    await conn.commit();
    process.stderr.write(`✓ 事务已提交（${executed} 步生效）\n`);
  } catch (e) {
    await conn.rollback();
    process.stderr.write(`✗ 事务已回滚：${e.message}\n`);
    await conn.end();
    process.exit(1);
  }

  // 5) 校验
  const [after] = await conn.query(
    'SELECT id, model, keywords FROM `agent_definitions` ORDER BY id',
  );
  process.stderr.write('\n-- 执行后状态 --\n');
  for (const r of after) {
    process.stderr.write(`${r.id}\t${r.model}\t${JSON.stringify(r.keywords)}\n`);
  }

  await conn.end();
  process.stderr.write(`\np34 完成：执行 ${executed} 步，跳过 ${skipped} 步\n`);
}

function runOffline() {
  const steps = buildModelSteps();
  const kw = buildKeywordStep(process.env.CURRENT_KEYWORDS);

  process.stderr.write(`-- p34 修意图路由配置（目标库请在执行端显式指定）\n`);

  // 备份表必须最先输出：否则备份到的是 model 改后数据，无法回滚 model（R2）
  if (!kw.noop) {
    process.stdout.write(`${BACKUP_TABLE_SQL};\n`);
    process.stderr.write('-- 步骤：建备份表（改前快照，必须排在所有 UPDATE 之前）\n');
  }

  for (const s of steps) {
    process.stdout.write(`${s.sql};\n`);
    process.stderr.write(`-- 步骤：${s.name}\n`);
  }

  if (kw.noop) {
    process.stderr.write(`-- translate.keywords 已齐备，无需改动\n`);
  } else {
    process.stdout.write(`${kw.sql};\n`);
    process.stderr.write(`-- 步骤：${kw.name}\n`);
    if (kw.risky) {
      process.stderr.write(
        '⚠️ 未提供 CURRENT_KEYWORDS，keywords 走整列覆盖——已前置建备份表，但运营自定义词仍可能丢失。\n' +
          '   推荐做法：CURRENT_KEYWORDS=$(mysql -N -e "SELECT keywords FROM agent_definitions WHERE id=\'translate\'") EMIT_SQL=1 node p34...\n',
      );
    }
  }

  process.stderr.write(
    '-- 校验：SELECT id, model, keywords FROM agent_definitions ORDER BY id;\n',
  );
  process.stderr.write(
    '-- 回滚：UPDATE agent_definitions t JOIN agent_definitions_bak_p34_20261008 b ON b.id=t.id SET t.keywords=b.keywords, t.model=b.model;\n',
  );
  if (DRY_RUN) process.stderr.write('-- DRY_RUN：以上 SQL 未执行\n');
}

if (OFFLINE) runOffline();
else runOnline().catch((e) => {
  process.stderr.write(`p34 失败: ${e.message}\n`);
  process.exit(1);
});
