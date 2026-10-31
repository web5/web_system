import { Injectable, Logger } from '@nestjs/common';

/**
 * 机构行为数据服务
 * 数据来源：东方财富公开 datacenter / push2 / reportapi 接口（免费、无需授权）。
 * 每个维度独立 try/catch，失败时返回 { ok:false, error }，由上游框架降级标注低置信度。
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** 六位代码 -> 东财 secid（1.=沪 0.=深） */
function toSecid(code: string): string {
  let c = (code || '').replace(/\.(SH|SZ|BJ)$/i, '').replace(/^(SH|SZ|BJ)/i, '').trim();
  c = c.replace(/\D/g, '');
  if (!c) return '';
  const market = /^6|9|5/.test(c) ? '1' : '0';
  return `${market}.${c}`;
}

/** 统一 GET（带 UA / 超时 / JSON 解析） */
async function emGet(url: string, timeoutMs = 12000): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
      signal: ctrl.signal as any,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 六位代码（去掉 SH/SZ/BJ 前后缀与非数字） */
function toDigits(code: string): string {
  return (code || '')
    .replace(/\.(SH|SZ|BJ)$/i, '')
    .replace(/^(SH|SZ|BJ)/i, '')
    .replace(/\D/g, '');
}

/**
 * 六位代码 -> 东财 F10 路径参数（SH600150 / SZ000001 / BJ920002）。
 * 920 段是北交所新代码段（实测 BJ920002 可用），必须先于「9 → 沪市」判断；
 * 8/4 开头按北交所；判不了一律按沪市（东财会回「股票代码不合法」，由上层降级）。
 */
function toF10Code(code: string): string {
  const c = toDigits(code);
  if (!c) return '';
  let market: 'SH' | 'SZ' | 'BJ';
  if (/^(920|8|4)/.test(c)) market = 'BJ';
  else if (/^(6|9|5)/.test(c)) market = 'SH';
  else if (/^(0|3|2)/.test(c)) market = 'SZ';
  else market = 'SH';
  return `${market}${c}`;
}

/** 安全数值：null / '' / 非数值 -> undefined（不产出 NaN / null 脏值） */
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 东财金额单位为元，直接给调用方读不动 -> 同时给亿元（保留 2 位） */
function toYi(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round((n / 1e8) * 100) / 100;
}

/** F10 股东研究 gdrs 行（只声明用到的字段；数值在接口里可能是 string / null） */
interface GdrsRow {
  END_DATE?: string | null;
  HOLDER_TOTAL_NUM?: number | string | null;
  TOTAL_NUM_RATIO?: number | string | null;
  AVG_FREE_SHARES?: number | string | null;
  AVG_FREESHARES_RATIO?: number | string | null;
  AVG_HOLD_AMT?: number | string | null;
  HOLD_FOCUS?: string | null;
  HOLD_RATIO_TOTAL?: number | string | null;
  FREEHOLD_RATIO_TOTAL?: number | string | null;
}

/** 东财 RPT_LICO_FN_CPD 行（只声明用到的字段） */
interface FinanceRow {
  SECURITY_NAME_ABBR?: string | null;
  REPORTDATE?: string | null;
  DATATYPE?: string | null;
  TOTAL_OPERATE_INCOME?: number | string | null;
  PARENT_NETPROFIT?: number | string | null;
  YSTZ?: number | string | null;
  SJLTZ?: number | string | null;
  BASIC_EPS?: number | string | null;
  WEIGHTAVG_ROE?: number | string | null;
  XSMLL?: number | string | null;
  BPS?: number | string | null;
  MGJYXJJE?: number | string | null;
  BOARD_NAME?: string | null;
  PUBLISHNAME?: string | null;
}

export interface InstResult {
  ok: boolean;
  code: string;
  data?: any;
  error?: string;
  note?: string;
}

function ok(code: string, data: unknown, note?: string): InstResult {
  return { ok: true, code, data, note };
}
function fail(code: string, error: string, note?: string): InstResult {
  return { ok: false, code, error, note };
}

