/**
 * 机构行为数据 —— 筹码 / 业绩两个工具的数据源单测。
 *
 * 锁的是「东财报表下架后这两个工具还能不能给出真数据」的四件事，坏了都不会报错、
 * 只会让上游 LLM 一直拿着「接口不可用」的结论去做排雷：
 *   ① 业绩必须来自**可用报表** RPT_LICO_FN_CPD，且取的是**最近报告期**（排序一旦丢了，
 *      就会拿到 2010 年的老财报，数字看着正常、结论全错）。
 *   ② 字段必须做**中文映射**：上游是 LLM / 前端，`YSTZ` / `SJLTZ` / `MGJYXJJE` 这种
 *      东财内部字段名没人猜得出，映射缺失 = 数据在但没人敢用。
 *   ③ 筹码只能给**代理指标**（股东户数 / 持股集中度），且必须在返回里写明
 *      「这不是成本分布」——原 RPT_CYQ_DEFAULT 已下架、push2his chip 接口 404，
 *      不写清楚就会被当成获利比例直接引用。
 *   ④ 失败必须**保留东财原文**并给出替代工具，不能把四种不同故障糊成一类。
 */
import { InstitutionService } from './institution.service';

/** 实测抓回：600150 中国船舶 2026 三季报，https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD（2026-10 抓取，字段裁剪未改值） */
const LICO_CPD_OK = {
  version: 'afa7ce63b78632ad0a5d16970d129adf',
  result: {
    pages: 111,
    data: [
      {
        SECURITY_CODE: '600150',
        SECURITY_NAME_ABBR: '中国船舶',
        TRADE_MARKET: '上交所主板',
        SECURITY_TYPE: 'A股',
        UPDATE_DATE: '2026-10-31 00:00:00',
        REPORTDATE: '2026-09-30 00:00:00',
        BASIC_EPS: 1.786,
        DEDUCT_BASIC_EPS: null,
        TOTAL_OPERATE_INCOME: 131118382946.35,
        PARENT_NETPROFIT: 13440070099.25,
        WEIGHTAVG_ROE: 8.99,
        YSTZ: 22.0809683974,
        SJLTZ: 129.67,
        BPS: 20.428931613492,
        MGJYXJJE: 2.909375112502,
        XSMLL: 17.4653563525,
        YSHZ: -17.8958,
        SJLHZ: -31.9214,
        PUBLISHNAME: '航海装备Ⅱ',
        NOTICE_DATE: '2026-10-31 00:00:00',
        ISNEW: '1',
        QDATE: '2026Q3',
        DATATYPE: '2026年 三季报',
        DATAYEAR: '2026',
        DATEMMDD: '三季报',
        SECUCODE: '600150.SH',
        BOARD_NAME: '航海装备Ⅱ',
        BOARD_CODE: 'BK1230',
      },
    ],
    count: 111,
  },
  success: true,
  message: 'ok',
  code: 0,
};

/** 实测抓回：000001 平安银行 2026 三季报（银行无毛利率 XSMLL=null） */
const LICO_CPD_BANK = {
  result: {
    pages: 123,
    data: [
      {
        SECURITY_CODE: '000001',
        SECURITY_NAME_ABBR: '平安银行',
        REPORTDATE: '2026-09-30 00:00:00',
        BASIC_EPS: 1.94,
        TOTAL_OPERATE_INCOME: 103100000000,
        PARENT_NETPROFIT: 39186000000,
        WEIGHTAVG_ROE: 8.07,
        YSTZ: 2.4158620416,
        SJLTZ: 2.2,
        BPS: 24.564619189941,
        MGJYXJJE: 14.59450685355,
        XSMLL: null,
        PUBLISHNAME: '银行Ⅱ',
        QDATE: '2026Q3',
        DATATYPE: '2026年 三季报',
        SECUCODE: '000001.SZ',
        BOARD_NAME: '银行Ⅱ',
      },
    ],
    count: 123,
  },
  success: true,
  message: 'ok',
  code: 0,
};

/** 实测抓回：不存在代码 999999 → success:false */
const LICO_EMPTY_FAIL = {
  version: null,
  result: null,
  success: false,
  message: '返回数据为空',
  code: 9201,
};

