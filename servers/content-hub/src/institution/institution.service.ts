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

export interface InstResult {
  ok: boolean;
  code: string;
  data?: any;
  error?: string;
  note?: string;
}

function ok(code: string, data: any): InstResult {
  return { ok: true, code, data };
}
function fail(code: string, error: string, note?: string): InstResult {
  return { ok: false, code, error, note };
}

@Injectable()
export class InstitutionService {
  private readonly logger = new Logger(InstitutionService.name);

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

  /** 主力资金流（近 N 日净流入） */
  async getFundFlow(code: string, days = 10): Promise<InstResult> {
    try {
      const secid = toSecid(code);
      if (!secid) return fail(code, '代码解析失败');
      const url = `https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${days}&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;
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
      return ok(code, {
        secid,
        days: rows.length,
        last_main_net_inflow: last.main_net_inflow,
        last_close: last.close,
        last_pct_change: last.pct_change,
        sum5_main_net_inflow: sum5,
        trend: sum5 > 0 ? '近5日主力净流入' : '近5日主力净流出',
        recent: rows,
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

  /** 估值（PE/PB/市值） */
  async getValuation(code: string): Promise<InstResult> {
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_VALUEANALYSIS_DET&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=1`;
      const json = await emGet(url);
      const list: any[] = json?.result?.data ?? [];
      if (!list.length) return fail(code, '无估值数据');
      const r = list[0];
      return ok(code, {
        pe_ttm: r.PE_TTM,
        pe_lyr: r.PE_LAR,
        pb_mrq: r.PB_MRQ,
        pcf_ocf: r.PCF_OCF_LAR,
        total_market_cap_yi: Math.round(Number(r.TOTAL_MARKET_CAP || 0) / 1e8),
        close: r.CLOSE_PRICE,
        change_rate: r.CHANGE_RATE,
        board: r.BOARD_NAME,
      });
    } catch (e) {
      return fail(code, (e as Error).message, '估值接口异常');
    }
  }

  /** 筹码分布（东财该报表当前可能不可用 -> 优雅降级） */
  async getChip(code: string): Promise<InstResult> {
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_CYQ_DEFAULT&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=1`;
      const json = await emGet(url);
      const list: any[] = json?.result?.data ?? [];
      if (!list.length || json?.success === false) {
        return fail(code, json?.message || '无筹码数据', '东方财富筹码分布接口当前不可用，建议人工核对成本区');
      }
      return ok(code, list[0]);
    } catch (e) {
      return fail(code, (e as Error).message, '东方财富筹码分布接口当前不可用，建议人工核对成本区');
    }
  }

  /** 业绩同比（营收/净利）— 东财 F10 报表已下架，优雅降级 */
  async getFinanceYoy(code: string): Promise<InstResult> {
    try {
      const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_F10_FN_MAIN&columns=ALL&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=2`;
      const json = await emGet(url);
      const list: any[] = json?.result?.data ?? [];
      if (!list.length || json?.success === false) {
        return fail(code, json?.message || '无业绩数据', '东方财富 F10 业绩报表接口已下架；可用 get_valuation(PE) 与 get_rating(EPS预测) 作业绩代理，或人工核对财报');
      }
      return ok(code, list[0]);
    } catch (e) {
      return fail(code, (e as Error).message, '东方财富 F10 业绩报表接口已下架；可用 get_valuation 与 get_rating 作业绩代理');
    }
  }
}
