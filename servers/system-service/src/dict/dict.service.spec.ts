import { BadRequestException } from '@nestjs/common';
import { DictService } from './dict.service';
import { DictField } from './dict-field.entity';

/**
 * 极简内存 repo：只实现被测路径用到的方法。
 * 不引入 @nestjs/testing —— DictService 的依赖就是三个 Repository，直接构造即可。
 */
function makeRepo(rows: any[] = []) {
  const matches = (row: any, where?: Record<string, any>) =>
    !where || Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    rows,
    find: jest.fn(async (opt?: any) => rows.filter((r) => matches(r, opt?.where))),
    findOne: jest.fn(async (opt?: any) => rows.find((r) => matches(r, opt?.where)) ?? null),
    count: jest.fn(async (opt?: any) => rows.filter((r) => matches(r, opt?.where)).length),
    create: jest.fn((v: any) => ({ ...v })),
    save: jest.fn(async (v: any) => {
      const list = Array.isArray(v) ? v : [v];
      rows.push(...list);
      return v;
    }),
    delete: jest.fn(async () => ({ affected: 0 })),
    remove: jest.fn(async () => ({ ok: true })),
  };
}

function build(seed: { types?: any[]; fields?: any[]; items?: any[] } = {}) {
  const typeRepo = makeRepo(seed.types ?? []);
  const fieldRepo = makeRepo(seed.fields ?? []);
  const itemRepo = makeRepo(seed.items ?? []);
  const svc = new DictService(typeRepo as any, fieldRepo as any, itemRepo as any);
  return { svc, typeRepo, fieldRepo, itemRepo };
}

/** 模型价格相关字段（本次新增的三个） */
const PRICE_FIELDS = ['input_price_per1k', 'output_price_per1k', 'currency'];

const llmFieldNames = (rows: any[]) =>
  rows.filter((f) => f.typeCode === 'llm_models').map((f) => f.name);

describe('DictService.ensureBuiltin —— 内置字段按 name 增量补齐', () => {
  it('字典还没有任何字段时全量补齐（含三个价格字段）', async () => {
    const { svc, fieldRepo } = build();

    await svc.ensureBuiltin();

    expect(llmFieldNames(fieldRepo.rows)).toEqual(
      expect.arrayContaining([
        'provider',
        'context_window',
        'supports_vision',
        'note',
        ...PRICE_FIELDS,
      ]),
    );
  });

  it('已有部分字段时只补缺失，且不覆盖已存在字段（保护人工改动）', async () => {
    const { svc, fieldRepo } = build({
      fields: [{ typeCode: 'llm_models', name: 'provider', label: '我改过的标签', type: 'string' }],
    });

    await svc.ensureBuiltin();

    const provider = fieldRepo.rows.find(
      (f) => f.typeCode === 'llm_models' && f.name === 'provider',
    );
    expect(provider.label).toBe('我改过的标签'); // 不被内置定义覆盖
    expect(llmFieldNames(fieldRepo.rows)).toContain('input_price_per1k'); // 缺失的被补上
    expect(
      fieldRepo.rows.filter((f) => f.typeCode === 'llm_models' && f.name === 'provider'),
    ).toHaveLength(1); // 不重复插入
  });

  it('幂等：连续执行两次不产生重复字段', async () => {
    const { svc, fieldRepo } = build();

    await svc.ensureBuiltin();
    const afterFirst = fieldRepo.rows.length;
    await svc.ensureBuiltin();

    expect(fieldRepo.rows.length).toBe(afterFirst);
  });
});

describe('DictService.validateAttrs —— 价格字段校验', () => {
  const fields = [
    { name: 'input_price_per1k', label: '输入价/1K', type: 'number', length: 8, required: false },
    { name: 'output_price_per1k', label: '输出价/1K', type: 'number', length: 8, required: false },
    { name: 'currency', label: '币种', type: 'enum', options: ['CNY', 'USD'], defaultValue: 'CNY' },
  ] as unknown as DictField[];

  it('合法价格按数字落库', () => {
    const out = build().svc.validateAttrs(fields, { input_price_per1k: 0.000002 });
    expect(out.input_price_per1k).toBe(0.000002);
  });

  it('非数字值报错并指明字段', () => {
    expect(() => build().svc.validateAttrs(fields, { input_price_per1k: 'abc' })).toThrow(
      BadRequestException,
    );
  });

  it('整数位超出上限报错', () => {
    expect(() => build().svc.validateAttrs(fields, { input_price_per1k: 123456789 })).toThrow(
      /位数超出上限/,
    );
  });

  it('currency 缺省时回填默认值 CNY', () => {
    const out = build().svc.validateAttrs(fields, {});
    expect(out.currency).toBe('CNY');
  });

  it('currency 取非枚举值报错', () => {
    expect(() => build().svc.validateAttrs(fields, { currency: 'EUR' })).toThrow(
      /取值必须是/,
    );
  });
});
