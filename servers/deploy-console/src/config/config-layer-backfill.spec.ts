import * as fs from 'fs';
import * as path from 'path';
import { RESERVED_LOCAL_KEYS } from './config.service';
import { CONFIG_LAYERS } from '../entities/config-item.entity';

/**
 * 层回填 SQL 与代码名单的一致性。
 *
 * 为什么需要这个测试：`config_items.layer` 是**数据维度**的层判定，
 * `RESERVED_LOCAL_KEYS` 是**代码维度**的。两者答的是同一个问题（"这个键能不能下发"），
 * 于是天然有漂移风险 —— SQL 漏掉一个新加的保留键，代码照样拦得住（双保险），
 * 但那条数据的 layer 就永远是错的，将来有人只看 layer 就会误判。
 *
 * 这个测试把漂移变成 CI 红灯，而不是线上事故。
 */
const SQL_PATH = path.resolve(__dirname, '../../../../scripts/config-layer-backfill.sql');

/** 从 SQL 里抽出它认得的键：精确匹配 + `PREFIX\_%` 通配 */
function parseSqlKeys(sql: string): Set<string> {
  const keys = new Set<string>();
  // `key` = 'CONFIG_MASTER_KEY'
  for (const m of sql.matchAll(/`key`\s*=\s*'([A-Za-z_]+)'/g)) keys.add(m[1]);
  // `key` IN ('PATH', 'HOME', ...)
  for (const m of sql.matchAll(/`key`\s+IN\s*\(([^)]*)\)/g)) {
    for (const v of m[1].split(',')) {
      const lit = v.trim().replace(/'/g, '');
      if (lit) keys.add(lit);
    }
  }
  // `key` LIKE 'MYSQL\_%' / 'PM2\_%' → 名单里的 'MYSQL_*'（前缀形态要与名单一致）
  for (const m of sql.matchAll(/`key`\s+LIKE\s+'([A-Za-z0-9_]+)\\*_%'/g)) keys.add(`${m[1]}_*`);
  return keys;
}

describe('配置层回填 · 与代码名单同源', () => {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');

  it('SQL 里的键不得超出代码保留键名单（不凭空发明）', () => {
    const code = new Set(RESERVED_LOCAL_KEYS);
    const extra = [...parseSqlKeys(sql)].filter((k) => !code.has(k));
    expect(extra).toEqual([]);
  });

  it('代码保留键名单里的键必须被 SQL 覆盖（不漏一个）', () => {
    const sqlKeys = parseSqlKeys(sql);
    const missing = RESERVED_LOCAL_KEYS.filter((k) => !sqlKeys.has(k));
    // 漏了 = 那批存量行的 layer 永远停在 app，层分级的扩展性打折扣
    expect(missing).toEqual([]);
  });

  it('回填只写 bootstrap / platform 两层 —— 都是永不下发', () => {
    // 这两层的 deliverable 必须是 0：写进服务 .env.generated 就是事故
    expect(CONFIG_LAYERS).toContain('bootstrap');
    expect(CONFIG_LAYERS).toContain('platform');
    const layers = [...sql.matchAll(/SET\s+layer\s*=\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect(layers.sort()).toEqual(['bootstrap', 'platform']);
    // 每一处 SET layer 都必须同时把 deliverable 置 0（不能指望列的默认值）
    const sets = sql.split(';').filter((s) => s.includes('SET layer'));
    expect(sets.length).toBe(2);
    for (const s of sets) expect(s).toMatch(/deliverable\s*=\s*0/);
  });

  it('幂等：只动 layer=app 的存量行，不覆盖人工修正', () => {
    // UPDATE 语句前带 `--` 注释，不能按行首判断
    const updates = sql.split(';').filter((s) => /\bUPDATE\s+config_items\b/.test(s));
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u).toMatch(/WHERE\s+layer\s*=\s*'app'/);
  });
});
