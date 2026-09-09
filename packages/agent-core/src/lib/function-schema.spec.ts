/**
 * toFunctionSchema 单测（Phase1.2：ToolParameter 支持 enum / 嵌套 object / array）
 *
 * 目标：从 ToolParameter（含扩展字段）自动生成 OpenAI 风格 function schema，
 * 让 enum/items/嵌套 properties 真正出现在发给模型的 tools payload 中。
 */
import { toFunctionSchema } from './function-schema';
import { ToolParameter } from '../interfaces/tool.interface';

describe('toFunctionSchema', () => {
  it('普通 string/number/boolean 参数原样序列化并提升 required', () => {
    const params: Record<string, ToolParameter> = {
      path: { type: 'string', description: '路径', required: true },
      retries: { type: 'number', description: '次数', required: false },
      dryRun: { type: 'boolean', description: '试跑', required: false },
    };
    const schema = toFunctionSchema('t', '测试工具', params);
    expect(schema.function.parameters.required).toEqual(['path']);
    expect(schema.function.parameters.properties.path).toMatchObject({ type: 'string', description: '路径' });
    expect(schema.function.parameters.properties.retries).toMatchObject({ type: 'number' });
  });

  it('string enum 参数会完整序列化到 properties（供模型约束取值）', () => {
    const params: Record<string, ToolParameter> = {
      mode: {
        type: 'string',
        description: '写入模式',
        required: false,
        enum: ['create', 'overwrite', 'append'],
      },
    };
    const schema = toFunctionSchema('write-file', '写入', params);
    expect(schema.function.parameters.properties.mode).toMatchObject({
      type: 'string',
      enum: ['create', 'overwrite', 'append'],
    });
  });

  it('array 参数序列化 items（含元素为嵌套类型）', () => {
    const params: Record<string, ToolParameter> = {
      tags: { type: 'array', description: '标签', required: true, items: { type: 'string', description: '标签项' } },
    };
    const schema = toFunctionSchema('t', '标签', params);
    expect(schema.function.parameters.required).toEqual(['tags']);
    expect(schema.function.parameters.properties.tags).toMatchObject({
      type: 'array',
      items: { type: 'string', description: '标签项' },
    });
  });

  it('object 参数序列化嵌套 properties（含深层 enum）', () => {
    const params: Record<string, ToolParameter> = {
      filter: {
        type: 'object',
        description: '过滤条件',
        required: false,
        properties: {
          field: { type: 'string', description: '字段' },
          op: { type: 'string', description: '操作符', required: true, enum: ['eq', 'ne', 'gt'] },
        },
      },
    };
    const schema = toFunctionSchema('t', '过滤', params);
    const filter = schema.function.parameters.properties.filter as any;
    expect(filter.type).toBe('object');
    expect(filter.properties.op.enum).toEqual(['eq', 'ne', 'gt']);
    expect(filter.properties.field).toMatchObject({ type: 'string' });
  });

  it('无参数时返回空 properties', () => {
    const schema = toFunctionSchema('noop', '无参', {});
    expect(schema.function.parameters.properties).toEqual({});
    expect(schema.function.parameters.required).toEqual([]);
  });
});
