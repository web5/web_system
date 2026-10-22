import { ContentService } from './content.service';

/**
 * 采集明细页统计卡（itemStats）的原生 SQL 形状回归测试。
 *
 * 背景（2026-10-23 线上事故）：
 *   itemStats 里曾写成 `'item.quality_status IN (:...qs'` —— 少一个右括号、多写 `...`，
 *   TypeORM 拼出的 SQL 未闭合，MySQL 报
 *     "You have an error in your SQL syntax ... near '' at line 1"
 *   采集明细页 `Promise.all([listItems(), itemStats()])` 因此整页 500，
 *   而列表数据其实一直是好的。
 *
 * 根因是这条 SQL 从没被任何测试覆盖过（content.service 此前零单测），
 * 故本文件专门钉死「原生 SQL 的形状」，防止同类笔误再次上线。
 */

/** 记录 QueryBuilder 收到的每个 SQL 片段与参数 */
type SqlLog = Array<{ sql: string; params?: Record<string, unknown> }>;

function makeQueryBuilder(log: SqlLog) {
  const qb: any = {
    where(sql: string, params?: Record<string, unknown>) {
      log.push({ sql, params });
      return qb;
    },
    andWhere(sql: string, params?: Record<string, unknown>) {
      log.push({ sql, params });
      return qb;
    },
    orWhere(sql: string, params?: Record<string, unknown>) {
      log.push({ sql, params });
      return qb;
    },
    getCount: async () => 0,
    getRawOne: async () => null,
  };
  return qb;
}

function buildService(log: SqlLog): ContentService {
  const itemRepo: any = {
    count: async () => 0,
    createQueryBuilder: () => makeQueryBuilder(log),
  };
  return new ContentService(
    {} as any,
    {} as any,
    itemRepo,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe('ContentService.itemStats 原生 SQL 形状', () => {
  it('quality_status 的 IN 子句必须闭合，且占位符与参数名一致', async () => {
    const log: SqlLog = [];
    await buildService(log).itemStats();

    const hit = log.find((l) => l.sql.includes('quality_status'));
    expect(hit).toBeDefined();
    expect(hit!.sql).toBe('item.quality_status IN (:qs)');
    expect(hit!.params).toEqual({ qs: ['fail', 'partial'] });
    // 事故原文就是 'IN (:...qs' —— 显式钉死不得再出现
    expect(hit!.sql).not.toContain('...');
  });

  it('所有原生 SQL 片段的括号必须配对（防未闭合 SQL 上线）', async () => {
    const log: SqlLog = [];
    await buildService(log).itemStats();

    expect(log.length).toBeGreaterThan(0);
    for (const { sql } of log) {
      const open = (sql.match(/\(/g) ?? []).length;
      const close = (sql.match(/\)/g) ?? []).length;
      expect({ sql, open, close }).toEqual({ sql, open: close, close: open });
    }
  });

  it('占位符 :name 必须在 params 里有对应 key（防 :...qs 这类笔误）', async () => {
    const log: SqlLog = [];
    await buildService(log).itemStats();

    for (const { sql, params } of log) {
      const names = [...sql.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
      for (const n of names) {
        expect({ sql, missing: n, has: Object.prototype.hasOwnProperty.call(params ?? {}, n) }).toEqual({
          sql,
          missing: n,
          has: true,
        });
      }
    }
  });
});
