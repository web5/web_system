/**
 * CQO 枚举与 DTO 的一致性契约（p35）。
 *
 * 锁两件漂移了也**不报错**、只会静默出错的事：
 *   ① DTO 层把 status / stage / trigger 又抄了一份字符串常量数组。与 quality.enum 一旦不同步，
 *      接口收进来的值就和写入库里的值对不上 —— 统计 SQL 静默漏数据，页面上永远不会红。
 *   ② 查询类 DTO 的边界与类型转换：HTTP query 全是字符串，靠 @Type(() => Number) 转换，
 *      转换失败（NaN）必须被挡在门外，而不是带着 NaN 一路走进 SQL。
 * 依赖 main.ts 的全局 ValidationPipe（whitelist + forbidNonWhitelisted）——
 * 没有它，这些装饰器只是一层类型提示。
 */
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import {
  ListItemsQueryDto,
  TriggerCollectDto,
  QUALITY_STATUS_VALUES as DTO_STATUS_VALUES,
  QUALITY_STAGE_VALUES as DTO_STAGE_VALUES,
  COLLECT_TRIGGER_VALUES as DTO_TRIGGER_VALUES,
} from '../dto/content-quality.dto';
import { QUALITY_STATUS, QUALITY_STAGE, COLLECT_TRIGGER } from './quality.enum';

/** 走与 ValidationPipe 相同的校验选项，返回出错的字段名 */
async function errorProps<T extends object>(
  dtoClass: ClassConstructor<T>,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(dtoClass, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('CQO 枚举与 DTO 一致性', () => {
  it('DTO 的 quality_status 取值必须与 quality.enum 完全一致', () => {
    expect(sorted(DTO_STATUS_VALUES)).toEqual(sorted(Object.values(QUALITY_STATUS)));
  });

  it('DTO 的 quality_stage 取值必须与 quality.enum 完全一致（含 fallback）', () => {
    expect(sorted(DTO_STAGE_VALUES)).toEqual(sorted(Object.values(QUALITY_STAGE)));
  });

  it('DTO 的 trigger 取值必须与 quality.enum 完全一致', () => {
    expect(sorted(DTO_TRIGGER_VALUES)).toEqual(sorted(Object.values(COLLECT_TRIGGER)));
  });

  it('skip 与 fallback 两个语义值必须在枚举内 —— 删掉等于统计口径悄悄变形', () => {
    expect(DTO_STATUS_VALUES).toContain('skip');
    expect(DTO_STAGE_VALUES).toContain('fallback');
  });
});

describe('ListItemsQueryDto 边界与类型转换', () => {
  it('空查询合法 —— limit / offset 有默认值', async () => {
    expect(await errorProps(ListItemsQueryDto, {})).toEqual([]);
  });

  it('字符串数字会被 @Type(() => Number) 转换后放行（query 天然是字符串）', async () => {
    expect(await errorProps(ListItemsQueryDto, { limit: '50', offset: '10' })).toEqual([]);
  });

  const BAD_LIMITS: Array<[unknown, string]> = [
    [0, 'limit 下限 1'],
    [201, 'limit 上限 200'],
    ['abc', '非数字字符串转出 NaN'],
  ];

  it.each(BAD_LIMITS)('limit=%p 必须被挡住（%s）', async (limit) => {
    expect(await errorProps(ListItemsQueryDto, { limit })).toContain('limit');
  });

  it('offset 负数被挡住', async () => {
    expect(await errorProps(ListItemsQueryDto, { offset: -1 })).toContain('offset');
  });

  it('未声明的查询参数被 whitelist 拦掉（forbidNonWhitelisted）', async () => {
    expect(await errorProps(ListItemsQueryDto, { bogus_field: 1 })).toContain('bogus_field');
  });
});

describe('TriggerCollectDto 采集条数上限', () => {
  it('limit=100 放行（服务端再 clamp 一次）', async () => {
    expect(await errorProps(TriggerCollectDto, { limit: 100 })).toEqual([]);
  });

  it('limit=101 被挡住 —— 人工触发不许无界拉取', async () => {
    expect(await errorProps(TriggerCollectDto, { limit: 101 })).toContain('limit');
  });
});
