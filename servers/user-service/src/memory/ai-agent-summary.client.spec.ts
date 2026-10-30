import { ConfigService } from '@nestjs/config';
import { AiAgentSummaryClient } from './ai-agent-summary.client';

/**
 * AiAgentSummaryClient 单测（#8229 架构修正 · 静默降级修复）：
 *
 * 核心契约：ai-agent 的 UnifiedExceptionFilter 把一切异常包成 **HTTP 200** +
 * { code, message, data }，因此 `res.ok` 恒为 true。客户端必须依据 body.code 判定失败，
 * 否则「密钥错配 / internal 未授权 / 对端异常」会被当成「空摘要」静默回落模板聚合。
 *
 * 覆盖：
 * - code=4010（守卫拒绝）→ 抛错，且错误信息带 code 与 message
 * - code=5000（对端异常）→ 抛错
 * - code=0 + summary → 正常返回
 * - body 无 code 字段但有 summary（向后兼容老响应/裸 body）→ 正常返回
 * - 真实 HTTP 非 2xx（框架将来改回真实状态码）→ 仍抛错
 * - code=0 但 summary 缺失 → 返回空串（交由上层判空回落模板）
 */
describe('AiAgentSummaryClient', () => {
  const originalFetch = global.fetch;

  function makeClient(overrides?: { url?: string; key?: string }) {
    const config = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'AI_AGENT_URL') return overrides?.url ?? 'http://ai-agent:6010';
        if (key === 'USER_SERVICE_KEY') return overrides?.key ?? 'service-key-1';
        return def;
      }),
    } as unknown as ConfigService;
    return new AiAgentSummaryClient(config);
  }

  function mockJson(status: number, payload: unknown) {
    const fn = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(payload),
    });
    global.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  const items = [{ category: 'fact', content: '用户叫小豆包' }];

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('code=4010（x-service-key 校验失败，HTTP 200 包裹）→ 抛错', async () => {
    mockJson(200, { code: 4010, message: 'x-service-key 校验失败', data: null });
    const client = makeClient();
    await expect(client.summarize('13', 'general', items, 1)).rejects.toThrow(/code=4010/);
    await expect(client.summarize('13', 'general', items, 1)).rejects.toThrow(/x-service-key 校验失败/);
  });

  it('code=5000（对端未捕获异常，HTTP 200 包裹）→ 抛错', async () => {
    mockJson(200, { code: 5000, message: '服务器开小差了，请稍后重试', data: null });
    const client = makeClient();
    await expect(client.summarize('13', 'general', items, 1)).rejects.toThrow(/code=5000/);
  });

  it('code=0 + summary（顶层，防御性兼容）→ 正常返回摘要正文', async () => {
    mockJson(200, { code: 0, summary: '# 用户画像\n- 事实：用户叫小豆包', message: 'success' });
    const client = makeClient();
    await expect(client.summarize('13', 'general', items, 1)).resolves.toBe('# 用户画像\n- 事实：用户叫小豆包');
  });

  it('body 无 code 字段但有 summary（向后兼容）→ 正常返回', async () => {
    mockJson(200, { summary: '# 用户画像\n- 事实：用户叫小豆包', model: 'hy3', itemCount: 1 });
    const client = makeClient();
    await expect(client.summarize('13', 'general', items, 1)).resolves.toBe('# 用户画像\n- 事实：用户叫小豆包');
  });

  it('真实 HTTP 502（非 2xx）→ 仍抛错（保留 res.ok 判定）', async () => {
    mockJson(502, {});
    const client = makeClient();
    await expect(client.summarize('13', 'general', items, 1)).rejects.toThrow(/502/);
  });

  it('code=0 但 summary 缺失 → 返回空串（交由上层判空回落模板）', async () => {
    mockJson(200, { code: 0, message: 'success' });
    const client = makeClient();
    await expect(client.summarize('13', 'general', items, 1)).resolves.toBe('');
  });

  it('请求按约定组装：URL、x-service-key 头、body 字段', async () => {
    const fn = mockJson(200, { code: 0, summary: 'ok' });
    const client = makeClient({ url: 'http://ai-agent:6010/', key: 'k-abc' });
    await client.summarize('13', 'general', items, 1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('http://ai-agent:6010/internal/llm/memory-summary');
    expect((init as any).method).toBe('POST');
    expect((init as any).headers['x-service-key']).toBe('k-abc');
    expect(JSON.parse((init as any).body)).toEqual({
      userId: '13',
      namespace: 'general',
      itemCount: 1,
      items,
    });
  });
});
