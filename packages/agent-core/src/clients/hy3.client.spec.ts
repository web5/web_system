/**
 * Hy3Client 生成参数组装最小回归面（T10，D1）。
 *
 * 防三处再漂移：payload 的 `thinking` 与 `max_tokens` 必须与共享函数
 * `resolveThinking` / `resolveMaxTokens` 输出一致（hy3/tokenhub/content-hub 同策略）。
 * 原「仅显式传才发」已废弃——非工具未配置也必须显式下发 disabled（P5）。
 */
import { Hy3Client } from './hy3.client';
import { resolveThinking, resolveMaxTokens, lookupModelMaxTokens } from './thinking-policy';
import { postJson } from '../lib/fetch-http';

jest.mock('../lib/fetch-http', () => ({
  postJson: jest.fn(),
  streamSse: jest.fn(),
}));

const mockPost = postJson as jest.MockedFunction<typeof postJson>;
const OK_RESP = {
  choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};
const MODEL_MAX = lookupModelMaxTokens('hy3');
const TOOL = {
  type: 'function' as const,
  function: {
    name: 't',
    description: 'd',
    parameters: { type: 'object' as const, properties: {}, required: [] },
  },
};

describe('Hy3Client.genParams → payload 与共享函数一致（T10）', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env.HY3_API_KEY = 'test-key';
    delete process.env.TOKENHUB_THINKING;
    delete process.env.MODEL_MAX_OUTPUT_TOKENS_JSON;
    mockPost.mockReset();
    mockPost.mockResolvedValue(OK_RESP as any);
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('非工具 + agent disabled：payload.thinking 与 max_tokens 与共享函数一致', async () => {
    const client = new Hy3Client();
    await client.chatWithTools(
      [{ role: 'user', content: 'hi', ts: Date.now() }],
      [],
      { maxTokens: 500, agentThinking: { type: 'disabled' } },
    );
    const payload = mockPost.mock.calls[0][1] as Record<string, any>;
    const expected = resolveThinking({
      hasTools: false,
      maxTokens: 500,
      agentThinking: { type: 'disabled' },
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 2000,
    });
    expect(payload.thinking).toEqual(expected!.thinking);
    expect(payload.max_tokens).toBe(
      resolveMaxTokens({ hasTools: false, maxTokens: 500, modelMaxTokens: MODEL_MAX, clientDefault: 2000 }),
    );
  });

  it('带工具 + 一切未配：强制 enabled + max_tokens=模型上限（与共享函数一致）', async () => {
    const client = new Hy3Client();
    await client.chatWithTools([{ role: 'user', content: 'hi', ts: Date.now() }], [TOOL], {});
    const payload = mockPost.mock.calls[0][1] as Record<string, any>;
    const expected = resolveThinking({
      hasTools: true,
      maxTokens: undefined,
      modelMaxTokens: MODEL_MAX,
      clientDefaultMaxTokens: 2000,
    });
    expect(payload.thinking).toEqual(expected!.thinking);
    expect(payload.thinking).toEqual({
      type: 'enabled',
      budget_tokens: Math.max(1, Math.floor(Math.min(MODEL_MAX, MODEL_MAX / 2))),
    });
    expect(payload.max_tokens).toBe(MODEL_MAX);
  });

  it('omitThinking=true：payload 整体不含 thinking 字段（wire-format 逃生口）', async () => {
    const client = new Hy3Client();
    await client.chatWithTools([{ role: 'user', content: 'hi', ts: Date.now() }], [], {
      maxTokens: 500,
      omitThinking: true,
    });
    const payload = mockPost.mock.calls[0][1] as Record<string, any>;
    expect(payload).not.toHaveProperty('thinking');
  });
});
