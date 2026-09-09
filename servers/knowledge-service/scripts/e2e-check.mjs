import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import mysql from 'mysql2/promise';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const key = env.INTERNAL_API_KEY;
const base = 'http://localhost:6011';

const conn = await mysql.createConnection({
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD || '',
  database: env.DB_DATABASE,
});
const [rows] = await conn.query(
  'SELECT id FROM knowledge_collections WHERE name=? LIMIT 1',
  ['e2e-合同法规'],
);
let cid = rows[0]?.id;
if (!cid) {
  cid = randomUUID();
  await conn.query(
    'INSERT INTO knowledge_collections (id,name,description,embed_model,enabled,meta,created_by,created_at,updated_at,deleted_at) VALUES (?,?,?,?,1,NULL,NULL,NOW(6),NOW(6),NULL)',
    [cid, 'e2e-合同法规', 'e2e', 'tokenhub'],
  );
  console.log('COLLECTION_CREATED', cid);
} else {
  console.log('COLLECTION_EXISTS', cid);
}

const H = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
const ingest = await fetch(base + '/knowledge/mcp/ingest', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    collectionId: cid,
    title: '合同法要点',
    text: '合同解除需经双方协商一致并签署书面解除协议。违约金不得超过实际损失的百分之三十。',
    source: 'e2e',
  }),
}).then((r) => r.json());
console.log('INGEST', JSON.stringify(ingest));

const q = encodeURIComponent('合同怎么解除');
const search = await fetch(
  `${base}/knowledge/mcp/search?collectionId=${cid}&query=${q}&topK=3`,
  { headers: H },
).then((r) => r.json());
console.log('SEARCH', Array.isArray(search) ? `hits=${search.length}` : JSON.stringify(search));

const evalRes = await fetch(base + '/knowledge/mcp/eval', {
  method: 'POST',
  headers: H,
  body: JSON.stringify({
    collectionId: cid,
    topK: 3,
    cases: [{ question: '合同解除需要满足什么条件？' }],
  }),
}).then((r) => r.json());
console.log('EVAL', JSON.stringify(evalRes.metrics || evalRes).slice(0, 500));

// 停用集合 → 检索应返回明确错误（R3.4）
await conn.query('UPDATE knowledge_collections SET enabled=0 WHERE id=?', [cid]);
const disabled = await fetch(
  `${base}/knowledge/mcp/search?collectionId=${cid}&query=${q}&topK=3`,
  { headers: H },
).then((r) => r.json());
console.log('DISABLED_SEARCH', JSON.stringify(disabled).slice(0, 200));
await conn.query('UPDATE knowledge_collections SET enabled=1 WHERE id=?', [cid]);
await conn.end();
console.log('E2E_DONE');