/** 腾讯行情 qt.gtimg.cn 实时快照（GBK 编码，~ 分隔）。返回解析后的字段或 null */
async function tencentQuote(code: string): Promise<any | null> {
  try {
    const prefix = /^(6|9|5)/.test(code) ? 'sh' : 'sz';
    const url = `https://qt.gtimg.cn/q=${prefix}${code}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: 'https://gu.qq.com/' },
      signal: ctrl.signal as any,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    let txt: string;
    try {
      txt = new TextDecoder('gbk').decode(buf);
    } catch {
      txt = buf.toString('latin1'); // 数值字段均为 ASCII，中文名可能乱码但可忽略
    }
    const inner = txt.split('"')[1] || '';
    const f = inner.split('~');
    if (f.length < 50 || !f[3]) return null;
    return {
      name: f[1],
      code: f[2],
      close: Number(f[3]),
      prev_close: Number(f[4]),
      open: Number(f[5]),
      time: f[30],
      change: Number(f[31]),
      pct_change: Number(f[32]),
      high: Number(f[33]),
      low: Number(f[34]),
      turnover: Number(f[38]), // 换手率 %
      pe_ttm: Number(f[39]),
      amplitude: Number(f[43]), // 振幅 %
      float_market_cap_yi: Number(f[44]), // 流通市值 亿
      total_market_cap_yi: Number(f[45]), // 总市值 亿
      pb: Number(f[46]),
      limit_up: Number(f[47]),
      limit_down: Number(f[48]),
      volume_ratio: Number(f[49]), // 量比
      avg_price: Number(f[51]),
      pe_dynamic: Number(f[52]),
      pe_static: Number(f[53]),
    };
  } catch {
    return null;
  }
}

/**
 * 业绩字段中文映射。上游是 LLM / 前端，东财内部字段名（YSTZ / SJLTZ / MGJYXJJE）
 * 没人猜得出，缺了映射等于「数据在但没人敢用」。
 */
const FINANCE_LABELS: Record<string, string> = {
  name: '证券简称',
  report_date: '报告期',
  report_name: '报告期名称',
  revenue_yuan: '营业总收入(元)',
  revenue_yi: '营业总收入(亿元)',
  revenue_yoy: '营业总收入同比(%)',
  net_profit_yuan: '归母净利润(元)',
  net_profit_yi: '归母净利润(亿元)',
  net_profit_yoy: '归母净利润同比(%)',
  eps: '基本每股收益(元)',
  roe: '加权平均净资产收益率(%)',
  gross_margin: '销售毛利率(%)',
  bps: '每股净资产(元)',
  ocf_per_share: '每股经营现金流(元)',
  board: '所属板块',
};

/** 筹码代理指标字段中文映射 */
const CHIP_LABELS: Record<string, string> = {
  market: '市场(SH/SZ/BJ)',
  end_date: '报告期',
  holder_total_num: '股东户数(户)',
  holder_num_change_ratio: '股东户数较上期变化(%)',
  avg_free_shares: '户均持股(股)',
  avg_free_shares_change_ratio: '户均持股较上期变化(%)',
  avg_hold_amt_yuan: '户均持股市值(元)',
  hold_focus: '东财持股集中度档位(文字)',
  top10_hold_ratio: '前十大股东持股比例合计(%)',
  top10_float_hold_ratio: '前十大流通股东持股比例合计(%)',
  history: '近两期户数序列',
};

/**
 * 业绩降级提示。原 RPT_F10_FN_MAIN 已下架（东财返回「报表配置不存在」），
 * 这里只负责「换源后仍失败」的兜底，替代工具必须点名，否则上游只能瞎猜。
 */
const FINANCE_DEGRADE_NOTE =
  '东财业绩报表（RPT_LICO_FN_CPD）本次取数失败；可改用 get_valuation(PE/PB) 与 get_rating(EPS 预测) 作业绩代理，或人工核对财报。';

/**
 * 筹码 ok 时也必须带的语义边界（实测结论，非推测）：
 * 2026-10 实测 RPT_CYQ_DEFAULT 返回「报表配置不存在」，push2his .../chip/get 返回 HTTP 404，
 * 东财已无公开成本分布数据；F10 股东研究只能给股东户数/持股集中度这类**代理指标**。
 */
const CHIP_PROXY_NOTE =
  '本结果是「股东户数与持股集中度」代理指标，不是成本分布/获利比例（无获利盘比例、无成本区间）。'
  + '原筹码报表 RPT_CYQ_DEFAULT 已被东财下架、push2his 的 chip 分时接口返回 404（2026-10 实测），故改用 F10 股东研究。'
  + '读法：股东户数下降 + 户均持股上升，通常对应筹码趋于集中（散户离场），反之趋于分散；hold_focus 是东财的文字档位（字符串枚举，如「非常分散」），不是数值。';

/** 筹码失败降级提示：必须点名替代工具，否则上游只能瞎猜 */
const CHIP_DEGRADE_NOTE =
  '东财 F10 股东研究接口本次取数失败（原 RPT_CYQ_DEFAULT 报表已下架、push2his chip 接口 404）；'
  + '可改用 get_valuation（估值/换手）与 get_rating（机构评级）作为代理，成本区请人工核对。';

@Injectable()
export class InstitutionService {
  private readonly logger = new Logger(InstitutionService.name);

  /** 实时行情快照（腾讯行情 qt.gtimg.cn 直连） */
  async getQuote(code: string): Promise<InstResult> {
    try {
      const q = await tencentQuote(code);
      if (!q) return fail(code, '腾讯行情接口无数据', 'qt.gtimg.cn 直连失败或无此标的');
      return ok(code, q);
    } catch (e) {
      return fail(code, (e as Error).message, '腾讯行情接口异常');
    }
  }

  /** 北向资金个股持股（沪深港通） */
  async getNorthHolding(code: string): Promise<InstResult> {
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_MUTUAL_HOLD_DET&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=50&sortColumns=HOLD_DATE&sortTypes=-1`;
      const json = await emGet(url);
      const list: any[] = json?.result?.data ?? [];
      if (!list.length) return fail(code, '无北向持股数据', '该标的非沪深港通或暂无北向持仓');
      // 取最新日期
      const dates = [...new Set(list.map((r) => r.HOLD_DATE?.slice(0, 10)))].filter(Boolean);
      const latest = dates[0];
      const latestRows = list.filter((r) => (r.HOLD_DATE || '').slice(0, 10) === latest);
      const totalCap = latestRows.reduce((s, r) => s + Number(r.HOLD_MARKET_CAP || 0), 0);
      const top = [...latestRows]
        .sort((a, b) => Number(b.HOLD_MARKET_CAP || 0) - Number(a.HOLD_MARKET_CAP || 0))
        .slice(0, 3)
        .map((r) => ({
          org: r.ORG_NAME,
          hold_cap_wan: Math.round(Number(r.HOLD_MARKET_CAP || 0) / 1e4),
          hold_ratio: r.HOLD_SHARES_RATIO,
        }));
      return ok(code, {
        hold_date: latest,
        org_count: latestRows.length,
        total_hold_cap_wan: Math.round(totalCap / 1e4),
        top_orgs: top,
      });
    } catch (e) {
      return fail(code, (e as Error).message, '北向接口异常');
    }
  }

  /** 主力资金流（东财 push2delay 直连：当日主力净流入 + 近 N 日 + 腾讯实时价） */
  async getFundFlow(code: string, days = 10): Promise<InstResult> {
    try {
      const secid = toSecid(code);
      if (!secid) return fail(code, '代码解析失败');
      const url = `https://push2delay.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${days}&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;
      const json = await emGet(url);
      const klines: string[] = json?.data?.klines ?? [];
      if (!klines.length) return fail(code, '无资金流数据');
      const rows = klines.map((k) => {
        const p = k.split(',');
        return {
          date: p[0],
          main_net_inflow: Number(p[1]), // 主力净流入(元)
          close: Number(p[7]),
          pct_change: Number(p[8]),
        };
      });
      const recent = rows.slice(-5);
      const sum5 = recent.reduce((s, r) => s + r.main_net_inflow, 0);
      const last = rows[rows.length - 1];
      // 附带腾讯实时价
      const q = await tencentQuote(code);
      return ok(code, {
        secid,
        days: rows.length,
        last_main_net_inflow: last.main_net_inflow,
        last_close: last.close,
        last_pct_change: last.pct_change,
        sum5_main_net_inflow: sum5,
        trend: sum5 > 0 ? '近5日主力净流入' : '近5日主力净流出',
        recent: rows,
        quote: q
          ? {
              realtime_price: q.close,
              realtime_pct_change: q.pct_change,
              time: q.time,
            }
          : undefined,
      });
    } catch (e) {
      return fail(code, (e as Error).message, '资金流接口异常');
    }
  }

  /** 龙虎榜（机构席位买卖） */
  async getLhb(code: string, limit = 5): Promise<InstResult> {
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=${limit}&sortColumns=TRADE_DATE&sortTypes=-1`;
      const json = await emGet(url);
      const list: any[] = json?.result?.data ?? [];
      if (!list.length) return fail(code, '近期限无龙虎榜记录');
      const rows = list.map((r) => ({
        trade_date: (r.TRADE_DATE || '').slice(0, 10),
        explain: r.EXPLAIN || r.EXPLANATION,
        close: r.CLOSE_PRICE,
        change_rate: r.CHANGE_RATE,
        buy_amt_wan: Math.round(Number(r.BILLBOARD_BUY_AMT || 0) / 1e4),
        sell_amt_wan: Math.round(Number(r.BILLBOARD_SELL_AMT || 0) / 1e4),
        reason: r.EXPLANATION,
      }));
      return ok(code, { count: rows.length, recent: rows });
    } catch (e) {
      return fail(code, (e as Error).message, '龙虎榜接口异常');
    }
  }

  /** 机构评级与盈利预测 */
  async getRating(code: string): Promise<InstResult> {
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_WEB_RESPREDICT&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=5`;
      const json = await emGet(url);
      const list: any[] = json?.result?.data ?? [];
      if (!list.length) return fail(code, '无机构评级数据');
      const r = list[0];
      return ok(code, {
        org_num: r.RATING_ORG_NUM,
        buy_num: r.RATING_BUY_NUM,
        add_num: r.RATING_ADD_NUM,
        neutral_num: r.RATING_NEUTRAL_NUM,
        EPS_forecast: [
          { year: r.YEAR1, mark: r.YEAR_MARK1, eps: r.EPS1 },
          { year: r.YEAR2, mark: r.YEAR_MARK2, eps: r.EPS2 },
          { year: r.YEAR3, mark: r.YEAR_MARK3, eps: r.EPS3 },
        ].filter((x) => x.eps != null),
        industry: r.INDUSTRY_BOARD,
      });
    } catch (e) {
      return fail(code, (e as Error).message, '评级接口异常');
    }
  }

  /** 研报列表 */
  async getReport(code: string, days = 180, limit = 10): Promise<InstResult> {
    try {
      const end = new Date();
      const begin = new Date(Date.now() - days * 86400000);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const url = `https://reportapi.eastmoney.com/report/list?industryCode=*&pageSize=${limit}&pageNo=1&sortType=1&code=${code}&qType=0&beginTime=${fmt(begin)}&endTime=${fmt(end)}`;
      const json = await emGet(url);
      const list: any[] = json?.data ?? [];
      if (!list.length) return fail(code, '近期无研报');
      const rows = list.map((r) => ({
        title: r.title,
        org: r.orgSName || r.orgName,
        date: (r.publishDate || '').slice(0, 10),
        rating: r.rating,
        eps_next_year: r.predictNextYearEps,
        pe_next_year: r.predictNextYearPe,
      }));
      return ok(code, { count: rows.length, recent: rows });
    } catch (e) {
      return fail(code, (e as Error).message, '研报接口异常');
    }
  }

  /** 估值（腾讯行情实时：PE/PB/市值/现价） */
  async getValuation(code: string): Promise<InstResult> {
    try {
      const q = await tencentQuote(code);
      if (!q) return fail(code, '腾讯行情接口无数据');
      return ok(code, {
        pe_ttm: q.pe_ttm,
        pe_dynamic: q.pe_dynamic,
        pe_static: q.pe_static,
        pb_mrq: q.pb,
        total_market_cap_yi: q.total_market_cap_yi,
        float_market_cap_yi: q.float_market_cap_yi,
        close: q.close,
        prev_close: q.prev_close,
        change: q.change,
        change_rate: q.pct_change,
        high: q.high,
        low: q.low,
        turnover: q.turnover,
        amplitude: q.amplitude,
        volume_ratio: q.volume_ratio,
        time: q.time,
        source: 'qt.gtimg.cn 实时',
      });
    } catch (e) {
      return fail(code, (e as Error).message, '估值接口异常');
    }
  }

  /**
   * 筹码集中度（代理指标）。
   *
   * 原实现调 `RPT_CYQ_DEFAULT`（东财筹码分布报表）——2026-10 实测该报表已下架
   * （`success:false` + 「报表配置不存在,RPT_CYQ_DEFAULT」），`push2his` 的
   * chip 分时接口也已 404，公开渠道已**没有**成本分布 / 获利比例数据。
   *
   * 现改用东财 F10 股东研究 PageAjax 的 `gdrs`（股东户数）：给股东户数、较上期变化率、
   * 户均持股、持股集中度档位，并在 `note` 里写清「这是代理指标、不是成本分布」——
   * 不写清楚，上游会把它当获利比例直接引用。
   */
  async getChip(code: string): Promise<InstResult> {
    const f10 = toF10Code(code);
    if (!f10) return fail(code, '代码解析失败', CHIP_DEGRADE_NOTE);
    try {
      const url = `https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=${f10}`;
      const json = await emGet(url);
      // 非法代码不是 HTTP 错误：东财回 HTTP 200 + { status:-1, message:'股票代码不合法' }
      const rows = (Array.isArray(json?.gdrs) ? json.gdrs : []) as GdrsRow[];
      if (!rows.length) {
        return fail(code, json?.message || '无股东户数数据', CHIP_DEGRADE_NOTE);
      }
      // 接口原始顺序不可信（实测非严格倒序），按 END_DATE 自己排
      const ordered = [...rows].sort((a, b) =>
        String(b?.END_DATE || '').localeCompare(String(a?.END_DATE || '')),
      );
      const latest = ordered[0];
      const history = ordered.slice(0, 2).map((r) => ({
        end_date: (r?.END_DATE || '').slice(0, 10) || undefined,
        holder_total_num: num(r?.HOLDER_TOTAL_NUM),
        change_ratio: num(r?.TOTAL_NUM_RATIO),
      }));
      return ok(
        code,
        {
          market: f10.slice(0, 2),
          end_date: (latest?.END_DATE || '').slice(0, 10) || undefined,
          holder_total_num: num(latest?.HOLDER_TOTAL_NUM),
          holder_num_change_ratio: num(latest?.TOTAL_NUM_RATIO),
          avg_free_shares: num(latest?.AVG_FREE_SHARES),
          avg_free_shares_change_ratio: num(latest?.AVG_FREESHARES_RATIO),
          avg_hold_amt_yuan: num(latest?.AVG_HOLD_AMT),
          hold_focus: latest?.HOLD_FOCUS ?? undefined,
          // 实测交叉验证：HOLD_RATIO_TOTAL = 前十大股东持股比例之和（600150 2026Q3 为 56.46）
          top10_hold_ratio: num(latest?.HOLD_RATIO_TOTAL),
          top10_float_hold_ratio: num(latest?.FREEHOLD_RATIO_TOTAL),
          history,
          labels: CHIP_LABELS,
        },
        CHIP_PROXY_NOTE,
      );
    } catch (e) {
      return fail(code, (e as Error).message, CHIP_DEGRADE_NOTE);
    }
  }

  /**
   * 业绩同比（营收 / 归母净利）。
   *
   * 原实现调 `RPT_F10_FN_MAIN` —— 2026-10 实测同样下架（「报表配置不存在,RPT_F10_FN_MAIN」）。
   * 现改 `RPT_LICO_FN_CPD`（业绩报表·单季度/累计），字段比原报表更直接：
   * TOTAL_OPERATE_INCOME / YSTZ / PARENT_NETPROFIT / SJLTZ 就是要的营收、营收同比、归母净利、净利同比。
   * 用服务端排序取最近报告期——排序一丢就会拿到十几年前的财报，数字看着正常、结论全错。
   */
  async getFinanceYoy(code: string): Promise<InstResult> {
    const c = toDigits(code);
    if (!c) return fail(code, '代码解析失败', FINANCE_DEGRADE_NOTE);
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=ALL&filter=(SECURITY_CODE%3D%22${c}%22)&pageSize=1&sortColumns=REPORTDATE&sortTypes=-1`;
      const json = await emGet(url);
      const list = (json?.result?.data ?? []) as FinanceRow[];
      if (json?.success === false || !list.length) {
        return fail(code, json?.message || '无业绩数据', FINANCE_DEGRADE_NOTE);
      }
      const r = list[0];
      return ok(code, {
        name: r?.SECURITY_NAME_ABBR ?? undefined,
        report_date: (r?.REPORTDATE || '').slice(0, 10) || undefined,
        report_name: r?.DATATYPE ?? undefined,
        revenue_yuan: num(r?.TOTAL_OPERATE_INCOME),
        revenue_yi: toYi(r?.TOTAL_OPERATE_INCOME),
        revenue_yoy: num(r?.YSTZ),
        net_profit_yuan: num(r?.PARENT_NETPROFIT),
        net_profit_yi: toYi(r?.PARENT_NETPROFIT),
        net_profit_yoy: num(r?.SJLTZ),
        eps: num(r?.BASIC_EPS),
        roe: num(r?.WEIGHTAVG_ROE),
        gross_margin: num(r?.XSMLL),
        bps: num(r?.BPS),
        ocf_per_share: num(r?.MGJYXJJE),
        board: r?.BOARD_NAME || r?.PUBLISHNAME || undefined,
        source: '东方财富 RPT_LICO_FN_CPD',
        labels: FINANCE_LABELS,
      });
    } catch (e) {
      return fail(code, (e as Error).message, FINANCE_DEGRADE_NOTE);
    }
  }
}