/** 实测抓回：https://emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=SH600150（13 个顶层键裁剪为 gdrs，3 期数据按接口原始顺序） */
const GDRS_OK = {
  gdrs: [
    {
      SECUCODE: '600150.SH',
      SECURITY_CODE: '600150',
      END_DATE: '2026-06-30 00:00:00',
      HOLDER_TOTAL_NUM: 613881,
      TOTAL_NUM_RATIO: -15.0857,
      AVG_FREE_SHARES: 12259,
      AVG_FREESHARES_RATIO: 17.76582106304,
      HOLD_FOCUS: '非常分散',
      PRICE: 32.9687279678,
      AVG_HOLD_AMT: 404166.542103041,
      HOLD_RATIO_TOTAL: 56.24990328,
      FREEHOLD_RATIO_TOTAL: 56.24990328,
    },
    {
      SECUCODE: '600150.SH',
      SECURITY_CODE: '600150',
      END_DATE: '2026-09-30 00:00:00',
      HOLDER_TOTAL_NUM: 555007,
      TOTAL_NUM_RATIO: -9.5905,
      AVG_FREE_SHARES: 13559,
      AVG_FREESHARES_RATIO: 10.60779413593,
      HOLD_FOCUS: '非常分散',
      PRICE: 38.579119575,
      AVG_HOLD_AMT: 523113.840989244,
      HOLD_RATIO_TOTAL: 56.44630814,
      FREEHOLD_RATIO_TOTAL: 56.44630814,
    },
    {
      SECUCODE: '600150.SH',
      SECURITY_CODE: '600150',
      END_DATE: '2026-03-31 00:00:00',
      HOLDER_TOTAL_NUM: 722942,
      TOTAL_NUM_RATIO: -11.2374,
      AVG_FREE_SHARES: 10409,
      AVG_FREESHARES_RATIO: 39.64319162254,
      HOLD_FOCUS: '非常分散',
      PRICE: 30.0904282488,
      AVG_HOLD_AMT: 313232.82835166,
      HOLD_RATIO_TOTAL: 55.50108754,
      FREEHOLD_RATIO_TOTAL: 55.50108754,
    },
  ],
  sdltgd_date: ['2026-09-30'],
  sdgd_date: ['2026-09-30'],
};

/** 实测抓回：非法代码 → HTTP 200 + status:-1（不是 HTTP 错误，靠字段判） */
const GDRS_INVALID = { status: -1, message: '股票代码不合法' };

function mockFetchOnce(payload: any): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => payload,
  });
  (globalThis as any).fetch = fn;
  return fn;
}

function mockFetchReject(err: Error): jest.Mock {
  const fn = jest.fn().mockRejectedValue(err);
  (globalThis as any).fetch = fn;
  return fn;
}

/** 取第 n 次 fetch 的 URL */
function urlOf(fn: jest.Mock, n = 0): string {
  return String(fn.mock.calls[n]?.[0] ?? '');
}

describe('InstitutionService.getFinanceYoy（数据源 RPT_LICO_FN_CPD）', () => {
  const svc = new InstitutionService();
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('正常返回 → ok + 中文字段映射 + 东财金额同时给「亿元」', async () => {
    const fn = mockFetchOnce(LICO_CPD_OK);
    const r = await svc.getFinanceYoy('600150');

    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();

    const d = r.data;
    expect(d.name).toBe('中国船舶');
    expect(d.report_date).toBe('2026-09-30');
    expect(d.report_name).toBe('2026年 三季报');
    expect(d.revenue_yuan).toBeCloseTo(131118382946.35, 2);
    expect(d.revenue_yi).toBeCloseTo(1311.18, 2);
    expect(d.revenue_yoy).toBeCloseTo(22.0809683974, 6);
    expect(d.net_profit_yi).toBeCloseTo(134.4, 2);
    expect(d.net_profit_yoy).toBeCloseTo(129.67, 6);
    expect(d.eps).toBeCloseTo(1.786, 6);
    expect(d.roe).toBeCloseTo(8.99, 6);
    expect(d.gross_margin).toBeCloseTo(17.4653563525, 6);
    expect(d.bps).toBeCloseTo(20.428931613492, 6);
    expect(d.ocf_per_share).toBeCloseTo(2.909375112502, 6);
    expect(d.board).toBe('航海装备Ⅱ');

    // 中文映射是硬要求：没有 labels，上游只能看见 YSTZ / SJLTZ，等于数据不可用
    expect(d.labels.revenue_yoy).toContain('同比');
    expect(d.labels.net_profit_yoy).toContain('同比');
    expect(d.labels.revenue_yi).toContain('亿元');
    expect(d.labels.report_date).toContain('报告期');

    // 最近报告期靠服务端排序拿到，不能靠「碰巧第一条」
    const url = urlOf(fn);
    expect(url).toContain('reportName=RPT_LICO_FN_CPD');
    expect(url).toContain('sortColumns=REPORTDATE');
    expect(url).toContain('sortTypes=-1');
    expect(url).toContain('pageSize=1');
  });

  it('东财 success=false（如「返回数据为空」）→ ok:false，原文保留 + note 指向替代工具', async () => {
    mockFetchOnce(LICO_EMPTY_FAIL);
    const r = await svc.getFinanceYoy('999999');

    expect(r.ok).toBe(false);
    expect(r.error).toBe('返回数据为空');
    expect(r.note).toContain('get_valuation');
    expect(r.note).toContain('get_rating');
  });

  it('success=true 但 data 为空数组 → 也是 ok:false（不能把空 data 当成功）', async () => {
    mockFetchOnce({ success: true, message: 'ok', result: { pages: 0, data: [], count: 0 } });
    const r = await svc.getFinanceYoy('600150');

    expect(r.ok).toBe(false);
    expect(r.data).toBeUndefined();
    expect(r.note).toContain('get_valuation');
  });

  it('网络异常 → ok:false + note 指向替代工具，error 保留异常原文', async () => {
    mockFetchReject(new Error('fetch failed: ETIMEDOUT'));
    const r = await svc.getFinanceYoy('600150');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('ETIMEDOUT');
    expect(r.note).toContain('get_valuation');
  });

  it('字段为 null（银行无毛利率）→ 缺省而不是 NaN / null 脏值', async () => {
    mockFetchOnce(LICO_CPD_BANK);
    const r = await svc.getFinanceYoy('000001');

    expect(r.ok).toBe(true);
    expect(r.data.gross_margin).toBeUndefined();
    expect(r.data.name).toBe('平安银行');
    expect(r.data.revenue_yi).toBeCloseTo(1031, 2);
  });
});

