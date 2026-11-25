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

  it('资产 136 条 source 锚点合法且身份键唯一（冻结真源自洽）', () => {
    const keys = new Set<string>();
    for (const q of ASSET.items) {
      expect(q.cn.length).toBeGreaterThan(0);
      expect(q.en.length).toBeGreaterThan(0);
      expect(q.source.book).toBe('NCE2');
      expect(Number.isInteger(q.source.lessonId)).toBe(true);
      expect(q.source.title.length).toBeGreaterThan(0);
      expect(Number.isInteger(q.source.lineIndex)).toBe(true);
      const key = `${q.source.lessonId}:${q.source.lineIndex}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
    expect(keys.size).toBe(136);
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
    ['版本混杂', (rows: DailyQuoteEntity[]) => rows.map((r, i) => (i === 0 ? { ...r, pool_version: 2 } : r))],
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
    await expect(service.getPool()).resolves.toMatchObject({ count: 136 });
    expect(repo.find).toHaveBeenCalledTimes(2);
  });
});
