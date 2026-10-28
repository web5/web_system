/**
 * TokenHubClient 密钥兜底回归测试（P0 REQ-2 密钥兜底断裂修复）。
 *
 * 根因：TokenHubClient.getApiKey() 只读 TOKENHUB_API_KEY → HY3_API_KEY，
 * 漏了 LLM_API_KEY 兜底——content-hub 的 resolveApiKey() 三级兜底链会选出
 * LLM_API_KEY，但传给 client 后 client 自己又从 env 读，读不到就报「不可用」。
 *
 * 修复：① getApiKey() 补 LLM_API_KEY 兜底；② 构造参数 apiKey 显式优先。
 */
import { TokenHubClient } from './tokenhub.client';
import { resolveThinking, resolveMaxTokens, lookupModelMaxTokens } from './thinking-policy';
import { postJson } from '../lib/fetch-http';

jest.mock('../lib/fetch-http', () => ({
  postJson: jest.fn(),
  streamSse: jest.fn(),
}));

describe('TokenHubClient.getApiKey() 密钥兜底链', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    // 清空所有相关 key，隔离测试
    delete process.env.TOKENHUB_API_KEY;
    delete process.env.HY3_API_KEY;
    delete process.env.LLM_API_KEY;
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('仅设 LLM_API_KEY 时 getApiKey() 返回该值（P0 回归）', () => {
    process.env.LLM_API_KEY = 'test-llm-key';
    const client = new TokenHubClient('test-model');
    // getApiKey 是 private，用类型断言访问
    expect((client as any).getApiKey()).toBe('test-llm-key');
  });

  it('TOKENHUB_API_KEY 优先级最高', () => {
    process.env.TOKENHUB_API_KEY = 'tok-key';
    process.env.HY3_API_KEY = 'hy3-key';
    process.env.LLM_API_KEY = 'llm-key';
    const client = new TokenHubClient('test-model');
    expect((client as any).getApiKey()).toBe('tok-key');
  });

  it('HY3_API_KEY 回落（无 TOKENHUB_API_KEY 时）', () => {
    process.env.HY3_API_KEY = 'hy3-key';
    process.env.LLM_API_KEY = 'llm-key';
    const client = new TokenHubClient('test-model');
    expect((client as any).getApiKey()).toBe('hy3-key');
  });

  it('无任何 env key 时返回空串', () => {
    const client = new TokenHubClient('test-model');
    expect((client as any).getApiKey()).toBe('');
  });

  it('构造参数 apiKey 优先于环境变量', () => {
    process.env.TOKENHUB_API_KEY = 'env-key';
    const client = new TokenHubClient('test-model', undefined, 'explicit-key');
    expect((client as any).getApiKey()).toBe('explicit-key');
  });

  it('仅设 LLM_API_KEY 时 isAvailable() 返回 true', () => {
    process.env.LLM_API_KEY = 'test-llm-key';
    const client = new TokenHubClient('test-model');
    expect(client.isAvailable()).toBe(true);
  });

  it('无任何 key 时 isAvailable() 返回 false', () => {
    const client = new TokenHubClient('test-model');
    expect(client.isAvailable()).toBe(false);
  });
});

const mockPost = postJson as jest.MockedFunction<typeof postJson>;
const OK_RESP = {
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};
const TOOL = {
  type: 'function' as const,
  function: {
    name: 't',
    description: 'd',
    parameters: { type: 'object' as const, properties: {}, required: [] },
  },
};

describe('TokenHubClient.genParams → payload 与共享函数一致（T10）', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.TOKENHUB_API_KEY = 'test-key';
    delete process.env.TOKENHUB_THINKING;
    delete process.env.MODEL_MAX_OUTPUT_TOKENS_JSON;
    mockPost.mockReset();
    mockPost.mockResolvedValue(OK_RESP as any);
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('非工具 + agent disabled：payload.thinking 与 max_tokens 与共享函数一致', async () => {
    const client = new TokenHubClient('hy4-preview');
    await client.chatWithTools(
      [{ role: 'user', content: 'hi', ts: Date.now() }],
      [],
      { maxTokens: 500, agentThinking: { type: 'disabled' } },
    );
    const payload = mockPost.mock.calls[0][1] as Record<string, any>;
    const modelMaxTokens = lookupModelMaxTokens('hy4-preview');
    const expected = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      agentThinking: { type: 'disabled' },
      modelMaxTokens,
      clientDefaultMaxTokens: 8000,
    });
    expect(payload.thinking).toEqual(expected!.thinking);
    expect(payload.max_tokens).toBe(
      resolveMaxTokens({ hasTools: false, maxTokens: 500, modelMaxTokens, clientDefault: 8000 }),
    );
  });

  it('带工具 + 显式 disabled 被纠正；deepseek 系不再按模型名注入 budget:1024', async () => {
    const client = new TokenHubClient('deepseek-v4-flash');
    await client.chatWithTools([{ role: 'user', content: 'hi', ts: Date.now() }], [TOOL], {
      thinking: { type: 'disabled' },
    });
    const payload = mockPost.mock.calls[0][1] as Record<string, any>;
    const modelMaxTokens = lookupModelMaxTokens('deepseek-v4-flash');
    const expected = resolveThinking({
      hasTools: true,
      maxTokens: undefined,
      override: { type: 'disabled' },
      modelMaxTokens,
      clientDefaultMaxTokens: 8000,
    });
    expect(payload.thinking).toEqual(expected!.thinking);
    expect(payload.thinking).toEqual({
      type: 'enabled',
      budget_tokens: Math.max(1, Math.floor(Math.min(modelMaxTokens, modelMaxTokens / 2))),
    });
    // 回归：旧代码对 deepseek 系硬编码 budget:1024，新策略一律公式值
    expect((payload.thinking as any).budget_tokens).not.toBe(1024);
    expect(payload.max_tokens).toBe(modelMaxTokens);
  });

  it('非工具未配置 deepseek：P5 disabled（旧「模型名推断 budget:1024」已删除）', async () => {
    const client = new TokenHubClient('deepseek-v4-flash');
    await client.chatWithTools([{ role: 'user', content: 'hi', ts: Date.now() }], [], {});
    const payload = mockPost.mock.calls[0][1] as Record<string, any>;
    expect(payload.thinking).toEqual({ type: 'disabled' });
    expect(payload.max_tokens).toBe(8000); // 非工具未配 → 客户端现状默认透传
  });
});
