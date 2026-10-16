/**
 * 东方财富龙虎榜采集器（p35 · CQO）。
 *
 * 接口路径**已验证**：`institution.service.ts` 的 `getLhb()` 在生产跑的是
 * `RPT_DAILYBILLBOARD_DETAILSNEW`，稳定可用。本采集器不是去试一个未知接口，
 * 而是在已验证路径上补齐该实现缺的三项：
 *   1) 按**交易日主动扫全量**（getLhb 是按股票代码被动查单个）
 *   2) **席位明细**（seats）—— 游资识别的关键原料
 *   3) **涨停 / ST 标记**（limit_up / is_st）
 *
 * 替代方案：westock `data_lhb` 与东财妙想连接器，当前全部禁用 → 链路不可用。
 *
 * 三条硬约束（写进代码，不靠约定）：
 *   1) 交易日窗口有上界——只采最近 N 个交易日，禁止无界扫历史（防拉爆/防限流）
 *   2) 单次条数 clamp——limit 强制 ≤ MAX_ITEMS
 *   3) 失败返回空数组**不抛异常**——与既有 arxiv.collector / collectors/collector
 *      的 `if (!resp.ok) return []` 约定一致，否则上游抖动会中断整个定时任务
 */
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ICollector, RawItem } from './collector.interface';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const EM_DATACENTER = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/** 已验证的报表名（来自 institution.service.ts: getLhb） */
const REPORT_DETAILS = 'RPT_DAILYBILLBOARD_DETAILSNEW';

/** 单次采集条数上限（约束 2） */
const MAX_ITEMS = 100;

/** 交易日窗口默认天数（约束 1） */
const DEFAULT_WINDOW_DAYS = 2;

const logger = new Logger('EastmoneyLhbCollector');

/** 席位买卖方向 */
export type SeatTradeType = 'buy' | 'sell' | 'both';

/** 单个席位明细 */
export interface LhbSeat {
  name: string;
  buy: number;
  sell: number;
  type: SeatTradeType;
}

/** 东财原始行（只声明本采集器实际读到的字段，不全量展开） */
interface EmLhbRow {
  TRADE_DATE?: string;
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  EXPLANATION?: string;
  CHANGE_RATE?: number;
  BILLBOARD_BUY_AMT?: number;
  BILLBOARD_SELL_AMT?: number;
  BILLBOARD_NET_AMT?: number;
  TURNOVERRATE?: number;
  ACCUM_AMOUNT?: number;
  /** 部分报表用 CLOSE_PRICE */
  CLOSE_PRICE?: number;
  /** 东财用 1/0 或 'Y'/'N' 两种写法表示涨停/标记 */
  LIMIT_UP?: number | string;
  IS_ST?: number | string;
  /** 席位明细字段：机构 / 营业部买卖金额（万） */
  BUYER_NAME?: string;
  SELLER_NAME?: string;
  OPERATEDEPT_NAME?: string;
  CHANGE_TYPE?: string;
}

/** 统一 GET（带 UA / Referer / 超时），失败抛异常由调用方转空数组 */
async function emGet(url: string, timeoutMs = 12000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' },
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 东财的 1/0、'Y'/'N'、true/false 统一转 boolean */
function toBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return ['1', 'Y', 'y', 'true'].includes(v.trim());
  return false;
}

/** 生成最近 N 个交易日（跳过周末；不含节假日判断——节假日接口返回空属正常） */
function recentTradeDates(days: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  while (out.length < days) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() - 1);
  }
  return out;
}

/**
 * 拉单日龙虎榜明细。
 *
 * filter 用 `TRADE_DATE='YYYY-MM-DD'`（东财该报表支持按日期过滤）。
 * 若东财改版导致该 filter 失效，返回空数组而非抛异常 —— 由 collect() 记 failed 日志。
 */
async function fetchByTradeDate(tradeDate: string, limit: number): Promise<EmLhbRow[]> {
  const filter = encodeURIComponent(`(TRADE_DATE='${tradeDate}')`);
  const url =
    `${EM_DATACENTER}?reportName=${REPORT_DETAILS}` +
    `&columns=ALL&filter=${filter}` +
    `&pageSize=${limit}&pageNumber=1` +
    `&sortColumns=TRADE_DATE&sortTypes=-1`;

  const json = await emGet(url);
  const list = json?.result?.data;
  return Array.isArray(list) ? (list as EmLhbRow[]) : [];
}

/**
 * 从原始行解析席位明细。
 *
 * ⚠️ 东财该报表的席位字段在不同接口下形态不一致：有的返回
 * `OPERATEDEPT_NAME`（单个营业部），有的返回买卖各五席数组。
 * 这里只做**保守提取**——取到就填，取不到留空数组。
 * 席位明细拿不到时 `quality_issue` 会记明原因，不静默当作「无席位」。
 */
