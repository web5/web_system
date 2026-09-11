import { ConfigService } from '@nestjs/config';
import { ModelPricingCatalog, calcCost, parseDictPricing } from './model-pricing.catalog';

/** 字典内部接口的响应形状（system-service `/internal/dict/:code`） */
const dictResponse = (rows: Array<{ value: string; attrs?: Record<string, unknown> }>) => ({
  code: 0,
  data: rows.map((r) => ({ value: r.value, label: r.value, sort: 0, attrs: r.attrs ?? null })),
});

function makeCatalog(cfg: Record<string, string> = {}): ModelPricingCatalog {
  const config = new ConfigService({
    SYSTEM_SERVICE_URL: 'http://system.test',
    INTERNAL_API_KEY: 'k',
    PRICE_POLL_MS: '60000',
    ...cfg,
  });
  return new ModelPricingCatalog(config);
}

describe('parseDictPricing', () => {
  it('解析出配了价格的模型，currency 默认 CNY', () => {
    const map = parseDictPricing([
      { value: 'hy4-preview', attrs: { input_price_per1k: 0.000002, output_price_per1k: 0.000006 } },
    ]);

    expect(map.get('hy4-preview')).toEqual({
      inputPricePer1k: 0.000002,
      outputPricePer1k: 0.000006,
      currency: 'CNY',
    });
  });

  it('未配价格的模型不进缓存（成本按 0 处理）', () => {
    const map = parseDictPricing([{ value: 'glm-5.3', attrs: { provider: 'tokenhub' } }]);
    expect(map.has('glm-5.3')).toBe(false);
  });

  it('只有一个价格字段时，另一个按 0 计', () => {
    const map = parseDictPricing([
      { value: 'kimi-k3', attrs: { output_price_per1k: 0.00001 } },
    ]);
    expect(map.get('kimi-k3')).toEqual({
      inputPricePer1k: 0,
      outputPricePer1k: 0.00001,
      currency: 'CNY',
    });
  });

  it('非法数值按未配置处理，不抛错', () => {
    const map = parseDictPricing([
      { value: 'bad', attrs: { input_price_per1k: 'abc', output_price_per1k: -1 } },
    ]);
    expect(map.has('bad')).toBe(false);
  });

  it('忽略空 value', () => {
    const map = parseDictPricing([{ value: '', attrs: { input_price_per1k: 1 } }]);
    expect(map.size).toBe(0);
  });
});

describe('calcCost', () => {
  it('按每 1K tokens 计算（输入价×prompt + 输出价×completion）/ 1000', () => {
    const cost = calcCost(
      { inputPricePer1k: 0.001, outputPricePer1k: 0.002, currency: 'CNY' },
      1000,
      500,
    );
    expect(cost).toBeCloseTo(0.001 + 0.001, 10);
  });

  it('token 为 0 时成本为 0', () => {
    expect(calcCost({ inputPricePer1k: 1, outputPricePer1k: 1, currency: 'CNY' }, 0, 0)).toBe(0);
  });
});

describe('ModelPricingCatalog', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('从字典同步后可按模型取价', async () => {
    global.fetch = jest.fn(async () =>
      ({
        ok: true,
        json: async () =>
          dictResponse([
            { value: 'hy4-preview', attrs: { input_price_per1k: 0.000002, output_price_per1k: 0.000006 } },
          ]),
      }) as any,
    ) as any;

    const catalog = makeCatalog();
    await catalog.sync();

    expect(catalog.get('hy4-preview')?.inputPricePer1k).toBe(0.000002);
    expect(catalog.get('unknown-model')).toBeUndefined();
    expect(catalog.source).toBe('dict');
  });

  it('拉取失败保留上一次缓存（不因字典抖动把成本打成 0）', async () => {
    global.fetch = jest.fn(async () =>
      ({
        ok: true,
        json: async () => dictResponse([{ value: 'm1', attrs: { input_price_per1k: 0.001 } }]),
      }) as any,
    ) as any;
    const catalog = makeCatalog();
    await catalog.sync();

    global.fetch = jest.fn(async () => {
      throw new Error('boom');
    }) as any;
    await catalog.sync();

    expect(catalog.get('m1')?.inputPricePer1k).toBe(0.001); // 旧值仍在
  });

  it('PRICE_SOURCE=legacy 时不从字典取价（交给调用方查旧表）', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const catalog = makeCatalog({ PRICE_SOURCE: 'legacy' });
    await catalog.sync();

    expect(catalog.source).toBe('legacy');
    expect(catalog.get('m1')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('未配置 INTERNAL_API_KEY 时不发请求（无法鉴权）', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    const catalog = makeCatalog({ INTERNAL_API_KEY: '' });
    await catalog.sync();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
