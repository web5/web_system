/**
 * s27 · NCE 每日美句冻结池「数据库存储」加载器验收（TDD 红→绿）。
 *
 * 不变量：DB 只是存储介质替换。136 条逐字取自仓库冻结资产（相对路径读取，
 * 禁止硬编码本机绝对路径）；接口缓存首次查库后不再查库；DB 不可用时
 * 有缓存用缓存、无缓存快速失败（不静默返回空池）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  DAILY_QUOTES_ASSET_SHA256,
  DAILY_QUOTES_FROZEN_COUNT,
  DAILY_QUOTES_FROZEN_VERSION,
  dailyQuoteIdentity,
} from '../daily-quotes.data';
import { DailyQuoteEntity } from '../entities/daily-quote.entity';
import { DailyQuoteService, resetDailyQuoteCacheForTest } from './daily-quote.service';

// 相对路径：src/content/services → content-hub/data，CI 与本机同构。
const ASSET_PATH = resolve(__dirname, '../../../data/daily-quotes.json');
const ASSET = JSON.parse(readFileSync(ASSET_PATH, 'utf-8')) as {
  version: number;
  count: number;
  items: Array<{ cn: string; en: string; source: { book: string; lessonId: number; title: string; lineIndex: number } }>;
};

function dbRows(): DailyQuoteEntity[] {
  return ASSET.items.map((q, i) => ({
    id: i + 1,
    pool_version: ASSET.version,
    ordinal: i + 1,
    cn: q.cn,
    en: q.en,
    source_book: q.source.book,
    source_lesson_id: q.source.lessonId,
    source_title: q.source.title,
    source_line_index: q.source.lineIndex,
    created_at: new Date(),
    updated_at: new Date(),
  }));
}

function mockRepo(findImpl: () => Promise<DailyQuoteEntity[]>): jest.Mocked<Pick<Repository<DailyQuoteEntity>, 'find'>> {
  return { find: jest.fn(findImpl) } as unknown as jest.Mocked<Pick<Repository<DailyQuoteEntity>, 'find'>>;
}

describe('冻结资产与代码常量（V1 零编造）', () => {
  it('资产 sha256 / version / count 与冻结常量一致', () => {
    const buf = readFileSync(ASSET_PATH);
    expect(createHash('sha256').update(buf).digest('hex')).toBe(DAILY_QUOTES_ASSET_SHA256);
    expect(ASSET.version).toBe(DAILY_QUOTES_FROZEN_VERSION);
    expect(ASSET.count).toBe(DAILY_QUOTES_FROZEN_COUNT);
    expect(ASSET.items).toHaveLength(DAILY_QUOTES_FROZEN_COUNT);
  });

  it('资产 281 条 source 锚点合法（三册白名单 + 按册课号上限）且含 book 身份键唯一（冻结真源自洽）', () => {
    const maxByBook: Record<string, number> = { NCE2: 96, NCE3: 60, NCE4: 48 };
    const keys = new Set<string>();
    const books = new Set<string>();
    for (const q of ASSET.items) {
      expect(q.cn.length).toBeGreaterThan(0);
      expect(q.en.length).toBeGreaterThan(0);
      expect(Object.keys(maxByBook)).toContain(q.source.book);
      expect(Number.isInteger(q.source.lessonId)).toBe(true);
      expect(q.source.lessonId).toBeGreaterThanOrEqual(1);
      expect(q.source.lessonId).toBeLessThanOrEqual(maxByBook[q.source.book]);
      expect(q.source.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(q.source.lineIndex)).toBe(true);
      expect(q.source.lineIndex).toBeGreaterThanOrEqual(0);
      const key = dailyQuoteIdentity(q.source.book, q.source.lessonId, q.source.lineIndex);
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      books.add(q.source.book);
    }
    expect(keys.size).toBe(281);
    expect([...books].sort()).toEqual(['NCE2', 'NCE3', 'NCE4']);
  });

  it('三册分布：NCE2=136（冻结原样）/ NCE3=80 / NCE4=65', () => {
    const dist: Record<string, number> = {};
    for (const q of ASSET.items) dist[q.source.book] = (dist[q.source.book] || 0) + 1;
    expect(dist).toEqual({ NCE2: 136, NCE3: 80, NCE4: 65 });
  });

  it('含 book 身份键：跨册同 (lessonId,lineIndex) 共存不被判重复；无 book 键会碰撞（变异反例）', () => {
    // 构造 NCE2 L1:0 与 NCE3 L1:0 两条同号行
    const a = dailyQuoteIdentity('NCE2', 1, 0);
    const b = dailyQuoteIdentity('NCE3', 1, 0);
    expect(a).not.toBe(b);
    const set = new Set([a, b]);
    expect(set.size).toBe(2);
    // 反例：若身份键不含 book，两者会碰撞 → 这正是 0030 之前的老键形态
    const oldA = `${1}:${0}`;
    const oldB = `${1}:${0}`;
    expect(oldA).toBe(oldB);
    expect(new Set([oldA, oldB]).size).toBe(1);
  });
});

describe('DailyQuoteService.getPool（V1/V3/V4/V5）', () => {
  beforeEach(() => resetDailyQuoteCacheForTest());
  afterEach(() => resetDailyQuoteCacheForTest());

  it('首次查库 → 返回与资产逐字一致的 {version,count,items}；再查命中缓存不再打库', async () => {
    const repo = mockRepo(async () => dbRows());
    const service = new DailyQuoteService(repo as unknown as Repository<DailyQuoteEntity>);
    const first = await service.getPool();
    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ version: ASSET.version, count: ASSET.count, items: ASSET.items });
    const second = await service.getPool();
    expect(second).toEqual(first);
    expect(repo.find).toHaveBeenCalledTimes(1);
  });

  it('跨册同 (lessonId,lineIndex) 两行共存：含 book 身份键不被 shapeIsValid 误判重复（V4）', async () => {
    // 用资产中真实存在的跨册同号锚点：构造两条仅 book 不同的行，ordinal 连续。
    const rows = dbRows();
    const nce2 = rows.find((r) => r.source_book === 'NCE2' && r.source_lesson_id === 1 && r.source_line_index === 0)
      || rows.find((r) => r.source_book === 'NCE2');
    const nce3 = rows.find((r) => r.source_book === 'NCE3');
    expect(nce2 && nce3).toBeTruthy();
    // 把两条改成同一 (lessonId,lineIndex)，保留不同 book
    const cross = [
      { ...nce2!, ordinal: 1, source_lesson_id: 1, source_line_index: 0, pool_version: DAILY_QUOTES_FROZEN_VERSION },
      { ...nce3!, ordinal: 2, source_lesson_id: 1, source_line_index: 0, pool_version: DAILY_QUOTES_FROZEN_VERSION },
    ];
    // 补齐到 COUNT 条（其余用普通行、ordinal 从 3 开始），确保形状校验只针对身份键
    const filler = rows.filter((r) => r !== nce2 && r !== nce3).slice(0, DAILY_QUOTES_FROZEN_COUNT - 2)
      .map((r, i) => ({ ...r, ordinal: i + 3 }));
    const repo = mockRepo(async () => [...cross, ...filler]);
    const service = new DailyQuoteService(repo as unknown as Repository<DailyQuoteEntity>);
    await expect(service.getPool()).resolves.toMatchObject({ count: DAILY_QUOTES_FROZEN_COUNT });
  });

  it('并发首次请求共用一个 in-flight 查询，只打库一次', async () => {
    const repo = mockRepo(() => new Promise((resolve) => setTimeout(() => resolve(dbRows()), 5)));
    const service = new DailyQuoteService(repo as unknown as Repository<DailyQuoteEntity>);
    const [a, b] = await Promise.all([service.getPool(), service.getPool()]);
    expect(repo.find).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('无缓存 + DB 报错 → 快速失败（5xx 由 controller/Nest 映射），不静默返回空池', async () => {
    const repo = mockRepo(async () => { throw new Error('ECONNREFUSED'); });
    const service = new DailyQuoteService(repo as unknown as Repository<DailyQuoteEntity>);
    await expect(service.getPool()).rejects.toThrow(/DB unavailable/i);
  });

  it('已有缓存 + 新实例 DB 报错 → 仍返回缓存池（冻结数据无过期概念）', async () => {
    const good = new DailyQuoteService(mockRepo(async () => dbRows()) as unknown as Repository<DailyQuoteEntity>);
    const pool = await good.getPool();
    const brokenRepo = mockRepo(async () => { throw new Error('ECONNREFUSED'); });
    const broken = new DailyQuoteService(brokenRepo as unknown as Repository<DailyQuoteEntity>);
    await expect(broken.getPool()).resolves.toEqual(pool);
    expect(brokenRepo.find).not.toHaveBeenCalled();
  });

  it.each([
    ['缺一条', (rows: DailyQuoteEntity[]) => rows.slice(0, 135)],
    ['多一条', (rows: DailyQuoteEntity[]) => [...rows, { ...rows[0], ordinal: 137 }]],
    ['ordinal 跳号', (rows: DailyQuoteEntity[]) => rows.map((r, i) => (i === 2 ? { ...r, ordinal: 4 } : r))],
    ['版本混杂', (rows: DailyQuoteEntity[]) => rows.map((r, i) => (i === 0 ? { ...r, pool_version: DAILY_QUOTES_FROZEN_VERSION + 1 } : r))],
    ['cn 为空', (rows: DailyQuoteEntity[]) => rows.map((r, i) => (i === 0 ? { ...r, cn: '' } : r))],
    ['source 非法', (rows: DailyQuoteEntity[]) => rows.map((r, i) => (i === 0 ? { ...r, source_book: 'X', source_lesson_id: 0 } : r))],
  ])('形状漂移 %s → 拒绝返回（count/ordinal/version/source 判据生效）', async (_name, mutate) => {
    const repo = mockRepo(async () => mutate(dbRows()));
    const service = new DailyQuoteService(repo as unknown as Repository<DailyQuoteEntity>);
    await expect(service.getPool()).rejects.toThrow(/shape invalid/i);
  });

  it('DB 报错后缓存不残留：下次调用会重新查库', async () => {
    const repo = mockRepo(async () => { throw new Error('ECONNREFUSED'); });
    const service = new DailyQuoteService(repo as unknown as Repository<DailyQuoteEntity>);
    await expect(service.getPool()).rejects.toThrow(/DB unavailable/i);
    repo.find.mockImplementationOnce(async () => dbRows());
    await expect(service.getPool()).resolves.toMatchObject({ count: DAILY_QUOTES_FROZEN_COUNT });
    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
