/**
 * 阶段③ S4 → s27 · 服务端只读「今日一句」GET 契约验收。
 *
 * s27 起内容来源为 DB（DailyQuoteService），controller 只做信封包装与
 * ?version 留痕；DB 故障必须向上传播（Nest 映射 5xx），绝不静默返回空池。
 * 本文件只读仓库冻结资产做对照，路径为相对路径，不含任何本机绝对路径。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NceController } from './nce.controller';
import {
  DAILY_QUOTES_ASSET_SHA256,
  DAILY_QUOTES_FROZEN_COUNT,
  DAILY_QUOTES_FROZEN_VERSION,
  type DailyQuotesPool,
} from './daily-quotes.data';
import { DailyQuoteService } from './services/daily-quote.service';

const ASSET_PATH = resolve(__dirname, '../../data/daily-quotes.json');
const ASSET = JSON.parse(readFileSync(ASSET_PATH, 'utf-8')) as DailyQuotesPool & { _notice: string };

function controllerWith(pool: DailyQuotesPool, fail = false) {
  const getPool = jest.fn(async () => {
    if (fail) throw new Error('DB unavailable');
    return pool;
  });
  const service = { getPool } as unknown as DailyQuoteService;
  return { controller: new NceController({} as any, service), getPool };
}

describe('冻结资产仍为唯一内容真源（V1）', () => {
  it('资产 _notice 保留版权/原文 sha16，version/count 与代码冻结常量一致', () => {
    expect(ASSET._notice).toContain('仅供个人学习，不对外分发');
    expect(ASSET._notice).toContain('40339154ec0a54ad');
    expect(ASSET.version).toBe(DAILY_QUOTES_FROZEN_VERSION);
    expect(ASSET.count).toBe(DAILY_QUOTES_FROZEN_COUNT);
    expect(ASSET.items).toHaveLength(136);
    // 冻结快照防篡改：与资产 sha256 对齐（内容若变必须同步改常量并走新版本）
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    expect(createHash('sha256').update(readFileSync(ASSET_PATH)).digest('hex')).toBe(DAILY_QUOTES_ASSET_SHA256);
  });
});

describe('NceController.dailyQuotes（V2 契约不变 / V4 故障传播）', () => {
  const pool = { version: ASSET.version, count: ASSET.count, items: ASSET.items } as DailyQuotesPool;

  it('返回 ok 信封 {code:0,data,message:ok}，data 为 service 提供的冻结池', async () => {
    const { controller } = controllerWith(pool);
    const res = await controller.dailyQuotes();
    expect(res).toEqual({ code: 0, data: pool, message: 'ok' });
  });

  it('?version 合法整数 / 非法串 / 负数都忽略、不 500，恒返回同池', async () => {
    const { controller, getPool } = controllerWith(pool);
    const a = await controller.dailyQuotes('1');
    const b = await controller.dailyQuotes('not-an-int');
    const c = await controller.dailyQuotes('-3');
    expect(b.code).toBe(0);
    expect(c.code).toBe(0);
    expect(b.data).toEqual(a.data);
    expect(c.data).toEqual(a.data);
    // version 不进入 service 查询：非法值不产生任何额外分支
    expect(getPool).toHaveBeenCalledTimes(3);
    expect(getPool).toHaveBeenCalledWith();
  });

  it('DB 不可用且无缓存 → service 抛错向上传播（5xx），不返回空池/假数据', async () => {
    const { controller } = controllerWith(pool, true);
    await expect(controller.dailyQuotes()).rejects.toThrow(/DB unavailable/i);
  });

  it('只读：连续两次返回深相等，controller 不提供任何写接口', async () => {
    const { controller } = controllerWith(pool);
    const a = await controller.dailyQuotes();
    const b = await controller.dailyQuotes();
    expect(a).toEqual(b);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).sort()).toEqual([
      'constructor', 'dailyQuotes', 'detail', 'list', 'meta',
    ]);
  });
});