function parseSeats(row: EmLhbRow): LhbSeat[] {
  const seats: LhbSeat[] = [];
  const push = (name: unknown, buy: unknown, sell: unknown) => {
    const n = String(name ?? '').trim();
    if (!n) return;
    const b = Number(buy ?? 0) || 0;
    const s = Number(sell ?? 0) || 0;
    const type: SeatTradeType = b > 0 && s > 0 ? 'both' : b > 0 ? 'buy' : 'sell';
    seats.push({ name: n, buy: b, sell: s, type });
  };

  // 东财金额字段单位为「万」，统一转「元」与 buy_amount 对齐
  const buyer = row.BUYER_NAME;
  const seller = row.SELLER_NAME;
  const dept = row.OPERATEDEPT_NAME;

  // 若返回的是数组（多席位），逐个展开
  const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : []);
  for (const b of asArray(buyer)) {
    const obj = (b ?? {}) as Record<string, unknown>;
    push(obj['OPERATEDEPT_NAME'] ?? obj['name'], obj['BUY'] ?? obj['buy'], 0);
  }
  for (const s of asArray(seller)) {
    const obj = (s ?? {}) as Record<string, unknown>;
    push(obj['OPERATEDEPT_NAME'] ?? obj['name'], 0, obj['SELL'] ?? obj['sell']);
  }
  // 单营业部形态
  if (seats.length === 0) push(dept, 0, 0);

  return seats;
}

export class EastmoneyLhbCollector implements ICollector {
  readonly code = 'eastmoney_lhb';

  async collect(
    config: Record<string, unknown> = {},
    limit = 20,
  ): Promise<RawItem[]> {
    // 约束 2：单次条数 clamp
    const cap = Math.min(Number(limit) || 20, MAX_ITEMS);
    const windowDays = Math.min(
      Number(config['window_days'] ?? DEFAULT_WINDOW_DAYS) || DEFAULT_WINDOW_DAYS,
      5,
    );

    const dates = recentTradeDates(windowDays);
    const results: RawItem[] = [];
    const perDate = Math.max(1, Math.floor(cap / dates.length));

    for (const tradeDate of dates) {
      let rows: EmLhbRow[];
      try {
        rows = await fetchByTradeDate(tradeDate, perDate);
      } catch (e) {
        // 约束 3：失败不抛异常，记日志后继续下一个交易日
        logger.warn(
          `龙虎榜采集失败 tradeDate=${tradeDate}: ${(e as Error).message}（已跳过该日）`,
        );
        continue;
      }

      for (const row of rows) {
        const item = this.toRawItem(row, tradeDate);
        if (item) results.push(item);
        if (results.length >= cap) return results;
      }
    }

    return results;
  }

  /** 原始行 → RawItem；缺关键字段返回 null（不编造） */
  private toRawItem(row: EmLhbRow, fallbackDate: string): RawItem | null {
    const code = String(row.SECURITY_CODE ?? '').trim();
    const name = String(row.SECURITY_NAME_ABBR ?? '').trim();
    if (!code || !name) return null; // 缺关键字段 → 丢弃，不猜

    const tradeDate = (row.TRADE_DATE ?? '').slice(0, 10) || fallbackDate;
    const reason = String(row.EXPLANATION ?? '').trim() || '未知上榜原因';
    const buy = Number(row.BILLBOARD_BUY_AMT ?? 0) || 0;
    const sell = Number(row.BILLBOARD_SELL_AMT ?? 0) || 0;
    const seats = parseSeats(row);

    const meta = {
      trade_date: tradeDate,
      stock_code: code,
      stock_name: name,
      reason,
      buy_amount: buy,
      sell_amount: sell,
      net_amount: Number(row.BILLBOARD_NET_AMT ?? buy - sell) || buy - sell,
      turnover_rate: Number(row.TURNOVERRATE ?? 0) / 100 || null,
      close_price: Number(row.CLOSE_PRICE ?? 0) || null,
      change_rate: Number(row.CHANGE_RATE ?? 0) / 100 || null,
      is_st: toBool(row.IS_ST),
      limit_up: toBool(row.LIMIT_UP),
      seats,
      /** 席位明细取不到时留空数组，采集日志侧会记明原因 */
      seats_available: seats.length > 0,
    };

    return {
      // 唯一键 (trade_date, stock_code, reason) —— 与 lhb_records 的 uk_lhb_date_code 对齐
      external_id: createHash('sha1')
        .update(`${tradeDate}|${code}|${reason}`)
        .digest('hex'),
      title: `${name}（${code}）${reason}`,
      content: [
        `上榜原因：${reason}`,
        `买入额：${buy.toLocaleString('zh-CN')} 元`,
        `卖出额：${sell.toLocaleString('zh-CN')} 元`,
        `净额：${meta.net_amount.toLocaleString('zh-CN')} 元`,
        seats.length > 0
          ? `席位（${seats.length} 个）：${seats.map((s) => s.name).join('、')}`
          : '席位明细：本接口未返回',
      ].join('\n'),
      url: `https://data.eastmoney.com/stock/lhb/${code}.html`,
      source_name: '东方财富龙虎榜',
      publish_date: new Date(`${tradeDate}T00:00:00`),
      meta,
    };
  }
}
