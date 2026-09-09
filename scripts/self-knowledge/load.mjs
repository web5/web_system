/**
 * self-knowledge load —— 把 corpgen 生成的语料入库为 knowledge 集合
 *
 * 前置：
 *   1) knowledge-service 已启动（cd servers/knowledge-service && node dist/main.js &）
 *   2) 本机 MySQL 存在 web_system_knowledge 库；knowledge-service/.env 的
 *      DB_* / INTERNAL_API_KEY 可用（默认读取该服务的 .env）
 *
 * 用法：node scripts/self-knowledge/load.mjs
 * 效果：建 3 个固定 id 集合（ws-arch / ws-agent-platform / ws-dev-guide，已存在则跳过建集合）
 *      并 ingest out/*.md（幂等：同内容 checksum 命中即跳过）。
 * 绑定：给某 agent 使用需在其定义 capabilities 加
 *       { type:'mcp', ref:'knowledge/knowledge_search', config:{ collectionId:'ws-arch' } } 等。
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
const ENV_FILE = path.resolve(__dirname, '../../servers/knowledge-service/.env');
const env = Object.fromEntries(
  (await readFile(ENV_FILE, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const KEY = env.INTERNAL_API_KEY;
const BASE = `http://localhost:${env.PORT || 6011}`;

const COLLECTIONS = [
  { id: 'ws-arch', name: 'web_system 架构总览', description: '服务/路由/表/gateway 代理/微前端结构（自动生成）' },
  { id: 'ws-agent-platform', name: 'Agent 平台玩法', description: 'agent-core/ai-agent/ai-service/mcp-gateway/knowledge 能力与使用契约' },
  { id: 'ws-dev-guide', name: '研发指南', description: 'UI Token 规范/微前端部署/agent-kit 契约/评测口径' },
];

async function ensureCollections(conn) {
  for (const c of COLLECTIONS) {
    const [rows] = await conn.query('SELECT id FROM knowledge_collections WHERE id=?', [c.id]);
    if (!rows.length) {
      await conn.query(
        'INSERT INTO knowledge_collections (id,name,description,embed_model,enabled,meta,created_by,created_at,updated_at,deleted_at) VALUES (?,?,?,?,1,NULL,NULL,NOW(6),NOW(6),NULL)',
        [c.id, c.name, c.description, 'tokenhub'],
      );
      console.log('COLLECTION_CREATED', c.id);
    } else {
      console.log('COLLECTION_EXISTS', c.id);
    }
  }
}

const conn = await mysql.createConnection({
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD || '',
  database: env.DB_DATABASE,
});
await ensureCollections(conn);
await conn.end();

const files = (await readdir(OUT)).filter((f) => f.endsWith('.md')).sort();
const H = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
for (const f of files) {
  const key = f.replace(/\.md$/, '');
  const collectionId = COLLECTIONS.find((c) => c.id.endsWith(key.split('-').pop()))?.id;
  const cid =
    collectionId ||
    (key === 'architecture'
      ? 'ws-arch'
      : key === 'agent-platform'
        ? 'ws-agent-platform'
        : key === 'dev-guide'
          ? 'ws-dev-guide'
          : null);
  if (!cid) {
    console.warn('SKIP 未知语料文件', f);
    continue;
  }
  const text = await readFile(path.join(OUT, f), 'utf8');
  const res = await fetch(`${BASE}/knowledge/mcp/ingest`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      collectionId: cid,
      title: `语料 ${f}`,
      text,
      source: `scripts/self-knowledge/out/${f}`,
    }),
  }).then((r) => r.json());
  console.log('INGEST', f, '->', res.docId ? `ok(${res.status}, chunks=${res.chunkCount})` : JSON.stringify(res));
}
console.log('LOAD_DONE');
