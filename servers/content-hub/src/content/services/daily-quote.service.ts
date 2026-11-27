/**
 * 每日美句冻结池只读加载（s27 · DB + 内存缓存）。
 *
 * 判据（与 spec 一一对应）：
 * - 首次调用查库一次，成功后整池缓存；同进程后续调用零查库；
 * - 并发首次调用共用一个 in-flight Promise，不重复打库；
 * - DB 不可用且**无缓存** → 抛错，由 Nest 映射 5xx（绝不静默返回空池/假数据）；
 * - DB 不可用但**已有缓存** → 直接返回缓存（冻结数据不会变，无过期概念）；
 * - 行数/顺序/版本/内容形状任一漂移 → 抛错，不把半套数据交给上层。
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DAILY_QUOTES_FROZEN_COUNT,
  DAILY_QUOTES_FROZEN_VERSION,
  dailyQuoteIdentity,
  dailyQuoteSourceValid,
  type DailyQuoteItem,
  type DailyQuotesPool,
} from '../daily-quotes.data';
import { DailyQuoteEntity } from '../entities/daily-quote.entity';

let cached: DailyQuotesPool | null = null;
let inFlight: Promise<DailyQuotesPool> | null = null;

/** 仅供测试重置进程内缓存；生产语义无失效入口（冻结池换版本必须重启）。 */
export function resetDailyQuoteCacheForTest(): void {
  cached = null;
  inFlight = null;
}

function isValidRow(row: DailyQuoteEntity): boolean {
  return row.pool_version === DAILY_QUOTES_FROZEN_VERSION
    && typeof row.cn === 'string' && row.cn.length > 0
    && typeof row.en === 'string' && row.en.length > 0
    && dailyQuoteSourceValid({
      book: row.source_book,
      lessonId: row.source_lesson_id,
      title: row.source_title,
      lineIndex: row.source_line_index,
    });
}

function shapeIsValid(rows: DailyQuoteEntity[]): boolean {
  if (!Array.isArray(rows) || rows.length !== DAILY_QUOTES_FROZEN_COUNT) return false;
  const keys = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!isValidRow(row) || row.ordinal !== i + 1) return false;
    // 身份键含 book：三册课号都从 1 起，(lessonId,lineIndex) 大量跨册碰撞。
    const key = dailyQuoteIdentity(row.source_book, row.source_lesson_id, row.source_line_index);
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

function toItem(row: DailyQuoteEntity): DailyQuoteItem {
  return {
    cn: row.cn,
    en: row.en,
    source: {
      book: row.source_book,
      lessonId: row.source_lesson_id,
      title: row.source_title,
      lineIndex: row.source_line_index,
    },
  };
}

@Injectable()
export class DailyQuoteService {
  constructor(
    @InjectRepository(DailyQuoteEntity)
    private readonly repo: Repository<DailyQuoteEntity>,
  ) {}

  getPool(): Promise<DailyQuotesPool> {
    if (cached) return Promise.resolve(cached);
    if (inFlight) return inFlight;
    inFlight = this.loadFromDb()
      .then((pool) => {
        cached = pool;
        return pool;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  private async loadFromDb(): Promise<DailyQuotesPool> {
    let rows: DailyQuoteEntity[];
    try {
      rows = await this.repo.find({
        where: { pool_version: DAILY_QUOTES_FROZEN_VERSION },
        order: { ordinal: 'ASC' },
      });
    } catch {
      throw new Error('[daily-quotes] DB unavailable and no cache');
    }
    if (!shapeIsValid(rows)) {
      throw new Error('[daily-quotes] frozen DB pool shape invalid');
    }
    return {
      version: DAILY_QUOTES_FROZEN_VERSION,
      count: rows.length,
      items: rows.map(toItem),
    };
  }
}
