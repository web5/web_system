#!/usr/bin/env node
/**
 * 新概念英语课文入库器（可重复运行 / 按课号 UPSERT）。
 *
 * 用法：
 *   node scripts/import-nce-lessons.mjs
 *   node scripts/import-nce-lessons.mjs --file /abs/path/lessons.json
 *   node scripts/import-nce-lessons.mjs --dry-run          # 只校验 JSON，不连库
 *
 * 数据源默认指向工作空间的 data/lessons.json；表结构见 migrations/0025_nce_lessons.sql。
 *
 * 🔴 写 JSON 列必须参数化：JSON.stringify 的结果作为 `?` 的参数值传入，
 *    绝不能拼进 SQL 字符串。否则中文会被 MySQL 吞掉反斜杠，静默变成
 *    `u62c9…` 这样的乱码且没有任何报错（2026-11-02 已出过事故）。
 *
 * 凭证只从 servers/content-hub/.env(.generated) 或环境变量读，不落明文、不进日志。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE =
  '/Users/geekwen/WorkBuddy/chase 个人 AI 工作空间/30-任务产物/2026-11-05-新概念英语学习站点/data/lessons.json';
const MIGRATION = path.join(ROOT, 'migrations/0025_nce_lessons.sql');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const DRY_RUN = process.argv.includes('--dry-run');
const FILE = arg('--file') || DEFAULT_FILE;

/** 与 ConfigModule 的优先级一致：.env 打底，.env.generated 覆盖 */
function loadEnv() {
  const out = {};
  for (const f of ['.env', '.env.generated']) {
    const p = path.join(ROOT, 'servers/content-hub', f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const idx = s.indexOf('=');
      out[s.slice(0, idx).trim()] = s.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function isoToDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** JSON 列一律先序列化成字符串，再作为参数值绑定，中文才不会被吞转义。 */
function jsonParam(v) {
  return JSON.stringify(Array.isArray(v) ? v : []);
}

const COLUMNS = [
  'book', 'book_title', 'lesson_no', 'title', 'title_cn',
  'lead_question', 'lead_question_zh', 'text', 'text_source',
  'lines', 'translation', 'words', 'exercises', 'sources', 'fetched_at',
];

// `lines` 是 MySQL 保留字（LOAD DATA ... LINES TERMINATED BY），所有列名一律加反引号。
const Q = (c) => `\`${c}\``;
const UPDATE_COLUMNS = COLUMNS.filter((c) => c !== 'book' && c !== 'lesson_no');
const UPSERT = `
INSERT INTO nce_lessons (${COLUMNS.map(Q).join(', ')})
VALUES (${COLUMNS.map(() => '?').join(', ')})
ON DUPLICATE KEY UPDATE
${UPDATE_COLUMNS.map((c) => `  ${Q(c)} = VALUES(${Q(c)})`).join(',\n')}
`;

async function main() {
  if (!fs.existsSync(FILE)) throw new Error(`数据文件不存在：${FILE}`);
  const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (!Array.isArray(db.lessons)) throw new Error('lessons.json 缺少 lessons 数组');

  console.log(`[读取] ${FILE}`);
  console.log(`[数据] ${db.book} · ${db.bookTitle} · ${db.downloaded}/${db.total} 课`);
  const ids = db.lessons.map((x) => x.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) throw new Error(`课号重复：${[...new Set(dup)].join(',')}`);
  for (const it of db.lessons) {
    if (!Number.isInteger(it.id) || it.id < 1 || it.id > 96) throw new Error(`课号非法：${it.id}`);
    if (!it.text || !Array.isArray(it.lines) || it.lines.length < 5) {
      throw new Error(`Lesson ${it.id} 课文不完整（text/lines 缺失）`);
    }
  }
  if (DRY_RUN) {
    console.log('[dry-run] JSON 校验通过，未连库');
    return;
  }

  const env = loadEnv();
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD ?? env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE || env.DB_DATABASE || 'web_system',
    charset: 'utf8mb4',
  });

  try {
    // 建表幂等；与 scripts/apply-migrations.sh 的 0025 是同一份 SQL
    const ddl = fs.readFileSync(MIGRATION, 'utf8');
    // 先逐行剥掉 `--` 注释，再按 `;` 切语句；不能先按首字符过滤，
    // 否则以注释开头的第一段会把整条 CREATE TABLE 一起丢掉。
    const cleanDdl = ddl.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of cleanDdl.split(';')) {
      const sql = stmt.trim();
      if (sql) await conn.query(sql);
    }

    const bookTitle = db.bookTitle || '';
    for (const it of db.lessons) {
      const params = [
        db.book || 'NCE2',
        bookTitle,
        it.id,
        it.title || '',
        it.titleCn || null,
        it.leadQuestion || null,
        it.leadQuestionCn || null,
        it.text || '',
        it.textSource || 'lrc',
        jsonParam(it.lines),
        it.translation || null,
        jsonParam(it.words),
        jsonParam(it.exercises),
        jsonParam(it.sources),
        isoToDate(it.fetchedAt),
      ];
      await conn.execute(UPSERT, params);
    }

    // 回读校验：中文没有被 \uXXXX 化，且 JSON 列能正确反序列化
    const READ_COLS = ['lesson_no', 'title_cn', 'lead_question_zh', 'translation', 'lines', 'words', 'exercises'];
    const [rows] = await conn.query(
      `SELECT ${READ_COLS.map(Q).join(', ')} FROM nce_lessons WHERE ${Q('book')} = ? ORDER BY ${Q('lesson_no')}`,
      [db.book || 'NCE2'],
    );
    const bad = [];
    for (const r of rows) {
      const zh = [r.title_cn, r.lead_question_zh, r.translation].filter(Boolean).join('');
      if (zh && !/[\u4e00-\u9fff]/.test(zh)) bad.push(`L${r.lesson_no}: 中文丢失`);
      if (/\\u[0-9a-fA-F]{4}/.test(String(r.translation || ''))) bad.push(`L${r.lesson_no}: 译文存在 \\uXXXX 转义`);
      for (const k of ['lines', 'words', 'exercises']) {
        const v = r[k];
        if (typeof v === 'string' && v.includes('\\u')) bad.push(`L${r.lesson_no}: ${k} 列存在 \\uXXXX 转义`);
        if (v && !Array.isArray(v) && typeof v !== 'object') bad.push(`L${r.lesson_no}: ${k} 列不是 JSON 数组`);
      }
    }
    const [cnt] = await conn.query('SELECT COUNT(*) AS n FROM nce_lessons WHERE book = ?', [db.book || 'NCE2']);
    console.log(`[入库] ${db.lessons.length} 课 UPSERT 完成；表内共 ${cnt[0].n} 课`);
    console.log(`[回读] 中文/JSON 转义检查：${bad.length ? 'FAIL -> ' + bad.slice(0, 10).join(' | ') : 'PASS'}`);
    if (bad.length) process.exitCode = 1;
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('[失败]', e.message);
  process.exit(1);
});
