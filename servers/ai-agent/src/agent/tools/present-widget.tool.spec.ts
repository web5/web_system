import { PresentWidgetTool } from './present-widget.tool';

describe('PresentWidgetTool', () => {
  const tool = new PresentWidgetTool();
  const ctx = { userId: 'u-demo', runId: 'r-demo', deps: {} };

  it('元数据：工具名 present-widget，app 三选一白名单进 schema enum', () => {
    expect(tool.name).toBe('present-widget');
    const schema = tool.toSchema();
    expect(schema.function.name).toBe('present-widget');
    expect(schema.function.parameters.properties.app.enum).toEqual(['poll', 'chart', 'form']);
    expect(schema.function.parameters.required).toEqual(['app', 'props']);
  });

  it.each(['poll', 'chart', 'form'])('合法 app=%s：成功并返回 {app, props} JSON 信封', async (app) => {
    const props = { question: '周末去哪', options: [{ id: 'a', label: '公园', votes: 3 }] };
    const res = await tool.execute({ app, props }, ctx);
    expect(res.success).toBe(true);
    expect(res.error).toBeUndefined();
    expect(JSON.parse(res.content)).toEqual({ app, props });
  });

  it('空 props 放行（widget 侧回退默认 props）', async () => {
    const res = await tool.execute({ app: 'form', props: {} }, ctx);
    expect(res.success).toBe(true);
    expect(JSON.parse(res.content)).toEqual({ app: 'form', props: {} });
  });

  it('props 深层清洗：剔除 __proto__ / constructor / prototype 污染键（含嵌套）', async () => {
    const dirty = JSON.parse(
      '{"question":"q","__proto__":{"polluted":1},"constructor":{"x":1},"nested":{"prototype":{"y":2},"ok":true}}',
    );
    const res = await tool.execute({ app: 'poll', props: dirty }, ctx);
    expect(res.success).toBe(true);
    const parsed = JSON.parse(res.content) as { props: Record<string, Record<string, unknown>> };
    expect(Object.keys(parsed.props)).toEqual(['question', 'nested']);
    expect(Object.keys(parsed.props.nested)).toEqual(['ok']);
    // 全局原型未被污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('app 不在白名单：抛错（ToolRegistry 转 tool_result 错误 → 转译层降级文本）', async () => {
    await expect(tool.execute({ app: 'evil-app', props: {} }, ctx)).rejects.toThrow(/白名单|poll/);
  });

  it('app 缺失或非字符串：抛错', async () => {
    await expect(tool.execute({ props: {} }, ctx)).rejects.toThrow();
    await expect(tool.execute({ app: 123, props: {} }, ctx)).rejects.toThrow();
  });

  it('props 缺失 / 非对象 / 数组：抛错', async () => {
    await expect(tool.execute({ app: 'poll' }, ctx)).rejects.toThrow();
    await expect(tool.execute({ app: 'poll', props: 'not-object' }, ctx)).rejects.toThrow();
    await expect(tool.execute({ app: 'poll', props: [1, 2] }, ctx)).rejects.toThrow();
  });

  it('props 不可 JSON 序列化（环状引用）：抛错而非产出坏 fence', async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    await expect(tool.execute({ app: 'chart', props: circular }, ctx)).rejects.toThrow(/序列化/);
  });
});