describe('InstitutionService.getChip（数据源 F10 股东研究，代理指标）', () => {
  const svc = new InstitutionService();
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('正常返回 → ok + 户数/变化率/户均持股/集中度，并写明「不是成本分布」', async () => {
    const fn = mockFetchOnce(GDRS_OK);
    const r = await svc.getChip('600150');

    expect(r.ok).toBe(true);
    const d = r.data;
    expect(d.market).toBe('SH');
    expect(d.end_date).toBe('2026-09-30');
    expect(d.holder_total_num).toBe(555007);
    expect(d.holder_num_change_ratio).toBeCloseTo(-9.5905, 4);
    expect(d.avg_free_shares).toBe(13559);
    expect(d.avg_hold_amt_yuan).toBeCloseTo(523113.840989244, 3);
    expect(d.hold_focus).toBe('非常分散');
    // 实测交叉验证：HOLD_RATIO_TOTAL = 十大股东持股比例合计（56.46 ≈ 前10名持股比例之和）
    expect(d.top10_hold_ratio).toBeCloseTo(56.44630814, 6);
    expect(d.top10_float_hold_ratio).toBeCloseTo(56.44630814, 6);

    // 语义边界必须写在返回里：上游会把它当获利比例直接引用
    expect(r.note).toContain('代理');
    expect(r.note).toContain('不是成本分布');
    expect(r.note).toContain('RPT_CYQ_DEFAULT');

    expect(urlOf(fn)).toContain('ShareholderResearch/PageAjax?code=SH600150');
  });

  it('只取最近 2 期，按 END_DATE 倒序（接口原始顺序不可信）', async () => {
    mockFetchOnce(GDRS_OK);
    const r = await svc.getChip('600150');

    expect(r.data.history).toHaveLength(2);
    expect(r.data.history[0].end_date).toBe('2026-09-30');
    expect(r.data.history[1].end_date).toBe('2026-06-30');
    expect(r.data.history[1].holder_total_num).toBe(613881);
  });

  it.each([
    ['600150', 'SH600150'],
    ['000001', 'SZ000001'],
    ['300750', 'SZ300750'],
    ['688981', 'SH688981'],
    ['920002', 'BJ920002'],
    ['830799', 'BJ830799'],
    ['sh600150', 'SH600150'],
    ['600150.SH', 'SH600150'],
  ])('代码 %s → F10 前缀 %s', async (code, expected) => {
    const fn = mockFetchOnce(GDRS_OK);
    await svc.getChip(code);
    expect(urlOf(fn)).toContain(`code=${expected}`);
  });

  it('非法代码 status:-1 → ok:false，东财原文保留 + note 给出替代工具', async () => {
    mockFetchOnce(GDRS_INVALID);
    const r = await svc.getChip('999999');

    expect(r.ok).toBe(false);
    expect(r.error).toBe('股票代码不合法');
    expect(r.note).toContain('get_valuation');
    expect(r.note).toContain('get_rating');
  });

  it('网络异常 → ok:false + note 给出替代工具', async () => {
    mockFetchReject(new Error('getaddrinfo ENOTFOUND emweb.securities.eastmoney.com'));
    const r = await svc.getChip('600150');

    expect(r.ok).toBe(false);
    expect(r.error).toContain('ENOTFOUND');
    expect(r.note).toContain('get_valuation');
  });
});
